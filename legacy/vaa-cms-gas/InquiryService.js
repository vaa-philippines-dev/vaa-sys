// InquiryService.gs — Concerns & Inquiries CRUD
// Root cause fix: updateInquiry and all related functions were called
// by Router.gs wrappers but never implemented. Every resolve/close
// silently errored out with no error shown to the user.

function _iqHMap(headerRow) {
  var h = {};
  for (var i = 0; i < headerRow.length; i++) {
    if (headerRow[i]) h[String(headerRow[i]).trim()] = i;
  }
  return h;
}

function _iqSD(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function getInquiries(filters) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
    if (!sheet) return { success: true, data: [] };
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _iqHMap(data[0]);

    // Customer/Account name lookups — this was previously missing
    // entirely, which is why the inquiries table's Customer/Account column
    // always showed blank.
    var custLookup = {}, cliLookup = {};
    try {
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var cd = custSheet.getDataRange().getValues();
        var ch = _iqHMap(cd[0]);
        for (var ci = 1; ci < cd.length; ci++) {
          if (cd[ci][ch['CustomerID']]) custLookup[String(cd[ci][ch['CustomerID']])] = String(cd[ci][ch['CustomerName']]||'');
        }
      }
      var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet) {
        var cld = cliSheet.getDataRange().getValues();
        var clh = _iqHMap(cld[0]);
        for (var cli = 1; cli < cld.length; cli++) {
          if (cld[cli][clh['ClientID']]) cliLookup[String(cld[cli][clh['ClientID']])] = String(cld[cli][clh['CompanyName']]||'') + (cld[cli][clh['AccountName']] ? ' — ' + String(cld[cli][clh['AccountName']]) : '');
        }
      }
    } catch (lookupEx) { Logger.log('getInquiries lookup build: ' + lookupEx.message); }

    // ConnectionID -> Department, for the "Related VA" department shown
    // in the ticket modal/table — Department lives on the Service
    // Request, not the connection itself, so this joins through it.
    var deptByConnId = {};
    try {
      var reqSheetForDept = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
      var deptByReqIdForDept = {};
      if (reqSheetForDept) {
        var reqDataForDept = reqSheetForDept.getDataRange().getValues();
        var reqHForDept = {}; reqDataForDept[0].forEach(function(c,i){ if(c) reqHForDept[String(c)]=i; });
        for (var rdi2 = 1; rdi2 < reqDataForDept.length; rdi2++) {
          var rdi2Id = String(reqDataForDept[rdi2][reqHForDept['RequestID']]||''); if (!rdi2Id) continue;
          deptByReqIdForDept[rdi2Id] = String(reqDataForDept[rdi2][reqHForDept['Department']]||'');
        }
      }
      var connSheetForDept = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
      if (connSheetForDept) {
        var connDataForDept = connSheetForDept.getDataRange().getValues();
        var connHForDept = {}; connDataForDept[0].forEach(function(c,i){ if(c) connHForDept[String(c)]=i; });
        for (var cdi = 1; cdi < connDataForDept.length; cdi++) {
          var cdiConnId = String(connDataForDept[cdi][connHForDept['ConnectionID']]||''); if (!cdiConnId) continue;
          var cdiReqId = String(connDataForDept[cdi][connHForDept['RequestID']]||'');
          deptByConnId[cdiConnId] = deptByReqIdForDept[cdiReqId] || '';
        }
      }
    } catch (deptLookupEx) { Logger.log('getInquiries deptByConnId build: ' + deptLookupEx.message); }

    // CS Specialists only see inquiries assigned to them. This is the
    // server-side backstop for the frontend's own scoping — that one is
    // UX-only and can be bypassed by calling this function directly, so
    // real enforcement has to live here. Scoped by the inquiry's own
    // AssignedTo field (not via customer assignment) since that's the
    // actual ownership record for a given inquiry.
    var scopeUser = getCurrentUser();
    var scopeMyEmail = (scopeUser && !scopeUser.error && scopeUser.role === CONFIG.ROLES.CS_SPECIALIST)
      ? (scopeUser.email || '').toLowerCase().trim() : null;
    var scopeTakeoverIds = scopeMyEmail ? getTakeoverCustomerIdsForSpecialist(scopeMyEmail) : [];

    // Service Manager only ever sees tickets for their own department.
    // Built from the set of client IDs with at least one VA connection in
    // that department — covers both VA-specific concerns and general
    // account-level concerns for that same account, not just tickets
    // that happen to name a specific VA.
    var serviceManagerDeptClients = null;
    if (scopeUser && !scopeUser.error && scopeUser.role === CONFIG.ROLES.SERVICE_MANAGER) {
      var smDept = (scopeUser.department || '').toLowerCase().trim();
      serviceManagerDeptClients = {};
      try {
        var reqSheetForIq = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
        var deptByReqForIq = {};
        if (reqSheetForIq) {
          var reqDataForIq = reqSheetForIq.getDataRange().getValues();
          var reqHForIq = {}; reqDataForIq[0].forEach(function(c,i){ if(c) reqHForIq[String(c)]=i; });
          for (var rqi = 1; rqi < reqDataForIq.length; rqi++) {
            var rqiId = String(reqDataForIq[rqi][reqHForIq['RequestID']]||''); if (!rqiId) continue;
            deptByReqForIq[rqiId] = String(reqDataForIq[rqi][reqHForIq['Department']]||'').toLowerCase().trim();
          }
        }
        var connSheetForIq = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
        if (connSheetForIq) {
          var connDataForIq = connSheetForIq.getDataRange().getValues();
          var connHForIq = {}; connDataForIq[0].forEach(function(c,i){ if(c) connHForIq[String(c)]=i; });
          for (var cni2 = 1; cni2 < connDataForIq.length; cni2++) {
            var cniReqId = String(connDataForIq[cni2][connHForIq['RequestID']]||'');
            if (deptByReqForIq[cniReqId] !== smDept) continue;
            var cniClientId = String(connDataForIq[cni2][connHForIq['ClientID']]||'');
            if (cniClientId) serviceManagerDeptClients[cniClientId] = true;
          }
        }
      } catch (iqDeptEx) { Logger.log('getInquiries Service Manager dept scope: ' + iqDeptEx.message); }
    }

    // Per the request — the Terminations list needs the connection's own TerminationDate for tickets
    // whose Actual Last Working Date was never filled in. Read from the VAConnections sheet once, the
    // first time a termination ticket needs it (not at all for other ticket types).
    var connTermById = null;
    var connTerminationDateFor = function(connectionId) {
      if (!connectionId) return '';
      if (connTermById === null) {
        connTermById = {};
        try {
          var cSheetT = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
          if (cSheetT && cSheetT.getLastRow() > 1) {
            var cdT = cSheetT.getDataRange().getValues();
            var chT = {}; cdT[0].forEach(function(c, i2){ if (c) chT[String(c).trim()] = i2; });
            if (chT['ConnectionID'] !== undefined && chT['TerminationDate'] !== undefined) {
              for (var ct = 1; ct < cdT.length; ct++) {
                var tv = cdT[ct][chT['TerminationDate']];
                if (tv) connTermById[String(cdT[ct][chT['ConnectionID']] || '').trim()] = _iqSD(tv);
              }
            }
          }
        } catch (ctEx) { Logger.log('getInquiries connection termination dates: ' + ctEx.message); }
      }
      return connTermById[String(connectionId).trim()] || '';
    };

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rec = {
        inquiryId:    String(row[h['InquiryID']]    || ''),
        subject:      String(row[h['Subject']]      || ''),
        inquiryType:  String(row[h['InquiryType']]  || ''),
        priority:     String(row[h['Priority']]     || ''),
        customerId:   String(row[h['CustomerID']]   || ''),
        clientId:     String(row[h['ClientID']]     || ''),
        contactName:  String(row[h['ContactName']]  || ''),
        contactEmail: String(row[h['ContactEmail']] || ''),
        status:       String(row[h['Status']]       || ''),
        resolution:   String(row[h['Resolution']]   || ''),
        closedReason: String(row[h['ClosedReason']] || ''),
        lostReason:   String(row[h['LostReason']]   || ''),
        assignedTo:   String(row[h['AssignedTo']]   || ''),
        ticketReportLink: h['TicketReportLink'] !== undefined ? String(row[h['TicketReportLink']] || '') : '',
        relatedVAId:   h['RelatedVAID']   !== undefined ? String(row[h['RelatedVAID']]   || '') : '',
        relatedVAName: h['RelatedVAName'] !== undefined ? String(row[h['RelatedVAName']] || '') : '',
        relatedVAIds:   h['RelatedVAIds']   !== undefined ? String(row[h['RelatedVAIds']]   || '') : '',
        relatedVANames: h['RelatedVANames'] !== undefined ? String(row[h['RelatedVANames']] || '') : '',
        department: h['Department'] !== undefined ? String(row[h['Department']] || '') : '',
        relatedVADepartment: deptByConnId[h['RelatedConnectionID'] !== undefined ? String(row[h['RelatedConnectionID']]||'') : ''] || '',
        relatedConnectionId: h['RelatedConnectionID'] !== undefined ? String(row[h['RelatedConnectionID']] || '') : '',
        terminationCause:    h['TerminationCause']     !== undefined ? String(row[h['TerminationCause']]     || '') : '',
        terminationOutcome:  h['TerminationOutcome']   !== undefined ? String(row[h['TerminationOutcome']]   || '') : '',
        csRetention:          h['CSRetention']          !== undefined ? String(row[h['CSRetention']]          || '') : '',
        securityConducted:    h['SecurityConducted']    !== undefined ? _toBool(row[h['SecurityConducted']]) : false,
        securityDate:         h['SecurityDate']         !== undefined ? _iqSD(row[h['SecurityDate']]) : '',
        vaExitCallConducted:  h['VAExitCallConducted']  !== undefined ? _toBool(row[h['VAExitCallConducted']]) : false,
        vaExitCallDate:       h['VAExitCallDate']       !== undefined ? _iqSD(row[h['VAExitCallDate']]) : '',
        targetTerminationDate:h['TargetTerminationDate']!== undefined ? _iqSD(row[h['TargetTerminationDate']]) : '',
        terminationReason:    h['TerminationReason']    !== undefined ? String(row[h['TerminationReason']]    || '') : '',
        linkedTerminationTicketId: h['LinkedTerminationTicketId'] !== undefined ? String(row[h['LinkedTerminationTicketId']] || '') : '',
        originatingInquiryId: h['OriginatingInquiryId'] !== undefined ? String(row[h['OriginatingInquiryId']] || '') : '',
        actualLastWorkingDate: h['ActualLastWorkingDate'] !== undefined ? String(row[h['ActualLastWorkingDate']] || '') : '',
        terminationStatusType: h['TerminationStatusType'] !== undefined ? String(row[h['TerminationStatusType']] || '') : '',
        escalatedToRequestId: h['EscalatedToRequestID'] !== undefined ? String(row[h['EscalatedToRequestID']] || '') : '',
        createdAt:    _iqSD(row[h['CreatedAt']]),
        createdBy:    String(row[h['CreatedBy']]    || ''),
        updatedAt:    _iqSD(row[h['UpdatedAt']]),
        updatedBy:    String(row[h['UpdatedBy']]    || ''),
        // The client's first message is stored in this column
        // (createInquiry writes payload.firstMessage here) — never
        // mapped back out before, which is why it always appeared to
        // vanish even though it was genuinely saved.
        notes:        String(row[h['Notes']]        || '')
      };
      if (serviceManagerDeptClients && !serviceManagerDeptClients[rec.clientId]) continue;
      if (!rec.inquiryId) continue;
      rec.customerName = custLookup[rec.customerId] || rec.customerId;
      rec.accountName  = cliLookup[rec.clientId]     || rec.clientId;
      if (scopeMyEmail && rec.assignedTo.toLowerCase().trim() !== scopeMyEmail && scopeTakeoverIds.indexOf(String(rec.customerId||'').trim()) === -1) continue;
      if (filters && filters.customerId && rec.customerId !== filters.customerId) continue;
      if (filters && filters.clientId   && rec.clientId   !== filters.clientId)   continue;
      if (filters && filters.status     && rec.status     !== filters.status)     continue;
      if (filters && filters.inquiryType && rec.inquiryType !== filters.inquiryType) continue;
      if (rec.inquiryType === 'Termination' && rec.relatedConnectionId) rec.connectionTerminationDate = connTerminationDateFor(rec.relatedConnectionId);
      rows.push(rec);
    }
    rows.sort(function(a,b){ return new Date(b.createdAt||0)-new Date(a.createdAt||0); });
    return { success: true, data: rows };
  } catch(e) { return { success: false, error: 'getInquiries: '+e.message }; }
}

// Single inquiry + its full conversation thread — getInquiryById previously
// only ever returned the bare inquiry record (via getInquiries().filter()),
// with no thread attached at all. That's why the ticket modal (and the full
// page view, which reads the same data) always showed an empty conversation
// log regardless of how many updates had actually been posted.
function getInquiryById(id) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
    if (!sheet) return { success: false, error: 'Inquiry not found: ' + id };
    var data = sheet.getDataRange().getValues();
    var h = _iqHMap(data[0]);

    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['InquiryID']]||'') === id) { rowIdx = i; break; }
    }
    if (rowIdx === -1) return { success: false, error: 'Inquiry not found: ' + id };
    var row = data[rowIdx];

    var rec = {
      inquiryId:    String(row[h['InquiryID']]    || ''),
      subject:      String(row[h['Subject']]      || ''),
      inquiryType:  String(row[h['InquiryType']]  || ''),
      priority:     String(row[h['Priority']]     || ''),
      customerId:   String(row[h['CustomerID']]   || ''),
      clientId:     String(row[h['ClientID']]     || ''),
      contactName:  String(row[h['ContactName']]  || ''),
      contactEmail: String(row[h['ContactEmail']] || ''),
      status:       String(row[h['Status']]       || ''),
      resolution:   String(row[h['Resolution']]   || ''),
      closedReason: String(row[h['ClosedReason']] || ''),
      lostReason:   String(row[h['LostReason']]   || ''),
      assignedTo:   String(row[h['AssignedTo']]   || ''),
      ticketReportLink: h['TicketReportLink'] !== undefined ? String(row[h['TicketReportLink']] || '') : '',
      relatedVAId:   h['RelatedVAID']   !== undefined ? String(row[h['RelatedVAID']]   || '') : '',
      relatedVAName: h['RelatedVAName'] !== undefined ? String(row[h['RelatedVAName']] || '') : '',
      relatedVAIds:   h['RelatedVAIds']   !== undefined ? String(row[h['RelatedVAIds']]   || '') : '',
      relatedVANames: h['RelatedVANames'] !== undefined ? String(row[h['RelatedVANames']] || '') : '',
      department: h['Department'] !== undefined ? String(row[h['Department']] || '') : '',
      relatedConnectionId: h['RelatedConnectionID'] !== undefined ? String(row[h['RelatedConnectionID']] || '') : '',
      terminationCause:    h['TerminationCause']     !== undefined ? String(row[h['TerminationCause']]     || '') : '',
      terminationOutcome:  h['TerminationOutcome']   !== undefined ? String(row[h['TerminationOutcome']]   || '') : '',
      csRetention:          h['CSRetention']          !== undefined ? String(row[h['CSRetention']]          || '') : '',
      securityConducted:    h['SecurityConducted']    !== undefined ? _toBool(row[h['SecurityConducted']]) : false,
      securityDate:         h['SecurityDate']         !== undefined ? _iqSD(row[h['SecurityDate']]) : '',
      vaExitCallConducted:  h['VAExitCallConducted']  !== undefined ? _toBool(row[h['VAExitCallConducted']]) : false,
      vaExitCallDate:       h['VAExitCallDate']       !== undefined ? _iqSD(row[h['VAExitCallDate']]) : '',
      targetTerminationDate:h['TargetTerminationDate']!== undefined ? _iqSD(row[h['TargetTerminationDate']]) : '',
      terminationReason:    h['TerminationReason']    !== undefined ? String(row[h['TerminationReason']]    || '') : '',
      linkedTerminationTicketId: h['LinkedTerminationTicketId'] !== undefined ? String(row[h['LinkedTerminationTicketId']] || '') : '',
      originatingInquiryId: h['OriginatingInquiryId'] !== undefined ? String(row[h['OriginatingInquiryId']] || '') : '',
      actualLastWorkingDate: h['ActualLastWorkingDate'] !== undefined ? String(row[h['ActualLastWorkingDate']] || '') : '',
      terminationStatusType: h['TerminationStatusType'] !== undefined ? String(row[h['TerminationStatusType']] || '') : '',
      escalatedToRequestId: h['EscalatedToRequestID'] !== undefined ? String(row[h['EscalatedToRequestID']] || '') : '',
      createdAt:    _iqSD(row[h['CreatedAt']]),
      createdBy:    String(row[h['CreatedBy']]    || ''),
      updatedAt:    _iqSD(row[h['UpdatedAt']]),
      updatedBy:    String(row[h['UpdatedBy']]    || ''),
      notes:        String(row[h['Notes']]        || '')
    };

    // Targeted lookups for just this one record's Customer/Account name
    // and its related connection's department — not full maps built for
    // every record in the system, the way getInquiries() needs to for a
    // whole-table view.
    rec.customerName = rec.customerId;
    if (rec.customerId) {
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var cd = custSheet.getDataRange().getValues();
        var ch = _iqHMap(cd[0]);
        for (var ci = 1; ci < cd.length; ci++) {
          if (String(cd[ci][ch['CustomerID']]||'') !== rec.customerId) continue;
          rec.customerName = String(cd[ci][ch['CustomerName']]||'') || rec.customerId;
          break;
        }
      }
    }
    rec.accountName = rec.clientId;
    if (rec.clientId) {
      var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet) {
        var cld = cliSheet.getDataRange().getValues();
        var clh = _iqHMap(cld[0]);
        for (var cli = 1; cli < cld.length; cli++) {
          if (String(cld[cli][clh['ClientID']]||'') !== rec.clientId) continue;
          rec.accountName = String(cld[cli][clh['CompanyName']]||'') + (cld[cli][clh['AccountName']] ? ' — ' + String(cld[cli][clh['AccountName']]) : '');
          break;
        }
      }
    }
    rec.relatedVADepartment = '';
    if (rec.relatedConnectionId) {
      var connSheetForDept = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
      if (connSheetForDept) {
        var connDataForDept = connSheetForDept.getDataRange().getValues();
        var connHForDept = {}; connDataForDept[0].forEach(function(c,i){ if(c) connHForDept[String(c)]=i; });
        var relatedReqId = '';
        for (var cdi = 1; cdi < connDataForDept.length; cdi++) {
          if (String(connDataForDept[cdi][connHForDept['ConnectionID']]||'') !== rec.relatedConnectionId) continue;
          relatedReqId = String(connDataForDept[cdi][connHForDept['RequestID']]||'');
          break;
        }
        if (relatedReqId) {
          var reqSheetForDept = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
          if (reqSheetForDept) {
            var reqDataForDept = reqSheetForDept.getDataRange().getValues();
            var reqHForDept = {}; reqDataForDept[0].forEach(function(c,i){ if(c) reqHForDept[String(c)]=i; });
            for (var rdi = 1; rdi < reqDataForDept.length; rdi++) {
              if (String(reqDataForDept[rdi][reqHForDept['RequestID']]||'') !== relatedReqId) continue;
              rec.relatedVADepartment = String(reqDataForDept[rdi][reqHForDept['Department']]||'');
              break;
            }
          }
        }
      }
    }

    // Same access enforcement as getInquiries(), applied to just this one
    // record instead of scanning every connection/request in the system
    // to build a scoping map. CS Specialist: must be the assigned owner
    // or covering this customer via an active takeover. Service Manager:
    // must have at least one VA connection for this inquiry's account in
    // their own department.
    var scopeUser = getCurrentUser();
    if (scopeUser && !scopeUser.error && scopeUser.role === CONFIG.ROLES.CS_SPECIALIST) {
      var myEmail = (scopeUser.email||'').toLowerCase().trim();
      var isOwnInquiry = rec.assignedTo.toLowerCase().trim() === myEmail;
      var isTakenOver = getTakeoverCustomerIdsForSpecialist(myEmail).indexOf(rec.customerId) !== -1;
      if (!isOwnInquiry && !isTakenOver) return { success: false, error: 'Inquiry not found: ' + id };
    } else if (scopeUser && !scopeUser.error && scopeUser.role === CONFIG.ROLES.SERVICE_MANAGER) {
      var smDept = (scopeUser.department||'').toLowerCase().trim();
      var hasDeptConnection = false;
      if (rec.clientId) {
        var connSheetForSM = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
        if (connSheetForSM) {
          var connDataForSM = connSheetForSM.getDataRange().getValues();
          var connHForSM = {}; connDataForSM[0].forEach(function(c,i){ if(c) connHForSM[String(c)]=i; });
          var reqSheetForSM = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
          var deptByReqForSM = {};
          if (reqSheetForSM) {
            var reqDataForSM = reqSheetForSM.getDataRange().getValues();
            var reqHForSM = {}; reqDataForSM[0].forEach(function(c,i){ if(c) reqHForSM[String(c)]=i; });
            for (var rqi = 1; rqi < reqDataForSM.length; rqi++) {
              var rqiId = String(reqDataForSM[rqi][reqHForSM['RequestID']]||''); if (!rqiId) continue;
              deptByReqForSM[rqiId] = String(reqDataForSM[rqi][reqHForSM['Department']]||'').toLowerCase().trim();
            }
          }
          for (var cni = 1; cni < connDataForSM.length; cni++) {
            if (String(connDataForSM[cni][connHForSM['ClientID']]||'') !== rec.clientId) continue;
            var cniReqId = String(connDataForSM[cni][connHForSM['RequestID']]||'');
            if (deptByReqForSM[cniReqId] === smDept) { hasDeptConnection = true; break; }
          }
        }
      }
      if (!hasDeptConnection) return { success: false, error: 'Inquiry not found: ' + id };
    }

    var updatesRes = getInquiryUpdates(id);
    rec.thread = (updatesRes && updatesRes.success) ? updatesRes.data : [];
    return { success: true, data: rec };
  } catch(e) { return { success: false, error: 'getInquiryById: ' + e.message }; }
}

function createInquiry(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success:false, error:'Permission denied.' };
    if (!payload||!payload.subject) return { success:false, error:'Subject is required.' };
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, CONFIG.SHEETS.INQUIRIES, CONFIG.SCHEMA.Inquiries);
    // Self-heal any columns the live sheet is missing (e.g. added to the
    // schema after this sheet already existed) — _ensureSheet alone only
    // ever writes the full header row for a brand-new sheet, so an
    // existing sheet missing a newer column (like Notes) would otherwise
    // silently swallow that field's write below.
    _migrateSheetColumns(ss, CONFIG.SHEETS.INQUIRIES, CONFIG.SCHEMA.Inquiries);
    var id    = generateID('IQ');
    var now   = new Date();
    var data  = sheet.getDataRange().getValues();
    var h     = _iqHMap(data[0]);
    var row   = new Array(data[0].length).fill('');
    function s(col,val){ if(h[col]!==undefined) row[h[col]]=val; }
    s('InquiryID',    id);
    s('Subject',      payload.subject      || '');
    s('InquiryType',  payload.inquiryType  || '');
    s('Priority',     payload.priority     || 'Medium');
    s('CustomerID',   payload.customerId   || '');
    s('ClientID',     payload.clientId     || '');
    s('ContactName',  payload.contactName  || '');
    s('ContactEmail', payload.contactEmail || '');
    s('Status',       payload.status       || CONFIG.INQUIRY_STATUS.OPEN);
    s('Resolution',   '');
    s('AssignedTo',   payload.assignedTo   || perm.user.email);
    s('TicketReportLink', payload.ticketReportLink || '');
    var relatedVAIdsArr = Array.isArray(payload.relatedVAIds) ? payload.relatedVAIds.filter(Boolean) : [];
    var relatedVANamesArr = Array.isArray(payload.relatedVANames) ? payload.relatedVANames.filter(Boolean) : [];
    s('RelatedVAID',   relatedVAIdsArr.length   ? relatedVAIdsArr[0]   : (payload.relatedVAId   || ''));
    s('RelatedVAName', relatedVANamesArr.length ? relatedVANamesArr[0] : (payload.relatedVAName || ''));
    s('RelatedVAIds',   relatedVAIdsArr.join(','));
    s('RelatedVANames', relatedVANamesArr.join(', '));
    s('Department', payload.department || '');
    s('RelatedConnectionID', payload.relatedConnectionId || '');
    s('TerminationCause',    payload.terminationCause    || '');
    s('TerminationOutcome',  payload.terminationOutcome  || '');
    s('CSRetention',         payload.csRetention          || '');
    s('SecurityConducted',   !!payload.securityConducted);
    s('SecurityDate',        payload.securityDate         || '');
    s('VAExitCallConducted', !!payload.vaExitCallConducted);
    s('VAExitCallDate',      payload.vaExitCallDate       || '');
    s('TargetTerminationDate', payload.targetTerminationDate || '');
    s('TerminationReason',   payload.terminationReason    || '');
    s('ActualLastWorkingDate', payload.actualLastWorkingDate || '');
    s('TerminationStatusType', payload.terminationStatusType || '');
    // The ticket modal's timeline displays the Notes column specifically
    // as the client's own first message (senderType: 'client') — so
    // that's what belongs here, not the separate internal-notes field.
    s('Notes',        payload.firstMessage || '');
    s('CreatedAt',    now);
    s('CreatedBy',    perm.user.email);
    s('UpdatedAt',    now);
    s('UpdatedBy',    perm.user.email);
    sheet.appendRow(row);
    _writeLog('Inquiry',id,'CREATE','New inquiry','',payload.subject,perm.user);

    if (payload.inquiryType === 'Termination' && payload.relatedConnectionId) {
      try {
        var connSheetForTerm = _connGetSheet(ss);
        var connDataForTerm = connSheetForTerm.getDataRange().getValues();
        var connHForTerm = _connHMap(connDataForTerm[0]);
        for (var cti = 1; cti < connDataForTerm.length; cti++) {
          if (String(connDataForTerm[cti][connHForTerm['ConnectionID']]||'') !== payload.relatedConnectionId) continue;
          if (connHForTerm['TerminationRequestedBy'] !== undefined) connSheetForTerm.getRange(cti+1, connHForTerm['TerminationRequestedBy']+1).setValue(perm.user.email);
          if (connHForTerm['TerminationRequestedAt'] !== undefined) connSheetForTerm.getRange(cti+1, connHForTerm['TerminationRequestedAt']+1).setValue(now);
          if (connHForTerm['TerminationRequestedDate'] !== undefined) connSheetForTerm.getRange(cti+1, connHForTerm['TerminationRequestedDate']+1).setValue(payload.targetTerminationDate || '');
          if (connHForTerm['TerminationRequestReason'] !== undefined) connSheetForTerm.getRange(cti+1, connHForTerm['TerminationRequestReason']+1).setValue(payload.terminationReason || '');
          break;
        }
      } catch (termLinkEx) { Logger.log('createInquiry pending-termination link: ' + termLinkEx.message); }
    }
    // The separate internal-notes field (distinct from the client's first
    // message above) is preserved as its own internal thread entry, so
    // it isn't silently dropped.
    if (payload.notes) {
      try { addInquiryUpdateV2(id, { content: payload.notes, senderType: 'Internal', messageType: 'Note' }); }
      catch (noteEx) { Logger.log('createInquiry internal note: ' + noteEx.message); }
    }
    return { success:true, inquiryId:id };
  } catch(e){ return { success:false, error:'createInquiry: '+e.message }; }
}

// THE MISSING FUNCTION — this is what caused the resolve-not-saving bug
function createTerminationTicketFromConcern(concernInquiryId, connectionId, replacementRequestId, extraFields) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!connectionId) return { success: false, error: 'A related VA Connection is required.' };

    var connRes = getVAConnectionById(connectionId);
    if (!connRes || !connRes.success) return { success: false, error: 'Could not load the related VA Connection.' };
    var conn = connRes.data;
    extraFields = extraFields || {};

    var termPayload = {
      subject: 'Termination — ' + (conn.vaName || connectionId),
      inquiryType: 'Termination',
      priority: 'High',
      customerId: conn.customerId || '',
      clientId: conn.clientId || '',
      assignedTo: conn.csAssignedEmail || '',
      relatedVAId: conn.vaId || '',
      relatedVAName: conn.vaName || '',
      relatedConnectionId: connectionId,
      escalatedToRequestId: replacementRequestId || '',
      originatingInquiryId: concernInquiryId || '',
      // Per the request — defaults to "Client Initiated" when this
      // termination is being raised from a Concern ticket, since that's
      // the far more common scenario for this specific path (a client
      // raised a concern that led here), while still honoring an
      // explicit override if one was given.
      terminationCause: extraFields.terminationCause || (concernInquiryId ? 'Client Initiated' : ''),
      targetTerminationDate: extraFields.targetTerminationDate || '',
      actualLastWorkingDate: extraFields.actualLastWorkingDate || '',
      firstMessage: concernInquiryId
        ? 'Auto-created — a replacement was requested from Concern ticket ' + concernInquiryId + '.'
        : 'Termination raised directly' + (extraFields.terminationCause ? ' — ' + extraFields.terminationCause : '') + '.'
    };
    var createRes = createInquiry(termPayload);
    if (!createRes || !createRes.success) return createRes;

    // Link the originating Concern ticket back to this new Termination
    // ticket too, per the request — cross-linked in both directions —
    // and per the restructuring, its own status becomes Escalated the
    // moment a termination exists for it.
    if (concernInquiryId) {
      try { updateInquiry(concernInquiryId, { linkedTerminationTicketId: createRes.inquiryId, status: CONFIG.INQUIRY_STATUS.ESCALATED }); }
      catch (linkEx) { Logger.log('createTerminationTicketFromConcern link-back: ' + linkEx.message); }
    }

    return { success: true, inquiryId: createRes.inquiryId };
  } catch (e) {
    return { success: false, error: 'createTerminationTicketFromConcern: ' + e.message };
  }
}

// Computes a termination's TerminationStatusType automatically, per the
// restructuring — never set directly, always derived from the
// termination's own linked connection/origin/replacement state. Called
// both when the termination itself is saved, and separately whenever
// its linked replacement request's own status changes later (see the
// hook in VARequestService.gs/WorkflowService.gs close-cascade logic),
// since a replacement failing after the fact needs this reclassified
// from Replace back to Remove even though the termination itself isn't
// being edited at that moment.
function _iqComputeTerminationStatusType(terminationRow) {
  try {
    var T = CONFIG.TERMINATION_STATUS_TYPE;
    var connId = terminationRow.relatedConnectionId || '';
    if (connId) {
      var connRes = getVAConnectionById(connId);
      if (connRes && connRes.success && connRes.data && connRes.data.connectionType === 'Project Based') {
        return T.END_OF_PROJECT;
      }
    }
    var originId = terminationRow.originatingInquiryId || '';
    if (!originId) return T.END_OF_CONTRACT;

    var replacementReqId = terminationRow.escalatedToRequestId || '';
    if (!replacementReqId) return T.REMOVE;

    var reqRes = getVARequestById(replacementReqId);
    var replacementAccepted = reqRes && reqRes.success && reqRes.data && reqRes.data.status === CONFIG.VA_REQUEST_STATUS.CLOSED_WON;
    return replacementAccepted ? T.REPLACE : T.REMOVE;
  } catch (e) {
    Logger.log('_iqComputeTerminationStatusType: ' + e.message);
    return '';
  }
}

function updateInquiry(id, payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success:false, error:'Permission denied.' };
    if (!id) return { success:false, error:'Inquiry ID is required.' };
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
    if (!sheet) return { success:false, error:'Inquiries sheet not found.' };
    var data  = sheet.getDataRange().getValues();
    var h     = _iqHMap(data[0]);
    for (var i=1; i<data.length; i++) {
      if (String(data[i][h['InquiryID']]||'').trim() !== id) continue;
      var rowNum = i+1;
      var now    = new Date();

      // For Termination-type inquiries, the outcome is what actually
      // determines Status — Cancelled and Changed to Replacement both
      // resolve the underlying concern, Pushed Through means the
      // connection actually ended. This takes precedence over any
      // explicitly-passed status when an outcome is being set, since the
      // outcome is the definitive signal here.
      if (payload.terminationOutcome) {
        var O = CONFIG.TERMINATION_OUTCOME;
        if (payload.terminationOutcome === O.CANCELLED || payload.terminationOutcome === O.CHANGED_TO_REPLACEMENT) {
          payload.status = CONFIG.INQUIRY_STATUS.CLOSED_WON;
        } else if (payload.terminationOutcome === O.PUSHED_THROUGH) {
          // Per the request — if a linked Replacement request exists and
          // is still in progress, this ticket stays open rather than
          // closing immediately. It only closes once there's no
          // replacement to wait on, or that replacement has already
          // resolved (Won or Closed Lost) on its own.
          var replacementStillOpen = false;
          try {
            var escalatedToReqId = h['EscalatedToRequestID'] !== undefined ? String(data[i][h['EscalatedToRequestID']]||'') : '';
            if (escalatedToReqId) {
              var linkedReqRes = getVARequestById(escalatedToReqId);
              if (linkedReqRes.success && linkedReqRes.data) {
                var linkedStatus = String(linkedReqRes.data.status||'');
                replacementStillOpen = linkedStatus !== 'Won' && linkedStatus !== 'Closed - Lost';
              }
            }
          } catch (replCheckEx) { Logger.log('updateInquiry replacement-still-open check: ' + replCheckEx.message); }

          if (!replacementStillOpen) {
            payload.status = CONFIG.INQUIRY_STATUS.CLOSED_LOST;
          }
          // Per the request — cascades to the actual VA Connection once
          // the termination is confirmed as actually happening, rather
          // than this ticket's own outcome/status being the only thing
          // that changes. The Target Termination Date was only ever the
          // plan going in; the connection's own TerminationDate needs
          // the real date, which the closing user can override here —
          // falling back to today if they don't.
          try {
            var relatedConnIdForCascade = h['RelatedConnectionID'] !== undefined ? String(data[i][h['RelatedConnectionID']]||'') : '';
            if (relatedConnIdForCascade) {
              var reasonForCascade = payload.terminationReason || (h['TerminationReason'] !== undefined ? String(data[i][h['TerminationReason']]||'') : '');
              var actualDateForCascade = payload.actualTerminationDate || new Date();
              terminateVAConnection(relatedConnIdForCascade, actualDateForCascade, reasonForCascade, '', 'Terminated', true);
            }
          } catch (cascadeEx) { Logger.log('updateInquiry termination cascade: ' + cascadeEx.message); }
        }

        // Reopens/closes the originating Concern to match this outcome
        // — see _iqCascadeToOriginatingConcern for why this is needed.
        // Read from the row's existing OriginatingInquiryId BEFORE the
        // colMap writes below, though that column isn't touched by this
        // update anyway, so read order doesn't actually matter here —
        // kept alongside the other termination-outcome cascades above
        // for readability, all three fire from this same one spot.
        try {
          var originatingInquiryIdForCascade = h['OriginatingInquiryId'] !== undefined ? String(data[i][h['OriginatingInquiryId']]||'') : '';
          _iqCascadeToOriginatingConcern(sheet, data, h, originatingInquiryIdForCascade, payload.terminationOutcome, perm.user);
        } catch (concernCascadeEx) { Logger.log('updateInquiry concern cascade: ' + concernCascadeEx.message); }
      }

      var colMap = {
        status:'Status', resolution:'Resolution', lostReason:'LostReason',
        closedReason:'ClosedReason', assignedTo:'AssignedTo',
        priority:'Priority', subject:'Subject', inquiryType:'InquiryType',
        ticketReportLink:'TicketReportLink',
        relatedVAId:'RelatedVAID', relatedVAName:'RelatedVAName',
        relatedConnectionId:'RelatedConnectionID', terminationCause:'TerminationCause',
        terminationOutcome:'TerminationOutcome',
        csRetention:'CSRetention',
        securityConducted:'SecurityConducted', securityDate:'SecurityDate',
        vaExitCallConducted:'VAExitCallConducted', vaExitCallDate:'VAExitCallDate',
        targetTerminationDate:'TargetTerminationDate', terminationReason:'TerminationReason',
        linkedTerminationTicketId:'LinkedTerminationTicketId',
        actualLastWorkingDate:'ActualLastWorkingDate', terminationStatusType:'TerminationStatusType'
      };
      Object.keys(colMap).forEach(function(key){
        var col=colMap[key];
        if (payload[key]!==undefined&&payload[key]!==null&&h[col]!==undefined)
          sheet.getRange(rowNum,h[col]+1).setValue(payload[key]);
      });
      if (h['UpdatedAt']!==undefined) sheet.getRange(rowNum,h['UpdatedAt']+1).setValue(now);
      if (h['UpdatedBy']!==undefined) sheet.getRange(rowNum,h['UpdatedBy']+1).setValue(perm.user.email);
      _writeLog('Inquiry',id,'UPDATE','Fields updated',
        String(data[i][h['Status']]||''),payload.status||'',perm.user);
      return { success:true };
    }
    return { success:false, error:'Inquiry not found: '+id };
  } catch(e){ return { success:false, error:'updateInquiry: '+e.message }; }
}

// Finds and closes any inquiry escalated into the given Service Request
// — called from both closing paths (Won when the VA started, Lost when
// the request closed Lost) in VARequestService.gs. Silently does nothing
// if no inquiry was ever escalated into this request.
function _closeLinkedInquiry(requestId, outcome, user) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _ensureSheet(ss, 'Inquiries', CONFIG.SCHEMA.Inquiries);
  var data = sheet.getDataRange().getValues();
  var h = _iqHMap(data[0]);
  if (h['EscalatedToRequestID'] === undefined) return;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['EscalatedToRequestID']]||'') !== requestId) continue;
    var inquiryId = String(data[i][h['InquiryID']]||''); if (!inquiryId) continue;

    // Termination tickets also use this same field, to link to their
    // own replacement request — per the restructuring, they're excluded
    // from this generic Won/Lost close entirely, since they have their
    // own, careful outcome-driven cascade that this would otherwise
    // silently overwrite.
    var inquiryTypeForLink = h['InquiryType'] !== undefined ? String(data[i][h['InquiryType']]||'') : '';
    if (inquiryTypeForLink === 'Termination') {
      try { _iqRecheckTerminationAfterReplacementChange(sheet, data, h, i); }
      catch (recheckEx) { Logger.log('_closeLinkedInquiry termination recheck: ' + recheckEx.message); }
      continue;
    }

    var currentStatus = String(data[i][h['Status']]||'');
    if (currentStatus === CONFIG.INQUIRY_STATUS.CLOSED_WON || currentStatus === CONFIG.INQUIRY_STATUS.CLOSED_LOST) continue;
    var note = outcome === 'Lost'
      ? 'Automatically closed — the linked Service Request (' + requestId + ') was closed as Lost.'
      : 'Automatically closed — the linked Service Request (' + requestId + ') is now underway (VA started).';
    closeInquiry(inquiryId, outcome === 'Lost' ? 'lost' : 'won', '', note);
  }
}

// Per the restructuring — re-derives a termination's TerminationStatusType
// after its linked replacement request's own status changes (row index
// termRowIdx is already known from the caller's own scan above, so this
// re-reads only that one row rather than re-scanning). If the
// termination had already been accepted (already closed, its connection
// already terminated), and its classification changes as a result
// (typically Replace reverting to Remove because the replacement fell
// through), this also re-cascades to the originating Concern ticket —
// which needs to move from "resolved" to "unresolved" even though the
// termination itself isn't being actively edited at this moment.
function _iqRecheckTerminationAfterReplacementChange(sheet, data, h, termRowIdx) {
  var termInquiryId = String(data[termRowIdx][h['InquiryID']]||''); if (!termInquiryId) return;
  var termRowForCompute = {
    relatedConnectionId: h['RelatedConnectionID'] !== undefined ? String(data[termRowIdx][h['RelatedConnectionID']]||'') : '',
    originatingInquiryId: h['OriginatingInquiryId'] !== undefined ? String(data[termRowIdx][h['OriginatingInquiryId']]||'') : '',
    escalatedToRequestId: h['EscalatedToRequestID'] !== undefined ? String(data[termRowIdx][h['EscalatedToRequestID']]||'') : ''
  };
  var newType = _iqComputeTerminationStatusType(termRowForCompute);
  var oldType = h['TerminationStatusType'] !== undefined ? String(data[termRowIdx][h['TerminationStatusType']]||'') : '';
  if (h['TerminationStatusType'] !== undefined) {
    sheet.getRange(termRowIdx + 1, h['TerminationStatusType'] + 1).setValue(newType);
  }

  var termOutcome = h['TerminationOutcome'] !== undefined ? String(data[termRowIdx][h['TerminationOutcome']]||'') : '';
  var wasAccepted = termOutcome === CONFIG.TERMINATION_OUTCOME.PUSHED_THROUGH;
  var typeChanged = newType !== oldType;
  var originId = termRowForCompute.originatingInquiryId;
  if (wasAccepted && typeChanged && originId) {
    var newConcernStatus = (newType === CONFIG.TERMINATION_STATUS_TYPE.REPLACE)
      ? CONFIG.INQUIRY_STATUS.CLOSED_WON
      : CONFIG.INQUIRY_STATUS.CLOSED_LOST;
    // The Concern may already be Closed one way — this re-cascade needs
    // to actually override it in this specific case (unlike the normal
    // Escalated-only guard in _iqCascadeToOriginatingConcern), since the
    // whole point here is correcting an outcome that already landed on
    // the wrong side.
    for (var oi = 1; oi < data.length; oi++) {
      if (String(data[oi][h['InquiryID']]||'').trim() !== originId) continue;
      sheet.getRange(oi + 1, h['Status'] + 1).setValue(newConcernStatus);
      sheet.getRange(oi + 1, h['UpdatedAt'] + 1).setValue(new Date());
      break;
    }
  }
}

// Reopens or closes the originating Concern ticket the moment a
// Termination ticket's own outcome is set — the counterpart to
// _iqRecheckTerminationAfterReplacementChange above (which reacts to a
// LATER change in a replacement's status; this is the FIRST cascade,
// fired the instant Retract/Accept happens). Without this, a Concern
// that was escalated into a Termination ticket is left permanently
// stuck at "Escalated" with no next action once that termination
// resolves — which is exactly what was being reported as "Retract
// Termination doesn't work": the button does close the termination
// ticket, but the Concern it came from is left frozen, so nothing about
// the situation visibly changes for the person who reported it.
//
// Guarded to only act while the Concern is still sitting at Escalated —
// the state createTerminationTicketFromConcern puts it in. If a person
// already moved the Concern somewhere else manually, this leaves that
// decision alone rather than silently overriding it.
function _iqCascadeToOriginatingConcern(sheet, data, h, originatingInquiryId, outcome, user) {
  if (!originatingInquiryId) return;
  var O = CONFIG.TERMINATION_OUTCOME;
  // Retracted — the termination didn't happen, so the Concern that
  // raised it is still an open, unresolved situation; reopen it.
  // Pushed Through — the termination went ahead, so the Concern's
  // underlying issue ended in the VA leaving rather than being
  // resolved; close it as Unresolved rather than leaving it open.
  var newConcernStatus =
    outcome === O.CANCELLED      ? CONFIG.INQUIRY_STATUS.OPEN :
    outcome === O.PUSHED_THROUGH ? CONFIG.INQUIRY_STATUS.CLOSED_LOST :
    null;
  if (!newConcernStatus) return;
  for (var oi = 1; oi < data.length; oi++) {
    if (String(data[oi][h['InquiryID']]||'').trim() !== originatingInquiryId) continue;
    var concernStatus = String(data[oi][h['Status']]||'');
    if (concernStatus !== CONFIG.INQUIRY_STATUS.ESCALATED) return;
    sheet.getRange(oi + 1, h['Status'] + 1).setValue(newConcernStatus);
    if (h['UpdatedAt'] !== undefined) sheet.getRange(oi + 1, h['UpdatedAt'] + 1).setValue(new Date());
    if (h['UpdatedBy'] !== undefined && user && user.email) sheet.getRange(oi + 1, h['UpdatedBy'] + 1).setValue(user.email);
    return;
  }
}

// Links an inquiry to a Service Request it was escalated into — called
// right after that request is successfully created from within the
// escalation flow. Closing the request later (Won or Lost) automatically
// closes this inquiry too, via _closeLinkedInquiry.
function escalateInquiryToRequest(inquiryId, requestId) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, CONFIG.SHEETS.INQUIRIES, CONFIG.SCHEMA.Inquiries);
    var data = sheet.getDataRange().getValues();
    var h = _iqHMap(data[0]);
    if (h['EscalatedToRequestID'] === undefined) return { success: false, error: 'EscalatedToRequestID column not found — run initializeSystem() to add it.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['InquiryID']]) !== inquiryId) continue;
      sheet.getRange(i+1, h['EscalatedToRequestID']+1).setValue(requestId);
      _writeLog('Inquiry', inquiryId, 'UPDATE', 'EscalatedToRequestID', '', requestId, perm.user);
      addInquiryUpdate(inquiryId, 'Escalated to Service Request ' + requestId + '.');
      return { success: true };
    }
    return { success: false, error: 'Inquiry not found.' };
  } catch (e) {
    return { success: false, error: 'escalateInquiryToRequest: ' + e.message };
  }
}

function closeInquiry(id,outcome,reason,note) {
  var st=(outcome==='lost')?CONFIG.INQUIRY_STATUS.CLOSED_LOST:CONFIG.INQUIRY_STATUS.CLOSED_WON;
  return updateInquiry(id,{status:st,resolution:note||'',lostReason:reason||''});
}

function reopenInquiry(id) {
  return updateInquiry(id,{status:CONFIG.INQUIRY_STATUS.OPEN,resolution:'',lostReason:''});
}

function addInquiryUpdate(id,content) {
  return addInquiryUpdateV2(id,{content:content,messageType:'Note'});
}

function addInquiryUpdateV2(id,payload) {
  try {
    var perm=checkPermission('edit');
    if (!perm.allowed) return {success:false,error:'Permission denied.'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sheet=_ensureSheet(ss,'InquiryUpdates',CONFIG.SCHEMA.InquiryUpdates);
    var uid=generateID('IQU');
    var now=new Date();
    var data=sheet.getDataRange().getValues();
    var h=_iqHMap(data[0]);
    var row=new Array(data[0].length).fill('');
    function s(col,val){if(h[col]!==undefined)row[h[col]]=val;}
    s('UpdateID',uid); s('InquiryID',id);
    s('AuthorEmail',perm.user.email); s('AuthorName',perm.user.name||perm.user.email);
    s('SenderType',payload.senderType||'Internal');
    s('MessageType',payload.messageType||'Note');
    s('Content',payload.content||'');
    s('StatusChange',payload.statusChange||'');
    s('PostedAt',now); s('CreatedAt',now);
    sheet.appendRow(row);
    if (payload.statusChange) updateInquiry(id,{status:payload.statusChange});
    return {success:true,updateId:uid};
  } catch(e){return {success:false,error:'addInquiryUpdateV2: '+e.message};}
}

function getInquiryUpdates(inquiryId) {
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sheet=ss.getSheetByName('InquiryUpdates');
    if (!sheet) return {success:true,data:[]};
    var data=sheet.getDataRange().getValues();
    if (data.length<2) return {success:true,data:[]};
    var h=_iqHMap(data[0]);
    var rows=[];
    for (var i=1;i<data.length;i++){
      if (String(data[i][h['InquiryID']]||'')!==inquiryId) continue;
      rows.push({
        updateId:String(data[i][h['UpdateID']]||''),
        inquiryId:inquiryId,
        authorEmail:String(data[i][h['AuthorEmail']]||''),
        authorName:String(data[i][h['AuthorName']]||''),
        senderType:String(data[i][h['SenderType']]||''),
        messageType:String(data[i][h['MessageType']]||''),
        content:String(data[i][h['Content']]||''),
        statusChange:String(data[i][h['StatusChange']]||''),
        postedAt:_iqSD(data[i][h['PostedAt']]),
        createdAt:_iqSD(data[i][h['CreatedAt']])
      });
    }
    rows.sort(function(a,b){return new Date(a.postedAt||0)-new Date(b.postedAt||0);});
    return {success:true,data:rows};
  } catch(e){return {success:false,error:'getInquiryUpdates: '+e.message};}
}

function updateInquiryUpdate(updateId,payload) {
  try {
    var perm=checkPermission('edit');
    if (!perm.allowed) return {success:false,error:'Permission denied.'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sheet=ss.getSheetByName('InquiryUpdates');
    if (!sheet) return {success:false,error:'InquiryUpdates sheet not found.'};
    var data=sheet.getDataRange().getValues();
    var h=_iqHMap(data[0]);
    for (var i=1;i<data.length;i++){
      if (String(data[i][h['UpdateID']]||'')!==updateId) continue;
      if (payload.content!==undefined&&h['Content']!==undefined)
        sheet.getRange(i+1,h['Content']+1).setValue(payload.content);
      return {success:true};
    }
    return {success:false,error:'Update not found: '+updateId};
  } catch(e){return {success:false,error:'updateInquiryUpdate: '+e.message};}
}