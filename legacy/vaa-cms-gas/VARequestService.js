// ─────────────────────────────────────────
// VARequestService.gs — Service Request tickets
// ─────────────────────────────────────────

// Auto-create sheet if missing so functions never crash
function _reqGetSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.VA_REQUESTS);
    var headers = CONFIG.SCHEMA.VARequests;
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    _migrateSheetColumns(ss, CONFIG.SHEETS.VA_REQUESTS, CONFIG.SCHEMA.VARequests);
  }
  return sheet;
}

function _reqHMap(headerRow) {
  var h = {};
  for (var i = 0; i < headerRow.length; i++) {
    if (headerRow[i]) h[String(headerRow[i])] = i;
  }
  return h;
}

function getVARequests(filters) {
  try {
    var _t0 = Date.now();
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    Logger.log('[REQLIST TIMING] VARequests sheet read: ' + (Date.now()-_t0) + 'ms, ' + data.length + ' rows');
    if (data.length < 2) return { success: true, data: [] };

    var h = _reqHMap(data[0]);
    if (h['RequestID'] === undefined) return { success: true, data: [] };

    filters = filters || {};
    var rows = [];

    // Build VA connection lookup per requestId
    var connLookup = {};
    try {
      var connSheet2 = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
      if (connSheet2) {
        var connD2 = connSheet2.getDataRange().getValues();
        var coh2 = {}; connD2[0].forEach(function(col,i2){ if(col) coh2[String(col)]=i2; });
        for (var vc=1; vc<connD2.length; vc++) {
          var rId2 = String(connD2[vc][coh2['RequestID']]||''); if(!rId2) continue;
          if (!connLookup[rId2]) connLookup[rId2] = [];
          var sd2 = connD2[vc][coh2['ActualStartDate']];
          var vcd2 = coh2['VAConnectionDate'] !== undefined ? connD2[vc][coh2['VAConnectionDate']] : null;
          connLookup[rId2].push({
            vaName:           String(connD2[vc][coh2['VAName']]||''),
            connectionStatus: String(connD2[vc][coh2['ConnectionStatus']]||''),
            actualStartDate:  sd2 instanceof Date ? sd2.toISOString() : String(sd2||''),
            vaConnectionDate: vcd2 instanceof Date ? vcd2.toISOString() : String(vcd2||''),
            isFinalVA:        coh2['IsFinalVA'] !== undefined ? (connD2[vc][coh2['IsFinalVA']] === true || connD2[vc][coh2['IsFinalVA']] === 'true') : false
          });
        }
      }
    } catch(cvEx) { Logger.log('connLookup: '+cvEx.message); }
    Logger.log('[REQLIST TIMING] connLookup built: ' + (Date.now()-_t0) + 'ms');

    // Build lookup maps for customer/account names
    var custLookup = {}, cliLookup = {};
    try {
      var custSheet2 = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet2) {
        var cd = custSheet2.getDataRange().getValues();
        var ch2 = _reqHMap(cd[0]);
        for (var ci = 1; ci < cd.length; ci++) {
          if (cd[ci][ch2['CustomerID']]) custLookup[String(cd[ci][ch2['CustomerID']]).trim()] = {
            name: String(cd[ci][ch2['CustomerName']]||''),
            assignedSpecialist: ch2['AssignedSpecialist'] !== undefined ? String(cd[ci][ch2['AssignedSpecialist']]||'').trim() : ''
          };
        }
      }
      var cliSheet2 = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet2) {
        var cl = cliSheet2.getDataRange().getValues();
        var clh = _reqHMap(cl[0]);
        for (var cci = 1; cci < cl.length; cci++) {
          if (cl[cci][clh['ClientID']]) cliLookup[String(cl[cci][clh['ClientID']]).trim()] = { company: String(cl[cci][clh['CompanyName']]||''), account: String(cl[cci][clh['AccountName']]||'') };
        }
      }
    } catch(ex) { Logger.log('lookup build error: ' + ex.message); }
    Logger.log('[REQLIST TIMING] custLookup/cliLookup built: ' + (Date.now()-_t0) + 'ms');

    // VAID -> VAName, needed to resolve replacementForVAID into a
    // readable name (e.g. for the Account profile's Service Requests
    // table, which shows who a Replacement request is replacing).
    var vaNameLookup = {};
    try {
      var vaSheetForName = ss.getSheetByName(CONFIG.SHEETS.VIRTUAL_ASSISTANTS);
      if (vaSheetForName) {
        var vd = vaSheetForName.getDataRange().getValues();
        var vh = {}; vd[0].forEach(function(c,ix){ if(c) vh[String(c).trim()]=ix; });
        for (var vi = 1; vi < vd.length; vi++) {
          if (vd[vi][vh['VAID']]) vaNameLookup[String(vd[vi][vh['VAID']]).trim()] = String(vd[vi][vh['VAName']]||'');
        }
      }
    } catch (vaNameEx) { Logger.log('vaNameLookup build error: ' + vaNameEx.message); }
    Logger.log('[REQLIST TIMING] vaNameLookup built: ' + (Date.now()-_t0) + 'ms');

    // CS Specialists only ever see requests for their own assigned
    // customers. This is the server-side backstop for the same rule the
    // frontend applies (_scopeToSpecialist in scripts-core.html) — that one
    // is UX-only and can be bypassed by calling this function directly, so
    // the actual enforcement has to live here too.
    var scopeUser = getCurrentUser();
    var scopeMyEmail = (scopeUser && !scopeUser.error && scopeUser.role === CONFIG.ROLES.CS_SPECIALIST && !filters.viewAll)
      ? (scopeUser.email || '').toLowerCase().trim() : null;
    var scopeTakeoverIds = scopeMyEmail ? getTakeoverCustomerIdsForSpecialist(scopeMyEmail) : [];

    // Recruitment Specialist and Training Manager only ever work requests
    // that are specifically waiting on their own workflow stage — this was
    // previously only enforced on the dashboard widget (getMyDashboardTickets
    // in Router.gs), which meant either role could see every request,
    // regardless of phase, just by opening the main Service Requests list.
    // Same backstop principle as the CS Specialist rule above.
    var workflowStageScope = null;
    if (scopeUser && !scopeUser.error) {
      if (scopeUser.role === CONFIG.ROLES.RECRUITMENT) workflowStageScope = WORKFLOW_STAGES.RECRUITMENT.label;
      else if (scopeUser.role === CONFIG.ROLES.TRAINING) workflowStageScope = WORKFLOW_STAGES.TRAINING.label;
    }

    // Service Manager only ever sees requests for their own department —
    // was only enforced on the dashboard widget (getMyDashboardTickets in
    // Router.gs), which meant a Service Manager could see every
    // department's requests just by opening the main Service Requests
    // list. Same backstop principle as the rules above.
    var serviceManagerDept = null;
    if (scopeUser && !scopeUser.error && scopeUser.role === CONFIG.ROLES.SERVICE_MANAGER) {
      serviceManagerDept = (scopeUser.department || '').toLowerCase().trim();
    }

    // Fetched once here, not per-row — see _wfGetLatestAckByRequest for
    // why only the latest acknowledgement per request matters.
    var latestAckByRequest = {};
    try { latestAckByRequest = _wfGetLatestAckByRequest(); } catch (ackEx) { Logger.log('getVARequests ack lookup: ' + ackEx.message); }
    Logger.log('[REQLIST TIMING] ack lookup built: ' + (Date.now()-_t0) + 'ms — starting row loop over ' + (data.length-1) + ' rows');

    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['RequestID']]) continue;
      var rec = _mapReqRow(r, h);
      if (scopeMyEmail) {
        var custForScope = custLookup[String(rec.customerId||'').trim()];
        var custSpec = custForScope ? String(custForScope.assignedSpecialist||'').toLowerCase().trim() : '';
        var isOwnCustomer = custSpec === scopeMyEmail;
        var isTakenOver = scopeTakeoverIds.indexOf(String(rec.customerId||'').trim()) !== -1;
        if (!isOwnCustomer && !isTakenOver) continue;
      }
      if (workflowStageScope && rec.currentStage !== workflowStageScope) continue;
      if (serviceManagerDept && (rec.department||'').toLowerCase().trim() !== serviceManagerDept) continue;
      if (filters.status      && rec.status      !== filters.status)      continue;
      if (filters.clientId    && rec.clientId    !== filters.clientId)    continue;
      if (filters.customerId  && rec.customerId  !== filters.customerId)  continue;
      if (filters.requestType && rec.requestType !== filters.requestType) continue;
      // Default fetch window (performance) — only ever excludes a request
      // that's BOTH older than 6 months AND already closed; anything still
      // Open/In Progress stays visible regardless of age. filters.allTime
      // bypasses this entirely.
      if (!filters.allTime) {
        var isClosedForWindow = rec.status === 'Closed - Won' || rec.status === 'Closed - Lost';
        if (isClosedForWindow) {
          var recCreatedAt = new Date(rec.createdAt || 0);
          var sixMonthsAgoForWindow = new Date(); sixMonthsAgoForWindow.setMonth(sixMonthsAgoForWindow.getMonth() - 6);
          if (!isNaN(recCreatedAt.getTime()) && recCreatedAt < sixMonthsAgoForWindow) continue;
        }
      }
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (![(rec.requestId||''),(rec.clientId||''),(rec.requestType||''),(rec.department||'')]
              .some(function (v) { return v.toLowerCase().includes(q); })) continue;
      }
      // Enrich with customer and account names for display
      var custRow = custLookup[String(rec.customerId||'').trim()];
      var cliRow  = cliLookup[String(rec.clientId||'').trim()];
      rec.customerName = custRow ? custRow.name    : rec.customerId;
      rec.accountName  = cliRow  ? cliRow.company  : rec.clientId;
      rec.assignedSpecialistEmail = custRow ? (custRow.assignedSpecialist || '') : '';
      rec.replacementForVAName = vaNameLookup[String(rec.replacementForVAID||'').trim()] || '';
      // Attach VA connection summary — main Started VA, pending buffer, declined buffer
      var reqConns = connLookup[rec.requestId] || [];
      rec.startedVA    = null;
      rec.pendingVA    = null;
      rec.declinedVA   = null;
      rec.vaConnCount  = reqConns.length;
      rec.allConns     = reqConns;
      var vc2Final = null;
      for (var vc2=0; vc2<reqConns.length; vc2++) {
        var cs = reqConns[vc2].connectionStatus;
        if (cs === 'Started'  && !rec.startedVA)  rec.startedVA  = reqConns[vc2];
        if ((cs === 'Pending' || cs === 'Accepted') && !rec.pendingVA)  rec.pendingVA  = reqConns[vc2];
        if (cs === 'Declined' && !rec.declinedVA) rec.declinedVA = reqConns[vc2];
        if (reqConns[vc2].isFinalVA && !vc2Final) vc2Final = reqConns[vc2];
      }
      // Flattened for the table columns — the Final VA flag is the
      // explicit, deliberate marker for who this request is actually
      // committed to, so it takes priority over connection status alone.
      // Falls back to Started/Pending/Accepted only when no connection
      // has been marked Final yet, then array order as a last resort.
      var relevantConn = vc2Final || rec.startedVA || rec.pendingVA || reqConns[0] || null;
      rec.finalVA = vc2Final;
      rec.vaConnectionDate = relevantConn ? (relevantConn.vaConnectionDate || '') : '';
      rec.actualStartDate  = rec.startedVA ? (rec.startedVA.actualStartDate || '') : '';

      // 24-hour feedback tracking — every stage except Management
      // Approval (a one-time decision point), Request Intake (a quick
      // review-and-forward step, not an ongoing work queue), and
      // Completed (nothing left to update) needs an acknowledgement at
      // least every 24 hours. An acknowledgement only counts if it was
      // given for the request's CURRENT stage — one from a stage it's
      // since moved past doesn't carry forward.
      rec.needsFeedback = false;
      rec.hasAcknowledgedCurrentStage = false;
      var isClosedStatus = rec.status === 'Closed - Won' || rec.status === 'Closed - Lost';
      if (!isClosedStatus && rec.currentStage && rec.currentStage !== 'Management Approval' && rec.currentStage !== 'Request Intake' && rec.currentStage !== 'Completed') {
        var ack = latestAckByRequest[rec.requestId + '|' + rec.currentStage];
        rec.hasAcknowledgedCurrentStage = !!ack;
        var clockStart = ack ? ack.at : new Date(rec.updatedAt || rec.createdAt || 0);
        var hoursSince = (new Date() - clockStart) / 3600000;
        rec.needsFeedback = hoursSince > 24;
      }

      // Executive Support's payment confirmation requirement — any open
      // request whose payment hasn't been resolved yet (Paid or Add to
      // Next Bill). Closed requests never need this regardless of their
      // payment status.
      rec.needsPaymentConfirmation = (rec.status === CONFIG.VA_REQUEST_STATUS.OPEN) &&
        rec.paymentStatus !== 'Paid' && rec.paymentStatus !== 'Add to Next Bill';

      rows.push(rec);
    }
    rows.sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    Logger.log('[REQLIST TIMING] row loop + sort complete: ' + (Date.now()-_t0) + 'ms total, ' + rows.length + ' rows returned');
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getVARequests: ' + e.message };
  }
}

// The assigned CS Specialist confirms the work schedule is correct — a
// second gate (alongside Final VA being designated) that markVAPrepDone
// in WorkflowService.gs checks before letting the request proceed to
// Rate Agreement. Gated to the specific CS Specialist actually assigned
// to this customer (not just any CS Specialist), or Administrator.
function confirmWorkScheduleByCS(requestId) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _reqHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      var custId = String(data[i][h['CustomerID']]||'');
      var assignedSpecialistEmail = '';
      try {
        var custSheetSched = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
        if (custSheetSched && custId) {
          var custdSched = custSheetSched.getDataRange().getValues();
          var cushSched  = {}; custdSched[0].forEach(function(c,ix){ if(c) cushSched[String(c).trim()]=ix; });
          for (var csi2 = 1; csi2 < custdSched.length; csi2++) {
            if (String(custdSched[csi2][cushSched['CustomerID']]||'') !== custId) continue;
            assignedSpecialistEmail = cushSched['AssignedSpecialist'] !== undefined ? String(custdSched[csi2][cushSched['AssignedSpecialist']]||'') : '';
            break;
          }
        }
      } catch (custLookupEx) { Logger.log('confirmWorkScheduleByCS customer lookup: ' + custLookupEx.message); }
      var myEmailForConfirm = (user.email||'').toLowerCase().trim();
      var isAssignedSpecialist = (assignedSpecialistEmail && assignedSpecialistEmail.toLowerCase().trim() === myEmailForConfirm)
        || (custId && getTakeoverCustomerIdsForSpecialist(myEmailForConfirm).indexOf(custId) !== -1);
      if (!isAssignedSpecialist && user.role !== CONFIG.ROLES.ADMINISTRATOR) {
        return { success: false, error: 'Only the CS Specialist assigned to this customer (or an Administrator) can confirm the work schedule.' };
      }
      var rowNum = i + 1;
      if (h['ScheduleConfirmedByCS'] !== undefined) sheet.getRange(rowNum, h['ScheduleConfirmedByCS']+1).setValue(user.email);
      if (h['ScheduleConfirmedByCSAt'] !== undefined) sheet.getRange(rowNum, h['ScheduleConfirmedByCSAt']+1).setValue(new Date());
      _writeLog('VARequest', requestId, 'UPDATE', 'ScheduleConfirmedByCS', '', user.email, user);
      return { success: true };
    }
    return { success: false, error: 'Request not found.' };
  } catch (e) {
    return { success: false, error: 'confirmWorkScheduleByCS: ' + e.message };
  }
}

function getVARequestById(requestId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _reqHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      var req = _mapReqRow(data[i], h);

      // Acknowledgement/24h-feedback tracking — this was previously only
      // ever computed in getVARequests's own loop, never here, so the
      // request detail modal (which uses this function) always saw
      // hasAcknowledgedCurrentStage as undefined/false regardless of
      // whether the assigned person had genuinely already acknowledged —
      // permanently blocking actions like Assign VA behind "Acknowledge
      // the ticket first" even after they had.
      req.needsFeedback = false;
      req.hasAcknowledgedCurrentStage = false;
      var isClosedStatusForReq = req.status === 'Closed - Won' || req.status === 'Closed - Lost';
      if (!isClosedStatusForReq && req.currentStage && req.currentStage !== 'Management Approval' && req.currentStage !== 'Request Intake' && req.currentStage !== 'Completed') {
        try {
          var ackByReq = _wfGetLatestAckByRequest();
          var ackForThis = ackByReq[req.requestId + '|' + req.currentStage];
          req.hasAcknowledgedCurrentStage = !!ackForThis;
          var clockStartForThis = ackForThis ? ackForThis.at : new Date(req.updatedAt || req.createdAt || 0);
          req.needsFeedback = ((new Date() - clockStartForThis) / 3600000) > 24;
        } catch (ackLookupEx) { Logger.log('getVARequestById ack lookup: ' + ackLookupEx.message); }
      }

      var connRes = getVAConnections({ requestId: requestId });
      req.connections = (connRes && connRes.success) ? connRes.data : [];

      // The replaced VA's name — replacementForVAID is a raw ID with no
      // name of its own; the connection it replaced already has VAName
      // cached on it, so that's a simpler, more reliable source than a
      // separate VA lookup.
      req.replacementForVAName = '';
      if (req.replacementForConnectionId) {
        try {
          var replConnSheet = _connGetSheet(ss);
          var replConnData = replConnSheet.getDataRange().getValues();
          var replConnH = _connHMap(replConnData[0]);
          for (var rci = 1; rci < replConnData.length; rci++) {
            if (String(replConnData[rci][replConnH['ConnectionID']]||'') !== req.replacementForConnectionId) continue;
            req.replacementForVAName = String(replConnData[rci][replConnH['VAName']]||'');
            break;
          }
        } catch (replVaNameEx) { Logger.log('getVARequestById replacementForVAName lookup: ' + replVaNameEx.message); }
      }

      // If an inquiry was escalated into this request, surface that here
      // so the frontend can warn before closing that this will also
      // close the linked inquiry (see _closeLinkedInquiry).
      try {
        var iqSheetForLink = ss.getSheetByName('Inquiries');
        if (iqSheetForLink) {
          var iqDataForLink = iqSheetForLink.getDataRange().getValues();
          var iqHForLink = {}; iqDataForLink[0].forEach(function(c,ix){ if(c) iqHForLink[String(c).trim()]=ix; });
          if (iqHForLink['EscalatedToRequestID'] !== undefined) {
            for (var li = 1; li < iqDataForLink.length; li++) {
              if (String(iqDataForLink[li][iqHForLink['EscalatedToRequestID']]||'') !== requestId) continue;
              req.linkedInquiryId      = String(iqDataForLink[li][iqHForLink['InquiryID']]||'');
              req.linkedInquirySubject = iqHForLink['Subject'] !== undefined ? String(iqDataForLink[li][iqHForLink['Subject']]||'') : '';
              break;
            }
          }
        }
      } catch (linkLookupEx) { Logger.log('getVARequestById linked inquiry lookup: ' + linkLookupEx.message); }

      // Any contract assigned to this request's customer — shown beside
      // the Payment section on the modal/full page.
      try {
        var assignRes = getContractAssignments();
        if (assignRes && assignRes.success) {
          var custAssignment = assignRes.data.filter(function(a) {
            return a.entityType === 'Customer' && a.entityId === req.customerId;
          })[0];
          if (custAssignment) {
            req.customerContractId   = custAssignment.contractId;
            req.customerContractName = custAssignment.contractName;
          }
        }
      } catch (contractLookupEx) { Logger.log('getVARequestById contract lookup: ' + contractLookupEx.message); }

      // Hours/Schedule Change requests point at a connection that belongs to
      // a DIFFERENT (earlier) request — resolve its VA name here so the
      // profile can show "Jane Doe" instead of a bare connection ID.
      if (req.requestType === 'Hours/Schedule Change' && req.changeRequestForConnectionId) {
        var targetConn = getVAConnectionById(req.changeRequestForConnectionId);
        req.changeRequestForVAName = (targetConn && targetConn.success) ? targetConn.data.vaName : '';
      }

      var cliRes = getClientById(req.clientId);
      req.clientInfo = (cliRes && cliRes.success) ? cliRes.data : null;

      // CS Assigned is derived from the customer's own AssignedSpecialist
      // field, not a direct column on VARequests — getVARequests (used
      // by the table) already does this in its own loop; replicated here
      // too, since without it this always showed "Not yet assigned"
      // regardless of the customer's actual assignment.
      try {
        var custForSpecRes = getCustomerById(req.customerId);
        req.assignedSpecialistEmail = (custForSpecRes && custForSpecRes.success && custForSpecRes.data)
          ? (custForSpecRes.data.assignedSpecialist || '') : '';
      } catch (specEx) { req.assignedSpecialistEmail = ''; }

      // Resolve display names so the detail modal can show "Acme Corp / Main Account"
      // instead of raw IDs. The list endpoint already does this; the by-ID endpoint
      // did not, causing the modal to fall back to the bare CLT_ / CST_ identifiers.
      if (req.clientInfo) {
        req.accountName  = req.clientInfo.companyName || req.clientInfo.accountName || req.clientId;
      } else {
        req.accountName  = req.clientId;
      }
      // Resolve customer name from the customer sheet
      try {
        var custRes2 = getCustomerById(req.customerId);
        req.customerName = (custRes2 && custRes2.success && custRes2.data)
          ? (custRes2.data.customerName || req.customerId)
          : req.customerId;
      } catch(custE) {
        req.customerName = req.customerId;
      }

      return { success: true, data: req };
    }
    return { success: false, error: 'Request not found.' };
  } catch (e) {
    return { success: false, error: 'getVARequestById: ' + e.message };
  }
}

function createVARequest(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var errors = _validateRequest(payload);
    if (errors.length) return { success: false, errors: errors };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var hRow  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var h     = _reqHMap(hRow);
    var now   = new Date();
    var id    = generateID('REQ');

    // "Date Filed" — lets a CS backdate a request that's being entered late
    // (e.g. logging a Replacement that was actually requested a few days
    // ago). Same late-entry pattern as Customers' CreatedAt field. Falls
    // back to now if not provided; explicitly rejected (not silently
    // corrected) if it's in the future or more than a year in the past.
    var createdAtVal = now;
    if (payload.dateFiled) {
      var parsedFiled = _parseDateInput(payload.dateFiled);
      if (!isNaN(parsedFiled.getTime())) {
        var oneYearAgo = new Date(now); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        if (parsedFiled > now) {
          return { success: false, error: 'Ticket Created Date can\'t be in the future.' };
        }
        if (parsedFiled < oneYearAgo) {
          return { success: false, error: 'Ticket Created Date can\'t be more than a year before today.' };
        }
        createdAtVal = parsedFiled;
      }
    }

    // A "New" request's payment is considered already covered by the
    // customer's own initial payment — derived server-side (never trusting
    // a client-sent value) so it can't drift between requests for the same
    // customer. "Additional" requests are a new service on top of what was
    // already paid for, so they ALWAYS need Executive Support's own
    // confirmation regardless of the customer's existing payment date —
    // this auto-Paid shortcut deliberately does not apply to them.
    var requestPaymentDate = '';
    var autoPaymentStatus = '';
    if (payload.customerId && payload.requestType === 'New') {
      var custRes = getCustomerById(payload.customerId);
      if (custRes && custRes.success && custRes.data && !custRes.data.noPaymentYet && custRes.data.paymentDate) {
        requestPaymentDate = custRes.data.paymentDate;
        autoPaymentStatus = 'Paid';
      }
    }

    var colMap = {
      'RequestID':           id,
      'ClientID':            payload.clientId            || '',
      'CustomerID':          payload.customerId          || '',
      'RequestType':         payload.requestType         || '',
      'SpecialRequestType':  payload.specialRequestType  || '',
      'Department':          payload.department          || '',
      'PrimaryAccount':      payload.primaryAccount      || '',
      'SecondaryAccount':    payload.secondaryAccount    || '',
      'AccountManager':      payload.accountManager      || '',
      'Service':             payload.service             || '',
      'Hours':               payload.hours               || '',
      'ScheduleType':        payload.scheduleType        || '',
      'ScheduleDays':        payload.scheduleDays        || '',
      'ScheduleNotes':       payload.scheduleNotes       || '',
      'ClientTimezone':      payload.clientTimezone      || '',
      'PHTimezone':          payload.phTimezone          || '',
      'ReplacementForVAID':  payload.replacementForVAID  || '',
      'ParentRequestID':     payload.parentRequestId     || '',
      'RequestGroup':        _normRequestGroup(payload.requestGroup),
      'SellerOnboardingDate':payload.sellerOnboardingDate|| '',
      'TargetStartDate':     payload.targetStartDate     || '',
      'Status':              CONFIG.VA_REQUEST_STATUS.OPEN,
      'PaymentStatus':       autoPaymentStatus || payload.paymentStatus || 'No Payment',
      'ServiceManagerEmail': _lookupServiceManager_(payload.department || '', ss),
      'Notes':               payload.notes               || '',
      'PaymentDate':         requestPaymentDate,
      
      'ChangeRequestForConnectionID': payload.changeRequestForConnectionId || '',
      'RequestedHours':              payload.requestedHours              || '',
      'RequestedScheduleNotes':      payload.requestedScheduleNotes      || '',
      'HoursType':           payload.hoursType           || '',
      'HoursBreakdown':      payload.hoursBreakdown      || '',
      'RequiredPHTime':      payload.requiredClientTime ? convertClientTimeToPH(payload.requiredClientTime, payload.clientTimezone || '', new Date()) : (payload.requiredPHTime || ''),
      'RequiredClientTime':  payload.requiredClientTime  || '',
      'PaymentMethod':       payload.paymentMethod       || '',
      'ReplacementForConnectionID': payload.replacementForConnectionId || '',
      'NightDiffApplicableAtSchedule': !!payload.nightDiffApplicableAtSchedule,
      'BreaksIncludedInTotal': payload.breaksIncludedInTotal !== undefined ? !!payload.breaksIncludedInTotal : true,
      'CreatedAt':           createdAtVal,
      'CreatedBy':           perm.user.email,
      'UpdatedAt':           now,
      'UpdatedBy':           perm.user.email
    };

    var rowData = hRow.map(function (col) {
      return col && colMap.hasOwnProperty(col) ? colMap[col] : '';
    });
    sheet.appendRow(rowData);
    // Real bug fixed here: _wfInitializeForNewRequest (right below, via
    // _wfAdvance) reads this same sheet again immediately after — on a
    // large VARequests sheet, that read-after-write gap was occasionally
    // wide enough for the freshly appended row not to be found yet,
    // which is exactly what silently left CurrentStage/PersonInChargeRole
    // blank on some newly created requests. flush() forces this write to
    // fully land before anything reads the sheet again.
    SpreadsheetApp.flush();

    // If an Account Manager was entered that isn't already on this account's
    // list, add them there now — the ticket references a person, so that
    // person should actually be on the account's record going forward, not
    // just mentioned on this one ticket.
    if (payload.accountManager && payload.clientId) {
      _addAccountManagerIfNew(payload.clientId, payload.accountManager, perm.user, payload.accountManagerEmail);
    }

    _writeLog('VARequest', id, 'CREATE', '', '',
      JSON.stringify({ clientId: payload.clientId, requestType: payload.requestType }), perm.user);

    // Retry once — a fresh row's own stage initialization failing right
    // after everything else about creation succeeded is most likely a
    // transient hiccup, not a permanent one, so it's worth one more try
    // before giving up and warning the person. See
    // _wfInitializeForNewRequest (WorkflowService.gs) for what this used
    // to do instead: fail completely silently, leaving CurrentStage
    // blank with no indication anything was wrong.
    var stageInitRes = _wfInitializeForNewRequest(id, perm.user);
    var warning = '';
    if (!stageInitRes || !stageInitRes.success) {
      stageInitRes = _wfInitializeForNewRequest(id, perm.user);
      if (!stageInitRes || !stageInitRes.success) {
        var stageErr = (stageInitRes && stageInitRes.error) || 'unknown error';
        warning = 'Request ' + id + ' was created, but its workflow stage could not be set automatically (' + stageErr + '). It may show an empty Phase — please refresh, and contact an Administrator if it stays blank.';
        Logger.log('createVARequest: stage init failed twice for ' + id + ': ' + stageErr);
      }
    }
    return warning ? { success: true, id: id, warning: warning } : { success: true, id: id };
  } catch (e) {
    return { success: false, error: 'createVARequest: ' + e.message };
  }
}

// ── Server-side, unscoped check for the New-type restriction ───────────
// The frontend's _reqAll cache is scoped down to "my customers" for CS
// Specialists (see _scopeToSpecialist in scripts-va-ops.html), so it can't
// be trusted for this — a Specialist opening "Add New Service Request" for
// an account outside their own scope could get a false "no New request on
// file" result from an incomplete cache. This scans the sheet directly,
// every time, for an authoritative answer.
// Powers the New Service Request form's Customer/Account filtering by
// Request Type: New only shows customers with no New request on file yet;
// Replacement only shows customers/accounts that actually have an active
// (Started) VA connection to replace. One call, computed once, rather than
// a round trip per keystroke or per customer.
function getRequestFormFilterSets() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var reqSheet = _reqGetSheet(ss);
    var reqData  = reqSheet.getDataRange().getValues();
    var rh = _reqHMap(reqData[0]);
    var customersWithNewSR = {};
    for (var i = 1; i < reqData.length; i++) {
      if (String(reqData[i][rh['RequestType']]||'') !== 'New') continue;
      var custId = String(reqData[i][rh['CustomerID']]||'').trim();
      if (custId) customersWithNewSR[custId] = true;
    }

    var allCustomerIds = [];
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSheet) {
      var custData = custSheet.getDataRange().getValues();
      var ch = _reqHMap(custData[0]);
      for (var ci = 1; ci < custData.length; ci++) {
        var cid = String(custData[ci][ch['CustomerID']]||'').trim();
        if (cid) allCustomerIds.push(cid);
      }
    }
    var customersWithoutNewSR = allCustomerIds.filter(function(id){ return !customersWithNewSR[id]; });

    var customersWithActiveVA = {};
    var accountsWithActiveVA  = {};
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (connSheet) {
      var connData = connSheet.getDataRange().getValues();
      var coh = _reqHMap(connData[0]);
      for (var vi = 1; vi < connData.length; vi++) {
        if (String(connData[vi][coh['ConnectionStatus']]||'') !== 'Started') continue;
        var vCustId = String(connData[vi][coh['CustomerID']]||'').trim();
        var vCliId  = String(connData[vi][coh['ClientID']]||'').trim();
        if (vCustId) customersWithActiveVA[vCustId] = true;
        if (vCliId)  accountsWithActiveVA[vCliId]   = true;
      }
    }

    return {
      success: true,
      customersWithoutNewSR: customersWithoutNewSR,
      customersWithActiveVA: Object.keys(customersWithActiveVA),
      accountsWithActiveVA:  Object.keys(accountsWithActiveVA)
    };
  } catch (e) {
    return { success: false, error: 'getRequestFormFilterSets: ' + e.message };
  }
}

function hasNewServiceRequestOnFile(customerId, clientId, excludeRequestId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _reqHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']] || '') !== String(customerId)) continue;
      if (String(data[i][h['ClientID']]   || '') !== String(clientId))   continue;
      if (excludeRequestId && String(data[i][h['RequestID']] || '') === String(excludeRequestId)) continue;
      if (String(data[i][h['RequestType']]|| '') === 'New') return { success: true, hasNew: true };
    }
    return { success: true, hasNew: false };
  } catch (e) {
    return { success: false, error: 'hasNewServiceRequestOnFile: ' + e.message };
  }
}

// Deleting a Service Request is intentionally NOT gated by the generic
// canDelete role permission — that flag is shared across every entity in
// the system, and CS Manager may not have it set (or another role might)
// independent of whether they should specifically be able to delete a
// Service Request. This is a narrow, explicit check for this one action,
// matching the same pattern _checkAssignVAPermission uses elsewhere.
function _checkDeleteRequestPermission() {
  var user = getCurrentUser();
  if (!user || user.error) return { allowed: false, user: null };
  var allowed = user.role === CONFIG.ROLES.CS_MANAGER || user.role === CONFIG.ROLES.ADMINISTRATOR;
  return { allowed: allowed, user: user };
}

function deleteVARequest(requestId) {
  try {
    var perm = _checkDeleteRequestPermission();
    if (!perm.allowed) return { success: false, error: 'Only CS Managers and Administrators can delete Service Requests.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _reqHMap(data[0]);

    // Any VA Connection that came from this request gets deleted along
    // with it — the frontend warns about this before the user confirms
    // (see reqConfirmDelete in scripts-va-ops.html). This used to refuse
    // deletion outright instead, but that just left the connection
    // permanently stuck; deleting both together avoids the orphaned-
    // RequestID problem just as completely, without blocking the action.
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var ch = _connHMap(connData[0]);
    var deletedConnCount = 0;
    for (var ci = connData.length - 1; ci >= 1; ci--) {
      if (String(connData[ci][ch['RequestID']]||'') === requestId) {
        connSheet.deleteRow(ci + 1);
        deletedConnCount++;
      }
    }

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      var vaName = h['VAName'] !== undefined ? String(data[i][h['VAName']]||'') : '';
      var custId = String(data[i][h['CustomerID']]||'');
      var deptVal = String(data[i][h['Department']]||'');
      sheet.deleteRow(i + 1);
      _writeLog('VARequest', requestId, 'DELETE', '', deptVal + ' — ' + custId + (deletedConnCount ? ' (also deleted ' + deletedConnCount + ' VA Connection(s))' : ''), '', perm.user);
      return { success: true, deletedConnCount: deletedConnCount };
    }
    return { success: false, error: 'Request not found.' };
  } catch (e) {
    return { success: false, error: 'deleteVARequest: ' + e.message };
  }
}

// Surgical update — only ever touches PaymentDate/PaymentStatus, leaving
// every other field on the request untouched. Deliberately NOT routed
// through updateVARequest: that function rebuilds nearly every column
// from the payload it's given (payload.X || ''), so a partial payload
// like {paymentDate, paymentStatus} would silently wipe every other field
// on the request to empty. This is the safe way to update just these two.
// Executive Support's dedicated payment confirmation action — distinct
// from updateRequestPaymentStatus above, which serves the unrelated
// Accept-VA payment prompt flow. Gated specifically to Executive Support
// (or Administrator), matching the new workflow requirement that THEY
// are the ones responsible for confirming payment on Additional requests
// (and on any New request that didn't already qualify for the automatic
// Paid status at creation time).
function confirmRequestPayment(requestId, paymentStatus, paymentDate) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: 'Not signed in.' };
    if (user.role !== CONFIG.ROLES.EXECUTIVE_SUPPORT && user.role !== CONFIG.ROLES.ADMINISTRATOR && user.role !== CONFIG.ROLES.CS_MANAGER && user.role !== CONFIG.ROLES.CS_SPECIALIST) {
      return { success: false, error: 'Only Executive Support, CS Specialists, CS Managers, or Administrators can confirm payment status.' };
    }
    var validStatuses = ['Paid', 'No Payment', 'Add to Next Bill'];
    if (validStatuses.indexOf(paymentStatus) === -1) {
      return { success: false, error: 'Invalid payment status.' };
    }
    if (paymentStatus === 'Paid' && !paymentDate) {
      return { success: false, error: 'Payment Date is required when marking as Paid.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _reqHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      var rowNum = i + 1;
      var oldStatus = h['PaymentStatus'] !== undefined ? String(data[i][h['PaymentStatus']]||'') : '';
      var oldDate   = h['PaymentDate'] !== undefined ? String(data[i][h['PaymentDate']]||'') : '';

      if (h['PaymentStatus'] !== undefined) sheet.getRange(rowNum, h['PaymentStatus']+1).setValue(paymentStatus);
      if (h['PaymentDate'] !== undefined) {
        if (paymentStatus === 'Paid') {
          var parsedDate = new Date(paymentDate);
          sheet.getRange(rowNum, h['PaymentDate']+1).setValue(isNaN(parsedDate.getTime()) ? '' : parsedDate);
        } else {
          sheet.getRange(rowNum, h['PaymentDate']+1).setValue('');
        }
      }
      if (h['UpdatedAt'] !== undefined) sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(new Date());
      if (h['UpdatedBy'] !== undefined) sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(user.email);

      _writeLog('VARequest', requestId, 'UPDATE', 'PaymentStatus', oldStatus, paymentStatus, user);
      if (paymentStatus === 'Paid' && paymentDate !== oldDate) {
        _writeLog('VARequest', requestId, 'UPDATE', 'PaymentDate', oldDate, paymentDate, user, paymentDate);
      }

      // If this request was specifically waiting here for payment
      // confirmation, and payment is now genuinely resolved, proceed
      // toward Rate Agreement — the whole reason Payment Confirmation
      // exists. Any other payment status change (e.g. correcting it at
      // a later stage) never triggers this. Per the request, any
      // connection waiting on payment (not just the Final VA) can now
      // trigger this — recalculated centrally rather than gated on a
      // specific connection being designated Final VA.
      var currentStageLabel = h['CurrentStage'] !== undefined ? String(data[i][h['CurrentStage']]||'') : '';
      if (currentStageLabel === WORKFLOW_STAGES.PAYMENT_CONFIRMATION.label && (paymentStatus === 'Paid' || paymentStatus === 'Add to Next Bill')) {
        _wfRecalculateRequestStage(requestId, user);
      }
      return { success: true };
    }
    return { success: false, error: 'Request not found.' };
  } catch (e) {
    return { success: false, error: 'confirmRequestPayment: ' + e.message };
  }
}

function updateRequestPaymentStatus(requestId, payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _reqHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      var rowNum = i + 1;
      var oldPaymentDate = h['PaymentDate'] !== undefined ? String(data[i][h['PaymentDate']]||'') : '';
      var oldPaymentStatus = h['PaymentStatus'] !== undefined ? String(data[i][h['PaymentStatus']]||'') : '';

      if (payload.paymentDate !== undefined && h['PaymentDate'] !== undefined) {
        var parsedDate = _parseDateInput(payload.paymentDate);
        sheet.getRange(rowNum, h['PaymentDate']+1).setValue(isNaN(parsedDate.getTime()) ? '' : parsedDate);
      }
      if (payload.paymentStatus !== undefined && h['PaymentStatus'] !== undefined) {
        sheet.getRange(rowNum, h['PaymentStatus']+1).setValue(payload.paymentStatus);
      }
      if (h['UpdatedAt'] !== undefined) sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(new Date());
      if (h['UpdatedBy'] !== undefined) sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(perm.user.email);

      if (payload.paymentStatus !== undefined && payload.paymentStatus !== oldPaymentStatus) {
        _writeLog('VARequest', requestId, 'UPDATE', 'PaymentStatus', oldPaymentStatus, payload.paymentStatus, perm.user);
      }
      if (payload.paymentDate !== undefined && payload.paymentDate !== oldPaymentDate) {
        _writeLog('VARequest', requestId, 'UPDATE', 'PaymentDate', oldPaymentDate, payload.paymentDate, perm.user, payload.paymentDate);
      }
      return { success: true };
    }
    return { success: false, error: 'Request not found.' };
  } catch (e) {
    return { success: false, error: 'updateRequestPaymentStatus: ' + e.message };
  }
}

function updateVARequest(requestId, payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var errors = _validateRequest(payload);
    if (errors.length) return { success: false, errors: errors };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _reqHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;

      var currentStatus = String(data[i][h['Status']] || '');
      if (currentStatus === CONFIG.VA_REQUEST_STATUS.CLOSED_WON ||
          currentStatus === CONFIG.VA_REQUEST_STATUS.CLOSED_LOST) {
        return { success: false, error: 'Cannot edit a closed request.' };
      }

      var rowNum = i + 1;
      var old    = _mapReqRow(data[i], h);

      // Real bug fixed here — the exact risk that was reported: this
      // used to overwrite ~25 columns unconditionally from payload.X ||
      // '' on every save, with no way to tell "the form never included
      // this field" apart from "the user actually cleared it." Any edit
      // flow that doesn't load and resend every single one of those
      // fields (a partial/quick-edit form, or a bug in what the form
      // prefilled) would silently blank out real data on the columns it
      // didn't send. has() below distinguishes those two cases properly:
      // a field is only ever touched if payload actually contains that
      // key at all; a field genuinely absent from payload leaves the
      // existing value on the sheet untouched.
      function has(key) { return Object.prototype.hasOwnProperty.call(payload, key); }

      // Department/Service can only be changed while still in Request
      // Intake, and only by CS Specialist and up — same restriction the
      // frontend enforces via the disabled attribute, repeated here since
      // that alone can be bypassed by a direct call. Only counts as
      // "changed" if the field was actually sent — its mere absence from
      // a partial payload isn't a change to flag or block.
      var deptChanged = has('department') && (payload.department || '') !== (old.department || '');
      var svcChanged  = has('service')    && (payload.service     || '') !== (old.service     || '');
      if (deptChanged || svcChanged) {
        var canEditDeptSvc = old.currentStage === 'Request Intake' &&
          ['CS Specialist','CS Manager','Administrator'].indexOf(perm.user.role) !== -1;
        if (!canEditDeptSvc) {
          return { success: false, error: 'Department/Service can only be changed during Request Intake, by a CS Specialist or above.' };
        }
      }

      var updates = {};
      function setIf(payloadKey, col) { if (has(payloadKey)) updates[col] = payload[payloadKey] || ''; }
      setIf('requestType',        'RequestType');
      if (has('requestGroup')) updates['RequestGroup'] = _normRequestGroup(payload.requestGroup);
      setIf('specialRequestType', 'SpecialRequestType');
      setIf('department',         'Department');
      setIf('primaryAccount',     'PrimaryAccount');
      setIf('secondaryAccount',   'SecondaryAccount');
      setIf('accountManager',     'AccountManager');
      setIf('service',            'Service');
      setIf('hours',              'Hours');
      setIf('scheduleType',       'ScheduleType');
      setIf('scheduleDays',       'ScheduleDays');
      setIf('scheduleNotes',      'ScheduleNotes');
      setIf('clientTimezone',     'ClientTimezone');
      setIf('phTimezone',         'PHTimezone');
      setIf('replacementForVAID', 'ReplacementForVAID');
      setIf('sellerOnboardingDate', 'SellerOnboardingDate');
      setIf('targetStartDate',    'TargetStartDate');
      setIf('notes',               'Notes');
      setIf('changeRequestForConnectionId', 'ChangeRequestForConnectionID');
      setIf('requestedHours',              'RequestedHours');
      setIf('requestedScheduleNotes',      'RequestedScheduleNotes');
      setIf('hoursType',          'HoursType');
      setIf('hoursBreakdown',     'HoursBreakdown');
      setIf('paymentMethod',      'PaymentMethod');
      setIf('replacementForConnectionId', 'ReplacementForConnectionID');
      if (has('nightDiffApplicableAtSchedule')) updates['NightDiffApplicableAtSchedule'] = !!payload.nightDiffApplicableAtSchedule;
      if (has('breaksIncludedInTotal'))         updates['BreaksIncludedInTotal']         = !!payload.breaksIncludedInTotal;

      // RequiredPHTime/RequiredClientTime are a linked pair (PH is
      // derived from Client time) — only touched at all if the payload
      // actually sent one of them; otherwise both stay exactly as they
      // were, same as everything else above.
      if (has('requiredClientTime')) {
        updates['RequiredClientTime'] = payload.requiredClientTime || '';
        var tzForConvert = has('clientTimezone') ? payload.clientTimezone : old.clientTimezone;
        updates['RequiredPHTime'] = payload.requiredClientTime
          ? convertClientTimeToPH(payload.requiredClientTime, tzForConvert || '', new Date())
          : (has('requiredPHTime') ? (payload.requiredPHTime || '') : old.requiredPHTime);
      } else if (has('requiredPHTime')) {
        updates['RequiredPHTime'] = payload.requiredPHTime || '';
      }

      updates['UpdatedAt'] = new Date();
      updates['UpdatedBy'] = perm.user.email;

      // Ticket Created Date is editable too — same backdating use case as
      // on creation (entering a ticket after the fact). Bug fix: this field
      // was already in the edit form and already being sent here, but this
      // function silently dropped it — CreatedAt never actually changed.
      // Same range validation as creation — rejected outright if in the
      // future or more than a year in the past, not silently corrected.
      if (payload.dateFiled) {
        var parsedFiled2 = _parseDateInput(payload.dateFiled);
        if (!isNaN(parsedFiled2.getTime())) {
          var nowForEdit = new Date();
          var oneYearAgoForEdit = new Date(nowForEdit); oneYearAgoForEdit.setFullYear(oneYearAgoForEdit.getFullYear() - 1);
          if (parsedFiled2 > nowForEdit) {
            return { success: false, error: 'Ticket Created Date can\'t be in the future.' };
          }
          if (parsedFiled2 < oneYearAgoForEdit) {
            return { success: false, error: 'Ticket Created Date can\'t be more than a year before today.' };
          }
          updates['CreatedAt'] = parsedFiled2;
        }
      }
      Object.keys(updates).forEach(function (col) {
        if (h[col] !== undefined) sheet.getRange(rowNum, h[col] + 1).setValue(updates[col]);
      });
      if (payload.accountManager && (payload.clientId || old.clientId)) {
        _addAccountManagerIfNew(payload.clientId || old.clientId, payload.accountManager, perm.user, payload.accountManagerEmail);
      }
      // Per the request — editing a request's schedule is a "Service Request Change". If any
      // schedule-related field actually changed in this save, ONE entry is recorded saying what
      // changed (before → after), so the request can show it. (_logChanges below only tracks
      // customer/account fields, so a schedule edit used to leave no trace at all.)
      try {
        var schedChanges = [];
        var fmtBd = function(raw) { var f = ''; try { f = _fmtScheduleBreakdown(raw); } catch (e) {} return f || String(raw || ''); };
        var addStr = function(label, oldV, newV) {
          oldV = String(oldV == null ? '' : oldV).trim(); newV = String(newV == null ? '' : newV).trim();
          if (oldV !== newV) schedChanges.push({ label: label, from: oldV, to: newV });
        };
        var addBool = function(label, oldV, newV, offTxt, onTxt) {
          if (!!oldV !== !!newV) schedChanges.push({ label: label, from: oldV ? onTxt : offTxt, to: newV ? onTxt : offTxt });
        };
        if (updates['Hours'] !== undefined)        addStr('Hours per week', old.hours, updates['Hours']);
        if (updates['ScheduleType'] !== undefined) addStr('Schedule type', old.scheduleType, updates['ScheduleType']);
        if (updates['HoursType'] !== undefined)    addStr('Hours type', old.hoursType, updates['HoursType']);
        if (updates['ScheduleDays'] !== undefined) addStr('Schedule days', old.scheduleDays, updates['ScheduleDays']);
        if (updates['HoursBreakdown'] !== undefined) addStr('Schedule (day-by-day)', fmtBd(old.hoursBreakdown), fmtBd(updates['HoursBreakdown']));
        if (updates['RequiredClientTime'] !== undefined || updates['RequiredPHTime'] !== undefined) {
          var fmtTime = function(c, ph) { return (c ? c + ' (client time)' : '') + (ph ? (c ? ' · ' : '') + ph + ' (PH)' : ''); };
          var oc = String(old.requiredClientTime || ''), op = String(old.requiredPHTime || '');
          var nc = updates['RequiredClientTime'] !== undefined ? String(updates['RequiredClientTime'] || '') : oc;
          var np = updates['RequiredPHTime']     !== undefined ? String(updates['RequiredPHTime']     || '') : op;
          addStr('Required working time', fmtTime(oc, op), fmtTime(nc, np));
        }
        if (updates['ClientTimezone'] !== undefined) addStr('Client timezone', old.clientTimezone, updates['ClientTimezone']);
        if (updates['NightDiffApplicableAtSchedule'] !== undefined) addBool('Night differential', old.nightDiffApplicableAtSchedule, updates['NightDiffApplicableAtSchedule'], 'Does not apply', 'Applies');
        if (updates['BreaksIncludedInTotal'] !== undefined)         addBool('Breaks included in total hours', old.breaksIncludedInTotal, updates['BreaksIncludedInTotal'], 'No', 'Yes');
        if (updates['ScheduleNotes'] !== undefined) addStr('Schedule notes', old.scheduleNotes, updates['ScheduleNotes']);
        if (schedChanges.length) {
          _writeLog('VARequest', requestId, 'SCHEDULE_CHANGE', 'Schedule',
            schedChanges.map(function(c){ return c.label + ': ' + (c.from || '—'); }).join(' | '),
            schedChanges.map(function(c){ return c.label + ': ' + (c.to || '—'); }).join(' | '),
            perm.user, null, JSON.stringify(schedChanges));
        }
      } catch (schedLogEx) { Logger.log('updateVARequest schedule-change log: ' + schedLogEx.message); }
      _logChanges('VARequest', requestId, old, payload, perm.user);
      return { success: true };
    }
    return { success: false, error: 'Request not found.' };
  } catch (e) {
    return { success: false, error: 'updateVARequest: ' + e.message };
  }
}

// Bug fix (2026-06-24): this previously hardcoded CLOSED_LOST regardless of the
// `reason` argument, so the "Close Won" button in the UI (which called
// closeVARequest(requestId, 'Closed - Won')) was silently recording every
// manually-closed request as Lost. That got fixed by resolving status from
// `reason` — but per the later decision to disallow manual Closed-Won entirely
// (Won should ONLY ever happen automatically, via _closeRequestAsWon when a VA
// connection is marked Started), this function is now Lost-only. There is no
// "Won" path here anymore, and a reason is mandatory — the UI enforces this
// with a required field, and this check is the server-side backstop in case
// this is ever called directly.
// Whether every VA connection assigned to this request has been
// Declined — requires at least one to exist; a request with no VAs
// assigned yet was never actually declined, it just hasn't been worked.
function _allConnectionsDeclinedForRequest(requestId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var connSheet = _connGetSheet(ss);
  var connData = connSheet.getDataRange().getValues();
  var ch = _connHMap(connData[0]);
  var found = 0, allDeclined = true;
  for (var i = 1; i < connData.length; i++) {
    if (String(connData[i][ch['RequestID']]||'') !== requestId) continue;
    found++;
    if (String(connData[i][ch['ConnectionStatus']]||'') !== 'Declined') { allDeclined = false; break; }
  }
  return found > 0 && allDeclined;
}

function closeVARequest(requestId, reason) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var blockedRoles = [CONFIG.ROLES.RECRUITMENT, CONFIG.ROLES.TRAINING, CONFIG.ROLES.SERVICE_MANAGER];
    if (blockedRoles.indexOf(perm.user.role) !== -1) {
      // Exception — if every VA connection assigned to this request has
      // been Declined, Service Manager can still mark it closed (No
      // Available VAs), since there's genuinely nothing left for them to
      // do here otherwise. Recruitment/Training remain blocked outright.
      var isServiceManagerAllExceptions = perm.user.role === CONFIG.ROLES.SERVICE_MANAGER && _allConnectionsDeclinedForRequest(requestId);
      if (!isServiceManagerAllExceptions) {
        return { success: false, error: 'Your role cannot close a request as Lost.' };
      }
    }

    reason = (reason || '').trim();
    if (!reason) return { success: false, error: 'A reason is required to close a request as Lost.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _reqHMap(data[0]);

    var newStatus = CONFIG.VA_REQUEST_STATUS.CLOSED_LOST;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      var rowNum = i + 1;
      var oldStatus = String(data[i][h['Status']] || '');
      var now = new Date();
      sheet.getRange(rowNum, h['Status']    + 1).setValue(newStatus);
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);
      // ClosedAt and CompletedAt both stamp "when this request was
      // finalized" — kept in sync for both Won and Lost outcomes (the
      // Customer Onboarding report's Cancelled metrics read CompletedAt,
      // so a Lost request needs this populated the same way Won does,
      // not left blank the way it originally was here).
      if (h['ClosedAt'] !== undefined) {
        sheet.getRange(rowNum, h['ClosedAt'] + 1).setValue(now);
      }
      if (h['CompletedAt'] !== undefined) {
        sheet.getRange(rowNum, h['CompletedAt'] + 1).setValue(now);
      }
      _writeLog('VARequest', requestId, 'UPDATE', 'Status', oldStatus, newStatus, perm.user);
      _writeLog('VARequest', requestId, 'CLOSE_LOST_REASON', 'Reason', '', reason, perm.user);
      // Reason gets a visible note on the ticket too, same as reopen — so
      // anyone opening it later sees why without hunting through the log.
      addVAConnectionNote({ requestId: requestId, content: 'Closed - Lost — ' + reason });
      // Closing Lost always cancels any still-open VA connections.
      _cancelOpenConnections(requestId, perm.user);
      // If this request was escalated from a Concern/Inquiry, that
      // ticket closes Lost too — the escalation didn't work out.
      try { _closeLinkedInquiry(requestId, 'Lost', perm.user); } catch (linkEx) { Logger.log('closeVARequest linked inquiry: ' + linkEx.message); }
      return { success: true };
    }
    return { success: false, error: 'Request not found.' };
  } catch (e) {
    return { success: false, error: 'closeVARequest: ' + e.message };
  }
}

// Reopen a Closed - Won / Closed - Lost request back to Open. A reason is
// required (not optional) — it's written both to the ActivityLogs audit
// trail (via _writeLog) AND as a visible note on the request's own
// Notes/Thread panel via addVAConnectionNote(), so anyone opening the ticket
// immediately sees why it came back, without having to dig into the logs.
function reopenVARequest(requestId, reason) {
  // Closed requests are final — no path back to Open. This function is
  // kept only so any existing references to it fail with a clear message
  // rather than a missing-function error.
  return { success: false, error: 'Closed Service Requests cannot be reopened.' };
}

// ═══════════════════════════════════════════════════════════
// SCHEMA AUDIT — highlights columns that are candidates for removal,
// directly on the live sheets, so they're visible without digging through
// code. IMPORTANT: "highlighted" does not mean "safe to delete right now" —
// see the note attached to each cell. This is a curated list based on a
// manual code review, not a fully automated live scan (Apps Script has no
// way to grep its own source at runtime), so treat it as a strong starting
// point rather than a guarantee.
// ═══════════════════════════════════════════════════════════
function highlightRedundantColumns() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Administrator access required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var candidates = [
      {
        sheet: 'VAConnections', columns: ['Hours', 'HoursType'],
        note: 'Superseded by VAConnectionHoursLog, which is now the source of truth for a connection\'s current hours and schedule type. Still actively READ from and WRITTEN to in ~15 places each as a cached snapshot (VAConnectionService.gs, VAHoursService.gs, Router.gs) — NOT safe to delete until those call sites are refactored to read from the log instead. Flagged as a candidate, not cleared for deletion.'
      }
    ];

    var results = [];
    candidates.forEach(function(c) {
      var sheet = ss.getSheetByName(c.sheet);
      if (!sheet) { results.push({sheet: c.sheet, error: 'Sheet not found'}); return; }
      var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      c.columns.forEach(function(colName) {
        var colIdx = headerRow.indexOf(colName);
        if (colIdx === -1) { results.push({sheet: c.sheet, column: colName, error: 'Column not found'}); return; }
        var cell = sheet.getRange(1, colIdx + 1);
        cell.setBackground('#fecaca').setFontColor('#7f1d1d').setFontWeight('bold');
        cell.setNote('CANDIDATE FOR REMOVAL:\n\n' + c.note);
        results.push({sheet: c.sheet, column: colName, status: 'highlighted'});
      });
    });

    return { success: true, results: results };
  } catch (e) {
    return { success: false, error: 'highlightRedundantColumns: ' + e.message };
  }
}

// Removes the highlight/note without needing to reopen the sheet manually.
function clearRedundantColumnHighlights() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Administrator access required.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var targets = [ { sheet: 'VAConnections', columns: ['Hours', 'HoursType'] } ];
    targets.forEach(function(c) {
      var sheet = ss.getSheetByName(c.sheet); if (!sheet) return;
      var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      c.columns.forEach(function(colName) {
        var colIdx = headerRow.indexOf(colName); if (colIdx === -1) return;
        var cell = sheet.getRange(1, colIdx + 1);
        cell.setBackground(null).setFontColor(null).setFontWeight('normal').clearNote();
      });
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: 'clearRedundantColumnHighlights: ' + e.message };
  }
}

// closedDate: the moment this request should be considered closed — per the
// 2026-06-29 fix, this is the VA's ACTUAL START DATE (passed in by the
// caller, which already resolved it as dateValue || now when marking the
// connection Started), not the moment this function happens to run. Those
// can differ: a CS might mark a connection Started today but backdate the
// actual start to last week, and the request should read as closed then,
// not today.
function _closeRequestAsWon(requestId, user, closedDate) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _reqHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      var now = new Date();
      var closeAt = closedDate ? new Date(closedDate) : now;
      if (isNaN(closeAt.getTime())) closeAt = now;
      sheet.getRange(i + 1, h['Status']    + 1).setValue(CONFIG.VA_REQUEST_STATUS.CLOSED_WON);
      sheet.getRange(i + 1, h['UpdatedAt'] + 1).setValue(now);
      sheet.getRange(i + 1, h['UpdatedBy'] + 1).setValue(user ? user.email : '');
      if (h['CompletedAt'] !== undefined) {
        sheet.getRange(i + 1, h['CompletedAt'] + 1).setValue(closeAt);
      }
      if (h['ClosedAt'] !== undefined) {
        sheet.getRange(i + 1, h['ClosedAt'] + 1).setValue(closeAt);
      }
      _writeLog('VARequest', requestId, 'UPDATE', 'Status',
        String(data[i][h['Status']] || ''), CONFIG.VA_REQUEST_STATUS.CLOSED_WON, user, closeAt);
      // If this request was escalated from a Concern/Inquiry, that ticket
      // closes Won too — the VA starting means the escalation succeeded.
      try { _closeLinkedInquiry(requestId, 'Won', user); } catch (linkEx) { Logger.log('_closeRequestAsWon linked inquiry: ' + linkEx.message); }
      return;
    }
  } catch (e) {
    Logger.log('_closeRequestAsWon error: ' + e.message);
  }
}

function _mapReqRow(r, h) {
  function get(col) {
    if (h[col] === undefined) return '';
    var v = r[h[col]];
    if (v instanceof Date) return v.toISOString();
    return String(v == null ? '' : v);
  }
  return {
    requestId:           get('RequestID'),
    clientId:            get('ClientID'),
    customerId:          get('CustomerID'),
    requestType:         get('RequestType'),
    specialRequestType:  get('SpecialRequestType'),
    assignedVA:          get('AssignedVA'),
    department:          get('Department'),
    primaryAccount:      get('PrimaryAccount'),
    secondaryAccount:    get('SecondaryAccount'),
    accountManager:      get('AccountManager'),
    service:             get('Service'),
    hours:               get('Hours'),
    scheduleType:        get('ScheduleType'),
    scheduleDays:        get('ScheduleDays'),
    scheduleNotes:       get('ScheduleNotes'),
    clientTimezone:      get('ClientTimezone'),
    phTimezone:          get('PHTimezone'),
    replacementForVAID:  get('ReplacementForVAID'),
    parentRequestId:     get('ParentRequestID'),
    requestGroup:        _normRequestGroup(get('RequestGroup')),
    sellerOnboardingDate:get('SellerOnboardingDate'),
    targetStartDate:     get('TargetStartDate'),
    status:              get('Status'),
    notes:               get('Notes'),
    paymentDate:         get('PaymentDate'),
    paymentStatus:       get('PaymentStatus') || 'No Payment',
    serviceManagerEmail: get('ServiceManagerEmail') || '',
    mockCallDoneAt:      get('MockCallDoneAt') ? String(get('MockCallDoneAt')) : '',
    currentStage:        get('CurrentStage') || '',
    personInChargeRole:  get('PersonInChargeRole') || _wfDefaultRoleForStage(get('CurrentStage') || ''),
    scheduleConfirmedByCS:   get('ScheduleConfirmedByCS'),
    scheduleConfirmedByCSAt: get('ScheduleConfirmedByCSAt'),
    nightDiffApplicableAtSchedule: _toBool(get('NightDiffApplicableAtSchedule')),
    // Defaults true when blank (matches the creation-time default) —
    // older rows predating this field, or ones where the value never
    // got written for any other reason, shouldn't silently read as false.
    breaksIncludedInTotal: get('BreaksIncludedInTotal') === '' || get('BreaksIncludedInTotal') === undefined ? true : _toBool(get('BreaksIncludedInTotal')),
    mockCallDoneBy:      get('MockCallDoneBy') || '',
    prepStartedAt:       get('PrepStartedAt') ? String(get('PrepStartedAt')) : '',
    prepStartedBy:       get('PrepStartedBy') || '',
    prepDoneAt:          get('PrepDoneAt') ? String(get('PrepDoneAt')) : '',
    prepDoneBy:          get('PrepDoneBy') || '',
    vaCancelledAt:       get('VACancelledAt') ? String(get('VACancelledAt')) : '',
    vaCancelledNote:     get('VACancelledNote') || '',
    completedAt:         get('CompletedAt'),
    closedAt:            get('ClosedAt'),
    changeRequestForConnectionId: get('ChangeRequestForConnectionID'),
    requestedHours:               get('RequestedHours'),
    requestedScheduleNotes:       get('RequestedScheduleNotes'),
    hoursType:                    get('HoursType'),
    hoursBreakdown:               get('HoursBreakdown'),
    requiredPHTime:               get('RequiredPHTime'),
    requiredClientTime:           get('RequiredClientTime'),
    paymentMethod:                get('PaymentMethod'),
    replacementForConnectionId:   get('ReplacementForConnectionID'),
    createdAt:           get('CreatedAt'),
    createdBy:           get('CreatedBy'),
    updatedAt:           get('UpdatedAt'),
    updatedBy:           get('UpdatedBy')
  };
}

function _validateRequest(p) {
  var errors = [];
  if (!p || !p.clientId)    errors.push('Client is required.');
  if (!p || !p.requestType) errors.push('Request Type is required.');
  if (p && p.requestType === 'Hours/Schedule Change') {
    if (!p.changeRequestForConnectionId) errors.push('Select which existing VA this change request is for.');
    if (!p.requestedHours && !p.requestedScheduleNotes) {
      errors.push('Describe the requested hours change, schedule change, or both.');
    }
  }
  return errors;
}

// ─────────────────────────────────────────
// Service Request Completion Report
// ─────────────────────────────────────────
// Completion rate  = Closed-Won requests ÷ all requests created in the window.
// Lead time        = CompletedAt − CreatedAt, in days, for each Closed-Won
//                     request (CompletedAt is stamped once, either by
//                     closeVARequest's manual "Close Won" path or by
//                     _closeRequestAsWon when a VA connection starts —
//                     see VAConnectionService.gs). UpdatedAt is NOT used here
//                     because it's overwritten on every edit, so it can't be
//                     trusted to mark the moment of completion.
// Also folds in each request's customer's idle-days metric (since the
// customer was added / since they paid, to their first VA connection) so the
// two reports your team asked for — Service Request Completion and Customer
// Idle Time — can be cross-referenced from one place.
function getServiceRequestCompletionReport(filters) {
  try {
    filters = filters || {};
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [], summary: _srcEmptySummary() };
    var h = _reqHMap(data[0]);

    var fromDate = filters.fromDate ? new Date(filters.fromDate) : null;
    var toDate   = filters.toDate   ? new Date(filters.toDate)   : null;
    if (toDate) toDate.setHours(23,59,59,999);

    // Idle-days lookup, keyed by customerId, reusing the same report this
    // function is asked to surface inside of — avoids duplicating the
    // VAConnections scan a second time.
    var idleRes = getCustomerIdleTimeReport({});
    var idleByCustomer = {};
    if (idleRes && idleRes.success) {
      idleRes.data.forEach(function(row){ idleByCustomer[row.customerId] = row; });
    }

    // Customer/account name lookups (same pattern as getVARequests)
    var custLookup = {}, cliLookup = {};
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSheet) {
      var cd = custSheet.getDataRange().getValues();
      var ch = _reqHMap(cd[0]);
      for (var ci=1; ci<cd.length; ci++) {
        if (cd[ci][ch['CustomerID']]) custLookup[String(cd[ci][ch['CustomerID']])] = String(cd[ci][ch['CustomerName']]||'');
      }
    }
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (cliSheet) {
      var cl = cliSheet.getDataRange().getValues();
      var clh = _reqHMap(cl[0]);
      for (var cci=1; cci<cl.length; cci++) {
        if (cl[cci][clh['ClientID']]) cliLookup[String(cl[cci][clh['ClientID']])] = String(cl[cci][clh['CompanyName']]||'');
      }
    }

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['RequestID']]) continue;
      var rec = _mapReqRow(r, h);

      var createdD = rec.createdAt ? new Date(rec.createdAt) : null;
      if (fromDate && createdD && createdD < fromDate) continue;
      if (toDate   && createdD && createdD > toDate)   continue;
      if (filters.department && rec.department !== filters.department) continue;
      if (filters.requestType && rec.requestType !== filters.requestType) continue;

      var isWon  = rec.status === CONFIG.VA_REQUEST_STATUS.CLOSED_WON;
      var isLost = rec.status === CONFIG.VA_REQUEST_STATUS.CLOSED_LOST;
      var leadTimeDays = null;
      if (isWon && rec.completedAt && createdD) {
        var completedD = new Date(rec.completedAt);
        if (!isNaN(completedD.getTime())) {
          leadTimeDays = Math.max(0, Math.round((completedD - createdD) / 86400000));
        }
      }

      var idleRow = idleByCustomer[rec.customerId] || null;

      rows.push({
        requestId: rec.requestId,
        customerId: rec.customerId,
        customerName: custLookup[rec.customerId] || rec.customerId,
        clientId: rec.clientId,
        accountName: cliLookup[rec.clientId] || rec.clientId,
        requestType: rec.requestType,
        department: rec.department,
        status: rec.status,
        isWon: isWon,
        isLost: isLost,
        isOpen: !isWon && !isLost,
        paymentDate: rec.paymentDate,
        createdAt: rec.createdAt,
        completedAt: rec.completedAt,
        leadTimeDays: leadTimeDays,
        // Customer idle metrics, carried alongside each of that customer's requests
        idleDaysSinceAdded: idleRow ? idleRow.idleDaysSinceAdded : null,
        idleDaysSincePaid:  idleRow ? idleRow.idleDaysSincePaid  : null,
        customerIsConnected: idleRow ? idleRow.isConnected : null
      });
    }

    rows.sort(function(a,b){ return new Date(b.createdAt||0) - new Date(a.createdAt||0); });

    var total = rows.length;
    var wonRows  = rows.filter(function(r){ return r.isWon; });
    var lostRows = rows.filter(function(r){ return r.isLost; });
    var leadTimes = wonRows.map(function(r){ return r.leadTimeDays; }).filter(function(v){ return v !== null; });
    var avgLeadTime = leadTimes.length
      ? Math.round((leadTimes.reduce(function(a,b){return a+b;},0) / leadTimes.length) * 10) / 10
      : null;
    var medianLeadTime = null;
    if (leadTimes.length) {
      var sorted = leadTimes.slice().sort(function(a,b){return a-b;});
      var mid = Math.floor(sorted.length/2);
      medianLeadTime = sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid-1]+sorted[mid])/2)*10)/10;
    }

    var summary = {
      totalRequests: total,
      wonCount: wonRows.length,
      lostCount: lostRows.length,
      openCount: total - wonRows.length - lostRows.length,
      completionRate: total ? Math.round((wonRows.length / total) * 1000) / 10 : null, // percentage, 1 decimal
      avgLeadTimeDays: avgLeadTime,
      medianLeadTimeDays: medianLeadTime
    };

    return { success: true, data: rows, summary: summary };
  } catch (e) {
    return { success: false, error: 'getServiceRequestCompletionReport: ' + e.message };
  }
}

function _srcEmptySummary() {
  return { totalRequests:0, wonCount:0, lostCount:0, openCount:0, completionRate:null, avgLeadTimeDays:null, medianLeadTimeDays:null };
}

// ── Auto-activate Customer and Account ─────────────────────────────────────
// Called when a New service request is closed Won OR when a VA connection
// reaches Started status. Moves Pending Customers and Accounts to Active
// automatically so the CS team doesn't have to do it manually.
// Only upgrades Pending → Active; never downgrades an already-Active record.
function _autoActivateCustomerAndAccount(clientId, customerId, user) {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var now = new Date();
    var nowIso = now.toISOString().substring(0, 10);

    // Activate the Account (Client) if currently Pending
    if (clientId) {
      var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet) {
        var cliData = cliSheet.getDataRange().getValues();
        var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c).trim()]=i; });
        for (var ci = 1; ci < cliData.length; ci++) {
          if (String(cliData[ci][clh['ClientID']]||'') !== clientId) continue;
          var cliSt = String(cliData[ci][clh['Status']]||'');
          if (cliSt === 'Pending') {
            var clRow = ci + 1;
            cliSheet.getRange(clRow, clh['Status']     + 1).setValue('Active');
            cliSheet.getRange(clRow, clh['StatusDate'] + 1).setValue(now);
            if (clh['UpdatedAt'] !== undefined) cliSheet.getRange(clRow, clh['UpdatedAt'] + 1).setValue(now);
            if (clh['UpdatedBy'] !== undefined) cliSheet.getRange(clRow, clh['UpdatedBy'] + 1).setValue(user ? user.email : 'system');
            _writeLog('Account', clientId, _classifyStatusChangeAction('Pending', 'Active'), 'Status', 'Pending', 'Active', user || { email:'system', name:'System' });
          }
          // Also check if there's a parent customerId on this row
          if (!customerId) customerId = String(cliData[ci][clh['CustomerID']]||'');
          break;
        }
      }
    }

    // Activate the Customer if currently Pending
    if (customerId) {
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var custData = custSheet.getDataRange().getValues();
        var cuh = {}; custData[0].forEach(function(c,i){ if(c) cuh[String(c).trim()]=i; });
        for (var cui = 1; cui < custData.length; cui++) {
          if (String(custData[cui][cuh['CustomerID']]||'') !== customerId) continue;
          var custSt = String(custData[cui][cuh['Status']]||'');
          if (custSt === 'Pending') {
            var cuRow = cui + 1;
            custSheet.getRange(cuRow, cuh['Status']     + 1).setValue('Active');
            custSheet.getRange(cuRow, cuh['StatusDate'] + 1).setValue(now);
            if (cuh['UpdatedAt'] !== undefined) custSheet.getRange(cuRow, cuh['UpdatedAt'] + 1).setValue(now);
            if (cuh['UpdatedBy'] !== undefined) custSheet.getRange(cuRow, cuh['UpdatedBy'] + 1).setValue(user ? user.email : 'system');
            _writeLog('Customer', customerId, _classifyStatusChangeAction('Pending', 'Active'), 'Status', 'Pending', 'Active', user || { email:'system', name:'System' });
          }
          break;
        }
      }
    }
  } catch (e) {
    Logger.log('_autoActivateCustomerAndAccount: ' + e.message);
  }
}

function _lookupServiceManager_(department, ss) {
  if (!department) return '';
  try {
    var smSh = ss.getSheetByName('ServiceManagers');
    if (!smSh) return '';
    var d = smSh.getDataRange().getValues();
    var h = {}; d[0].forEach(function(c,i){ if(c) h[String(c).trim()]=i; });
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][h['Department']]||'') === department &&
          String(d[i][h['IsActive']]||'').toLowerCase() !== 'false') {
        return String(d[i][h['UserEmail']]||'');
      }
    }
  } catch(e) {}
  return '';
}
// Per the request — one-time, Administrator-only migration: ScheduleType's
// "Project Based" value (on VARequests) has been standardized to
// "Project-based" (hyphen), matching the exact casing used everywhere else
// this value is written or compared. All the code reading/writing/
// displaying this field was already updated to use the new format — this
// is what updates the EXISTING rows on the VARequests tab, plus the
// historical Prev/NewScheduleType columns on VAConnectionHoursLog, so past
// records match too, not just anything created going forward.
function migrateScheduleTypeToHyphenated() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) return { success: false, error: 'Only Administrators can run this migration.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var updatedCount = 0;

    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (reqSheet) {
      var reqData = reqSheet.getDataRange().getValues();
      var rh = {}; reqData[0].forEach(function(c,i){ if(c) rh[String(c).trim()]=i; });
      if (rh['ScheduleType'] !== undefined) {
        for (var i = 1; i < reqData.length; i++) {
          var raw = String(reqData[i][rh['ScheduleType']] || '');
          if (raw.toLowerCase().trim() !== 'project based') continue; // already 'Project-based' or something else — leave alone
          reqSheet.getRange(i + 1, rh['ScheduleType'] + 1).setValue('Project-based');
          updatedCount++;
        }
      }
    }

    // Historical log columns — same value, same fix, kept consistent with
    // the live field above so past change-history reads correctly too.
    var logSheetNames = ['VAConnectionHoursLog'];
    logSheetNames.forEach(function(sheetName) {
      var logSheet = ss.getSheetByName(sheetName);
      if (!logSheet) return;
      var logData = logSheet.getDataRange().getValues();
      var lh = {}; logData[0].forEach(function(c,i){ if(c) lh[String(c).trim()]=i; });
      ['PrevScheduleType', 'NewScheduleType'].forEach(function(col) {
        if (lh[col] === undefined) return;
        for (var j = 1; j < logData.length; j++) {
          var rawLog = String(logData[j][lh[col]] || '');
          if (rawLog.toLowerCase().trim() !== 'project based') continue;
          logSheet.getRange(j + 1, lh[col] + 1).setValue('Project-based');
          updatedCount++;
        }
      });
    });

    SpreadsheetApp.flush();
    if (updatedCount) {
      _writeLog('VARequest', 'BULK', 'UPDATE', 'ScheduleType', 'Project Based', 'Project-based', user,
        null, updatedCount + ' field(s) migrated across VARequests and VAConnectionHoursLog.');
    }
    return { success: true, updatedCount: updatedCount };
  } catch (e) {
    return { success: false, error: 'migrateScheduleTypeToHyphenated: ' + e.message };
  }
}


// Per the request — RequestGroup's "Project-based" value is now "Casual".
// Anything still carrying the old value (an un-migrated row, or an older
// client sending it) is read and saved as Casual, so it can never reappear.
function _normRequestGroup(v) {
  var t = String(v || '').trim();
  if (!t) return 'Regular';
  return t.toLowerCase().replace(/[\s-]/g, '') === 'projectbased' ? 'Casual' : t;
}

// One-time / repeatable, Administrator-only: changes every existing VARequests
// row whose RequestGroup is "Project-based" to "Casual". Safe to run again.
function migrateRequestGroupToCasual() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) return { success: false, error: 'Only Administrators can run this migration.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (!sheet) return { success: false, error: 'VARequests sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c, i){ if (c) h[String(c).trim()] = i; });
    if (h['RequestGroup'] === undefined) return { success: false, error: 'No RequestGroup column found on VARequests.' };
    var updated = 0, col = [];
    for (var i = 1; i < data.length; i++) {
      var raw = data[i][h['RequestGroup']];
      if (String(raw || '').toLowerCase().replace(/[\s-]/g, '') === 'projectbased') { col.push(['Casual']); updated++; }
      else col.push([raw]);
    }
    if (updated) sheet.getRange(2, h['RequestGroup'] + 1, col.length, 1).setValues(col);
    SpreadsheetApp.flush();
    if (updated) _writeLog('VARequest', 'BULK', 'UPDATE', 'RequestGroup', 'Project-based', 'Casual', user, null, updated + ' request(s) migrated.');
    return { success: true, updatedCount: updated };
  } catch (e) {
    return { success: false, error: 'migrateRequestGroupToCasual: ' + e.message };
  }
}


// Per the request — the Service Request Changes recorded above (each edit that changed the
// request's schedule), newest first, for the request modal. Reads only the Service Request
// activity sheet, and only this request's rows.
function getRequestScheduleChanges(requestId) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!requestId) return { success: true, data: [] };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.REQUEST_ACTIVITY_LOGS);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, data: [] };
    var lastCol = sheet.getLastColumn();
    var h = {}; sheet.getRange(1, 1, 1, lastCol).getValues()[0].forEach(function(c, i){ if (c) h[String(c).trim()] = i; });
    if (h['EntityID'] === undefined || h['Action'] === undefined) return { success: true, data: [] };
    var hits = sheet.getRange(2, h['EntityID'] + 1, sheet.getLastRow() - 1, 1).createTextFinder(String(requestId)).matchEntireCell(true).findAll();
    var out = [];
    hits.forEach(function(cell) {
      var row = sheet.getRange(cell.getRow(), 1, 1, lastCol).getValues()[0];
      if (String(row[h['Action']] || '') !== 'SCHEDULE_CHANGE') return;
      if (String(row[h['EntityType']] || '') !== 'VARequest') return;
      var changes = [];
      try { changes = JSON.parse(String(row[h['Notes']] || '[]')); } catch (e) {}
      var ts = row[h['Timestamp']];
      out.push({
        logId: String(row[h['LogID']] || ''),
        changedBy: String(row[h['ChangedBy']] || ''),
        changedAt: ts instanceof Date ? ts.toISOString() : String(ts || ''),
        changes: changes
      });
    });
    out.sort(function(a, b){ return new Date(b.changedAt || 0) - new Date(a.changedAt || 0); });
    return { success: true, data: out };
  } catch (e) {
    return { success: false, error: 'getRequestScheduleChanges: ' + e.message };
  }
}