// ═══════════════════════════════════════════════════════════
// AuditService.gs — Data-integrity checks surfaced on the Audit page
// ═══════════════════════════════════════════════════════════
//
// Findings on the overview:
//  1. Customers with at least one VA Connection but no Service Request on
//     file, OR whose Service Requests exist but none of them is RequestType
//     'New' (i.e. there's no record of how the very first VA connection was
//     actually requested — a gap worth knowing about regardless of whether
//     the customer is old or new).
//  2. VA Connections with no Hours identified yet (blank/zero), excluding
//     Cancelled/Declined connections since those never went anywhere.
//  3. Data-integrity issues on Customers AND Accounts (Clients), covering:
//       Completeness — every record needs an Added event. Anything that is
//       (or ever was) Active/Paused/Terminated needs an Activated event too.
//       Paused needs a Paused event; Terminated needs a Terminated event.
//     Chronology — Added can't be after Activated. Terminated can't be
//       before the Activated it followed. A Paused → Terminated sequence
//       needs a Resumed event in between (you can't go straight from paused
//       to terminated without coming back active first).
//
// Drilling into a Customer or Account shows its full status timeline
// (Added, Activated, Paused/Resumed, Terminated, Reactivated — merged from
// StatusHistory where it exists, plus ActivityLogs always) with the same
// issue list, and the completeness gaps (missing Activated/Paused/
// Terminated/Resumed) are backfillable directly from there. The chronology
// issues are surfaced but not auto-fixable — those mean an existing dated
// record is wrong, which needs a human to look at the specific dates rather
// than a "fill in the blank" action.

// ── Shared timeline + issue analysis — works for Customer or Client ────
// `historyRaw` is StatusHistory JSON (Customers only — Clients have no such
// column, so callers pass ''). `statusLogs` is that entity's slice of
// ActivityLogs Status-field entries (see _getStatusChangeLogsByEntityType/
// _getStatusChangeLogsForEntity in LogService.gs).
function _auditAnalyzeTimeline(currentStatus, createdAt, createdBy, historyRaw, statusLogs, activeIntervals) {
  activeIntervals = activeIntervals || [];
  var mergedEvents = _mergeStatusEvents(historyRaw, statusLogs || []);

  var timeline = [];
  if (createdAt) {
    timeline.push({ type: 'Added', date: _sd(createdAt), reason: '', by: String(createdBy || ''), manual: false, source: 'created' });
  }
  mergedEvents.forEach(function(ev) {
    timeline.push({
      type: ev.to === 'Active' ? (ev.from === 'Terminated' || ev.from === 'Cancelled' ? 'Reactivated' : (ev.from === 'Paused' ? 'Resumed' : 'Became Active'))
          : ev.to === 'Paused' ? 'Paused'
          : ev.to === 'Terminated' ? 'Terminated'
          : ev.to === 'Cancelled' ? 'Cancelled'
          : ('Changed to ' + ev.to),
      date: ev.date,
      from: ev.from, to: ev.to,
      reason: ev.reason || '',
      by: ev.by || '',
      manual: !!ev.manual,
      source: ev.source // 'history' (StatusHistory JSON) or 'log' (ActivityLogs)
    });
  });
  timeline.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

  var ACTIVATED_TYPES = ['Became Active', 'Reactivated', 'Resumed'];
  var isActivatedType = function(t) { return ACTIVATED_TYPES.indexOf(t) !== -1; };

  var issues = [];

  // ── Completeness ──────────────────────────────────────────────────────
  var everActivated = timeline.some(function(ev) { return isActivatedType(ev.type); });
  var everPaused     = timeline.some(function(ev) { return ev.type === 'Paused'; });
  var everTerminated = timeline.some(function(ev) { return ev.type === 'Terminated'; });
  var everAdded       = timeline.some(function(ev) { return ev.type === 'Added'; });

  if (!everAdded) {
    issues.push({ code: 'missing_added', message: 'No "Added" date on file at all.' });
  }
  // Active/Paused/Terminated all imply the record was activated at some point.
  var everActiveish = currentStatus === 'Active' || currentStatus === CONFIG.STATUS.PAUSED || currentStatus === 'Terminated' || everPaused || everTerminated;
  if (everActiveish && !everActivated) {
    issues.push({ code: 'missing_activated', message: 'Currently (or previously) Active/Paused/Terminated, but no "Activated" event is on file.' });
  }
  if (currentStatus === CONFIG.STATUS.PAUSED && !everPaused) {
    issues.push({ code: 'missing_paused', message: 'Status is Paused, but no "Paused" event is on file.' });
  }
  if (currentStatus === 'Terminated' && !everTerminated) {
    issues.push({ code: 'missing_terminated', message: 'Status is Terminated, but no "Terminated" event is on file.' });
  }

  // ── Chronology ────────────────────────────────────────────────────────
  var addedEvent     = timeline.find(function(ev) { return ev.type === 'Added'; });
  var firstActivated = timeline.find(function(ev) { return isActivatedType(ev.type); });
  if (addedEvent && firstActivated && _auditDateOnly(addedEvent.date) > _auditDateOnly(firstActivated.date)) {
    issues.push({
      code: 'added_after_activated',
      message: 'Added date (' + _auditFmt(addedEvent.date) + ') is AFTER the first Activated date (' + _auditFmt(firstActivated.date) + ') — Added should always come first.'
    });
  }

  // For every Terminated event, it must not be earlier than the most recent
  // Activated-type event that precedes it in the timeline.
  var lastActivatedDate = null;
  var lastPausedDate    = null;
  for (var t = 0; t < timeline.length; t++) {
    var ev = timeline[t];
    if (isActivatedType(ev.type)) { lastActivatedDate = ev.date; lastPausedDate = null; }
    else if (ev.type === 'Paused') { lastPausedDate = ev.date; }
    else if (ev.type === 'Terminated') {
      if (lastActivatedDate && new Date(ev.date) < new Date(lastActivatedDate)) {
        issues.push({
          code: 'terminated_before_activated',
          message: 'Terminated date (' + _auditFmt(ev.date) + ') is BEFORE the Activated date it followed (' + _auditFmt(lastActivatedDate) + ') — a record can\'t be terminated before it was ever activated.'
        });
      }
      // A Paused event with no Resumed/Activated event before this
      // Terminated means it went Paused straight to Terminated with no
      // record of coming back Active in between — but per the request,
      // this is only worth flagging if a VA connection was genuinely
      // active somewhere in that window. If nothing was ever active
      // during the Pause, nothing was actually overlooked.
      if (lastPausedDate) {
        var pauseWindowStart = new Date(lastPausedDate);
        var pauseWindowEnd   = new Date(ev.date);
        var hadActiveConnInWindow = activeIntervals.some(function(iv) {
          var ivEnd = iv.end || new Date(); // still active/open-ended — treat as ongoing through now
          return iv.start <= pauseWindowEnd && ivEnd >= pauseWindowStart;
        });
        if (hadActiveConnInWindow) {
          issues.push({
            code: 'terminated_without_resume',
            message: 'Paused on ' + _auditFmt(lastPausedDate) + ' then Terminated on ' + _auditFmt(ev.date) + ' with no "Resumed" event in between — and had an active VA connection during that window.'
          });
        }
      }
    }
  }

  return {
    timeline: timeline,
    issues: issues,
    // Kept for the specific backfill actions the timeline modal offers —
    // named after what's missing so the UI can decide which "+ Add" buttons
    // to show.
    missingActivated: issues.some(function(i){ return i.code === 'missing_activated'; }),
    missingPaused:     issues.some(function(i){ return i.code === 'missing_paused'; }),
    missingTerminated: issues.some(function(i){ return i.code === 'missing_terminated'; }),
    missingResume:      issues.some(function(i){ return i.code === 'terminated_without_resume'; })
  };
}

// Strips time-of-day, returning a value that compares purely by calendar
// date — a 'YYYY-MM-DD' string sorts/compares correctly as-is. Used so
// same-day events with different times of day are never treated as one
// coming "after" the other.
function _auditDateOnly(dateVal) {
  try { return Utilities.formatDate(new Date(dateVal), Session.getScriptTimeZone() || 'UTC', 'yyyy-MM-dd'); }
  catch (e) { return String(dateVal || ''); }
}

function _auditFmt(dateStr) {
  try { return Utilities.formatDate(new Date(dateStr), Session.getScriptTimeZone() || 'UTC', 'yyyy-MM-dd'); }
  catch (e) { return String(dateStr || ''); }
}

// Dedicated, lightweight version of the same check in getAuditOverview,
// per the request — the dashboard loads far more often than the Audit
// module itself, so this avoids computing all 10 audit sections just to
// show this one on it.
function getActiveConnectionsMissingWRLink() {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var reqSheet  = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var cliSheet  = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!custSheet || !reqSheet || !connSheet) return { success: true, data: [] };

    var custData = custSheet.getDataRange().getValues();
    var reqData  = reqSheet.getDataRange().getValues();
    var connData = connSheet.getDataRange().getValues();
    var ch  = _headerMap(custData[0]);
    var rh  = _headerMap(reqData[0]);
    var coh = _headerMap(connData[0]);

    var custNameById = {};
    var csAssignedByCustomerId = {};
    for (var ci = 1; ci < custData.length; ci++) {
      var cid = String(custData[ci][ch['CustomerID']]||'').trim(); if (!cid) continue;
      custNameById[cid] = String(custData[ci][ch['CustomerName']]||'');
      csAssignedByCustomerId[cid] = ch['AssignedSpecialist'] !== undefined ? String(custData[ci][ch['AssignedSpecialist']]||'') : '';
    }
    var deptByRequestId = {};
    for (var dri = 1; dri < reqData.length; dri++) {
      deptByRequestId[String(reqData[dri][rh['RequestID']]||'')] = String(reqData[dri][rh['Department']]||'');
    }
    // Real bug fixed here: a connection's own CustomerID is set once, at
    // creation time, from whatever the underlying Service Request's
    // customerId was then (VAConnectionService.gs, createVAConnection).
    // An older request whose own customerId was ever blank leaves every
    // connection created under it with a blank CustomerID too — even
    // though ClientID is fine — which is exactly what silently left CS
    // Assigned empty here: csAssignedByCustomerId['' ] never resolves to
    // anything. This fallback resolves the customer via ClientID
    // instead whenever the connection's own CustomerID comes up empty.
    var custIdByClientId = {};
    if (cliSheet) {
      var cliData = cliSheet.getDataRange().getValues();
      var clh = _headerMap(cliData[0]);
      for (var cli = 1; cli < cliData.length; cli++) {
        var clid = String(cliData[cli][clh['ClientID']]||'').trim(); if (!clid) continue;
        custIdByClientId[clid] = String(cliData[cli][clh['CustomerID']]||'').trim();
      }
    }

    var rows = [];
    for (var wri = 1; wri < connData.length; wri++) {
      var wrStatus = String(connData[wri][coh['ConnectionStatus']] || '');
      if (wrStatus !== 'Started') continue; // only Started connections need a WR on file
      var wrLink = coh['WRLink'] !== undefined ? String(connData[wri][coh['WRLink']]||'') : '';
      if (wrLink) continue;
      var wrConnId = String(connData[wri][coh['ConnectionID']] || ''); if (!wrConnId) continue;
      var wrClientId = String(connData[wri][coh['ClientID']] || '').trim();
      var wrCustId = String(connData[wri][coh['CustomerID']] || '').trim();
      if (!wrCustId && wrClientId) wrCustId = custIdByClientId[wrClientId] || '';
      var wrRequestId = coh['RequestID'] !== undefined ? String(connData[wri][coh['RequestID']]||'') : '';
      rows.push({
        connectionId: wrConnId,
        vaName: String(connData[wri][coh['VAName']] || ''),
        clientId: wrClientId,
        customerId: wrCustId,
        customerName: custNameById[wrCustId] || '',
        csAssignedEmail: csAssignedByCustomerId[wrCustId] || '',
        department: deptByRequestId[wrRequestId] || '',
        connectionStatus: wrStatus,
        actualStartDate: coh['ActualStartDate'] !== undefined ? _sd(connData[wri][coh['ActualStartDate']]) : ''
      });
    }
    rows.sort(function(a,b) {
      var deptCompare = (a.department||'').localeCompare(b.department||'');
      if (deptCompare !== 0) return deptCompare;
      return new Date(a.actualStartDate) - new Date(b.actualStartDate);
    });

    if (perm.user && perm.user.role === CONFIG.ROLES.CS_SPECIALIST) {
      var myVisibleCustomerIds = {};
      var myEmail = (perm.user.email||'').toLowerCase().trim();
      for (var svi = 1; svi < custData.length; svi++) {
        var svCustId = String(custData[svi][ch['CustomerID']]||'').trim(); if (!svCustId) continue;
        var svSpec = ch['AssignedSpecialist'] !== undefined ? String(custData[svi][ch['AssignedSpecialist']]||'').toLowerCase().trim() : '';
        if (svSpec === myEmail) myVisibleCustomerIds[svCustId] = true;
      }
      getTakeoverCustomerIdsForSpecialist(myEmail).forEach(function(cid){ myVisibleCustomerIds[cid] = true; });
      rows = rows.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
    }

    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getActiveConnectionsMissingWRLink: ' + e.message };
  }
}

function getAuditOverview() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var cliSheet  = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var reqSheet  = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!custSheet || !cliSheet || !reqSheet || !connSheet) {
      return { success: false, error: 'Required sheets missing. Run initializeSystem().' };
    }

    var custData = custSheet.getDataRange().getValues();
    var cliData  = cliSheet.getDataRange().getValues();
    var reqData  = reqSheet.getDataRange().getValues();
    var connData = connSheet.getDataRange().getValues();
    var ch  = _headerMap(custData[0]);
    var clh = _headerMap(cliData[0]);
    var rh  = _headerMap(reqData[0]);
    var coh = _headerMap(connData[0]);

    // ActivityLogs is read ONCE per entity type here (not per-record) via
    // _getStatusChangeLogsByEntityType (LogService.gs).
    var statusLogsByCustomer = _getStatusChangeLogsByEntityType('Customer', 'Status');
    // Accounts: current code always writes EntityType='Client', but older
    // rows used 'Account' — read both (see _getStatusChangeLogsByEntityType
    // in LogService.gs for the full explanation).
    var statusLogsByClient   = _getStatusChangeLogsByEntityType(['Client', 'Account'], 'Status');

    var dataIntegrityIssues = [];

    // Per the request — a Paused → Terminated transition (no Resume in
    // between) is only worth flagging if there was actually an active VA
    // connection somewhere in that window. If nothing was active at all,
    // nothing was genuinely missed — the account simply went from one
    // inactive state to another. Built once here, before both loops
    // below, from each connection's own ActualStartDate/TerminationDate
    // (still-active connections use "now" as an open-ended end).
    var clientIdToCustomerId = {};
    for (var pcli = 1; pcli < cliData.length; pcli++) {
      var pcliId = String(cliData[pcli][clh['ClientID']] || '').trim();
      if (!pcliId) continue;
      clientIdToCustomerId[pcliId] = String(cliData[pcli][clh['CustomerID']] || '').trim();
    }
    var connIntervalsByClient = {}; // clientId -> [{start, end}]
    for (var pconi = 1; pconi < connData.length; pconi++) {
      var pconClientId = String(connData[pconi][coh['ClientID']] || '').trim();
      if (!pconClientId) continue;
      var pconStart = connData[pconi][coh['ActualStartDate']];
      if (!pconStart) continue; // never actually started — no active period at all
      var pconEnd = connData[pconi][coh['TerminationDate']] || null;
      if (!connIntervalsByClient[pconClientId]) connIntervalsByClient[pconClientId] = [];
      connIntervalsByClient[pconClientId].push({
        start: new Date(pconStart),
        end: pconEnd ? new Date(pconEnd) : null // null = still active/open-ended
      });
    }
    var connIntervalsByCustomer = {}; // customerId -> [{start, end}], aggregated across its accounts
    Object.keys(connIntervalsByClient).forEach(function(cliIdForAgg) {
      var custIdForAgg = clientIdToCustomerId[cliIdForAgg];
      if (!custIdForAgg) return;
      if (!connIntervalsByCustomer[custIdForAgg]) connIntervalsByCustomer[custIdForAgg] = [];
      connIntervalsByCustomer[custIdForAgg] = connIntervalsByCustomer[custIdForAgg].concat(connIntervalsByClient[cliIdForAgg]);
    });

    // ── Customers ────────────────────────────────────────────────────────
    var custById = {};
    for (var i = 1; i < custData.length; i++) {
      var cid = String(custData[i][ch['CustomerID']] || '').trim();
      if (!cid) continue;
      var cName   = String(custData[i][ch['CustomerName']] || '');
      var cStatus = String(custData[i][ch['Status']]       || '');
      var cCreatedAt = custData[i][ch['CreatedAt']];
      var cCreatedBy = ch['CreatedBy'] !== undefined ? custData[i][ch['CreatedBy']] : '';
      var cHistoryRaw = ch['StatusHistory'] !== undefined ? custData[i][ch['StatusHistory']] : '';

      custById[cid] = { customerId: cid, customerName: cName, status: cStatus, createdAt: _sd(cCreatedAt) };

      var cAnalysis = _auditAnalyzeTimeline(cStatus, cCreatedAt, cCreatedBy, cHistoryRaw, statusLogsByCustomer[cid], connIntervalsByCustomer[cid]);
      if (cAnalysis.issues.length) {
        dataIntegrityIssues.push({
          entityType: 'Customer', entityId: cid, entityName: cName, status: cStatus,
          createdAt: _sd(cCreatedAt),
          issues: cAnalysis.issues
        });
      }
    }

    // ── Accounts (Clients) ───────────────────────────────────────────────
    // Clients have no StatusHistory column, so their timeline is built
    // purely from ActivityLogs — _auditAnalyzeTimeline handles that fine
    // with historyRaw passed as ''.
    var clientsByCustomer = {}; // customerId → array of {clientId, name, status}
    for (var ci = 1; ci < cliData.length; ci++) {
      var cliId = String(cliData[ci][clh['ClientID']] || '').trim();
      if (!cliId) continue;
      var cliName   = String(cliData[ci][clh['CompanyName']] || '') + (cliData[ci][clh['AccountName']] ? ' — ' + String(cliData[ci][clh['AccountName']]) : '');
      var cliStatus = String(cliData[ci][clh['Status']]       || '');
      var cliCreatedAt = cliData[ci][clh['CreatedAt']];
      var cliCreatedBy = clh['CreatedBy'] !== undefined ? cliData[ci][clh['CreatedBy']] : '';
      var cliCustId = String(cliData[ci][clh['CustomerID']] || '').trim();

      if (cliCustId) {
        if (!clientsByCustomer[cliCustId]) clientsByCustomer[cliCustId] = [];
        clientsByCustomer[cliCustId].push({ clientId: cliId, name: cliName, status: cliStatus });
      }

      var cliAnalysis = _auditAnalyzeTimeline(cliStatus, cliCreatedAt, cliCreatedBy, '', statusLogsByClient[cliId], connIntervalsByClient[cliId]);
      if (cliAnalysis.issues.length) {
        dataIntegrityIssues.push({
          entityType: 'Client', entityId: cliId, entityName: cliName, status: cliStatus,
          createdAt: _sd(cliCreatedAt),
          issues: cliAnalysis.issues
        });
      }
    }

    dataIntegrityIssues.sort(function(a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });

    // ── Customer/Account status consistency ─────────────────────────────
    // If any of a customer's accounts is Active, the customer itself should
    // be Active too. If NONE of them are Active, the customer's status
    // should match whatever the accounts collectively are (Paused if any
    // are Paused; Terminated only if ALL of them are) — a customer can't be
    // sitting on "Active" while every one of its accounts has moved on, nor
    // can it lag behind as "Paused" once every account is actually gone.
    var statusMismatches = [];
    var customersWithNoAccounts = [];
    Object.keys(custById).forEach(function(custId) {
      if (!clientsByCustomer[custId] || !clientsByCustomer[custId].length) {
        customersWithNoAccounts.push({ customerId: custId, customerName: custById[custId].customerName, customerStatus: custById[custId].status });
      }
    });
    customersWithNoAccounts.sort(function(a,b){ return a.customerName.localeCompare(b.customerName); });
    Object.keys(clientsByCustomer).forEach(function(custId) {
      var cust = custById[custId];
      if (!cust) return; // account references a customer that no longer exists
      var accounts = clientsByCustomer[custId];
      var hasActive = accounts.some(function(a){ return a.status === 'Active'; });
      var hasPaused = accounts.some(function(a){ return a.status === CONFIG.STATUS.PAUSED; });
      var allTerminated = accounts.length > 0 && accounts.every(function(a){ return a.status === 'Terminated'; });

      var expected = null;
      if (hasActive) expected = 'Active';
      else if (hasPaused) expected = CONFIG.STATUS.PAUSED;
      else if (allTerminated) expected = 'Terminated';
      // If accounts are in some other mix (e.g. only Cancelled/blank), no
      // clear expectation — don't flag rather than guess.

      if (expected && cust.status !== expected) {
        statusMismatches.push({
          customerId: custId, customerName: cust.customerName, customerStatus: cust.status,
          expectedStatus: expected,
          accountStatuses: accounts.map(function(a){ return a.name + ' (' + (a.status||'—') + ')'; }).join(', '),
          reason: hasActive
            ? 'Has at least one Active account, but the customer itself is "' + cust.status + '."'
            : (expected === CONFIG.STATUS.PAUSED
                ? 'No Active account, but at least one is Paused — customer should be Paused too, not "' + cust.status + '."'
                : 'Every account is Terminated, but the customer itself is "' + cust.status + '."')
        });
      }
    });
    statusMismatches.sort(function(a,b){ return a.customerName.localeCompare(b.customerName); });

    // ── Account status vs. Pending VA connections ─────────────────────────
    // If every VA connection under an account is still Pending, the
    // account itself should also be Pending — not Active or anything
    // else, since nothing has actually started working yet. Just as
    // importantly, the reverse also holds: once at least one connection
    // has moved past Pending, the account shouldn't still be sitting at
    // Pending either.
    var connectionsByClient = {}; // clientId -> array of connection statuses
    // Per the request — the IDs behind those statuses, so exports can list them. clientId -> [{id, status}]
    var connectionIdsByClient = {};
    for (var pci = 1; pci < connData.length; pci++) {
      var pciClientId = String(connData[pci][coh['ClientID']] || '').trim();
      if (!pciClientId) continue;
      var pciStatus = String(connData[pci][coh['ConnectionStatus']] || '');
      if (pciStatus === 'Cancelled' || pciStatus === 'Declined') continue; // never went anywhere — not part of this check
      if (!connectionsByClient[pciClientId]) connectionsByClient[pciClientId] = [];
      connectionsByClient[pciClientId].push(pciStatus);
      if (!connectionIdsByClient[pciClientId]) connectionIdsByClient[pciClientId] = [];
      connectionIdsByClient[pciClientId].push({ id: String(connData[pci][coh['ConnectionID']] || '').trim(), status: pciStatus });
    }
    var accountPendingMismatches = [];
    for (var aci = 1; aci < cliData.length; aci++) {
      var aciClientId = String(cliData[aci][clh['ClientID']] || '').trim();
      if (!aciClientId) continue;
      var aciStatuses = connectionsByClient[aciClientId];
      if (!aciStatuses || !aciStatuses.length) continue; // no connections at all — a different, separate concern
      var allPending = aciStatuses.every(function(s){ return s === 'Pending'; });
      // Per the report — being merely Accepted isn't the same as having
      // actually Started. The account should only be expected to move
      // past Pending once a VA has genuinely begun working, not simply
      // once one has been accepted but not yet started.
      var hasStarted = aciStatuses.some(function(s){ return s === 'Started'; });
      var aciAccountStatus = String(cliData[aci][clh['Status']] || '');

      var mismatchReason = null;
      if (allPending && aciAccountStatus !== 'Pending') {
        mismatchReason = 'Every VA connection is still Pending, but the account is "' + aciAccountStatus + '."';
      } else if (!allPending && hasStarted && aciAccountStatus === 'Pending') {
        // Exception, per the request: an account legitimately sits back
        // at Pending with older, non-Pending connections still on file
        // if it was reactivated — a Status change from Terminated/
        // Cancelled back to Pending, restarting fresh while the old
        // connections remain as history. Not a mismatch in that case.
        var wasReactivatedToPending = (statusLogsByClient[aciClientId] || []).some(function(lg) {
          return lg.newValue === 'Pending' && (lg.oldValue === 'Terminated' || lg.oldValue === 'Cancelled');
        });
        if (!wasReactivatedToPending) {
          mismatchReason = 'At least one VA connection has actually Started, but the account is still "Pending."';
        }
      }
      if (!mismatchReason) continue;

      accountPendingMismatches.push({
        clientId: aciClientId,
        accountName: String(cliData[aci][clh['CompanyName']] || '') + (cliData[aci][clh['AccountName']] ? ' — ' + String(cliData[aci][clh['AccountName']]) : ''),
        accountStatus: aciAccountStatus,
        connectionCount: aciStatuses.length,
        connectionIds: (connectionIdsByClient[aciClientId] || []).filter(function(c){ return c.id; }).map(function(c){ return c.id + ' (' + c.status + ')'; }).join(', '),
        reason: mismatchReason
      });
    }
    accountPendingMismatches.sort(function(a,b){ return a.accountName.localeCompare(b.accountName); });

    // ── Accounts/Customers not activated despite a Started connection ──
    // Per the request — a direct check on the activation guarantee
    // itself: _activateCustomerAndAccount (VAConnectionService.gs) is
    // supposed to set BOTH the Account and its parent Customer to Active
    // the moment any VA connection under that account is marked Started
    // (skipping only if already Active). This independently verifies
    // that actually held on the data, rather than trusting the cascade
    // always ran cleanly — distinct from accountPendingMismatches above,
    // which only catches an account stuck specifically at "Pending."
    // This catches ANY non-Active account status (blank, Inactive,
    // anything) once a connection has genuinely Started, and — just as
    // importantly — checks the Customer side too, which
    // accountPendingMismatches doesn't touch at all.
    var notActivatedDespiteStarted = [];
    for (var nai = 1; nai < cliData.length; nai++) {
      var naClientId = String(cliData[nai][clh['ClientID']] || '').trim();
      if (!naClientId) continue;
      var naStatuses = connectionsByClient[naClientId];
      if (!naStatuses || !naStatuses.some(function(s){ return s === 'Started'; })) continue; // no Started connection — not this check's concern
      var naAccountStatus = String(cliData[nai][clh['Status']] || '');
      var naCustId = clientIdToCustomerId[naClientId] || '';
      var naCust = custById[naCustId];
      var naCustomerStatus = naCust ? naCust.status : '';

      var naAccountOk = naAccountStatus === 'Active';
      var naCustomerOk = !naCustId || !naCust || naCustomerStatus === 'Active'; // customer unresolved — that half isn't this check's concern

      if (naAccountOk && naCustomerOk) continue;

      var naProblems = [];
      if (!naAccountOk) naProblems.push('Account is "' + (naAccountStatus || '—') + '," not Active');
      if (!naCustomerOk) naProblems.push('Customer is "' + (naCustomerStatus || '—') + '," not Active');

      notActivatedDespiteStarted.push({
        clientId: naClientId,
        accountName: String(cliData[nai][clh['CompanyName']] || '') + (cliData[nai][clh['AccountName']] ? ' — ' + String(cliData[nai][clh['AccountName']]) : ''),
        accountStatus: naAccountStatus,
        customerId: naCustId,
        customerName: naCust ? naCust.customerName : '',
        customerStatus: naCustomerStatus,
        connectionIds: (connectionIdsByClient[naClientId] || []).filter(function(c){ return c.id && c.status === 'Started'; }).map(function(c){ return c.id; }).join(', '),
        reason: naProblems.join('; ')
      });
    }
    notActivatedDespiteStarted.sort(function(a,b){ return a.accountName.localeCompare(b.accountName); });

    // ── Active Customers vs Active VA Connections ───────────────────────
    // Connections should normally outnumber active customers (any active
    // customer can have more than one VA connection) — if the total count
    // of Started connections comes in at or below the count of Active
    // customers, that's a sign either some connections aren't being
    // counted somewhere, or there are active customers with no connection
    // at all. This surfaces the customers in that second bucket directly.
    var activeCustomerCount = 0;
    Object.keys(custById).forEach(function(cid){ if (custById[cid].status === 'Active') activeCustomerCount++; });

    var startedConnCount = 0;
    var startedByCustomer = {};
    var startedIdsByCustomer = {};
    for (var sci = 1; sci < connData.length; sci++) {
      if (String(connData[sci][coh['ConnectionStatus']]||'') !== 'Started') continue;
      startedConnCount++;
      // Same fallback as getActiveConnectionsMissingWRLink — a
      // connection's own CustomerID can be blank if the underlying
      // Service Request's customerId was ever blank (an older/legacy
      // request); ClientID is far more reliably populated, so resolve
      // through it via clientIdToCustomerId (already built above) when
      // CustomerID itself comes up empty.
      var sCustId = String(connData[sci][coh['CustomerID']]||'').trim();
      var sClientId = String(connData[sci][coh['ClientID']]||'').trim();
      if (!sCustId && sClientId) sCustId = clientIdToCustomerId[sClientId] || '';
      if (sCustId) startedByCustomer[sCustId] = (startedByCustomer[sCustId]||0) + 1;
      if (sCustId) { if (!startedIdsByCustomer[sCustId]) startedIdsByCustomer[sCustId] = []; var sConnId = String(connData[sci][coh['ConnectionID']]||'').trim(); if (sConnId) startedIdsByCustomer[sCustId].push(sConnId); }
    }

    var activeCustomersNoConnection = [];
    Object.keys(custById).forEach(function(cid) {
      if (custById[cid].status !== 'Active') return;
      if (!startedByCustomer[cid]) {
        activeCustomersNoConnection.push({ customerId: cid, customerName: custById[cid].customerName });
      }
    });
    activeCustomersNoConnection.sort(function(a,b){ return a.customerName.localeCompare(b.customerName); });

    var connectionCountCheck = {
      activeCustomerCount: activeCustomerCount,
      startedConnectionCount: startedConnCount,
      looksOff: startedConnCount <= activeCustomerCount,
      activeCustomersNoConnection: activeCustomersNoConnection
    };

    // ── Active Customers with No Active Account ─────────────────────────
    // Per the request — distinct from both checks above: statusMismatches
    // only flags a clean Active/Paused/Terminated pattern (it explicitly
    // skips a mixed bag like Cancelled/blank accounts, "no clear
    // expectation — don't flag rather than guess"), and
    // customersWithNoAccounts only catches a customer with literally zero
    // accounts. This catches the specific case in between: an Active
    // customer whose accounts exist but NONE of them is Active, whatever
    // their actual statuses are — genuinely worth a look regardless. Each
    // one also reports whether an active (Started) VA connection exists
    // underneath it anyway, using the same startedByCustomer built just
    // above — that combination (Active customer, no Active account, yet
    // a VA connection is still running) is the most concerning version of
    // this and worth being able to spot at a glance.
    var activeCustomersNoActiveAccount = [];
    Object.keys(custById).forEach(function(cid) {
      if (custById[cid].status !== 'Active') return;
      var accounts = clientsByCustomer[cid] || [];
      if (!accounts.length) return; // already covered by customersWithNoAccounts above
      var hasActiveAccount = accounts.some(function(a){ return a.status === 'Active'; });
      if (hasActiveAccount) return;
      activeCustomersNoActiveAccount.push({
        customerId: cid,
        customerName: custById[cid].customerName,
        accountCount: accounts.length,
        accountStatuses: accounts.map(function(a){ return a.name + ' (' + (a.status||'—') + ')'; }).join(', '),
        startedConnectionCount: startedByCustomer[cid] || 0,
        startedConnectionIds: (startedIdsByCustomer[cid] || []).join(', '),
        hasActiveVAConnection: !!startedByCustomer[cid]
      });
    });
    activeCustomersNoActiveAccount.sort(function(a,b){
      // Customers with a VA connection still running despite no active
      // account are the more urgent case — surfaced first.
      if (a.hasActiveVAConnection !== b.hasActiveVAConnection) return a.hasActiveVAConnection ? -1 : 1;
      return a.customerName.localeCompare(b.customerName);
    });

    // ── Connections with NO schedule on file at all ────────────────────
    // Distinct from noHoursConnections above (which checks the CACHED
    // Hours column on VAConnections) — this checks VAConnectionHoursLog
    // itself, the actual source of truth for a connection's schedule.
    // A connection can have a stale non-zero cached Hours value while
    // genuinely having no log entry at all (or vice versa), so this needs
    // its own pass rather than reusing that list.
    var connsWithSchedule = {}; // connectionId → true, if it has ANY
                                 // entry that actually defines a schedule
    try {
      var hoursLogSheet = ss.getSheetByName('VAConnectionHoursLog');
      if (hoursLogSheet) {
        var hld = hoursLogSheet.getDataRange().getValues();
        var hlh = {}; hld[0].forEach(function(c,i){ if(c) hlh[String(c)]=i; });
        for (var hli = 1; hli < hld.length; hli++) {
          var hlConnId = String(hld[hli][hlh['ConnectionID']]||''); if (!hlConnId) continue;
          // Per the same confirmation workflow as _hoursBuildTimeline —
          // a Pending or Cancelled change hasn't actually taken effect,
          // so it shouldn't count as "has a schedule on file" here either.
          var hlApplyStatus = hlh['ApplyStatus'] !== undefined ? String(hld[hli][hlh['ApplyStatus']] || '') : '';
          if (hlApplyStatus === 'Pending' || hlApplyStatus === 'Cancelled') continue;
          var hlChangeType = String(hld[hli][hlh['ChangeType']]||'');
          if (hlChangeType === 'Project Hours Entry') { connsWithSchedule[hlConnId] = true; continue; } // Project Based connections don't have a day-by-day breakdown, but this confirms hours ARE on file
          var hlBreakdown = hlh['NewScheduleBreakdown'] !== undefined ? hld[hli][hlh['NewScheduleBreakdown']] : '';
          var hlHoursType = hlh['NewHoursType'] !== undefined ? String(hld[hli][hlh['NewHoursType']]||'') : '';
          if (hlBreakdown || hlHoursType === 'Project Based' || hlHoursType === 'Monthly') connsWithSchedule[hlConnId] = true;
        }
      }
    } catch (schedEx) { Logger.log('getAuditOverview schedule check: ' + schedEx.message); }

    var missingScheduleConnections = [];
    for (var msi = 1; msi < connData.length; msi++) {
      var msConnId = String(connData[msi][coh['ConnectionID']] || ''); if (!msConnId) continue;
      var msStatus = String(connData[msi][coh['ConnectionStatus']] || '');
      if (msStatus === 'Cancelled' || msStatus === 'Declined' || msStatus === 'Pending') continue; // never went anywhere, or not even accepted yet
      if (connsWithSchedule[msConnId]) continue;
      var msCustId = String(connData[msi][coh['CustomerID']] || '').trim();
      var msCustInfo = custById[msCustId] || {};
      missingScheduleConnections.push({
        connectionId: msConnId,
        vaName: String(connData[msi][coh['VAName']] || ''),
        clientId: String(connData[msi][coh['ClientID']] || ''),
        customerId: msCustId,
        customerName: msCustInfo.customerName || '',
        connectionStatus: msStatus,
        assignedAt: coh['AssignedAt'] !== undefined ? _sd(connData[msi][coh['AssignedAt']]) : ''
      });
    }
    missingScheduleConnections.sort(function(a,b){
      var aStarted = a.connectionStatus === 'Started' ? 0 : 1;
      var bStarted = b.connectionStatus === 'Started' ? 0 : 1;
      if (aStarted !== bStarted) return aStarted - bStarted;
      return new Date(a.assignedAt) - new Date(b.assignedAt);
    });

    // ── Active (Started) connections with no WR Link ──────────────────
    // Department lives on VARequests, not VAConnections directly — joined
    // through each connection's own RequestID.
    var deptByRequestId = {};
    for (var dri = 1; dri < reqData.length; dri++) {
      deptByRequestId[String(reqData[dri][rh['RequestID']]||'')] = String(reqData[dri][rh['Department']]||'');
    }
    var missingWRLinkConnections = [];
    for (var wri = 1; wri < connData.length; wri++) {
      var wrStatus = String(connData[wri][coh['ConnectionStatus']] || '');
      if (wrStatus !== 'Started') continue; // only Started connections need a WR on file
      var wrLink = coh['WRLink'] !== undefined ? String(connData[wri][coh['WRLink']]||'') : '';
      if (wrLink) continue;
      var wrConnId = String(connData[wri][coh['ConnectionID']] || ''); if (!wrConnId) continue;
      var wrClientId = String(connData[wri][coh['ClientID']] || '').trim();
      // Same CustomerID-via-ClientID fallback as
      // getActiveConnectionsMissingWRLink (the dashboard's own version
      // of this same check) and startedByCustomer above — a blank
      // CustomerID here is what was silently leaving CS Assigned empty
      // on the dashboard, and would do the same to Customer here.
      var wrCustId = String(connData[wri][coh['CustomerID']] || '').trim();
      if (!wrCustId && wrClientId) wrCustId = clientIdToCustomerId[wrClientId] || '';
      var wrCustInfo = custById[wrCustId] || {};
      var wrRequestId = coh['RequestID'] !== undefined ? String(connData[wri][coh['RequestID']]||'') : '';
      missingWRLinkConnections.push({
        connectionId: wrConnId,
        vaName: String(connData[wri][coh['VAName']] || ''),
        clientId: wrClientId,
        customerId: wrCustId,
        customerName: wrCustInfo.customerName || '',
        department: deptByRequestId[wrRequestId] || '',
        connectionStatus: wrStatus,
        actualStartDate: coh['ActualStartDate'] !== undefined ? _sd(connData[wri][coh['ActualStartDate']]) : ''
      });
    }
    // Sorted by department first (per the request), then by start date
    // within each department group — same secondary ordering as before.
    missingWRLinkConnections.sort(function(a,b){
      var deptCompare = String(a.department||'').localeCompare(String(b.department||''));
      if (deptCompare !== 0) return deptCompare;
      return new Date(a.actualStartDate) - new Date(b.actualStartDate);
    });

    // ── VA Connections Missing a Termination Date ───────────────────────
    // Per the request — every Terminated connection with a blank
    // TerminationDate on the VAConnections tab, cross-referenced against
    // ActivityLogs for the date terminateVAConnection actually recorded
    // when the status was changed to Terminated (VAConnectionService.gs
    // writes that as the log entry's own EffectiveDate — see the
    // _writeLog('VAConnection', connectionId, 'UPDATE', 'ConnectionStatus',
    // ...) call there). A connection can end up with a blank
    // TerminationDate despite the log having one on file if, e.g., an
    // older direct sheet edit cleared it, or a historical bug like the
    // ones already fixed elsewhere in this app dropped it.
    var missingTermDateConnections = [];
    var logSheetForTermDates = ss.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
    var termDateByConnectionId = {};
    if (logSheetForTermDates) {
      var logData = logSheetForTermDates.getDataRange().getValues();
      var lh = _headerMap(logData[0]);
      if (lh['EntityType'] !== undefined && lh['EntityID'] !== undefined && lh['FieldChanged'] !== undefined) {
        for (var li = 1; li < logData.length; li++) {
          if (String(logData[li][lh['EntityType']]||'') !== 'VAConnection') continue;
          if (String(logData[li][lh['FieldChanged']]||'') !== 'ConnectionStatus') continue;
          var logNewVal = String(logData[li][lh['NewValue']]||'');
          if (logNewVal !== 'Terminated') continue;
          var logConnId = String(logData[li][lh['EntityID']]||''); if (!logConnId) continue;
          var logEffDate = lh['EffectiveDate'] !== undefined ? logData[li][lh['EffectiveDate']] : (lh['Timestamp'] !== undefined ? logData[li][lh['Timestamp']] : '');
          var logTs = lh['Timestamp'] !== undefined ? logData[li][lh['Timestamp']] : logEffDate;
          // A connection can in principle be terminated more than once
          // in its history (re-activated, terminated again) — keep the
          // MOST RECENT such log entry, not the first one found.
          var existingLogHit = termDateByConnectionId[logConnId];
          if (!existingLogHit || new Date(logTs) > new Date(existingLogHit.loggedAt)) {
            termDateByConnectionId[logConnId] = { effectiveDate: _sd(logEffDate), loggedAt: logTs };
          }
        }
      }
    }
    for (var mti = 1; mti < connData.length; mti++) {
      if (String(connData[mti][coh['ConnectionStatus']]||'') !== 'Terminated') continue;
      var mtTermDate = coh['TerminationDate'] !== undefined ? connData[mti][coh['TerminationDate']] : '';
      if (mtTermDate) continue; // already has one on file — not this check's concern
      var mtConnId = String(connData[mti][coh['ConnectionID']] || ''); if (!mtConnId) continue;
      var mtClientId = String(connData[mti][coh['ClientID']] || '').trim();
      var mtCustId = String(connData[mti][coh['CustomerID']] || '').trim();
      if (!mtCustId && mtClientId) mtCustId = clientIdToCustomerId[mtClientId] || '';
      var mtCustInfo = custById[mtCustId] || {};
      var logHit = termDateByConnectionId[mtConnId];
      missingTermDateConnections.push({
        connectionId: mtConnId,
        vaName: String(connData[mti][coh['VAName']] || ''),
        clientId: mtClientId,
        customerId: mtCustId,
        customerName: mtCustInfo.customerName || '',
        terminationReason: coh['TerminationReason'] !== undefined ? String(connData[mti][coh['TerminationReason']]||'') : '',
        sheetTerminationDate: '', // always blank — that's this check's own filter above
        loggedTerminationDate: logHit ? logHit.effectiveDate : '',
        note: logHit
          ? 'Found in Activity Logs — not yet saved to the sheet.'
          : 'Not found in Activity Logs either — needs manual research.'
      });
    }
    missingTermDateConnections.sort(function(a,b){ return a.vaName.localeCompare(b.vaName); });

    // ── Closed-Won date vs. VA Connection start date ────────────────────
    // Per the request — a New/Additional request's Closed-Won date is
    // expected to match the Actual Start Date of its VA Connection. Lists
    // every Closed-Won request where they differ (one row per differing
    // connection), plus any Closed-Won request with no started connection
    // on file at all, since that's the same kind of gap. Compared as
    // calendar days in the spreadsheet's own timezone, so a time-of-day
    // difference alone is never flagged.
    var startDateMismatches = [];
    (function() {
      if (rh['Status'] === undefined || rh['RequestID'] === undefined) return;
      var tz = ss.getSpreadsheetTimeZone();
      function ymd(v) {
        if (!v) return '';
        var d = (v instanceof Date) ? v : new Date(v);
        if (isNaN(d.getTime())) return '';
        return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      }
      var startsByReq = {};
      for (var smi = 1; smi < connData.length; smi++) {
        var smReq = String(connData[smi][coh['RequestID']]||''); if (!smReq) continue;
        var smStart = coh['ActualStartDate'] !== undefined ? connData[smi][coh['ActualStartDate']] : '';
        var smStatus = String(connData[smi][coh['ConnectionStatus']]||'');
        if (!smStart || ['Pending','Accepted','Declined','Cancelled'].indexOf(smStatus) !== -1) continue;
        if (!startsByReq[smReq]) startsByReq[smReq] = [];
        startsByReq[smReq].push({
          connectionId: String(connData[smi][coh['ConnectionID']]||''),
          vaName: coh['VAName'] !== undefined ? String(connData[smi][coh['VAName']]||'') : '',
          start: ymd(smStart),
          status: smStatus
        });
      }
      function dayNum(str) { var p = str.split('-'); return Date.UTC(Number(p[0]), Number(p[1])-1, Number(p[2])) / 86400000; }
      for (var sri = 1; sri < reqData.length; sri++) {
        if (String(reqData[sri][rh['Status']]||'') !== 'Closed - Won') continue;
        var srType = rh['RequestType'] !== undefined ? String(reqData[sri][rh['RequestType']]||'') : '';
        if (srType !== 'New' && srType !== 'Additional' && srType !== 'Replacement') continue;
        var srId = String(reqData[sri][rh['RequestID']]||''); if (!srId) continue;
        var srWonRaw = (rh['CompletedAt'] !== undefined && reqData[sri][rh['CompletedAt']]) ? reqData[sri][rh['CompletedAt']] : (rh['ClosedAt'] !== undefined ? reqData[sri][rh['ClosedAt']] : '');
        var srWon = ymd(srWonRaw);
        var srCustId = rh['CustomerID'] !== undefined ? String(reqData[sri][rh['CustomerID']]||'') : '';
        var srCust = (custById[srCustId] || {}).customerName || srCustId;
        var srConns = startsByReq[srId] || [];
        if (!srConns.length) {
          startDateMismatches.push({ requestId: srId, customerId: srCustId, customerName: srCust, requestType: srType, closedWonDate: srWon, connectionId: '', vaName: '', connectionStartDate: '', daysDifference: '', note: 'Closed-Won, but no started VA Connection on file' });
          continue;
        }
        srConns.forEach(function(c) {
          if (srWon && c.start === srWon) return;
          startDateMismatches.push({
            requestId: srId, customerId: srCustId, customerName: srCust, requestType: srType,
            closedWonDate: srWon, connectionId: c.connectionId, vaName: c.vaName, connectionStartDate: c.start,
            daysDifference: (srWon && c.start) ? (dayNum(c.start) - dayNum(srWon)) : '',
            note: srWon ? 'Closed-Won date differs from connection start date' : 'Closed-Won request has no Closed-Won date on file'
          });
        });
      }
      startDateMismatches.sort(function(a,b){ return String(a.customerName).localeCompare(String(b.customerName)); });
    })();

    // ── Replacement request integrity ───────────────────────────────────
    // Per the request — two checks on Replacement requests:
    //  1. A Replacement Service Request that doesn't identify which VA /
    //     connection is being replaced (neither ReplacementForConnectionID
    //     nor ReplacementForVAID is filled in).
    //  2. A VA Connection whose request is a Replacement, but the
    //     connection it replaces has no ReplacedByConnectionID. That column
    //     sits on the OLD connection and points to its replacement, so it's
    //     checked there. If the request doesn't name the connection being
    //     replaced, it's looked up by the replaced VA on the same client; if
    //     that can't be resolved either, the row says so.
    var replacementRequestsUnidentified = [];
    var replacementConnectionsMissingReplacedBy = [];
    (function() {
      if (rh['RequestType'] === undefined || rh['RequestID'] === undefined) return;
      var tz = ss.getSpreadsheetTimeZone();
      function ymd(v) {
        if (!v) return '';
        var d = (v instanceof Date) ? v : new Date(v);
        if (isNaN(d.getTime())) return '';
        return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      }
      function rv(row, col) { return rh[col] !== undefined ? String(row[rh[col]]||'').trim() : ''; }
      var reqInfo = {};
      for (var ri = 1; ri < reqData.length; ri++) {
        var rid = rv(reqData[ri], 'RequestID'); if (!rid) continue;
        var cid = rv(reqData[ri], 'CustomerID');
        reqInfo[rid] = {
          requestId: rid, type: rv(reqData[ri], 'RequestType'), status: rv(reqData[ri], 'Status'),
          customerId: cid, customerName: (custById[cid] || {}).customerName || cid,
          forConnId: rv(reqData[ri], 'ReplacementForConnectionID'), forVAId: rv(reqData[ri], 'ReplacementForVAID'),
          createdAt: rh['CreatedAt'] !== undefined ? ymd(reqData[ri][rh['CreatedAt']]) : ''
        };
      }

      // 1. Replacement requests with nothing identified
      Object.keys(reqInfo).forEach(function(k) {
        var r = reqInfo[k];
        if (r.type !== 'Replacement') return;
        if (r.forConnId || r.forVAId) return;
        replacementRequestsUnidentified.push({
          requestId: r.requestId, customerId: r.customerId, customerName: r.customerName,
          requestStatus: r.status, createdAt: r.createdAt,
          note: 'Replacement request does not identify which VA / connection is being replaced'
        });
      });
      replacementRequestsUnidentified.sort(function(a,b){ return String(a.customerName).localeCompare(String(b.customerName)); });

      // 2. Replacement connections whose replaced connection has no ReplacedByConnectionID
      var connById = {}, allConns = [];
      for (var ci2 = 1; ci2 < connData.length; ci2++) {
        var cnId = String(connData[ci2][coh['ConnectionID']]||'').trim(); if (!cnId) continue;
        var cn = {
          id: cnId,
          requestId: String(connData[ci2][coh['RequestID']]||'').trim(),
          vaId: coh['VAID'] !== undefined ? String(connData[ci2][coh['VAID']]||'').trim() : '',
          vaName: coh['VAName'] !== undefined ? String(connData[ci2][coh['VAName']]||'') : '',
          clientId: coh['ClientID'] !== undefined ? String(connData[ci2][coh['ClientID']]||'').trim() : '',
          customerId: coh['CustomerID'] !== undefined ? String(connData[ci2][coh['CustomerID']]||'').trim() : '',
          status: String(connData[ci2][coh['ConnectionStatus']]||''),
          replacedBy: coh['ReplacedByConnectionID'] !== undefined ? String(connData[ci2][coh['ReplacedByConnectionID']]||'').trim() : '',
          termTs: (coh['TerminationDate'] !== undefined && connData[ci2][coh['TerminationDate']]) ? new Date(connData[ci2][coh['TerminationDate']]).getTime() : 0
        };
        connById[cnId] = cn; allConns.push(cn);
      }
      allConns.forEach(function(c) {
        var info = reqInfo[c.requestId];
        if (!info || info.type !== 'Replacement') return;
        if (c.status === 'Declined' || c.status === 'Cancelled') return; // never a real connection
        var oldConn = info.forConnId ? connById[info.forConnId] : null;
        var note = '';
        if (!info.forConnId && info.forVAId) {
          var best = null;
          allConns.forEach(function(o) {
            if (o.id === c.id || o.vaId !== info.forVAId || o.clientId !== c.clientId) return;
            if (!best || o.termTs > best.termTs) best = o;
          });
          oldConn = best;
        }
        if (!info.forConnId && !info.forVAId) note = 'Replacement request does not identify which connection it replaces';
        else if (!oldConn) note = info.forConnId ? ('Replaced connection "' + info.forConnId + '" was not found in VAConnections') : 'Could not find the connection being replaced for the VA named on the request';
        else if (!oldConn.replacedBy) note = 'Replaced connection has no ReplacedByConnectionID';
        else return;
        var custIdForRow = c.customerId || info.customerId;
        replacementConnectionsMissingReplacedBy.push({
          connectionId: c.id, vaName: c.vaName, connectionStatus: c.status,
          requestId: c.requestId, customerId: custIdForRow, customerName: (custById[custIdForRow] || {}).customerName || info.customerName || custIdForRow,
          replacedConnectionId: oldConn ? oldConn.id : (info.forConnId || ''),
          replacedVaName: oldConn ? oldConn.vaName : '',
          note: note
        });
      });
      replacementConnectionsMissingReplacedBy.sort(function(a,b){ return String(a.customerName).localeCompare(String(b.customerName)); });
    })();

    // ── RequestType per customer ───────────────────────────────────────
    var requestTypesByCustomer = {}; // customerId → array of RequestType strings
    for (var j = 1; j < reqData.length; j++) {
      var rCustId = String(reqData[j][rh['CustomerID']] || '').trim();
      if (!rCustId) continue;
      var rType = String(reqData[j][rh['RequestType']] || '');
      if (!requestTypesByCustomer[rCustId]) requestTypesByCustomer[rCustId] = [];
      requestTypesByCustomer[rCustId].push(rType);
    }

    // ── Customers with ≥1 VA Connection ────────────────────────────────
    var customersWithConnection = {}; // customerId → true
    var noHoursConnections = [];
    var connectionsWithoutRequest = [];
    for (var k = 1; k < connData.length; k++) {
      var connId = String(connData[k][coh['ConnectionID']] || '');
      if (!connId) continue;
      var connCustId = String(connData[k][coh['CustomerID']] || '').trim();
      if (connCustId) customersWithConnection[connCustId] = true;

      var connStatus = String(connData[k][coh['ConnectionStatus']] || '');

      // A connection with no RequestID at all has no linked Service
      // Request — flagged regardless of status, since this is a
      // data-integrity gap on its own, separate from hours/schedule.
      if (connStatus !== 'Cancelled' && connStatus !== 'Declined' && !String(connData[k][coh['RequestID']] || '').trim()) {
        connectionsWithoutRequest.push({
          connectionId: connId,
          vaName: String(connData[k][coh['VAName']] || ''),
          clientId: String(connData[k][coh['ClientID']] || ''),
          customerId: connCustId,
          customerName: (custById[connCustId] || {}).customerName || '',
          connectionStatus: connStatus,
          assignedAt: coh['AssignedAt'] !== undefined ? _sd(connData[k][coh['AssignedAt']]) : ''
        });
      }

      if (connStatus === 'Cancelled' || connStatus === 'Declined' || connStatus === 'Pending') continue; // never went anywhere, or not even accepted yet — not a gap worth flagging

      var hoursVal = connData[k][coh['Hours']];
      var hasHours = hoursVal !== '' && hoursVal !== null && hoursVal !== undefined && Number(hoursVal) > 0;
      if (!hasHours) {
        var connCliId = String(connData[k][coh['ClientID']] || '');
        var custInfo  = custById[connCustId] || {};
        noHoursConnections.push({
          connectionId:   connId,
          vaName:         String(connData[k][coh['VAName']] || ''),
          clientId:       connCliId,
          customerId:     connCustId,
          customerName:   custInfo.customerName || '',
          connectionStatus: connStatus,
          hoursType:      coh['HoursType'] !== undefined ? String(connData[k][coh['HoursType']] || '') : '',
          assignedAt:     coh['AssignedAt'] !== undefined ? _sd(connData[k][coh['AssignedAt']]) : ''
        });
      }
    }

    // ── Build the "no qualifying New SR" customer list ─────────────────
    var noNewSRCustomers = [];
    Object.keys(customersWithConnection).forEach(function(custId) {
      var info = custById[custId];
      if (!info) return; // connection references a customer that no longer exists — not this check's concern
      var types = requestTypesByCustomer[custId] || [];
      var hasNewSR = types.indexOf('New') !== -1;
      if (!hasNewSR) {
        noNewSRCustomers.push({
          customerId:   info.customerId,
          customerName: info.customerName,
          status:       info.status,
          createdAt:    info.createdAt,
          totalRequests: types.length,
          reason: types.length === 0 ? 'No Service Requests on file' : 'Has Service Requests, but none is type "New"'
        });
      }
    });
    // Oldest first — the longer a gap has existed, the more worth checking first
    noNewSRCustomers.sort(function(a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    noHoursConnections.sort(function(a, b) {
      var aStarted = a.connectionStatus === 'Started' ? 0 : 1;
      var bStarted = b.connectionStatus === 'Started' ? 0 : 1;
      if (aStarted !== bStarted) return aStarted - bStarted;
      return new Date(a.assignedAt) - new Date(b.assignedAt);
    });
    connectionsWithoutRequest.sort(function(a, b) {
      var aStarted = a.connectionStatus === 'Started' ? 0 : 1;
      var bStarted = b.connectionStatus === 'Started' ? 0 : 1;
      if (aStarted !== bStarted) return aStarted - bStarted;
      return new Date(a.assignedAt) - new Date(b.assignedAt);
    });

    // CS Specialist only ever sees audit findings for their own assigned
    // (or actively taken-over) customers, per the request — every other
    // role continues to see everything, unchanged.
    var auditUser = getCurrentUser();
    if (auditUser && !auditUser.error && auditUser.role === CONFIG.ROLES.CS_SPECIALIST) {
      var myVisibleCustomerIds = {};
      var myEmailForAudit = (auditUser.email||'').toLowerCase().trim();
      for (var avi = 1; avi < custData.length; avi++) {
        var avCustId = String(custData[avi][ch['CustomerID']]||'').trim(); if (!avCustId) continue;
        var avSpec = ch['AssignedSpecialist'] !== undefined ? String(custData[avi][ch['AssignedSpecialist']]||'').toLowerCase().trim() : '';
        if (avSpec === myEmailForAudit) myVisibleCustomerIds[avCustId] = true;
      }
      getTakeoverCustomerIdsForSpecialist(myEmailForAudit).forEach(function(cid){ myVisibleCustomerIds[cid] = true; });

      // ClientID -> CustomerID, needed since accountPendingMismatches and
      // the Client half of dataIntegrityIssues are keyed by account, not
      // customer, directly.
      var custIdByClientIdForAudit = {};
      for (var acci = 1; acci < cliData.length; acci++) {
        var accClientId = String(cliData[acci][clh['ClientID']]||'').trim(); if (!accClientId) continue;
        custIdByClientIdForAudit[accClientId] = String(cliData[acci][clh['CustomerID']]||'').trim();
      }

      noNewSRCustomers = noNewSRCustomers.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      noHoursConnections = noHoursConnections.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      missingScheduleConnections = missingScheduleConnections.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      missingWRLinkConnections = missingWRLinkConnections.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      statusMismatches = statusMismatches.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      customersWithNoAccounts = customersWithNoAccounts.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      activeCustomersNoActiveAccount = activeCustomersNoActiveAccount.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      connectionsWithoutRequest = connectionsWithoutRequest.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      accountPendingMismatches = accountPendingMismatches.filter(function(r){ return myVisibleCustomerIds[custIdByClientIdForAudit[r.clientId]]; });
      notActivatedDespiteStarted = notActivatedDespiteStarted.filter(function(r){ return myVisibleCustomerIds[custIdByClientIdForAudit[r.clientId]]; });
      missingTermDateConnections = missingTermDateConnections.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      startDateMismatches = startDateMismatches.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      replacementRequestsUnidentified = replacementRequestsUnidentified.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      replacementConnectionsMissingReplacedBy = replacementConnectionsMissingReplacedBy.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      dataIntegrityIssues = dataIntegrityIssues.filter(function(r){
        var ownerCustId = r.entityType === 'Customer' ? r.entityId : custIdByClientIdForAudit[r.entityId];
        return myVisibleCustomerIds[ownerCustId];
      });

      // Recompute the aggregate counts against only the visible customer
      // set too — otherwise this one section would show company-wide
      // totals while every list above it is scoped, which would look
      // inconsistent side by side.
      var scopedActiveCustomerCount = 0;
      Object.keys(custById).forEach(function(cid){ if (myVisibleCustomerIds[cid] && custById[cid].status === 'Active') scopedActiveCustomerCount++; });
      var scopedStartedConnCount = 0;
      var scopedActiveCustomersNoConnection = connectionCountCheck.activeCustomersNoConnection.filter(function(r){ return myVisibleCustomerIds[r.customerId]; });
      for (var scci = 1; scci < connData.length; scci++) {
        if (String(connData[scci][coh['ConnectionStatus']]||'') !== 'Started') continue;
        var scCustId = String(connData[scci][coh['CustomerID']]||'').trim();
        if (myVisibleCustomerIds[scCustId]) scopedStartedConnCount++;
      }
      connectionCountCheck = {
        activeCustomerCount: scopedActiveCustomerCount,
        startedConnectionCount: scopedStartedConnCount,
        looksOff: scopedStartedConnCount <= scopedActiveCustomerCount,
        activeCustomersNoConnection: scopedActiveCustomersNoConnection
      };
    }

    return {
      success: true,
      noNewSRCustomers: noNewSRCustomers,
      noHoursConnections: noHoursConnections,
      missingScheduleConnections: missingScheduleConnections,
      missingWRLinkConnections: missingWRLinkConnections,
      dataIntegrityIssues: dataIntegrityIssues,
      statusMismatches: statusMismatches,
      customersWithNoAccounts: customersWithNoAccounts,
      activeCustomersNoActiveAccount: activeCustomersNoActiveAccount,
      accountPendingMismatches: accountPendingMismatches,
      notActivatedDespiteStarted: notActivatedDespiteStarted,
      missingTermDateConnections: missingTermDateConnections,
      startDateMismatches: startDateMismatches,
      replacementRequestsUnidentified: replacementRequestsUnidentified,
      replacementConnectionsMissingReplacedBy: replacementConnectionsMissingReplacedBy,
      connectionsWithoutRequest: connectionsWithoutRequest,
      connectionCountCheck: connectionCountCheck
    };
  } catch (e) {
    return { success: false, error: 'getAuditOverview: ' + e.message };
  }
}

// ── Full status timeline for one Customer or Account, with issue list ──
function getEntityAuditTimeline(entityType, entityId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var isCustomer = entityType === 'Customer';
    var sheet = ss.getSheetByName(isCustomer ? CONFIG.SHEETS.CUSTOMERS : CONFIG.SHEETS.CLIENTS);
    if (!sheet) return { success: false, error: 'Sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h    = _headerMap(data[0]);
    var idCol = isCustomer ? 'CustomerID' : 'ClientID';

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h[idCol]] || '').trim() !== String(entityId).trim()) continue;
      var r = data[i];
      var entityName = isCustomer
        ? String(r[h['CustomerName']] || '')
        : String(r[h['CompanyName']] || '') + (r[h['AccountName']] ? ' — ' + String(r[h['AccountName']]) : '');
      var currentStatus = String(r[h['Status']] || '');
      var createdAt = r[h['CreatedAt']];
      var createdBy = String(r[h['CreatedBy']] || '');
      var historyRaw = (isCustomer && h['StatusHistory'] !== undefined) ? r[h['StatusHistory']] : '';
      var statusLogs = _getStatusChangeLogsForEntity(isCustomer ? 'Customer' : ['Client', 'Account'], entityId, 'Status');

      // Per the same request as the overview checker above — needed here
      // too so this detail view stays consistent with it.
      var entityActiveIntervals = [];
      try {
        var connSheetForEntity = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
        if (connSheetForEntity) {
          var connDataForEntity = connSheetForEntity.getDataRange().getValues();
          var connHForEntity = _headerMap(connDataForEntity[0]);
          var relevantClientIds = {};
          if (isCustomer) {
            var cliSheetForEntity = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
            var cliDataForEntity = cliSheetForEntity ? cliSheetForEntity.getDataRange().getValues() : [];
            var clhForEntity = cliDataForEntity.length ? _headerMap(cliDataForEntity[0]) : {};
            for (var eci = 1; eci < cliDataForEntity.length; eci++) {
              if (String(cliDataForEntity[eci][clhForEntity['CustomerID']]||'').trim() !== String(entityId).trim()) continue;
              relevantClientIds[String(cliDataForEntity[eci][clhForEntity['ClientID']]||'').trim()] = true;
            }
          } else {
            relevantClientIds[String(entityId).trim()] = true;
          }
          for (var econi = 1; econi < connDataForEntity.length; econi++) {
            var econClientId = String(connDataForEntity[econi][connHForEntity['ClientID']]||'').trim();
            if (!relevantClientIds[econClientId]) continue;
            var econStart = connDataForEntity[econi][connHForEntity['ActualStartDate']];
            if (!econStart) continue;
            var econEnd = connDataForEntity[econi][connHForEntity['TerminationDate']] || null;
            entityActiveIntervals.push({ start: new Date(econStart), end: econEnd ? new Date(econEnd) : null });
          }
        }
      } catch (entityIntervalEx) { Logger.log('getEntityAuditTimeline interval build: ' + entityIntervalEx.message); }

      var analysis = _auditAnalyzeTimeline(currentStatus, createdAt, createdBy, historyRaw, statusLogs, entityActiveIntervals);

      return {
        success: true,
        entity: { entityType: entityType, entityId: entityId, entityName: entityName, status: currentStatus, createdAt: _sd(createdAt) },
        timeline: analysis.timeline,
        issues: analysis.issues,
        missingActivated:  analysis.missingActivated,
        missingPaused:      analysis.missingPaused,
        missingTerminated:  analysis.missingTerminated,
        missingResume:       analysis.missingResume
      };
    }
    return { success: false, error: (isCustomer ? 'Customer' : 'Account') + ' not found.' };
  } catch (e) {
    return { success: false, error: 'getEntityAuditTimeline: ' + e.message };
  }
}

// ── Backfill: add a missing status event ────────────────────────────────
// eventType is one of 'Activated' | 'Paused' | 'Terminated' | 'Resumed' —
// covers every completeness gap _auditAnalyzeTimeline can flag. Customers
// get the event written into their StatusHistory JSON (existing mechanism);
// Accounts have no such column, so theirs goes straight into ActivityLogs
// with Action='AUDIT_BACKFILL' — _getStatusChangeLogsByEntityType/
// _mergeStatusEvents already know to treat that Action as a manual entry,
// so both paths show up identically (tagged "Manually backfilled") in the
// timeline regardless of which one an entity actually used.
// ── Fix: align Added date to the Activated date ────────────────────────
// Resolves the "Added after Activated" chronology issue by overwriting
// CreatedAt with the timeline's first Activated-type event date. Works for
// both Customers and Accounts (CreatedAt exists on both sheets).
function fixEntityAddedDate(entityType, entityId) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var isCustomer = entityType === 'Customer';
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(isCustomer ? CONFIG.SHEETS.CUSTOMERS : CONFIG.SHEETS.CLIENTS);
    if (!sheet) return { success: false, error: 'Sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h    = _headerMap(data[0]);
    var idCol = isCustomer ? 'CustomerID' : 'ClientID';

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h[idCol]] || '').trim() !== String(entityId).trim()) continue;
      var r = data[i];
      var currentStatus = String(r[h['Status']] || '');
      var createdAt = r[h['CreatedAt']];
      var createdBy = String(r[h['CreatedBy']] || '');
      var historyRaw = (isCustomer && h['StatusHistory'] !== undefined) ? r[h['StatusHistory']] : '';
      var statusLogs = _getStatusChangeLogsForEntity(isCustomer ? 'Customer' : ['Client', 'Account'], entityId, 'Status');

      var analysis = _auditAnalyzeTimeline(currentStatus, createdAt, createdBy, historyRaw, statusLogs);
      var ACTIVATED_TYPES = ['Became Active', 'Reactivated', 'Resumed'];
      var firstActivated = analysis.timeline.find(function(ev) { return ACTIVATED_TYPES.indexOf(ev.type) !== -1; });
      if (!firstActivated) return { success: false, error: 'No Activated date found on the timeline to align to.' };

      var oldCreatedAtStr = _sd(createdAt);
      var rowNum = i + 1;
      sheet.getRange(rowNum, h['CreatedAt'] + 1).setValue(new Date(firstActivated.date));

      _writeLog(entityType, entityId, 'AUDIT_BACKFILL', 'CreatedAt', oldCreatedAtStr, firstActivated.date, perm.user);
      return { success: true };
    }
    return { success: false, error: (isCustomer ? 'Customer' : 'Account') + ' not found.' };
  } catch (e) {
    return { success: false, error: 'fixEntityAddedDate: ' + e.message };
  }
}

function addEntityStatusEvent(entityType, entityId, eventType, dateStr) {
  var FROM_TO = {
    'Activated':  { from: '(unrecorded)', to: 'Active' },
    'Paused':     { from: 'Active',       to: 'Paused' },
    'Terminated': { from: 'Active',       to: 'Terminated' },
    'Resumed':    { from: 'Paused',       to: 'Active' }
  };
  var map = FROM_TO[eventType];
  if (!map) return { success: false, error: 'Unknown event type: ' + eventType };
  var reason = 'Manually backfilled via Audit — ' + eventType + ' date was unrecorded';

  var isCustomer = entityType === 'Customer';
  var result = isCustomer
    ? _auditInsertHistoryEntry(entityId, dateStr, map.from, map.to, reason)
    : _auditInsertActivityLogEvent(entityId, dateStr, map.from, map.to, reason);

  // Termination backfills also get chronologically inserted into
  // Customers' LastTerminatedDate summary log, same as before.
  if (result.success && isCustomer && eventType === 'Terminated') {
    try {
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      var data  = sheet.getDataRange().getValues();
      var h     = _headerMap(data[0]);
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][h['CustomerID']] || '').trim() !== String(entityId).trim()) continue;
        if (h['LastTerminatedDate'] !== undefined) {
          _auditInsertDateIntoLog(sheet, i + 1, h['LastTerminatedDate'], new Date(dateStr));
        }
        break;
      }
    } catch (e) { /* non-fatal — the event record is the source of truth */ }
  }
  return result;
}

function _auditInsertHistoryEntry(customerId, dateStr, fromStatus, toStatus, reason) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!dateStr) return { success: false, error: 'A date is required.' };
    var eventDate = new Date(dateStr);
    if (isNaN(eventDate.getTime())) return { success: false, error: 'Invalid date.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    var h     = _headerMap(data[0]);
    if (h['StatusHistory'] === undefined) return { success: false, error: 'StatusHistory column not found — run the Customers sheet migration first.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']] || '').trim() !== String(customerId).trim()) continue;
      var rowNum = i + 1;
      var historyRaw = sheet.getRange(rowNum, h['StatusHistory'] + 1).getValue();
      var history = [];
      if (historyRaw) {
        try { history = JSON.parse(historyRaw); if (!Array.isArray(history)) history = []; }
        catch (parseErr) { history = []; }
      }
      history.push({ from: fromStatus, to: toStatus, date: eventDate.toISOString(), reason: reason, by: perm.user.email, manual: true });
      history.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
      if (history.length > 50) history = history.slice(history.length - 50);
      sheet.getRange(rowNum, h['StatusHistory'] + 1).setValue(JSON.stringify(history));

      _writeLog('Customer', customerId, 'AUDIT_BACKFILL', 'StatusHistory', '', toStatus + ' @ ' + Utilities.formatDate(eventDate, Session.getScriptTimeZone() || 'UTC', 'yyyy-MM-dd'), perm.user, eventDate);
      return { success: true };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: '_auditInsertHistoryEntry: ' + e.message };
  }
}

// Accounts have no StatusHistory column, so their manual backfill writes
// straight into ActivityLogs with FieldChanged='Status' (so it's picked up
// by the same merge path as real status-change logs) and
// Action='AUDIT_BACKFILL' (so it's recognized as manual — see
// _mergeStatusEvents in LogService.gs).
function _auditInsertActivityLogEvent(clientId, dateStr, fromStatus, toStatus, reason) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!dateStr) return { success: false, error: 'A date is required.' };
    var eventDate = new Date(dateStr);
    if (isNaN(eventDate.getTime())) return { success: false, error: 'Invalid date.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data  = sheet.getDataRange().getValues();
    var h     = _headerMap(data[0]);
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']] || '').trim() === String(clientId).trim()) { found = true; break; }
    }
    if (!found) return { success: false, error: 'Account not found.' };

    // Was previously appending directly to the sheet with the backdated
    // eventDate written into the Timestamp column — that's exactly backwards:
    // Timestamp should always be when this was actually recorded (now),
    // with the backdated value in EffectiveDate instead. Routed through
    // _writeLog like everywhere else in the system now handles that correctly.
    _writeLog('Account', String(clientId), 'AUDIT_BACKFILL', 'Status', String(fromStatus || ''), String(toStatus || ''), perm.user, eventDate, reason);
    return { success: true };
  } catch (e) {
    return { success: false, error: '_auditInsertActivityLogEvent: ' + e.message };
  }
}

// Inserts a date into a comma-separated date log at the correct
// chronological position (rather than always appending at the end, which
// would misorder a manually backfilled EARLIER date).
function _auditInsertDateIntoLog(sheet, rowNum, colIdx, eventDate) {
  var cell = sheet.getRange(rowNum, colIdx + 1);
  var existing = String(cell.getValue() || '').trim();
  var tz = Session.getScriptTimeZone() || 'UTC';
  var parts = existing ? existing.split(',').map(function(s){ return s.trim(); }).filter(Boolean) : [];
  var dates = parts.map(function(p){ return new Date(p); }).filter(function(d){ return !isNaN(d.getTime()); });
  dates.push(eventDate);
  dates.sort(function(a, b) { return a - b; });
  var formatted = dates.map(function(d){ return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }).join(', ');
  cell.setValue(formatted);
}