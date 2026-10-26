// ═══════════════════════════════════════════════════════════════════════
// SERVICE REQUEST FULFILLMENT WORKFLOW
// ═══════════════════════════════════════════════════════════════════════
// Every Service Request moves through a fixed sequence of stages, each
// owned by exactly one role at a time — that role is the "person in
// charge" who needs to act next. RequestWorkflowHistory is the append-only
// timeline; CurrentStage/PersonInChargeRole on the request itself always
// mirrors the latest row there, kept redundant for fast reads (dashboard,
// list views) without needing a join every time.
//
//   VA Assignment (Service Manager)
//     ├─ VA assigned ──────────────────────────────┐
//     └─ No VA available → Recruitment (Recruitment)
//                              └─ found candidate → Training (Training)
//                                    └─ trained → back to VA Assignment
//                                                                        │
//   VA Preparation & Mock Interview (Service Manager) ◄─────────────────┘
//     └─ done → Rate Agreement (HR Specialist)
//                  └─ agreed → Kick Off Call (CS Specialist)
//                                └─ done → VA-Client Connection Call (CS Specialist)
//                                             └─ accepted → Start VA (CS Specialist)
//                                                              └─ started → Completed
// ═══════════════════════════════════════════════════════════════════════

var WORKFLOW_STAGES = {
  REQUEST_INTAKE:      { label: 'Request Intake',                    role: 'CS Specialist' },
  MANAGEMENT_APPROVAL: { label: 'Management Approval',              role: 'Executive' },
  VA_ASSIGNMENT:      { label: 'VA Assignment',                     role: 'Service Manager' },
  RECRUITMENT:        { label: 'Recruitment - Sourcing',            role: 'Recruitment Specialist' },
  TRAINING:           { label: 'Training',                         role: 'Training Manager' },
  VA_PREP:            { label: 'VA Preparation & Mock Interview',   role: 'Service Manager' },
  PAYMENT_CONFIRMATION: { label: 'Payment Confirmation',            role: 'CS Specialist' },
  RATE_AGREEMENT:      { label: 'Rate Agreement',                    role: 'HR Specialist' },
  KICKOFF_CALL:        { label: 'Kick Off Call',                     role: 'CS Specialist' },
  VA_CLIENT_CALL:      { label: 'VA-Client Connection Call',         role: 'CS Specialist' },
  START_VA:            { label: 'Start VA',                         role: 'Service Manager' },
  COMPLETED:           { label: 'Completed',                        role: '' }
};

// Label-to-role lookup derived once from WORKFLOW_STAGES above — used as
// a fallback wherever a request's own PersonInChargeRole field is blank
// (a real data gap found on an existing ticket: sitting in Request
// Intake with this field never populated, which silently broke both
// "Assigned To" display and the ability for anyone to act on it in the
// frontend). Keeping this derived from WORKFLOW_STAGES, rather than a
// separately maintained map, so the two can never drift out of sync.
var _WF_DEFAULT_ROLE_BY_LABEL = null;
function _wfDefaultRoleForStage(stageLabel) {
  if (!stageLabel) return '';
  if (!_WF_DEFAULT_ROLE_BY_LABEL) {
    _WF_DEFAULT_ROLE_BY_LABEL = {};
    Object.keys(WORKFLOW_STAGES).forEach(function(k) {
      _WF_DEFAULT_ROLE_BY_LABEL[WORKFLOW_STAGES[k].label] = WORKFLOW_STAGES[k].role;
    });
  }
  return _WF_DEFAULT_ROLE_BY_LABEL[stageLabel] || '';
}

function _wfGetReqSheet(ss) { return _reqGetSheet(ss); }
function _wfGetHistorySheet(ss) {
  return _ensureSheet(ss, CONFIG.SHEETS.REQUEST_WORKFLOW_HISTORY, CONFIG.SCHEMA.RequestWorkflowHistory);
}

// Core transition — updates the request's CurrentStage/PersonInChargeRole
// and appends one history row. Every specific transition function below
// (markNoVAAvailable, markRateAgreementDone, etc.) is a thin, named wrapper
// around this, since the actual mechanics of "move to a new stage" never
// change — only which stage, which role, and who's allowed to trigger it do.
// Real performance/correctness bug fixed here: this used to call
// sheet.getDataRange().getValues() — reading the ENTIRE VARequests sheet
// (the largest, most row-heavy table in the system) into memory on
// EVERY single stage transition across the whole app, not just once per
// page load. That's what made "saving…" take so long on request
// creation, and — more seriously — widened the read-after-write gap
// right after a fresh row's own appendRow() (see the flush() fix in
// createVARequest, VARequestService.gs) enough that the newly created
// row occasionally wasn't found yet, silently leaving
// CurrentStage/PersonInChargeRole blank. A TextFinder on the RequestID
// column finds the one matching row directly, and everything below
// reads/writes just that single row instead of scanning the whole sheet.
function _wfAdvance(requestId, toStageKey, user, notes, carryForwardAck) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _wfGetReqSheet(ss);
  var toStage = WORKFLOW_STAGES[toStageKey];
  if (!toStage) return { success: false, error: 'Unknown workflow stage: ' + toStageKey };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, error: 'Request not found.' };
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var h = _reqHMap(headerRow);
  if (h['RequestID'] === undefined) return { success: false, error: 'RequestID column not found.' };

  var match = sheet.getRange(2, h['RequestID'] + 1, lastRow - 1, 1)
    .createTextFinder(String(requestId)).matchEntireCell(true).findNext();
  if (!match) return { success: false, error: 'Request not found.' };
  var rowNum = match.getRow();
  var numCols = sheet.getLastColumn();
  var rowVals = sheet.getRange(rowNum, 1, 1, numCols).getValues()[0];

  // Per the request — Payment Confirmation is always skipped if payment
  // is already resolved (Paid or Add to Next Bill), regardless of which
  // call site is trying to send the request there. Centralized here
  // rather than only in individual callers, so this holds even for a
  // future path that might forget to check it itself.
  if (toStageKey === 'PAYMENT_CONFIRMATION' && h['PaymentStatus'] !== undefined) {
    var currentPayStatus = String(rowVals[h['PaymentStatus']]||'');
    if (currentPayStatus === 'Paid' || currentPayStatus === 'Add to Next Bill') {
      toStageKey = 'RATE_AGREEMENT';
      toStage = WORKFLOW_STAGES[toStageKey];
      notes = (notes || '') + ' (Payment already ' + currentPayStatus + ' — Payment Confirmation skipped.)';
    }
  }

  var fromStageLabel = h['CurrentStage'] !== undefined ? String(rowVals[h['CurrentStage']]||'') : '';
  var fromRole = h['PersonInChargeRole'] !== undefined ? String(rowVals[h['PersonInChargeRole']]||'') : '';
  var now = new Date();

  if (h['CurrentStage'] !== undefined) sheet.getRange(rowNum, h['CurrentStage']+1).setValue(toStage.label);
  if (h['PersonInChargeRole'] !== undefined) sheet.getRange(rowNum, h['PersonInChargeRole']+1).setValue(toStage.role);
  if (h['UpdatedAt'] !== undefined) sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(now);
  if (h['UpdatedBy'] !== undefined) sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(user ? user.email : '');

  // For an automatic, system-triggered revert only (not a normal, human
  // decision to advance the ticket) — carries forward whoever most
  // recently acknowledged, so a person who just posted an update
  // moments before the system reverted the stage underneath them isn't
  // immediately told to acknowledge again for something they already
  // just addressed.
  if (carryForwardAck) {
    try {
      var latestAck = _wfGetLatestAckByRequest()[requestId];
      var ackIsRecent = latestAck && (now - latestAck.at) < 3600000; // within the last hour
      if (ackIsRecent) {
        var ackSheetForCarry = _wfGetAckSheet(ss);
        ackSheetForCarry.appendRow([generateID('ACK'), requestId, toStage.label, '(carried forward — stage auto-reverted shortly after this acknowledgement)', latestAck.by || '', latestAck.byEmail || '', now]);
      }
    } catch (carryEx) { Logger.log('_wfAdvance carryForwardAck: ' + carryEx.message); }
  }

  var histSheet = _wfGetHistorySheet(ss);
  var hh = {}; histSheet.getRange(1,1,1,histSheet.getLastColumn()).getValues()[0].forEach(function(c,idx){ if(c) hh[String(c)]=idx; });
  var arr = new Array(Object.keys(hh).length).fill('');
  function hset(col, val) { if (hh[col] !== undefined) arr[hh[col]] = val; }
  hset('LogID', generateID('WFL'));
  hset('RequestID', requestId);
  hset('FromStage', fromStageLabel);
  hset('ToStage', toStage.label);
  hset('FromRole', fromRole);
  hset('ToRole', toStage.role);
  hset('Notes', notes || '');
  hset('ChangedBy', user ? (user.name || user.email) : 'System');
  hset('ChangedByEmail', user ? user.email : '');
  hset('ChangedAt', now);
  histSheet.appendRow(arr);

  _writeLog('VARequest', requestId, 'UPDATE', 'WorkflowStage', fromStageLabel, toStage.label, user);
  // Real bug fixed here — the likely cause of "Could not load timeline"
  // reappearing on very recently touched requests: _wfAdvance is called
  // from many different action flows (assigning a VA, marking prep/rate
  // agreement/kick-off done, etc.), any of which can be immediately
  // followed by opening that same request's detail view and loading its
  // Timeline. TextFinder-based reads (getRequestWorkflowHistory,
  // _wfGetConnectionsForTimeline) avoid scanning the whole sheet, but
  // they don't guarantee a write from moments earlier has fully
  // propagated — flush() here forces everything this function just
  // wrote to actually land before anything can read it again.
  SpreadsheetApp.flush();
  return { success: true, stage: toStage.label, role: toStage.role };
}

// Called once, right when a request is first created — starts every
// request at Request Intake, owned by the assigned CS Specialist. From
// there, they either move it to VA Assignment (the normal path) or send
// it for Management Approval directly (e.g. an "Other" service that needs
// sign-off before even reaching a Service Manager).
//
// Real bug fixed here: this used to swallow any failure from _wfAdvance
// completely silently — just a Logger.log line nobody would ever see
// unless they went looking. That meant a request could finish "created
// successfully" from the person's point of view while CurrentStage was
// left blank underneath them, with no error, no warning, nothing —
// exactly the reported symptom (Phase showing empty on recently created
// requests, and no "Move to VA Assignment" button, since that button's
// own logic bails out whenever the stage is empty). Now returns a real
// result so createVARequest can retry once and surface a visible
// warning if it still fails, instead of failing invisibly.
function _wfInitializeForNewRequest(requestId, user) {
  try {
    var res = _wfAdvance(requestId, 'REQUEST_INTAKE', user, 'Request created');
    if (!res || !res.success) {
      var errMsg = (res && res.error) || 'Unknown error setting initial stage.';
      Logger.log('_wfInitializeForNewRequest: _wfAdvance did not succeed for ' + requestId + ': ' + errMsg);
      return { success: false, error: errMsg };
    }
    return { success: true };
  } catch (e) {
    Logger.log('_wfInitializeForNewRequest: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Administrator-only, self-service repair for a request whose Timeline
// panel shows "Could not load timeline." — a UI-accessible counterpart
// to the one-off TEMP_ runner scripts used earlier to fix this exact
// symptom by hand in the Apps Script editor, so an Administrator can now
// do it directly from the request itself instead.
//
// The two things known to cause this symptom:
//   1. CurrentStage came back blank — the historical request-creation
//      race condition this whole file's flush() fixes address (see
//      _wfAdvance, _wfInitializeForNewRequest, assignVA in
//      VAConnectionService.gs). A request created before those fixes
//      shipped can still be carrying that blank stage today. Backfilled
//      here to Request Intake, same as a fresh request would get.
//   2. CurrentStage is already set, but the Timeline still failed to
//      load — most likely the same underlying propagation-delay class
//      of issue, just for a different write. A flush() plus a full,
//      forced stage recalculation re-commits and re-verifies everything
//      getRequestWorkflowTimeline depends on, without changing anything
//      that's already correct (both are idempotent).
// Either way, this never fabricates history it can't back up — it only
// ever sets CurrentStage to what the request's own connections already
// justify, the same computation _wfRecalculateRequestStage always uses.
function adminFixRequestTimeline(requestId) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) {
      return { success: false, error: 'Only Administrators can fix a request\'s Timeline this way.' };
    }
    if (!requestId) return { success: false, error: 'Request ID is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _wfGetReqSheet(ss);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, error: 'Request not found.' };
    var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var h = _reqHMap(headerRow);
    if (h['RequestID'] === undefined) return { success: false, error: 'RequestID column not found.' };

    var match = sheet.getRange(2, h['RequestID'] + 1, lastRow - 1, 1)
      .createTextFinder(String(requestId)).matchEntireCell(true).findNext();
    if (!match) return { success: false, error: 'Request ' + requestId + ' not found.' };

    var currentStageVal = h['CurrentStage'] !== undefined
      ? String(sheet.getRange(match.getRow(), h['CurrentStage'] + 1).getValue() || '')
      : '';

    if (!currentStageVal) {
      var initRes = _wfAdvance(requestId, 'REQUEST_INTAKE', user, 'Backfilled by Administrator — Current Stage was blank (the historical request-creation timing issue this ticket predates the fix for).');
      if (!initRes || !initRes.success) {
        return { success: false, error: (initRes && initRes.error) || 'Could not set an initial stage.' };
      }
      return { success: true, action: 'backfilled', stage: initRes.stage };
    }

    _wfRecalculateRequestStage(requestId, user);
    SpreadsheetApp.flush();
    return { success: true, action: 'reverified', stage: currentStageVal };
  } catch (e) {
    return { success: false, error: 'adminFixRequestTimeline: ' + e.message };
  }
}

// CS Specialist (or Administrator) moves a request out of intake and into
// VA Assignment — the normal next step once they've reviewed it.
// Per the request — Seller Onboarding doesn't apply to a Replacement request
// (the seller relationship already exists; this swaps the VA rather than
// onboarding a new account), so the status/date/waiver-reason checks below
// are skipped for that type, and nothing is written to the Seller
// Onboarding columns for it. Looked up by request type rather than trusting
// the frontend, which already hides the field for Replacement but isn't the
// only possible caller.
function _wfGetRequestTypeById(requestId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _wfGetReqSheet(ss);
    var lastRow = sheet.getLastRow(); if (lastRow < 2) return '';
    var h = _reqHMap(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
    if (h['RequestID'] === undefined || h['RequestType'] === undefined) return '';
    var m = sheet.getRange(2, h['RequestID'] + 1, lastRow - 1, 1).createTextFinder(String(requestId)).matchEntireCell(true).findNext();
    if (!m) return '';
    return String(sheet.getRange(m.getRow(), h['RequestType'] + 1).getValue() || '');
  } catch (e) { return ''; }
}

function moveToVAAssignment(requestId, notes, sellerOnboardingStatus, sellerOnboardingDate, sellerOnboardingWaivedReason, schedulePayload, paymentStatus) {
  var perm = _wfCheckOwnership(requestId, 'CS Specialist');
  if (!perm.allowed) return { success: false, error: perm.error };
  var isReplacementReq = _wfGetRequestTypeById(requestId) === 'Replacement';

  if (!isReplacementReq && sellerOnboardingStatus !== 'Done' && sellerOnboardingStatus !== 'Waived') {
    return { success: false, error: 'Confirm the Seller Onboarding as either Done or Waived before moving to VA Assignment.' };
  }
  if (!isReplacementReq && !sellerOnboardingDate) {
    return { success: false, error: 'A Seller Onboarding date is required.' };
  }
  if (!isReplacementReq && sellerOnboardingStatus === 'Waived' && !String(sellerOnboardingWaivedReason||'').trim()) {
    return { success: false, error: 'A reason is required when waiving Seller Onboarding.' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _wfGetReqSheet(ss);
  _migrateSheetColumns(ss, CONFIG.SHEETS.VA_REQUESTS, CONFIG.SCHEMA.VARequests);
  var data = sheet.getDataRange().getValues();
  var h = _reqHMap(data[0]);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['RequestID']]) !== requestId) continue;
    var rowNum = i + 1;
    if (!isReplacementReq && h['SellerOnboardingStatus'] !== undefined) sheet.getRange(rowNum, h['SellerOnboardingStatus']+1).setValue(sellerOnboardingStatus);
    // The date is saved regardless of Done/Waived — it stays filled out
    // either way, only the frontend's label changes to indicate it was
    // waived rather than genuinely done.
    if (!isReplacementReq && h['SellerOnboardingDate'] !== undefined) sheet.getRange(rowNum, h['SellerOnboardingDate']+1).setValue(new Date(sellerOnboardingDate));
    if (!isReplacementReq && h['SellerOnboardingWaivedReason'] !== undefined) sheet.getRange(rowNum, h['SellerOnboardingWaivedReason']+1).setValue(sellerOnboardingStatus === 'Waived' ? sellerOnboardingWaivedReason : '');
    // Per the request — Payment Status is also set at this same
    // transition point, defaulting to "No Payment" when not given
    // (matching the sheet's own data validation on this column exactly).
    if (h['PaymentStatus'] !== undefined) sheet.getRange(rowNum, h['PaymentStatus']+1).setValue(paymentStatus || 'No Payment');

    // Schedule can be reviewed and changed right here too, same fields as
    // the main request ticket's own Schedule section.
    if (schedulePayload) {
      var scm = {
        'ScheduleType': schedulePayload.scheduleType,
        'Hours': schedulePayload.hours,
        'HoursBreakdown': schedulePayload.hoursBreakdown,
        'RequiredPHTime': schedulePayload.requiredClientTime ? convertClientTimeToPH(schedulePayload.requiredClientTime, schedulePayload.clientTimezone || '', new Date()) : (schedulePayload.requiredPHTime || ''),
        'RequiredClientTime': schedulePayload.requiredClientTime || '',
        'NightDiffApplicableAtSchedule': !!schedulePayload.nightDiffApplicableAtSchedule,
        'BreaksIncludedInTotal': !!schedulePayload.breaksIncludedInTotal,
        'ClientTimezone': schedulePayload.clientTimezone
      };
      if (schedulePayload.targetStartDate && h['TargetStartDate'] !== undefined) {
        sheet.getRange(rowNum, h['TargetStartDate']+1).setValue(new Date(schedulePayload.targetStartDate));
      }
      Object.keys(scm).forEach(function(col) {
        if (h[col] !== undefined && scm[col] !== undefined && scm[col] !== '') sheet.getRange(rowNum, h[col]+1).setValue(scm[col]);
      });
    }
    break;
  }

  return _wfAdvance(requestId, 'VA_ASSIGNMENT', perm.user, notes || 'Moved to VA Assignment.');
}

function getRequestWorkflowHistory(requestId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _wfGetHistorySheet(ss);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };

    // Real performance bug fixed here: this used to call
    // sheet.getDataRange().getValues() — pulling the ENTIRE
    // WorkflowHistory sheet (every stage transition ever recorded, for
    // every request the whole company has ever created) into memory on
    // every single timeline load, then scanning it row by row for this
    // one requestId. That cost grows with the SHEET's total size, not
    // with how much history this one request actually has — as the
    // sheet has grown over time, this got slow enough (11+ seconds
    // observed) to occasionally have its response dropped en route back
    // to the browser, even though the server execution itself completed
    // cleanly (which is exactly why Executions shows "Completed" with
    // no logged error — nothing crashed, it just took too long). A
    // TextFinder restricted to just the RequestID column finds only the
    // matching rows without ever materializing the full sheet, so cost
    // now scales with how many transitions THIS request has, not the
    // sheet's entire history.
    var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var h = {}; headerRow.forEach(function(c,i){ if(c) h[String(c)]=i; });
    if (h['RequestID'] === undefined) return { success: true, data: [] };

    var reqIdColRange = sheet.getRange(2, h['RequestID'] + 1, lastRow - 1, 1);
    var matches = reqIdColRange.createTextFinder(String(requestId)).matchEntireCell(true).findAll();
    if (!matches.length) return { success: true, data: [] };

    var numCols = sheet.getLastColumn();
    var rows = [];
    var skipped = 0;
    matches.forEach(function(cell) {
      try {
        var rowVals = sheet.getRange(cell.getRow(), 1, 1, numCols).getValues()[0];
        var ts = rowVals[h['ChangedAt']];
        rows.push({
          fromStage: String(rowVals[h['FromStage']]||''),
          toStage:   String(rowVals[h['ToStage']]||''),
          fromRole:  String(rowVals[h['FromRole']]||''),
          toRole:    String(rowVals[h['ToRole']]||''),
          notes:     String(rowVals[h['Notes']]||''),
          changedBy: String(rowVals[h['ChangedBy']]||''),
          changedAt: (ts instanceof Date) ? ts.toISOString() : String(ts||'')
        });
      } catch (rowEx) {
        // One malformed row shouldn't lose the entire timeline — skip it,
        // log it, and keep going with whatever rows are actually usable.
        skipped++;
        Logger.log('getRequestWorkflowHistory: skipped a matched row for ' + requestId + ': ' + rowEx.message);
      }
    });
    rows.sort(function(a,b){ return new Date(a.changedAt) - new Date(b.changedAt); });
    return { success: true, data: rows, skipped: skipped };
  } catch (e) {
    return { success: false, error: 'getRequestWorkflowHistory: ' + e.message };
  }
}

// Only the role that currently owns the stage may advance it — otherwise
// anyone could push a request past a step that isn't actually done yet.
// Administrators can always override, same as elsewhere in the system.
function _wfCheckOwnership(requestId, expectedRole) {
  var user = getCurrentUser();
  if (!user || user.error) return { allowed: false, error: 'Not signed in.' };
  if (user.role === CONFIG.ROLES.ADMINISTRATOR) return { allowed: true, user: user };
  // CS Manager can act on behalf of CS Specialist (they oversee them) and
  // specifically on Management Approval requests too — both are explicit
  // exceptions, not a general "Manager can do anything" override.
  if (user.role === CONFIG.ROLES.CS_MANAGER && (expectedRole === CONFIG.ROLES.CS_SPECIALIST || expectedRole === CONFIG.ROLES.EXECUTIVE)) {
    return { allowed: true, user: user };
  }
  // HR Manager can act on behalf of HR Specialist — same reasoning as
  // the CS Manager exception above (they oversee them).
  if (user.role === CONFIG.ROLES.HR_MANAGER && expectedRole === CONFIG.ROLES.HR_SPECIALIST) {
    return { allowed: true, user: user };
  }
  if (user.role !== expectedRole) return { allowed: false, error: 'Only ' + expectedRole + ' can perform this step right now.' };
  return { allowed: true, user: user };
}

// ── Management Approval — an interrupt/override of the normal flow, not a
// forward step in it. Most commonly needed for a not-yet-catalogued "Other"
// service (e.g. a language-based VA role not in the system yet) that an
// executive needs to sign off on before the request proceeds. Can be
// triggered from wherever the request currently is — CS Specialist or
// Service Manager are the ones who'd actually notice this is needed, not
// necessarily whoever the CURRENT stage happens to be assigned to. ─────────

// Fetches active users for a given role, optionally scoped to a
// department (relevant for Service Manager, where multiple people can
// hold that role across different departments — showing just the role
// name doesn't tell you WHO to actually go talk to).
function getActiveUsersForRole(role, department) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var deptFilter = (department||'').toLowerCase().trim();
    var users = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Role']]||'') !== role) continue;
      var isActive = data[i][h['IsActive']] !== false && data[i][h['IsActive']] !== 'false' && data[i][h['IsActive']] !== 0;
      if (!isActive) continue;
      if (deptFilter && h['Department'] !== undefined) {
        var userDept = String(data[i][h['Department']]||'').toLowerCase().trim();
        if (userDept !== deptFilter) continue;
      }
      users.push({ name: String(data[i][h['Name']]||''), email: String(data[i][h['Email']]||'') });
    }
    return { success: true, data: users };
  } catch (e) {
    return { success: false, error: 'getActiveUsersForRole: ' + e.message };
  }
}

function requestManagementApproval(requestId, notes) {
  var user = getCurrentUser();
  if (!user || user.error) return { success: false, error: 'Not signed in.' };
  var allowedRoles = [CONFIG.ROLES.CS_SPECIALIST, CONFIG.ROLES.SERVICE_MANAGER, CONFIG.ROLES.CS_MANAGER, CONFIG.ROLES.ADMINISTRATOR];
  if (allowedRoles.indexOf(user.role) === -1) return { success: false, error: 'Only CS Specialists, Service Managers, or CS Managers can request Management Approval.' };

  // Remember where it came from so approval knows where to send it back to
  // — usually VA Assignment (the normal start), but could be later in the
  // flow if something new comes up mid-process.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _wfGetReqSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _reqHMap(data[0]);
  var returnToStage = 'VA_ASSIGNMENT';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['RequestID']]) !== requestId) continue;
    var currentLabel = h['CurrentStage'] !== undefined ? String(data[i][h['CurrentStage']]||'') : '';
    if (currentLabel !== WORKFLOW_STAGES.REQUEST_INTAKE.label) {
      return { success: false, error: 'Management Approval can only be requested during Request Intake — this request has already moved past that point.' };
    }
    Object.keys(WORKFLOW_STAGES).forEach(function(key) {
      if (WORKFLOW_STAGES[key].label === currentLabel) returnToStage = key;
    });
    if (h['PendingApprovalReturnStage'] !== undefined) sheet.getRange(i+1, h['PendingApprovalReturnStage']+1).setValue(returnToStage);
    break;
  }

  return _wfAdvance(requestId, 'MANAGEMENT_APPROVAL', user, notes || 'Sent for Management Approval.');
}

function approveManagementRequest(requestId, notes) {
  var perm = _wfCheckOwnership(requestId, 'Executive');
  if (!perm.allowed) return { success: false, error: perm.error };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _wfGetReqSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _reqHMap(data[0]);
  var returnToStage = 'REQUEST_INTAKE';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['RequestID']]) !== requestId) continue;
    if (h['PendingApprovalReturnStage'] !== undefined) {
      var stored = String(data[i][h['PendingApprovalReturnStage']]||'');
      if (stored && WORKFLOW_STAGES[stored]) returnToStage = stored;
    }
    break;
  }
  return _wfAdvance(requestId, returnToStage, perm.user, notes || 'Approved.');
}

function rejectManagementRequest(requestId, notes) {
  var perm = _wfCheckOwnership(requestId, 'Executive');
  if (!perm.allowed) return { success: false, error: perm.error };
  if (!notes) return { success: false, error: 'A reason is required when rejecting a request.' };
  // Sent back to VA Assignment regardless of where it came from — a
  // rejection means the CS Specialist/Service Manager needs to reconsider
  // the request itself, not just resume wherever it left off.
  return _wfAdvance(requestId, 'VA_ASSIGNMENT', perm.user, 'Rejected: ' + notes);
}


function markNoVAAvailable(requestId, notes) {
  var perm = _wfCheckOwnership(requestId, 'Service Manager');
  if (!perm.allowed) return { success: false, error: perm.error };
  return _wfAdvance(requestId, 'RECRUITMENT', perm.user, notes || 'No VA currently available.');
}

function recruitmentFoundCandidate(requestId, notes) {
  var perm = _wfCheckOwnership(requestId, 'Recruitment Specialist');
  if (!perm.allowed) return { success: false, error: perm.error };
  return _wfAdvance(requestId, 'TRAINING', perm.user, notes || 'Candidate found — moving to training.');
}

function trainingComplete(requestId, notes) {
  var perm = _wfCheckOwnership(requestId, 'Training Manager');
  if (!perm.allowed) return { success: false, error: perm.error };
  return _wfAdvance(requestId, 'VA_ASSIGNMENT', perm.user, notes || 'Training complete — ready for assignment.');
}

// The trainee didn't pass — back to Recruitment to source another
// candidate, rather than treating this as a dead end.
function trainingFailed(requestId, notes) {
  var perm = _wfCheckOwnership(requestId, 'Training Manager');
  if (!perm.allowed) return { success: false, error: perm.error };
  if (!notes) return { success: false, error: 'A reason is required when a candidate does not pass training.' };
  return _wfAdvance(requestId, 'RECRUITMENT', perm.user, 'Did not pass training: ' + notes);
}

function markVAPrepDoneForConnection(connectionId, requestId, notes, startDate, endDate) {
  var perm = _wfCheckOwnership(requestId, 'Service Manager');
  if (!perm.allowed) return { success: false, error: perm.error };
  if (!connectionId) return { success: false, error: 'A VA connection is required.' };
  if (!startDate || !endDate) return { success: false, error: 'Both Start Date and End Date are required.' };
  if (new Date(endDate) < new Date(startDate)) return { success: false, error: 'End Date cannot be before Start Date.' };

  var connSheet = _connGetSheet(SpreadsheetApp.getActiveSpreadsheet());
  var connData  = connSheet.getDataRange().getValues();
  var connH     = _connHMap(connData[0]);
  var found = false;
  for (var i = 1; i < connData.length; i++) {
    if (String(connData[i][connH['ConnectionID']]||'') !== connectionId) continue;
    if (String(connData[i][connH['RequestID']]||'') !== requestId) break;
    found = true;
    if (connH['VAPrepDone'] !== undefined) connSheet.getRange(i+1, connH['VAPrepDone']+1).setValue(true);
    if (connH['VAPrepDoneAt'] !== undefined) connSheet.getRange(i+1, connH['VAPrepDoneAt']+1).setValue(new Date());
    if (connH['VAPrepDoneBy'] !== undefined) connSheet.getRange(i+1, connH['VAPrepDoneBy']+1).setValue(perm.user.email);
    if (connH['VAPrepNotes'] !== undefined) connSheet.getRange(i+1, connH['VAPrepNotes']+1).setValue(notes || '');
    if (connH['VAPrepStartDate'] !== undefined) connSheet.getRange(i+1, connH['VAPrepStartDate']+1).setValue(new Date(startDate));
    if (connH['VAPrepEndDate'] !== undefined) connSheet.getRange(i+1, connH['VAPrepEndDate']+1).setValue(new Date(endDate));
    break;
  }
  if (!found) return { success: false, error: 'That VA connection was not found on this request.' };

  // Per the request — VA Prep/Mock Interview is conducted per Assigned
  // VA; this connection's own progress now contributes to the request's
  // overall displayed stage, whether or not it's the current Final VA.
  _wfRecalculateRequestStage(requestId, perm.user);

  return { success: true };
}

function markKickOffCallDoneForConnection(connectionId, requestId, notes, kickOffCallDate) {
  var perm = _wfCheckOwnership(requestId, 'CS Specialist');
  if (!perm.allowed) return { success: false, error: perm.error };
  if (!connectionId) return { success: false, error: 'A VA connection is required.' };

  var connSheet = _connGetSheet(SpreadsheetApp.getActiveSpreadsheet());
  var connData  = connSheet.getDataRange().getValues();
  var connH     = _connHMap(connData[0]);
  var found = false;
  for (var i = 1; i < connData.length; i++) {
    if (String(connData[i][connH['ConnectionID']]||'') !== connectionId) continue;
    if (String(connData[i][connH['RequestID']]||'') !== requestId) break;
    found = true;
    if (connH['KickOffCallDone'] !== undefined) connSheet.getRange(i+1, connH['KickOffCallDone']+1).setValue(true);
    if (connH['KickOffCallDoneAt'] !== undefined) connSheet.getRange(i+1, connH['KickOffCallDoneAt']+1).setValue(kickOffCallDate ? new Date(kickOffCallDate) : new Date());
    if (connH['KickOffCallDoneBy'] !== undefined) connSheet.getRange(i+1, connH['KickOffCallDoneBy']+1).setValue(perm.user.email);
    if (connH['KickOffCallNotes'] !== undefined) connSheet.getRange(i+1, connH['KickOffCallNotes']+1).setValue(notes || '');
    break;
  }
  if (!found) return { success: false, error: 'That VA connection was not found on this request.' };

  // Per the request — this connection's own progress now contributes to
  // the request's overall displayed stage, same as VA Prep/Rate
  // Agreement above.
  _wfRecalculateRequestStage(requestId, perm.user);

  return { success: true };
}

function markVAPrepDone(requestId, notes) {
  var perm = _wfCheckOwnership(requestId, 'Service Manager');
  if (!perm.allowed) return { success: false, error: perm.error };

  // VA Preparation/Mock Interview — and the Rate Agreement that follows
  // it — apply to a specific VA, not just "the request" in the
  // abstract. Requires a Final VA to be designated first; if a request
  // has multiple connections (several candidates tried) with none
  // marked final, this blocks with a clear error rather than silently
  // advancing the stage with no clear connection it actually applies to.
  var connSheet = _connGetSheet(SpreadsheetApp.getActiveSpreadsheet());
  var connData  = connSheet.getDataRange().getValues();
  var connH     = _connHMap(connData[0]);
  var finalVAConnId = '', finalVAName = '';
  if (connH['IsFinalVA'] !== undefined) {
    for (var ci = 1; ci < connData.length; ci++) {
      if (String(connData[ci][connH['RequestID']]||'') !== requestId) continue;
      if (_toBool(connData[ci][connH['IsFinalVA']])) {
        finalVAConnId = String(connData[ci][connH['ConnectionID']]||'');
        finalVAName   = String(connData[ci][connH['VAName']]||'');
        break;
      }
    }
  }
  if (!finalVAConnId) {
    return { success: false, error: 'No Final VA has been designated on this request yet. Use "Set as Final VA" on the connection that will actually go through Mock Interview and Rate Agreement before marking this done.' };
  }

  // Per the request — VA Prep/Mock Interview is now marked complete per
  // Assigned VA first (see markVAPrepDoneForConnection below); this
  // general button only advances the request's own stage once at least
  // one connection has actually been marked complete that way.
  var anyConnPrepDone = false;
  if (connH['VAPrepDone'] !== undefined) {
    for (var cpi = 1; cpi < connData.length; cpi++) {
      if (String(connData[cpi][connH['RequestID']]||'') !== requestId) continue;
      if (_toBool(connData[cpi][connH['VAPrepDone']])) { anyConnPrepDone = true; break; }
    }
  }
  if (!anyConnPrepDone) {
    return { success: false, error: 'Mark VA Preparation/Mock Interview complete for at least one Assigned VA first, before completing this for the request as a whole.' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _wfGetReqSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _reqHMap(data[0]);

  var paymentStatus = '';
  var requestType = '';

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['RequestID']]) !== requestId) continue;
    if (h['PrepDoneAt'] !== undefined) sheet.getRange(i+1, h['PrepDoneAt']+1).setValue(new Date());
    if (h['PrepDoneBy'] !== undefined) sheet.getRange(i+1, h['PrepDoneBy']+1).setValue(perm.user.email);
    if (h['PrepDoneForConnectionID'] !== undefined) sheet.getRange(i+1, h['PrepDoneForConnectionID']+1).setValue(finalVAConnId);
    paymentStatus = h['PaymentStatus'] !== undefined ? String(data[i][h['PaymentStatus']]||'') : '';
    requestType = h['RequestType'] !== undefined ? String(data[i][h['RequestType']]||'') : '';
    break;
  }

  // Special Request, per the request — skips the standard Payment
  // Confirmation/Rate Agreement sequence at this point entirely, going
  // straight to Kick Off Call instead. Rate Agreement and Payment
  // Confirmation happen afterward instead, once the VA is accepted at
  // Kick Off Call — see the Accept cascade in updateVAConnectionStatus,
  // which already checks both and routes to whichever is still
  // outstanding, regardless of which stage triggered it.
  if (requestType === 'Special') {
    var advanceToKickoff = _wfAdvance(requestId, 'KICKOFF_CALL', perm.user, notes || (finalVAName + ' completed VA preparation and mock interview — Special Request, proceeding directly to Kick Off Call.'));
    if (advanceToKickoff && advanceToKickoff.success) advanceToKickoff.finalVAName = finalVAName;
    return advanceToKickoff;
  }

  // Per the request — VA Prep/Mock Interview, Rate Agreement, etc. are
  // conducted per Assigned VA; the request's own displayed stage is now
  // the maximum progress across all of them, recalculated here rather
  // than following a hardcoded Payment/Rate Agreement check for just
  // this one connection.
  var recalcResult = _wfRecalculateRequestStage(requestId, perm.user);
  return { success: true, finalVAName: finalVAName };
}

function markRateAgreementDone(requestId, notes, baseRate, connectionId, rateAgreementDate) {
  var perm = _wfCheckOwnership(requestId, 'HR Specialist');
  if (!perm.allowed) return { success: false, error: perm.error };

  var rateNum = parseFloat(baseRate);
  if (baseRate === undefined || baseRate === null || baseRate === '' || isNaN(rateNum) || rateNum < 0) {
    return { success: false, error: 'A valid base rate for the VA is required to mark Rate Agreement done.' };
  }
  if (!connectionId) {
    return { success: false, error: 'Select which Assigned VA the rate agreement was conducted for.' };
  }

  // Confirm the chosen connection actually belongs to this request, and
  // find whether it's the current Final VA — per the request, Rate
  // Agreement can be conducted and recorded for any Assigned VA, but the
  // request itself only advances past this stage when its *current*
  // Final VA specifically has this done.
  var connSheet = _connGetSheet(SpreadsheetApp.getActiveSpreadsheet());
  var connData  = connSheet.getDataRange().getValues();
  var connH     = _connHMap(connData[0]);
  var isFinalVAConn = false;
  var chosenRowFound = false;
  for (var fci = 1; fci < connData.length; fci++) {
    if (String(connData[fci][connH['ConnectionID']]||'') !== connectionId) continue;
    if (String(connData[fci][connH['RequestID']]||'') !== requestId) break;
    chosenRowFound = true;
    isFinalVAConn = connH['IsFinalVA'] !== undefined && _toBool(connData[fci][connH['IsFinalVA']]);
    break;
  }
  if (!chosenRowFound) {
    return { success: false, error: 'That VA connection was not found on this request.' };
  }

  var rateRes = assignVAConnectionRate(connectionId, rateNum);
  if (!rateRes || !rateRes.success) {
    return { success: false, error: 'Could not save the base rate: ' + ((rateRes && rateRes.error) || 'unknown error') };
  }

  // Mark this specific connection's own Rate Agreement as done — per
  // the request, tracked per Assigned VA, not just once for the request.
  try {
    var connData2 = connSheet.getDataRange().getValues();
    for (var ci2 = 1; ci2 < connData2.length; ci2++) {
      if (String(connData2[ci2][connH['ConnectionID']]||'') !== connectionId) continue;
      if (connH['RateAgreementDone'] !== undefined) connSheet.getRange(ci2+1, connH['RateAgreementDone']+1).setValue(true);
      if (connH['RateAgreementDoneAt'] !== undefined) connSheet.getRange(ci2+1, connH['RateAgreementDoneAt']+1).setValue(rateAgreementDate ? new Date(rateAgreementDate) : new Date());
      if (connH['RateAgreementDoneBy'] !== undefined) connSheet.getRange(ci2+1, connH['RateAgreementDoneBy']+1).setValue(perm.user.email);
      if (connH['RateAgreementNotes'] !== undefined) connSheet.getRange(ci2+1, connH['RateAgreementNotes']+1).setValue(notes || '');
      break;
    }
  } catch (markEx) { Logger.log('markRateAgreementDone flag: ' + markEx.message); }

  // Defensive backend check, matching the established pattern — the
  // frontend only shows this once a request has reached Rate Agreement
  // (which already requires payment confirmed to get there), but that's
  // a UI assumption, not a backend guarantee, so this enforces it
  // directly too.
  var reqSheetForPay = _wfGetReqSheet(SpreadsheetApp.getActiveSpreadsheet());
  var reqDataForPay = reqSheetForPay.getDataRange().getValues();
  var reqHForPay = _reqHMap(reqDataForPay[0]);
  for (var pi = 1; pi < reqDataForPay.length; pi++) {
    if (String(reqDataForPay[pi][reqHForPay['RequestID']]||'') !== requestId) continue;
    var payStatusCheck = reqHForPay['PaymentStatus'] !== undefined ? String(reqDataForPay[pi][reqHForPay['PaymentStatus']]||'') : '';
    if (payStatusCheck !== 'Paid' && payStatusCheck !== 'Add to Next Bill') {
      return { success: false, error: 'Payment must be confirmed (Paid or Add to Next Bill) before Rate Agreement can be marked done.' };
    }
    break;
  }

  // Per the request — Rate Agreement is conducted per Assigned VA; any
  // connection's progress now contributes to the request's own overall
  // displayed stage (the furthest along among all of them), not just the
  // current Final VA's — the isFinalVAConn-only gate that used to block
  // this for a non-Final candidate no longer applies.
  _wfRecalculateRequestStage(requestId, perm.user);
  return { success: true, advanced: isFinalVAConn };
}

function markKickOffCallDone(requestId, notes) {
  var perm = _wfCheckOwnership(requestId, 'CS Specialist');
  if (!perm.allowed) return { success: false, error: perm.error };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _wfGetReqSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _reqHMap(data[0]);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['RequestID']]) !== requestId) continue;
    if (h['MockCallDoneAt'] !== undefined) sheet.getRange(i+1, h['MockCallDoneAt']+1).setValue(new Date());
    if (h['MockCallDoneBy'] !== undefined) sheet.getRange(i+1, h['MockCallDoneBy']+1).setValue(perm.user.email);
    break;
  }
  // Legacy/unused by the current UI (the live flow is
  // markKickOffCallDoneForConnection + resolveKickoffCall instead) —
  // fixed for safety anyway, since this carried the exact same
  // unconditional-advance bug just fixed in resolveKickoffCall
  // (KickoffCallService.gs): forcing VA_CLIENT_CALL directly, without
  // checking whether Rate Agreement was actually done first.
  _wfRecalculateRequestStage(requestId, perm.user);
  return { success: true };
}

// Full display order — mandatory stages always show; the three optional
// branch stages (Management Approval, Recruitment, Training) only show as
// genuinely relevant if they were actually visited, otherwise "Not
// Applicable" once we've moved past the point they'd have been needed.
var WF_DISPLAY_ORDER = [
  'REQUEST_INTAKE', 'MANAGEMENT_APPROVAL', 'VA_ASSIGNMENT', 'RECRUITMENT', 'TRAINING',
  'VA_PREP', 'PAYMENT_CONFIRMATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'VA_CLIENT_CALL', 'START_VA', 'COMPLETED'
];
var WF_OPTIONAL_STAGES = ['MANAGEMENT_APPROVAL', 'RECRUITMENT', 'TRAINING', 'PAYMENT_CONFIRMATION'];

// Per the request — VA Preparation/Mock Interview, Rate Agreement, Kick
// Off Call, and VA-Client Connection Call are all conducted per Assigned
// VA, not once for the request as a whole. Returns this connection's own
// position in WF_DISPLAY_ORDER, or -1 if it's out of contention entirely
// (Declined/Cancelled/Terminated) and shouldn't affect the request's
// displayed stage at all.
function _wfConnStageIndex(conn, paymentConfirmed) {
  var st = conn.connectionStatus;
  if (st === 'Declined' || st === 'Cancelled' || st === 'Terminated') return -1;
  if (st === 'Started') return WF_DISPLAY_ORDER.indexOf('START_VA');
  // Per the request — once accepted, the request is already considered
  // to be in the Start VA stage, not VA-Client Connection Call.
  if (st === 'Accepted') return WF_DISPLAY_ORDER.indexOf('START_VA');
  // Pending — still working through VA Prep, Payment, Rate Agreement,
  // Kick-Off Call, in that order. Once Kick-Off Call itself is marked
  // done, the connection is waiting on Accept/Decline specifically, per
  // the request — that's VA-Client Connection Call, not still Kick Off
  // Call (which now only means "the call itself hasn't happened yet").
  if (conn.rateAgreementDone && conn.kickOffCallDone) return WF_DISPLAY_ORDER.indexOf('VA_CLIENT_CALL');
  if (conn.rateAgreementDone) return WF_DISPLAY_ORDER.indexOf('KICKOFF_CALL');
  if (conn.vaPrepDone) return WF_DISPLAY_ORDER.indexOf(paymentConfirmed ? 'RATE_AGREEMENT' : 'PAYMENT_CONFIRMATION');
  return WF_DISPLAY_ORDER.indexOf('VA_PREP');
}

// Recalculates and, if it changed, applies the request's own displayed
// stage — per the request, this is the furthest-progressed of its still
// in-contention Assigned VAs (see _wfConnStageIndex above), not a single
// linear value advanced once per action. Called after every action that
// could shift that maximum: setting a Final VA, marking VA Prep or Rate
// Agreement done for a specific connection, a connection's status
// changing (Accept/Decline/Cancel/Start), and payment being confirmed.
// Safe to call even when nothing actually changed — it's a no-op then.
function _wfRecalculateRequestStage(requestId, user) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reqSheet = _wfGetReqSheet(ss);
    var reqData = reqSheet.getDataRange().getValues();
    var reqH = _reqHMap(reqData[0]);
    var curRow = -1, curStageLabel = '', paymentConfirmed = false;
    for (var ri = 1; ri < reqData.length; ri++) {
      if (String(reqData[ri][reqH['RequestID']]||'') !== requestId) continue;
      curRow = ri;
      curStageLabel = reqH['CurrentStage'] !== undefined ? String(reqData[ri][reqH['CurrentStage']]||'') : '';
      var payStatus = reqH['PaymentStatus'] !== undefined ? String(reqData[ri][reqH['PaymentStatus']]||'') : '';
      paymentConfirmed = (payStatus === 'Paid' || payStatus === 'Add to Next Bill');
      break;
    }
    if (curRow === -1) return; // request not found — nothing to recalculate

    var curIdx = WF_DISPLAY_ORDER.findIndex(function(key) { return WORKFLOW_STAGES[key].label === curStageLabel; });
    // Only recalculate once a request has actually reached VA Assignment
    // or later — Request Intake/Management Approval have no connections
    // yet to compute a maximum from, and shouldn't be disturbed by this.
    var vaAssignmentIdx = WF_DISPLAY_ORDER.indexOf('VA_ASSIGNMENT');
    if (curIdx < vaAssignmentIdx) return;
    // Once a request reaches VA-Client Connection Call or later, that
    // progress is final for this recalculation's purposes — Start
    // VA/Completed are reached through their own dedicated actions, not
    // this per-connection maximum.
    if (curIdx >= WF_DISPLAY_ORDER.indexOf('VA_CLIENT_CALL')) return;

    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var connH = _connHMap(connData[0]);
    var conns = [];
    if (connH['ConnectionID'] !== undefined && connH['RequestID'] !== undefined) {
      for (var cri = 1; cri < connData.length; cri++) {
        if (!connData[cri][connH['ConnectionID']]) continue;
        if (String(connData[cri][connH['RequestID']]||'') !== requestId) continue;
        conns.push(_mapConnRow(connData[cri], connH, false));
      }
    }
    var maxIdx = vaAssignmentIdx; // no in-contention connections at all → stays at VA Assignment
    // Once a Final VA is designated, only her own progress should drive
    // the request's overall stage — a non-Final candidate's stale
    // progress from an earlier attempt (before she was chosen) must not
    // drag the request ahead of where the actual Final VA really is.
    var finalConn = conns.find(function(c) { return c.isFinalVA; });
    // Real bug fixed here: when NO Final VA is currently designated —
    // exactly the state right after a Kick-Off Call gets Declined, before
    // a replacement is marked Final — this used to fall back to scanning
    // EVERY connection on the request, including ones that are Declined,
    // Cancelled, or Terminated. Those aren't just "not yet chosen," they
    // are definitively no longer in contention, but their stale
    // Rate-Agreement/Kick-Off-Call flags from before they were declined
    // don't get reset — so the request's stage stayed wherever the
    // declined VA had left it (or worse, reflected it) instead of
    // correctly falling back to match the fresh replacement candidate's
    // own genuinely-Pending progress. Excluded from the fallback here.
    var IN_CONTENTION_STATUSES = { 'Declined': true, 'Cancelled': true, 'Terminated': true };
    var connsForMax = finalConn ? [finalConn] : conns.filter(function(c) { return !IN_CONTENTION_STATUSES[c.connectionStatus]; });
    connsForMax.forEach(function(c) {
      var idx = _wfConnStageIndex(c, paymentConfirmed);
      if (idx > maxIdx) maxIdx = idx;
    });
    if (maxIdx === curIdx) return; // already correct — no-op

    var newStageKey = WF_DISPLAY_ORDER[maxIdx];
    var direction = maxIdx > curIdx ? 'advanced' : 'returned';
    _wfAdvance(requestId, newStageKey, user, 'Stage ' + direction + ' automatically based on Assigned VA progress.', true);
  } catch (e) {
    Logger.log('_wfRecalculateRequestStage error: ' + e.message);
  }
}

// Lightweight, single-request connection lookup used only by
// getRequestWorkflowTimeline below, which just needs a couple of
// factual dates (actualStartDate, finalVADate) per connection — not the
// compensation-rate visibility or Service-Manager department scoping
// getVAConnections applies for its broader UI callers. Uses a
// TextFinder on the RequestID column instead of reading the whole
// VAConnections sheet, matching the same fix applied to
// getRequestWorkflowHistory above, for the same reason: reading every
// VA connection ever recorded, for every request, just to find this
// one request's handful of them, got slow enough (11+ seconds observed
// combined with the WorkflowHistory read) to occasionally have the
// whole Timeline response dropped en route back to the browser.
function _wfGetConnectionsForTimeline(requestId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _connGetSheet(ss);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var h = {}; headerRow.forEach(function(c,i){ if(c) h[String(c)]=i; });
  if (h['ConnectionID'] === undefined || h['RequestID'] === undefined) return [];

  var matches = sheet.getRange(2, h['RequestID'] + 1, lastRow - 1, 1)
    .createTextFinder(String(requestId)).matchEntireCell(true).findAll();
  if (!matches.length) return [];

  var numCols = sheet.getLastColumn();
  var out = [];
  matches.forEach(function(cell) {
    var rowVals = sheet.getRange(cell.getRow(), 1, 1, numCols).getValues()[0];
    if (!rowVals[h['ConnectionID']]) return;
    out.push(_mapConnRow(rowVals, h, false)); // includeRate=false — this caller never needs compensation data
  });
  return out;
}

function getRequestWorkflowTimeline(requestId) {
  try {
    if (!requestId) return { success: false, error: 'getRequestWorkflowTimeline: no requestId was provided.' };

    var histRes;
    try {
      histRes = getRequestWorkflowHistory(requestId);
    } catch (histEx) {
      histRes = { success: false, error: histEx.message };
    }
    // Degrade gracefully rather than failing the whole timeline — current
    // stage, dates, and everything else below reads directly from the
    // request row itself and doesn't depend on history at all, so a
    // history-fetch failure shouldn't lose all of that too.
    var history = (histRes && histRes.success) ? histRes.data : [];
    var historyLoadError = (histRes && histRes.success) ? '' : (histRes && histRes.error) || 'Unknown history error.';

    // Real performance bug fixed here — the biggest one of the three:
    // this used to read the ENTIRE VARequests sheet (every service
    // request the whole company has ever created — by far the largest,
    // most row-heavy table in the system) into memory just to find this
    // one request's own row. Combined with the WorkflowHistory and
    // VAConnections full-sheet reads already fixed above, this was the
    // remaining, dominant cost keeping this call slow enough to
    // occasionally have its response dropped en route to the browser.
    // Same TextFinder approach as the other two fixes: locate the one
    // matching row directly, then read only that row.
    var currentStageLabel = '';
    var requestCreatedAt = '';
    var sellerOnboardingDate = '', paymentDate = '', targetStartDate = '', actualStartDate = '', paymentStatus = '';
    var requestFound = false;
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var reqSheetForTimeline = _wfGetReqSheet(ss);
      var reqLastRow = reqSheetForTimeline.getLastRow();
      if (reqLastRow >= 2) {
        var reqHeaderRow = reqSheetForTimeline.getRange(1, 1, 1, reqSheetForTimeline.getLastColumn()).getValues()[0];
        var h = {}; reqHeaderRow.forEach(function(c,i){ if(c) h[String(c)]=i; });
        if (h['RequestID'] !== undefined) {
          var reqMatch = reqSheetForTimeline.getRange(2, h['RequestID'] + 1, reqLastRow - 1, 1)
            .createTextFinder(String(requestId)).matchEntireCell(true).findNext();
          if (reqMatch) {
            var reqRowVals = reqSheetForTimeline.getRange(reqMatch.getRow(), 1, 1, reqSheetForTimeline.getLastColumn()).getValues()[0];
            requestFound = true;
            currentStageLabel = h['CurrentStage'] !== undefined ? String(reqRowVals[h['CurrentStage']]||'') : '';
            requestCreatedAt = h['CreatedAt'] !== undefined ? _sd(reqRowVals[h['CreatedAt']]) : '';
            sellerOnboardingDate = h['SellerOnboardingDate'] !== undefined ? _sd(reqRowVals[h['SellerOnboardingDate']]) : '';
            paymentDate = h['PaymentDate'] !== undefined ? _sd(reqRowVals[h['PaymentDate']]) : '';
            paymentStatus = h['PaymentStatus'] !== undefined ? String(reqRowVals[h['PaymentStatus']]||'') : '';
            targetStartDate = h['TargetStartDate'] !== undefined ? _sd(reqRowVals[h['TargetStartDate']]) : '';
          }
        }
      }
    } catch (sheetEx) {
      return { success: false, error: 'getRequestWorkflowTimeline: reading this request\'s own row — ' + sheetEx.message };
    }
    if (!requestFound) return { success: false, error: 'getRequestWorkflowTimeline: request ' + requestId + ' was not found.' };
    // Actual start date comes from the request's connections, not a
    // column on the request itself — used to tell whether Target Start
    // was actually achieved or ended up delayed.
    //
    // Real performance bug fixed here: this used to call
    // getVAConnections({requestId}), which — like the WorkflowHistory
    // read above — reads the ENTIRE VAConnections sheet (every VA
    // connection ever recorded, for every request) into memory before
    // filtering down to this one request, and additionally reads the
    // whole VARequests sheet a second time for Service-Manager
    // department scoping that this Timeline never even needs (it only
    // needs two factual dates, not compensation-rate visibility rules).
    // _wfGetConnectionsForTimeline below is a purpose-built, much
    // cheaper lookup using the same TextFinder approach, scoped to just
    // this one request's own handful of connections.
    var conns = [];
    try {
      conns = _wfGetConnectionsForTimeline(requestId);
    } catch (connEx) { Logger.log('getRequestWorkflowTimeline connections lookup: ' + connEx.message); }
    var startedConn = conns.find(function(c){ return c.actualStartDate; });
    if (startedConn) actualStartDate = startedConn.actualStartDate;

    // Real bug fixed here: a stage's checkmark used to stay "completed"
    // forever once reached, even after the Final VA designation moved to
    // a genuinely different candidate who hasn't actually gone through
    // that step themselves (e.g. via Change VA, or re-designating Final
    // VA to a different assigned candidate). The connection card already
    // correctly shows that NEW candidate's own Rate Agreement/Kick-Off
    // Call/etc. as Pending — this Timeline was the one place still
    // showing the PREVIOUS candidate's old progress as if it belonged to
    // whoever is Final now. Anchoring "visited" to the current Final
    // VA's own FinalVADate fixes that: a history entry from before this
    // candidate was even designated no longer counts as their progress.
    // Request Intake and VA Assignment are exempt — those are true
    // request-level facts (the ticket was created; a VA was assigned at
    // all), not something that resets when the specific candidate does.
    var finalVADateAnchor = null;
    try {
      var finalConnForAnchor = conns.find(function(c){ return c.isFinalVA; });
      if (finalConnForAnchor && finalConnForAnchor.finalVADate) {
        var anchorParsed = new Date(finalConnForAnchor.finalVADate);
        if (!isNaN(anchorParsed.getTime())) finalVADateAnchor = anchorParsed.getTime();
      }
    } catch (anchorEx) { Logger.log('getRequestWorkflowTimeline finalVA anchor: ' + anchorEx.message); }

    // "Visited" = appears as a toStage anywhere in the history, with the
    // most recent time it was reached (a stage can be revisited, e.g.
    // VA Assignment after a Recruitment/Training round-trip).
    var visitedAt = {};
    history.forEach(function(entry) {
      if (finalVADateAnchor !== null &&
          entry.toStage !== WORKFLOW_STAGES.REQUEST_INTAKE.label &&
          entry.toStage !== WORKFLOW_STAGES.VA_ASSIGNMENT.label) {
        var entryTime = entry.changedAt ? new Date(entry.changedAt).getTime() : 0;
        if (entryTime < finalVADateAnchor) return; // stale — belongs to a previous Final VA
      }
      visitedAt[entry.toStage] = entry.changedAt;
    });
    // Request Intake specifically defaults to the ticket's own creation
    // date if there's no history entry for it at all — e.g. an older
    // request created before this workflow tracking existed.
    if (!visitedAt[WORKFLOW_STAGES.REQUEST_INTAKE.label] && requestCreatedAt) {
      visitedAt[WORKFLOW_STAGES.REQUEST_INTAKE.label] = requestCreatedAt;
    }

    // How long a stage's most recent visit lasted — from when it was
    // entered until the next transition happened (or "now" if it's the
    // current/latest stage, i.e. there was no next transition yet).
    var durationEndAt = {};
    history.forEach(function(entry, idx) {
      var nextEntry = history[idx + 1];
      durationEndAt[entry.toStage] = nextEntry ? nextEntry.changedAt : new Date().toISOString();
    });
    function _daysBetween(fromIso, toIso) {
      if (!fromIso) return null;
      var d = (new Date(toIso) - new Date(fromIso)) / 86400000;
      return Math.max(0, Math.floor(d));
    }

    var timeline;
    try {
      var currentIndex = WF_DISPLAY_ORDER.findIndex(function(key) { return WORKFLOW_STAGES[key].label === currentStageLabel; });

      timeline = WF_DISPLAY_ORDER.map(function(key, idx) {
        var def = WORKFLOW_STAGES[key];
        var isVisited = visitedAt[def.label] !== undefined;
        var isCurrent = def.label === currentStageLabel;
        var status;
        var paymentAlreadyResolved = key === 'PAYMENT_CONFIRMATION' && (paymentStatus === 'Paid' || paymentStatus === 'Add to Next Bill');
        if (isCurrent) status = 'current';
        else if (isVisited && (currentIndex === -1 || idx < currentIndex)) status = 'completed';
        // Per the request — Payment Confirmation shows as automatically
        // Completed whenever payment is already resolved, regardless of
        // where the request currently sits in the stage order (it can
        // be confirmed even before the request reaches this stage's own
        // position, e.g. while still at VA Prep) — rather than
        // "not_applicable" like the other optional stages above/below
        // it, and not gated on the request having already moved past
        // this stage's position first.
        else if (paymentAlreadyResolved && !isVisited) status = 'completed';
        else if (WF_OPTIONAL_STAGES.indexOf(key) !== -1 && !isVisited && currentIndex !== -1 && idx < currentIndex) status = 'not_applicable';
        else if (isVisited) status = 'completed'; // visited but somehow past currentIndex (e.g. a loop-back) — still counts as done
        else status = 'pending';
        var daysInStage = isVisited ? _daysBetween(visitedAt[def.label], durationEndAt[def.label]) : null;
        var changedAtForStage = visitedAt[def.label] || (paymentAlreadyResolved && !isVisited ? paymentDate : '') || '';
        return { key: key, label: def.label, role: def.role, status: status, changedAt: changedAtForStage, daysInStage: daysInStage };
      });
    } catch (timelineEx) {
      return { success: false, error: 'getRequestWorkflowTimeline: building the stage timeline — ' + timelineEx.message };
    }

    // Key Dates — a separate section from the workflow-stage timeline
    // above. Created always shows; Seller Onboarding and Payment only
    // show once they're actually set. Target Start gets a specific
    // achieved/delayed comparison against the actual start date, once
    // there is one — the whole point of tracking it here rather than
    // just showing it as a plain date.
    var keyDates = [];
    try {
      if (requestCreatedAt) keyDates.push({ label: 'Created', date: requestCreatedAt, status: 'completed', note: '' });
      if (sellerOnboardingDate) keyDates.push({ label: 'Seller Onboarding', date: sellerOnboardingDate, status: 'completed', note: '' });
      if (paymentDate) keyDates.push({ label: 'Payment', date: paymentDate, status: 'completed', note: '' });
      if (targetStartDate) {
        var targetStatus, targetNote;
        if (actualStartDate) {
          var achieved = new Date(actualStartDate) <= new Date(targetStartDate);
          targetStatus = achieved ? 'completed' : 'delayed';
          targetNote = achieved ? 'Achieved — VA started on time' : 'Delayed — actual start was ' + _daysBetween(targetStartDate, actualStartDate) + ' day(s) later';
        } else {
          var isPastTarget = new Date() > new Date(targetStartDate);
          targetStatus = isPastTarget ? 'delayed' : 'pending';
          targetNote = isPastTarget ? 'Past target — no VA has started yet' : 'Upcoming';
        }
        keyDates.push({ label: 'Target Start', date: targetStartDate, status: targetStatus, note: targetNote });
      }
      keyDates.sort(function(a,b){ return new Date(a.date) - new Date(b.date); });
    } catch (keyDatesEx) {
      return { success: false, error: 'getRequestWorkflowTimeline: building key dates — ' + keyDatesEx.message };
    }

    return { success: true, timeline: timeline, history: history, keyDates: keyDates, historyLoadError: historyLoadError };
  } catch (e) {
    return { success: false, error: 'getRequestWorkflowTimeline: ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STAGE ACKNOWLEDGEMENT / 24-HOUR FEEDBACK TRACKING
// ═══════════════════════════════════════════════════════════════════════
// Whenever a request moves to a new stage (any stage except Management
// Approval, which is a review/decision point, not an ongoing work
// queue), whoever now owns that stage must acknowledge receipt and give
// their next action items. After that, they must give another update at
// least every 24 hours, or the request gets flagged as having gone quiet.
// Each acknowledgement is recorded against the specific stage it was
// given for, so moving to a new stage always starts that clock fresh —
// an old update from a previous stage never counts toward the current
// one's 24-hour window.
// ═══════════════════════════════════════════════════════════════════════

function _wfGetAckSheet(ss) {
  return _ensureSheet(ss, CONFIG.SHEETS.REQUEST_STAGE_ACKNOWLEDGEMENTS, CONFIG.SCHEMA.RequestStageAcknowledgements);
}

// Records an acknowledgement/update for a request's CURRENT stage. Gated
// to whoever currently owns that stage (or an Administrator) — same
// ownership check the stage-transition actions already use. Management
// Approval is excluded entirely: it's a review/decision point for the
// Executive, not an ongoing work queue that needs periodic check-ins.
function acknowledgeRequestStage(requestId, notes) {
  try {
    notes = (notes || '').trim();
    if (!notes) return { success: false, error: 'Please provide your next action items.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reqSheet = _wfGetReqSheet(ss);
    var data = reqSheet.getDataRange().getValues();
    var h = _reqHMap(data[0]);
    var currentStage = '', currentRole = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      currentStage = h['CurrentStage'] !== undefined ? String(data[i][h['CurrentStage']]||'') : '';
      currentRole  = h['PersonInChargeRole'] !== undefined ? String(data[i][h['PersonInChargeRole']]||'') : '';
      break;
    }
    if (!currentStage) return { success: false, error: 'Request not found or has no active stage.' };
    if (currentStage === 'Management Approval') return { success: false, error: 'Management Approval does not use acknowledgements — it is a one-time decision, not an ongoing work queue.' };
    if (currentStage === 'Completed') return { success: false, error: 'This request is already completed.' };

    var perm = _wfCheckOwnership(requestId, currentRole);
    if (!perm.allowed) return { success: false, error: perm.error };

    var ackSheet = _wfGetAckSheet(ss);
    ackSheet.appendRow([
      generateID('ACK'), requestId, currentStage, notes,
      perm.user.name || perm.user.email, perm.user.email, new Date()
    ]);
    return { success: true, stage: currentStage };
  } catch (e) {
    return { success: false, error: 'acknowledgeRequestStage: ' + e.message };
  }
}

function getRequestStageAcknowledgements(requestId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _wfGetAckSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]||'') !== requestId) continue;
      var ts = data[i][h['AcknowledgedAt']];
      rows.push({
        stage: String(data[i][h['Stage']]||''),
        notes: String(data[i][h['Notes']]||''),
        acknowledgedBy: String(data[i][h['AcknowledgedBy']]||''),
        acknowledgedAt: (ts instanceof Date) ? ts.toISOString() : String(ts||'')
      });
    }
    rows.sort(function(a,b){ return new Date(b.acknowledgedAt) - new Date(a.acknowledgedAt); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getRequestStageAcknowledgements: ' + e.message };
  }
}

// Builds a requestId -> latest-acknowledgement-for-its-CURRENT-stage map
// in one pass, for getVARequests to compute "needs feedback" across every
// request efficiently rather than querying per-row. Only the latest
// acknowledgement matching each request's CURRENT stage is kept — an
// acknowledgement for a stage the request has since moved past is
// irrelevant to whether the CURRENT stage has gone quiet.
function _wfGetLatestAckByRequest() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _wfGetAckSheet(ss);
    var data = sheet.getDataRange().getValues();
    var result = {};
    if (data.length < 2) return result;
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    for (var i = 1; i < data.length; i++) {
      var reqId = String(data[i][h['RequestID']]||''); if (!reqId) continue;
      var stage = String(data[i][h['Stage']]||'');
      var ts = data[i][h['AcknowledgedAt']];
      var tsDate = (ts instanceof Date) ? ts : new Date(ts);
      var entry = {
        stage: stage, at: tsDate,
        by: h['AcknowledgedBy'] !== undefined ? String(data[i][h['AcknowledgedBy']]||'') : '',
        byEmail: h['AcknowledgedByEmail'] !== undefined ? String(data[i][h['AcknowledgedByEmail']]||'') : ''
      };
      // Per this fix — the single overall-latest ack per request (kept
      // here too, for callers that genuinely want that, like
      // _wfAdvance's carryForwardAck) is not enough on its own to answer
      // "has this specific stage been acknowledged," since a stage can
      // be revisited after the request moves on and back. Also tracked
      // per request+stage below, so each stage's own history survives
      // independently of whichever stage happens to be most recent
      // overall.
      if (!result[reqId] || tsDate > result[reqId].at) result[reqId] = entry;
      var stageKey = reqId + '|' + stage;
      if (!result[stageKey] || tsDate > result[stageKey].at) result[stageKey] = entry;
    }
    return result;
  } catch (e) {
    Logger.log('_wfGetLatestAckByRequest error: ' + e.message);
    return {};
  }
}