// ══════════════════════════════════════════════════════════════════════
// ConnectionKPI Service — backend for the "KPI Performance" module.
// ══════════════════════════════════════════════════════════════════════

function _ckpiGetSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.CONNECTION_KPI);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.CONNECTION_KPI);
    var headers = CONFIG.SCHEMA.ConnectionKPI;
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    _migrateSheetColumns(ss, CONFIG.SHEETS.CONNECTION_KPI, CONFIG.SCHEMA.ConnectionKPI);
  }
  return sheet;
}

// Resilient to PeriodDate being stored either way: correctly as plain
// text ("2026-08-10"), or as an already-corrupted Date object if Google
// Sheets ever silently converted it on write. Same fix pattern already
// applied to the billing grid's Month column this session.
function _ckpiNormalizeDateValue(val) {
  if (val instanceof Date) {
    return val.getFullYear() + '-' + String(val.getMonth()+1).padStart(2,'0') + '-' + String(val.getDate()).padStart(2,'0');
  }
  return String(val||'');
}

// Monday of the most recently COMPLETED week — if today is itself a
// Monday, that's the start of a week still in progress, so this steps
// back one further week. Matches the example in the request exactly:
// today Aug 17 2026 (a Monday) -> returns Aug 10 2026.
function _ckpiMostRecentWeekMonday() {
  var now = new Date();
  var day = now.getDay(); // 0=Sun...6=Sat
  var diffToMonday = day === 0 ? 6 : day - 1;
  var thisWeekMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  var lastWeekMonday = new Date(thisWeekMonday.getFullYear(), thisWeekMonday.getMonth(), thisWeekMonday.getDate() - 7);
  return _ckpiDateToStr(lastWeekMonday);
}

// 1st of the most recently COMPLETED month — the current month is still
// in progress, so this always steps back to the prior month's 1st.
function _ckpiMostRecentMonthStart() {
  var now = new Date();
  var prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return _ckpiDateToStr(prevMonthStart);
}

function _ckpiDateToStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// Status sort priority, per the request's default sort order —
// Critical, At Risk, On Target, No Data.
var CKPI_STATUS_ORDER = { 'Critical': 0, 'At Risk': 1, 'On Target': 2, 'No Data': 3 };

function _mapConnectionKpiRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    recordId:            String(get('RecordID')||''),
    connectionId:        String(get('ConnectionID')||''),
    kpiType:             String(get('KPIType')||''),
    periodDate:          _ckpiNormalizeDateValue(get('PeriodDate')),
    status:              String(get('Status')||''),
    interventionDetails: String(get('InterventionDetails')||''),
    updatedAt:           get('UpdatedAt'),
    updatedBy:           String(get('UpdatedBy')||'')
  };
}

// Main read function for the KPI Performance module. Defaults to the
// most recently completed period (per kpiType) if periodDateStr isn't
// given, per the request's "most recent week" default behavior.
// CS Specialist only ever sees connections for customers assigned to
// them; every other role sees everything.
function getConnectionKPIData(kpiType, periodDateStr) {
  var _kpiT0 = new Date().getTime();
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    kpiType = (kpiType === 'Monthly') ? 'Monthly' : 'Weekly';
    var explicitPeriod = !!periodDateStr;
    var periodDate;
    try {
      periodDate = periodDateStr || (kpiType === 'Monthly' ? _ckpiMostRecentMonthStart() : _ckpiMostRecentWeekMonday());
    } catch (dateEx) {
      return { success: false, error: 'getConnectionKPIData: computing default period — ' + dateEx.message };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // KPI rows for this exact period, keyed by ConnectionID.
    var kpiSheet, kpiData, kh;
    try {
      kpiSheet = _ckpiGetSheet(ss);
      kpiData = kpiSheet.getDataRange().getValues();
      kh = {}; kpiData[0].forEach(function(c,i){ if(c) kh[String(c)]=i; });
      Logger.log('[KPI TIMING] ConnectionKPI sheet read: ' + (new Date().getTime()-_kpiT0) + 'ms, ' + kpiData.length + ' rows.');
      if (kh['ConnectionID'] === undefined || kh['KPIType'] === undefined || kh['PeriodDate'] === undefined || kh['Status'] === undefined) {
        return { success: false, error: 'getConnectionKPIData: the ConnectionKPI sheet is missing one or more expected columns (ConnectionID/KPIType/PeriodDate/Status). Try running initializeSystem() to repair it.' };
      }
    } catch (kpiSheetEx) {
      return { success: false, error: 'getConnectionKPIData: reading the ConnectionKPI sheet — ' + kpiSheetEx.message };
    }

    // If the caller didn't request a specific period, and today's
    // computed "most recently completed" period has no rows at all yet
    // for this KPI type (the tracking process hasn't caught up to the
    // current date), fall back to the latest period that actually has
    // data — rather than confidently showing "No Data" for every single
    // connection when the real issue is just an out-of-date default.
    var usedFallbackPeriod = false;
    try {
      if (!explicitPeriod) {
        var hasRowsForComputedPeriod = false;
        var latestPeriodWithData = '';
        for (var pi = 1; pi < kpiData.length; pi++) {
          if (String(kpiData[pi][kh['KPIType']]||'') !== kpiType) continue;
          var pDate = _ckpiNormalizeDateValue(kpiData[pi][kh['PeriodDate']]);
          if (!pDate) continue;
          if (pDate === periodDate) hasRowsForComputedPeriod = true;
          if (pDate > latestPeriodWithData) latestPeriodWithData = pDate;
        }
        if (!hasRowsForComputedPeriod && latestPeriodWithData) { periodDate = latestPeriodWithData; usedFallbackPeriod = true; }
      }
    } catch (fallbackEx) {
      return { success: false, error: 'getConnectionKPIData: computing fallback period — ' + fallbackEx.message };
    }

    var kpiByConnId = {};
    try {
      for (var ki = 1; ki < kpiData.length; ki++) {
        var kConnId = String(kpiData[ki][kh['ConnectionID']]||''); if (!kConnId) continue;
        var kType = String(kpiData[ki][kh['KPIType']]||'');
        var kPeriod = _ckpiNormalizeDateValue(kpiData[ki][kh['PeriodDate']]);
        if (kType !== kpiType || kPeriod !== periodDate) continue;
        kpiByConnId[kConnId] = _mapConnectionKpiRow(kpiData[ki], kh);
      }
    } catch (kpiMapEx) {
      return { success: false, error: 'getConnectionKPIData: mapping KPI rows — ' + kpiMapEx.message };
    }

    // If the caller is a CS Specialist, restrict to connections whose
    // customer is assigned to them specifically. Also builds the
    // CustomerName lookup here — VAConnections has no cached customer
    // name of its own, only the ID, so this same read covers both needs.
    var restrictMyEmail = perm.user && perm.user.role === 'CS Specialist' ? String(perm.user.email||'').toLowerCase().trim() : null;
    var restrictTakeoverIds = [];
    var custSpecialistById = {};
    var custNameById = {};
    try {
      if (restrictMyEmail) restrictTakeoverIds = getTakeoverCustomerIdsForSpecialist(restrictMyEmail) || [];
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var custData = custSheet.getDataRange().getValues();
        var ch = {}; custData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
        for (var cui = 1; cui < custData.length; cui++) {
          var cuId = String(custData[cui][ch['CustomerID']]||''); if (!cuId) continue;
          custSpecialistById[cuId] = String(custData[cui][ch['AssignedSpecialist']]||'').toLowerCase().trim();
          custNameById[cuId] = String(custData[cui][ch['CustomerName']]||'');
        }
      }
    } catch (custLookupEx) { Logger.log('getConnectionKPIData customer lookup: ' + custLookupEx.message); }
    Logger.log('[KPI TIMING] Customers sheet read + lookup built: ' + (new Date().getTime()-_kpiT0) + 'ms total elapsed.');

    // VAConnections has no cached account name either — same reasoning.
    var acctNameById = {};
    try {
      var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet) {
        var cliData = cliSheet.getDataRange().getValues();
        var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
        for (var cli = 1; cli < cliData.length; cli++) {
          var cliId = String(cliData[cli][clh['ClientID']]||''); if (!cliId) continue;
          acctNameById[cliId] = String(cliData[cli][clh['AccountName']]||cliData[cli][clh['CompanyName']]||'');
        }
      }
    } catch (cliLookupEx) { Logger.log('getConnectionKPIData client lookup: ' + cliLookupEx.message); }
    Logger.log('[KPI TIMING] Clients sheet read + lookup built: ' + (new Date().getTime()-_kpiT0) + 'ms total elapsed.');

    var connSheet, connData, conh;
    try {
      connSheet = _connGetSheet(ss);
      connData = connSheet.getDataRange().getValues();
      conh = _connHMap(connData[0]);
      if (conh['ConnectionID'] === undefined || conh['ConnectionStatus'] === undefined || conh['CustomerID'] === undefined) {
        return { success: false, error: 'getConnectionKPIData: the VAConnections sheet is missing one or more expected columns (ConnectionID/ConnectionStatus/CustomerID). Try running initializeSystem() to repair it.' };
      }
    } catch (connSheetEx) {
      return { success: false, error: 'getConnectionKPIData: reading the VAConnections sheet — ' + connSheetEx.message };
    }
    Logger.log('[KPI TIMING] VAConnections sheet read: ' + (new Date().getTime()-_kpiT0) + 'ms total elapsed, ' + connData.length + ' rows.');

    var rows = [];
    try {
      for (var i = 1; i < connData.length; i++) {
        var status = String(connData[i][conh['ConnectionStatus']]||'');
        // "All VA Connections" per the request — excludes only statuses
        // that never meaningfully have KPI data to track at all.
        if (status === 'Pending' || status === 'Accepted' || status === 'Cancelled' || status === 'Declined') continue;

        var connectionId = String(connData[i][conh['ConnectionID']]||'');
        var customerId = String(connData[i][conh['CustomerID']]||'');
        var clientId = conh['ClientID'] !== undefined ? String(connData[i][conh['ClientID']]||'') : '';

        if (restrictMyEmail && custSpecialistById[customerId] !== restrictMyEmail && restrictTakeoverIds.indexOf(customerId) === -1) continue;

        var kpi = kpiByConnId[connectionId] || null;
        var rowStatus = kpi ? kpi.status : 'No Data';

        rows.push({
          connectionId: connectionId,
          vaName: conh['VAName'] !== undefined ? String(connData[i][conh['VAName']]||'') : '',
          customerName: custNameById[customerId] || customerId,
          accountName: acctNameById[clientId] || '',
          connectionStatus: status,
          kpiStatus: rowStatus,
          interventionDetails: kpi ? kpi.interventionDetails : '',
          updatedAt: kpi ? kpi.updatedAt : '',
          updatedBy: kpi ? kpi.updatedBy : ''
        });
      }
    } catch (rowBuildEx) {
      return { success: false, error: 'getConnectionKPIData: building connection rows — ' + rowBuildEx.message };
    }

    try {
      rows.sort(function(a, b) {
        var pa = CKPI_STATUS_ORDER[a.kpiStatus] !== undefined ? CKPI_STATUS_ORDER[a.kpiStatus] : 4;
        var pb = CKPI_STATUS_ORDER[b.kpiStatus] !== undefined ? CKPI_STATUS_ORDER[b.kpiStatus] : 4;
        if (pa !== pb) return pa - pb;
        return (a.vaName||'').localeCompare(b.vaName||'');
      });
    } catch (sortEx) {
      return { success: false, error: 'getConnectionKPIData: sorting rows — ' + sortEx.message };
    }

    Logger.log('[KPI TIMING] Total: ' + (new Date().getTime()-_kpiT0) + 'ms, ' + rows.length + ' rows returned.');
    return { success: true, kpiType: kpiType, periodDate: periodDate, usedFallbackPeriod: usedFallbackPeriod, data: rows };
  } catch (e) {
    return { success: false, error: 'getConnectionKPIData: ' + e.message };
  }
}

// Upserts a single connection's KPI entry for a given period — keyed by
// ConnectionID + KPIType + PeriodDate, same upsert-by-key pattern
// already used for the billing grid, including the same plain-text
// date protection to prevent Google Sheets silently corrupting the key.
function saveConnectionKPI(connectionId, kpiType, periodDateStr, status, interventionDetails) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!connectionId) return { success: false, error: 'Connection is required.' };
    if (kpiType !== 'Weekly' && kpiType !== 'Monthly') return { success: false, error: 'Invalid KPI type: ' + kpiType };
    if (!periodDateStr) return { success: false, error: 'Period date is required.' };
    var validStatuses = ['No Data', 'On Target', 'At Risk', 'Critical'];
    if (validStatuses.indexOf(status) === -1) return { success: false, error: 'Invalid status: ' + status };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ckpiGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var now = new Date();

    var targetRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      if (String(data[i][h['KPIType']]||'') !== kpiType) continue;
      if (_ckpiNormalizeDateValue(data[i][h['PeriodDate']]) !== periodDateStr) continue;
      targetRow = i + 1;
      break;
    }

    if (targetRow > 0) {
      sheet.getRange(targetRow, h['Status']+1).setValue(status);
      sheet.getRange(targetRow, h['InterventionDetails']+1).setValue(interventionDetails || '');
      sheet.getRange(targetRow, h['UpdatedAt']+1).setValue(now);
      sheet.getRange(targetRow, h['UpdatedBy']+1).setValue(perm.user.email);
      // PeriodDate must stay plain text — see the schema comment for why.
      sheet.getRange(targetRow, h['PeriodDate']+1).setNumberFormat('@');
    } else {
      var newRow = new Array(Object.keys(h).length).fill('');
      newRow[h['RecordID']] = generateID('CKPI');
      newRow[h['ConnectionID']] = connectionId;
      newRow[h['KPIType']] = kpiType;
      newRow[h['PeriodDate']] = periodDateStr;
      newRow[h['Status']] = status;
      newRow[h['InterventionDetails']] = interventionDetails || '';
      newRow[h['CreatedAt']] = now;
      newRow[h['CreatedBy']] = perm.user.email;
      newRow[h['UpdatedAt']] = now;
      newRow[h['UpdatedBy']] = perm.user.email;
      var appendRow = sheet.getLastRow() + 1;
      sheet.getRange(appendRow, h['PeriodDate']+1).setNumberFormat('@');
      sheet.getRange(appendRow, 1, 1, newRow.length).setValues([newRow]);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: 'saveConnectionKPI: ' + e.message };
  }
}

// ── Diagnostic — run this directly from the Apps Script editor ──────
// Select "debugKPILoad" in the function dropdown at the top of the
// editor, then click Run. Check View > Logs (or View > Executions)
// afterward for the output. This calls getConnectionKPIData() the exact
// same way the KPI Performance page does, but logs the full raw result
// directly — bypassing the frontend and google.script.run entirely, so
// it will show the real error even if something prevents that error
// from ever reaching the browser normally.
function debugKPILoad() {
  try {
    var result = getConnectionKPIData('Weekly', '');
    Logger.log('=== debugKPILoad result ===');
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    Logger.log('=== debugKPILoad UNCAUGHT ERROR (this means the error is happening outside getConnectionKPIData\'s own try/catch — a real find) ===');
    Logger.log('Message: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    throw e;
  }
}