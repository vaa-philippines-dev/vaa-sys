// ═══════════════════════════════════════════════════════════════════════
// KICK OFF CALL SUB-PROCESS
// ═══════════════════════════════════════════════════════════════════════
// A sub-process inside the Kick Off Call workflow stage. Every VA
// Assignment candidate that reaches Rate Agreement gets their own Kick
// Off Call record here — logged with when the kickoff call itself
// happened, and when the VA-Client Connection Call is targeted for.
// Approve/Decline/Cancel is normally done by the CS Specialist assigned
// to the customer; for a Replacement request specifically, it's the CS
// Manager instead. Declining loops the request back so a different
// candidate can be designated Final VA and go through their own Rate
// Agreement + Kick Off Call.

var KICKOFF_RESULT = { APPROVED: 'Approved', DECLINED: 'Declined', CANCELLED: 'Cancelled' };

function _kickoffGetSheet(ss) {
  return _ensureSheet(ss, 'VAKickoffCalls', CONFIG.SCHEMA.VAKickoffCalls);
}

// Who is allowed to resolve (approve/decline/cancel) a kickoff call for a
// given request — the assigned CS Specialist normally, or CS Manager
// specifically when the request is a Replacement. Administrator can
// always act as an override, matching the pattern used elsewhere in this
// app for every other approval-style gate.
function _kickoffCanResolve(requestType, user, assignedSpecialistEmail, customerId) {
  if (!user || user.error) return false;
  if (user.role === CONFIG.ROLES.ADMINISTRATOR) return true;
  if (requestType === 'Replacement') return user.role === CONFIG.ROLES.CS_MANAGER;
  if (user.role === CONFIG.ROLES.CS_MANAGER) return true; // CS Manager can always act, not just for Replacement
  if (user.role !== CONFIG.ROLES.CS_SPECIALIST) return false;
  var myEmail = (user.email||'').toLowerCase().trim();
  if ((assignedSpecialistEmail||'').toLowerCase().trim() === myEmail) return true; // own customer
  return customerId && getTakeoverCustomerIdsForSpecialist(myEmail).indexOf(customerId) !== -1;
}

// Logs a new Kick Off Call for a specific VA candidate/connection — the
// candidate must already be the request's designated Final VA (mirrors
// the same Final VA requirement markVAPrepDone already enforces before
// Rate Agreement).
function createKickoffCall(requestId, connectionId, kickoffDateTime, vaConnCallTargetDate) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (!kickoffDateTime) return { success: false, error: 'Kickoff call date/time is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var connH = _connHMap(connData[0]);
    var vaId = '', vaName = '', isFinalVA = false;
    for (var i = 1; i < connData.length; i++) {
      if (String(connData[i][connH['ConnectionID']]) !== connectionId) continue;
      vaId = String(connData[i][connH['VAID']]||'');
      vaName = String(connData[i][connH['VAName']]||'');
      isFinalVA = connH['IsFinalVA'] !== undefined && !!connData[i][connH['IsFinalVA']];
      break;
    }
    if (!vaId) return { success: false, error: 'VA Connection not found.' };
    if (!isFinalVA) return { success: false, error: 'This connection is not the designated Final VA — use "Set as Final VA" first.' };

    var sheet = _kickoffGetSheet(ss);
    var id = generateID('KOC');
    var now = new Date();
    sheet.appendRow([
      id, requestId, connectionId, vaId, vaName,
      new Date(kickoffDateTime), vaConnCallTargetDate ? new Date(vaConnCallTargetDate) : '',
      '', '', '', '',
      user.email, now
    ]);
    _writeLog('VARequest', requestId, 'CREATE', 'KickoffCall', '', id, user);
    return { success: true, id: id };
  } catch (e) {
    return { success: false, error: 'createKickoffCall: ' + e.message };
  }
}

// Approve/Decline/Cancel a logged Kick Off Call. On Decline, loops the
// request back to VA Assignment (clearing Final VA on this candidate) so
// a different candidate can be designated and go through their own Rate
// Agreement + Kick Off Call — mirrors the same loop-back pattern already
// used elsewhere (VA-Client Connection Call decline, in
// updateVAConnectionStatus).
function resolveKickoffCall(kickoffCallId, result, notes) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if ([KICKOFF_RESULT.APPROVED, KICKOFF_RESULT.DECLINED, KICKOFF_RESULT.CANCELLED].indexOf(result) === -1) {
      return { success: false, error: 'Invalid result.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _kickoffGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,ix){ if(c) h[String(c).trim()]=ix; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['KickoffCallID']]) !== kickoffCallId) continue;
      var requestId = String(data[i][h['RequestID']]||'');
      var connectionId = String(data[i][h['ConnectionID']]||'');
      if (String(data[i][h['Result']]||'')) return { success: false, error: 'This kickoff call has already been resolved.' };

      // Resolve who's actually allowed to act, based on request type and
      // the customer's assigned specialist.
      var reqSheet = _reqGetSheet(ss);
      var reqData = reqSheet.getDataRange().getValues();
      var reqH = _reqHMap(reqData[0]);
      var requestType = '', custId = '';
      for (var ri = 1; ri < reqData.length; ri++) {
        if (String(reqData[ri][reqH['RequestID']]) !== requestId) continue;
        requestType = String(reqData[ri][reqH['RequestType']]||'');
        custId = String(reqData[ri][reqH['CustomerID']]||'');
        break;
      }
      var assignedSpecialistEmail = '';
      try {
        var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
        if (custSheet && custId) {
          var custData = custSheet.getDataRange().getValues();
          var custH = {}; custData[0].forEach(function(c,ix){ if(c) custH[String(c).trim()]=ix; });
          for (var ci = 1; ci < custData.length; ci++) {
            if (String(custData[ci][custH['CustomerID']]||'') !== custId) continue;
            assignedSpecialistEmail = custH['AssignedSpecialist'] !== undefined ? String(custData[ci][custH['AssignedSpecialist']]||'') : '';
            break;
          }
        }
      } catch (custLookupEx) { Logger.log('resolveKickoffCall customer lookup: ' + custLookupEx.message); }

      if (!_kickoffCanResolve(requestType, user, assignedSpecialistEmail, custId)) {
        var roleNeeded = requestType === 'Replacement' ? 'CS Manager' : 'the assigned CS Specialist (or CS Manager)';
        return { success: false, error: 'Only ' + roleNeeded + ' can approve, decline, or cancel this kickoff call.' };
      }

      var rowNum = i + 1;
      var now = new Date();
      sheet.getRange(rowNum, h['Result']+1).setValue(result);
      sheet.getRange(rowNum, h['ResultBy']+1).setValue(user.email);
      sheet.getRange(rowNum, h['ResultAt']+1).setValue(now);
      sheet.getRange(rowNum, h['ResultNotes']+1).setValue(notes||'');
      _writeLog('VARequest', requestId, 'UPDATE', 'KickoffCallResult', '', result, user);

      if (result === KICKOFF_RESULT.DECLINED) {
        // Loop back — un-designate Final VA on this candidate and return
        // the request to VA Assignment so a different candidate can be
        // designated and go through their own Rate Agreement + Kick Off
        // Call, mirroring the VA-Client Connection Call decline pattern.
        try {
          var connSheet2 = _connGetSheet(ss);
          var connData2 = connSheet2.getDataRange().getValues();
          var connH2 = _connHMap(connData2[0]);
          for (var ci2 = 1; ci2 < connData2.length; ci2++) {
            if (String(connData2[ci2][connH2['ConnectionID']]) !== connectionId) continue;
            if (connH2['IsFinalVA'] !== undefined) connSheet2.getRange(ci2+1, connH2['IsFinalVA']+1).setValue(false);
            break;
          }
        } catch (unmarkEx) { Logger.log('resolveKickoffCall unmark Final VA: ' + unmarkEx.message); }
        _wfAdvance(requestId, 'VA_ASSIGNMENT', user, 'Kick Off Call declined — returning to VA Assignment for a different candidate.', true);
      } else if (result === KICKOFF_RESULT.APPROVED) {
        // Real bug fixed here: this used to force the stage straight to
        // VA-Client Connection Call unconditionally the moment a
        // Kick-Off Call was approved — even if Rate Agreement hadn't
        // actually been marked done for this connection yet, which
        // _wfConnStageIndex (WorkflowService.gs) explicitly requires
        // together with Kick-Off Call before returning that stage. The
        // comment here used to claim this "replaces the old
        // markKickOffCallDone, which advanced unconditionally" — but it
        // just moved the same unconditional advance to a new spot
        // rather than actually fixing it. Recalculating properly here
        // means the stage only reaches VA-Client Connection Call when
        // Rate Agreement is genuinely done too — otherwise it correctly
        // lands at Kick Off Call or earlier, matching this connection's
        // real progress.
        _wfRecalculateRequestStage(requestId, user);
      }
      // Cancelled intentionally advances nothing — the CS can log a new
      // kickoff call for the same candidate whenever ready.

      return { success: true, requestId: requestId };
    }
    return { success: false, error: 'Kickoff call not found.' };
  } catch (e) {
    return { success: false, error: 'resolveKickoffCall: ' + e.message };
  }
}

// Every kickoff call record for a given request — a request can have
// more than one over time if earlier candidates were Declined.
function getKickoffCallsForRequest(requestId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _kickoffGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = {}; data[0].forEach(function(c,ix){ if(c) h[String(c).trim()]=ix; });

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]||'') !== requestId) continue;
      rows.push({
        kickoffCallId: String(data[i][h['KickoffCallID']]||''),
        connectionId:  String(data[i][h['ConnectionID']]||''),
        vaId:          String(data[i][h['VAID']]||''),
        vaName:        String(data[i][h['VAName']]||''),
        kickoffCallDateTime:        data[i][h['KickoffCallDateTime']] instanceof Date ? data[i][h['KickoffCallDateTime']].toISOString() : String(data[i][h['KickoffCallDateTime']]||''),
        vaConnectionCallTargetDate: data[i][h['VAConnectionCallTargetDate']] instanceof Date ? data[i][h['VAConnectionCallTargetDate']].toISOString() : String(data[i][h['VAConnectionCallTargetDate']]||''),
        result:      String(data[i][h['Result']]||''),
        resultBy:    String(data[i][h['ResultBy']]||''),
        resultAt:    data[i][h['ResultAt']] instanceof Date ? data[i][h['ResultAt']].toISOString() : String(data[i][h['ResultAt']]||''),
        resultNotes: String(data[i][h['ResultNotes']]||''),
        createdBy:   String(data[i][h['CreatedBy']]||''),
        createdAt:   data[i][h['CreatedAt']] instanceof Date ? data[i][h['CreatedAt']].toISOString() : String(data[i][h['CreatedAt']]||'')
      });
    }
    rows.sort(function(a,b){ return new Date(b.createdAt||0) - new Date(a.createdAt||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getKickoffCallsForRequest: ' + e.message };
  }
}