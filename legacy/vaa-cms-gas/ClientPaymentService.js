// ═══════════════════════════════════════════════════════════════════════
// CLIENT PAYMENTS MODULE
// ═══════════════════════════════════════════════════════════════════════
// CS Manager uploads a CSV each month with CustomerID, Customer Name,
// Month/Year, and Paid/Unpaid status. This is used two ways:
//   1. Its own dedicated module — a pivot view of every customer across
//      every month that's been uploaded so far.
//   2. A warning icon in Birthdays & Anniversaries when the customer tied
//      to that VA/client is unpaid for the relevant month.
// Re-uploading a CSV for a month that already has data replaces those
// existing rows for that Month/Year rather than duplicating them —
// treating each upload as the authoritative snapshot for that period.

var CLIENT_PAYMENT_STATUS = { PAID: 'Paid', UNPAID: 'Unpaid' };

function _cpGetSheet(ss) {
  return _ensureSheet(ss, 'ClientPayments', CONFIG.SCHEMA.ClientPayments);
}

// CS Manager (or Administrator) only — uploads a CSV of customer payment
// statuses for a given month/year. Expected columns (header row required,
// case-insensitive, order doesn't matter): CustomerID, CustomerName (or
// Customer Name), Status (Paid/Unpaid — anything not exactly "Paid" is
// treated as Unpaid). Month/Year can either be columns in the CSV itself,
// or passed as defaultMonth/defaultYear to apply to every row that
// doesn't specify its own — the common case, since a CS Manager uploads
// one file per month covering every customer.
function uploadClientPaymentsCSV(csvText, defaultMonth, defaultYear) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.CS_MANAGER && user.role !== CONFIG.ROLES.ADMINISTRATOR) {
      return { success: false, error: 'Only CS Managers or Administrators can upload client payment data.' };
    }
    if (!csvText || !csvText.trim()) return { success: false, error: 'CSV content is empty.' };

    var parsed = Utilities.parseCsv(csvText);
    if (parsed.length < 2) return { success: false, error: 'CSV has no data rows.' };
    var headerRow = parsed[0].map(function(c) { return String(c).trim().toLowerCase(); });
    function colIdx(names) {
      for (var n = 0; n < names.length; n++) {
        var idx = headerRow.indexOf(names[n]);
        if (idx !== -1) return idx;
      }
      return -1;
    }
    var idxCustId   = colIdx(['customerid', 'customer id']);
    var idxCustName = colIdx(['customername', 'customer name', 'name']);
    var idxMonth    = colIdx(['month']);
    var idxYear     = colIdx(['year']);
    var idxStatus   = colIdx(['status', 'paid']);
    if (idxCustId === -1) return { success: false, error: 'CSV must have a "CustomerID" column.' };
    if (idxStatus === -1) return { success: false, error: 'CSV must have a "Status" column.' };

    var rows = [];
    for (var i = 1; i < parsed.length; i++) {
      var r = parsed[i];
      if (!r[idxCustId]) continue;
      var month = idxMonth !== -1 && r[idxMonth] ? String(r[idxMonth]).trim() : (defaultMonth || '');
      var year  = idxYear  !== -1 && r[idxYear]  ? String(r[idxYear]).trim()  : (defaultYear  || '');
      if (!month || !year) return { success: false, error: 'Row ' + (i+1) + ': Month/Year is missing, and no default was provided.' };
      var statusRaw = String(r[idxStatus] || '').trim().toLowerCase();
      var status = (statusRaw === 'paid' || statusRaw === 'yes' || statusRaw === 'true') ? CLIENT_PAYMENT_STATUS.PAID : CLIENT_PAYMENT_STATUS.UNPAID;
      rows.push({
        customerId:   String(r[idxCustId]).trim(),
        customerName: idxCustName !== -1 ? String(r[idxCustName]||'').trim() : '',
        month: month, year: year, status: status
      });
    }
    if (!rows.length) return { success: false, error: 'No valid rows found in the CSV.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _cpGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,ix){ if(c) h[String(c).trim()]=ix; });

    // Replace any existing row for the same CustomerID+Month+Year —
    // re-uploading a month's file is meant to be the authoritative
    // snapshot for that period, not additive.
    var existingRowByKey = {};
    for (var ei = 1; ei < data.length; ei++) {
      var key = String(data[ei][h['CustomerID']]||'') + '|' + String(data[ei][h['Month']]||'') + '|' + String(data[ei][h['Year']]||'');
      existingRowByKey[key] = ei + 1; // 1-based sheet row number
    }

    var now = new Date();
    var updated = 0, inserted = 0;
    rows.forEach(function(r) {
      var key = r.customerId + '|' + r.month + '|' + r.year;
      if (existingRowByKey[key]) {
        var rowNum = existingRowByKey[key];
        if (h['CustomerName'] !== undefined) sheet.getRange(rowNum, h['CustomerName']+1).setValue(r.customerName);
        if (h['Status']       !== undefined) sheet.getRange(rowNum, h['Status']+1).setValue(r.status);
        if (h['UploadedBy']   !== undefined) sheet.getRange(rowNum, h['UploadedBy']+1).setValue(user.email);
        if (h['UploadedAt']   !== undefined) sheet.getRange(rowNum, h['UploadedAt']+1).setValue(now);
        updated++;
      } else {
        sheet.appendRow([generateID('CPAY'), r.customerId, r.customerName, r.month, r.year, r.status, user.email, now]);
        inserted++;
      }
    });

    _writeLog('ClientPayments', 'bulk', 'UPLOAD', 'CSV', '', inserted + ' inserted, ' + updated + ' updated', user);
    return { success: true, inserted: inserted, updated: updated, total: rows.length };
  } catch (e) {
    return { success: false, error: 'uploadClientPaymentsCSV: ' + e.message };
  }
}

// Returns every uploaded payment record, plus the distinct list of
// Month/Year periods seen so far — the frontend pivots this into a grid
// (one row per customer, one column per period) rather than doing that
// shaping here, so it stays flexible for however the UI wants to lay it out.
function getClientPaymentsGrid() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _cpGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, records: [], periods: [] };
    var h = {}; data[0].forEach(function(c,ix){ if(c) h[String(c).trim()]=ix; });

    var records = [];
    var periodSet = {};
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['PaymentRecordID']]) continue;
      var month = String(data[i][h['Month']]||'');
      var year  = String(data[i][h['Year']]||'');
      var period = month + ' ' + year;
      periodSet[period] = { month: month, year: year };
      records.push({
        customerId:   String(data[i][h['CustomerID']]||''),
        customerName: String(data[i][h['CustomerName']]||''),
        month: month, year: year, period: period,
        status: String(data[i][h['Status']]||CLIENT_PAYMENT_STATUS.UNPAID),
        uploadedAt: data[i][h['UploadedAt']] instanceof Date ? data[i][h['UploadedAt']].toISOString() : String(data[i][h['UploadedAt']]||'')
      });
    }
    // Sort periods chronologically (Year then Month order, using a fixed
    // month-name list so "March" doesn't sort before "January" as text).
    var MONTH_ORDER = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var periods = Object.keys(periodSet).map(function(k){ return periodSet[k]; });
    periods.sort(function(a,b){
      if (a.year !== b.year) return Number(a.year) - Number(b.year);
      return MONTH_ORDER.indexOf(a.month) - MONTH_ORDER.indexOf(b.month);
    });

    return { success: true, records: records, periods: periods };
  } catch (e) {
    return { success: false, error: 'getClientPaymentsGrid: ' + e.message };
  }
}

// Lookup helper for Birthdays & Anniversaries — returns a map of
// customerId -> most-recent status, so a customer flagged Unpaid in their
// latest uploaded period shows a warning. Kept as its own function
// (rather than making Celebration code parse the sheet itself) so this
// stays the single place that knows how to determine "most recent."
function _cpGetLatestStatusByCustomer() {
  var result = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _cpGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return result;
    var h = {}; data[0].forEach(function(c,ix){ if(c) h[String(c).trim()]=ix; });
    var latestByCustomer = {}; // customerId -> {year, month, status}
    var MONTH_ORDER = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['PaymentRecordID']]) continue;
      var custId = String(data[i][h['CustomerID']]||''); if (!custId) continue;
      var year = Number(data[i][h['Year']]||0);
      var month = String(data[i][h['Month']]||'');
      var monthIdx = MONTH_ORDER.indexOf(month);
      var existing = latestByCustomer[custId];
      var isNewer = !existing || year > existing.year || (year === existing.year && monthIdx > existing.monthIdx);
      if (isNewer) {
        latestByCustomer[custId] = { year: year, monthIdx: monthIdx, status: String(data[i][h['Status']]||CLIENT_PAYMENT_STATUS.UNPAID) };
      }
    }
    Object.keys(latestByCustomer).forEach(function(cid) { result[cid] = latestByCustomer[cid].status; });
  } catch (e) {
    Logger.log('_cpGetLatestStatusByCustomer: ' + e.message);
  }
  return result;
}