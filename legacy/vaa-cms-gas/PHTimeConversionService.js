// ══════════════════════════════════════════════════════════════════════
// PH Time Conversion — per the rework requested: the client's own local
// working time is now the actual input everywhere a schedule needs a
// "Required Working Time" window, with the PH equivalent derived from
// it rather than being entered directly. This is what lets the PH-side
// hours correctly shift by an hour twice a year to keep the client's
// actual schedule commitment constant across DST transitions, instead
// of the old model — a fixed PH time — which silently let the client's
// displayed hours drift by an hour instead.
//
// PH never observes DST (UTC+8 year-round), so the only timezone that
// ever needs a real, date-dependent offset lookup is the client's.
// ══════════════════════════════════════════════════════════════════════

var PH_TIMEZONE = 'Asia/Manila';
var PH_OFFSET_MINUTES = 480; // UTC+8, fixed — PH never observes DST

// The client timezone's UTC offset, in minutes, ON THE GIVEN DATE — not
// a fixed value, since this is exactly what changes across a DST
// transition. Utilities.formatDate uses the real IANA tz database, so
// this is correct for any timezone/date combination without needing a
// DST rules table maintained by hand.
function _phGetTimezoneOffsetMinutes(timezone, referenceDate) {
  var offsetStr = Utilities.formatDate(referenceDate, timezone, 'Z'); // e.g. "+0300", "-0500"
  var sign = offsetStr.charAt(0) === '-' ? -1 : 1;
  var hours = parseInt(offsetStr.substring(1, 3), 10) || 0;
  var mins = parseInt(offsetStr.substring(3, 5), 10) || 0;
  return sign * (hours * 60 + mins);
}

// "8:00 AM" -> 480, "5:30 PM" -> 1050. Returns null if unparseable —
// callers should treat that as "leave this alone," not silently zero.
function _phParseTimeStrToMinutes(timeStr) {
  var m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeStr||'').trim());
  if (!m) return null;
  var h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + (parseInt(m[2], 10) || 0);
}

// 480 -> "8:00 AM", 1050 -> "5:30 PM".
function _phMinutesToTimeStr(mins) {
  mins = ((mins % 1440) + 1440) % 1440; // wrap into a single 0–1439 day
  var h24 = Math.floor(mins / 60), m = mins % 60;
  var ampm = h24 >= 12 ? 'PM' : 'AM';
  var h12 = h24 % 12; if (h12 === 0) h12 = 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}

// Converts one "8:00 AM – 5:00 PM"-style client-time range into its PH
// equivalent, given the client's IANA timezone and a reference date
// (whose DST state actually determines the offset used). Returns '' if
// the input can't be parsed, rather than a misleading partial result.
function convertClientTimeToPH(clientTimeRangeStr, clientTimezone, referenceDate) {
  try {
    if (!clientTimeRangeStr || !clientTimezone) return '';
    var parts = String(clientTimeRangeStr).split(' – ');
    if (parts.length !== 2) return '';
    var refDate = referenceDate ? new Date(referenceDate) : new Date();
    if (isNaN(refDate.getTime())) refDate = new Date();
    var clientOffsetMin = _phGetTimezoneOffsetMinutes(clientTimezone, refDate);

    var convertOne = function(timeStr) {
      var clientMinutes = _phParseTimeStrToMinutes(timeStr);
      if (clientMinutes === null) return null;
      var utcMinutes = clientMinutes - clientOffsetMin;
      var phMinutes = utcMinutes + PH_OFFSET_MINUTES;
      return _phMinutesToTimeStr(phMinutes);
    };

    var startPH = convertOne(parts[0].trim());
    var endPH = convertOne(parts[1].trim());
    if (startPH === null || endPH === null) return '';
    return startPH + ' – ' + endPH;
  } catch (e) {
    Logger.log('convertClientTimeToPH error: ' + e.message);
    return '';
  }
}

// Frontend-callable wrapper — used by every schedule form's live PH
// preview as the client-time inputs change, so the same conversion
// logic (and the same IANA tz database Utilities.formatDate relies on)
// is used both for the live preview and for what actually gets saved,
// rather than the frontend approximating it with its own separate,
// potentially-diverging math.
function getPHEquivalentTime(clientTimeRangeStr, clientTimezone, referenceDate) {
  try {
    return { success: true, phTime: convertClientTimeToPH(clientTimeRangeStr, clientTimezone, referenceDate) };
  } catch (e) {
    return { success: false, error: 'getPHEquivalentTime: ' + e.message };
  }
}

// One-time backfill/migration, per the request — every existing saved
// RequiredPHTime was entered directly as PH time (the old model), so
// there's no "client time" on file for it yet. This computes what the
// client's local time equivalent would be — using the record's own
// ClientTimezone and its own effective/creation date for the DST
// calculation, since that's the date whose offset actually applied when
// this was originally saved — and stores it as RequiredClientTime, so
// going forward, RequiredPHTime can be treated as derived everywhere
// without silently losing/misrepresenting what's already on file.
//
// This is the exact reverse of convertClientTimeToPH — PH is fixed
// UTC+8, so converting outward from it needs only that same offset math
// run backward, not a separate function.
function _phConvertPHToClientTime(phTimeRangeStr, clientTimezone, referenceDate) {
  try {
    if (!phTimeRangeStr || !clientTimezone) return '';
    var parts = String(phTimeRangeStr).split(' – ');
    if (parts.length !== 2) return '';
    var refDate = referenceDate ? new Date(referenceDate) : new Date();
    if (isNaN(refDate.getTime())) refDate = new Date();
    var clientOffsetMin = _phGetTimezoneOffsetMinutes(clientTimezone, refDate);

    var convertOne = function(timeStr) {
      var phMinutes = _phParseTimeStrToMinutes(timeStr);
      if (phMinutes === null) return null;
      var utcMinutes = phMinutes - PH_OFFSET_MINUTES;
      var clientMinutes = utcMinutes + clientOffsetMin;
      return _phMinutesToTimeStr(clientMinutes);
    };

    var startClient = convertOne(parts[0].trim());
    var endClient = convertOne(parts[1].trim());
    if (startClient === null || endClient === null) return '';
    return startClient + ' – ' + endClient;
  } catch (e) {
    Logger.log('_phConvertPHToClientTime error: ' + e.message);
    return '';
  }
}

function backfillRequiredClientTimeFromPHTime() {
  var results = { requestsUpdated: 0, requestsSkipped: 0, logsUpdated: 0, logsSkipped: 0, errors: [] };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // VARequests — ClientTimezone lives on the request itself.
    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (reqSheet) {
      var reqData = reqSheet.getDataRange().getValues();
      var reqH = {}; reqData[0].forEach(function(c,i){ if(c) reqH[String(c)]=i; });
      if (reqH['RequiredPHTime'] !== undefined && reqH['RequiredClientTime'] !== undefined && reqH['ClientTimezone'] !== undefined) {
        for (var ri = 1; ri < reqData.length; ri++) {
          try {
            var existingClientTime = String(reqData[ri][reqH['RequiredClientTime']]||'');
            var phTime = String(reqData[ri][reqH['RequiredPHTime']]||'');
            if (existingClientTime || !phTime) { results.requestsSkipped++; continue; }
            var tz = String(reqData[ri][reqH['ClientTimezone']]||'');
            if (!tz) { results.requestsSkipped++; continue; }
            var refDateForReq = reqH['UpdatedAt'] !== undefined && reqData[ri][reqH['UpdatedAt']] ? reqData[ri][reqH['UpdatedAt']] : new Date();
            var clientTime = _phConvertPHToClientTime(phTime, tz, refDateForReq);
            if (!clientTime) { results.requestsSkipped++; continue; }
            reqSheet.getRange(ri + 1, reqH['RequiredClientTime'] + 1).setValue(clientTime);
            results.requestsUpdated++;
          } catch (perRowEx) { results.errors.push('VARequests row ' + (ri+1) + ': ' + perRowEx.message); }
        }
      }
    }

    // VAConnectionHoursLog — ClientTimezone isn't stored here directly;
    // joined via ConnectionID -> VAConnections.RequestID -> VARequests.
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var logSheet = ss.getSheetByName('VAConnectionHoursLog');
    if (connSheet && logSheet && reqSheet) {
      var connData = connSheet.getDataRange().getValues();
      var connH = {}; connData[0].forEach(function(c,i){ if(c) connH[String(c)]=i; });
      var reqIdByConnId = {};
      for (var cvi = 1; cvi < connData.length; cvi++) {
        var cid = String(connData[cvi][connH['ConnectionID']]||''); if (!cid) continue;
        reqIdByConnId[cid] = String(connData[cvi][connH['RequestID']]||'');
      }
      var reqData2 = reqSheet.getDataRange().getValues();
      var reqH2 = {}; reqData2[0].forEach(function(c,i){ if(c) reqH2[String(c)]=i; });
      var tzByReqId = {};
      if (reqH2['ClientTimezone'] !== undefined) {
        for (var rvi = 1; rvi < reqData2.length; rvi++) {
          var rid = String(reqData2[rvi][reqH2['RequestID']]||''); if (!rid) continue;
          tzByReqId[rid] = String(reqData2[rvi][reqH2['ClientTimezone']]||'');
        }
      }

      var logData = logSheet.getDataRange().getValues();
      var logH = {}; logData[0].forEach(function(c,i){ if(c) logH[String(c)]=i; });
      if (logH['RequiredPHTime'] !== undefined && logH['RequiredClientTime'] !== undefined) {
        for (var li = 1; li < logData.length; li++) {
          try {
            var existingClientTime2 = String(logData[li][logH['RequiredClientTime']]||'');
            var phTime2 = String(logData[li][logH['RequiredPHTime']]||'');
            if (existingClientTime2 || !phTime2) { results.logsSkipped++; continue; }
            var connId = logH['ConnectionID'] !== undefined ? String(logData[li][logH['ConnectionID']]||'') : '';
            var reqIdForLog = reqIdByConnId[connId] || '';
            var tz2 = tzByReqId[reqIdForLog] || '';
            if (!tz2) { results.logsSkipped++; continue; }
            var refDateForLog = logH['EffectiveDate'] !== undefined && logData[li][logH['EffectiveDate']] ? logData[li][logH['EffectiveDate']] : new Date();
            var clientTime2 = _phConvertPHToClientTime(phTime2, tz2, refDateForLog);
            if (!clientTime2) { results.logsSkipped++; continue; }
            logSheet.getRange(li + 1, logH['RequiredClientTime'] + 1).setValue(clientTime2);
            results.logsUpdated++;
          } catch (perRowEx2) { results.errors.push('VAConnectionHoursLog row ' + (li+1) + ': ' + perRowEx2.message); }
        }
      }
    }

    return { success: true, results: results };
  } catch (e) {
    return { success: false, error: 'backfillRequiredClientTimeFromPHTime: ' + e.message, results: results };
  }
}