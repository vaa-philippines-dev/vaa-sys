// ═══════════════════════════════════════════════════════════════════════
// ATTENDANCE MODULE
// ═══════════════════════════════════════════════════════════════════════
// Lists every VA Connection that was live at any point during a selected
// month, with a day-by-day Projected vs Actual hours grid split into two
// cutoffs (1st–15th, 16th–end of month — standard PH payroll cutoffs).
//
// Projected hours are NEVER stored — they're derived live, per day, from
// whichever schedule was actually in effect on that specific date
// (VAConnectionHoursLog is the source of truth, same as the rest of the
// Hours & Schedule module). This means a later schedule correction
// automatically corrects all past/future projected figures with no
// migration needed. Only actual-hours entries that differ from projected,
// or that carry a reference link, need a row in AttendanceRecords at all.
// ═══════════════════════════════════════════════════════════════════════

function _attGetSheet(ss) {
  var sheet = _ensureSheet(ss, CONFIG.SHEETS.ATTENDANCE_RECORDS, CONFIG.SCHEMA.AttendanceRecords);
  _migrateSheetColumns(ss, CONFIG.SHEETS.ATTENDANCE_RECORDS, CONFIG.SCHEMA.AttendanceRecords);
  return sheet;
}

// Builds, per connection, an ordered list of {effectiveDate, hours,
// hoursType, breakdown} entries from VAConnectionHoursLog — everything
// needed to answer "what was this connection's schedule on day X".
function _attBuildScheduleTimelines() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('VAConnectionHoursLog');
  var timelines = {}; // connectionId -> [{effectiveDate, hours, hoursType, breakdown}], sorted ascending
  if (!logSheet) return timelines;
  var data = logSheet.getDataRange().getValues();
  var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
  for (var i = 1; i < data.length; i++) {
    var changeType = String(data[i][h['ChangeType']]||'');
    if (changeType === 'Project Hours Entry') continue; // additive, not a schedule redefinition
    var connId = String(data[i][h['ConnectionID']]||''); if (!connId) continue;
    var effDate = data[i][h['EffectiveDate']]; if (!effDate) continue;
    if (!timelines[connId]) timelines[connId] = [];
    timelines[connId].push({
      effectiveDate: new Date(effDate),
      hours: parseFloat(data[i][h['NewHours']]) || 0,
      hoursType: String(data[i][h['NewHoursType']]||''),
      breakdown: h['NewScheduleBreakdown']!==undefined ? String(data[i][h['NewScheduleBreakdown']]||'') : ''
    });
  }
  Object.keys(timelines).forEach(function(connId) {
    timelines[connId].sort(function(a,b){ return a.effectiveDate - b.effectiveDate; });
  });
  return timelines;
}

// Returns the schedule entry in effect for connId as of a given date (the
// latest entry with effectiveDate <= asOfDate), or null if none yet.
// One-time utility — populates January's Actual Hours to exactly match
// Projected Hours for every connection with a live schedule that month,
// covering both cutoffs (1st-15th, 16th-end) since they're just a
// display split of the same underlying per-day records, not separate
// storage. Skips any day with no projected value (no schedule in effect,
// or a Project Based connection where day-by-day projection doesn't
// apply) — there's nothing meaningful to match there. Run manually from
// the Apps Script editor (select this function, then Run); not exposed
// to the frontend, since it's a backfill tool, not a regular feature.
function generateJanuaryAttendanceMatchingProjected(year) {
  year = parseInt(year, 10) || new Date().getFullYear();
  var dataRes = getAttendanceData(1, year); // January
  if (!dataRes.success) return dataRes;

  var yearMonth = year + '-01';
  var records = [];
  dataRes.data.forEach(function(row) {
    if (row.cutoff1ProjectedHours === null && row.cutoff2ProjectedHours === null) return; // no schedule in effect all month
    records.push({
      connectionId: row.connectionId,
      yearMonth: yearMonth,
      cutoff1Date: row.cutoff1Date,
      cutoff1ProjectedHours: row.cutoff1ProjectedHours,
      cutoff1ActualHours: row.cutoff1ProjectedHours, // Actual = Projected, per the request
      cutoff2Date: row.cutoff2Date,
      cutoff2ProjectedHours: row.cutoff2ProjectedHours,
      cutoff2ActualHours: row.cutoff2ProjectedHours,
      overtimeHours: 0, nightDifferentialHours: 0, salaryIncrease: 0, others: 0, refundHours: 0, absenceHours: 0,
      totalBilledHours: null, billedStatus: 'Not Billed', billingDate: '', paymentStatus: 'Not Yet Paid', paymentDate: ''
    });
  });

  if (!records.length) {
    return { success: true, saved: 0, message: 'No connections had a live schedule in January ' + year + ' — nothing to generate.' };
  }

  var saveRes = saveAttendanceRecords(records);
  if (!saveRes.success) return saveRes;
  return { success: true, saved: saveRes.saved, connectionsCovered: dataRes.data.length, message: 'Generated ' + saveRes.saved + ' monthly attendance records for January ' + year + ' (both cutoffs), Actual Hours set equal to Projected Hours.' };
}

function _attScheduleAsOf(timeline, asOfDate) {
  var result = null;
  (timeline||[]).forEach(function(entry) {
    if (entry.effectiveDate <= asOfDate) result = entry;
  });
  return result;
}

var ATT_DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; // JS getDay() order

function getAttendanceData(month, year) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    month = parseInt(month, 10); year = parseInt(year, 10);
    if (!month || !year) return { success: false, error: 'Month and year are required.' };

    var shared = _attLoadSharedData();
    var rows = _attComputeMonthRows(shared, month, year);
    return { success: true, data: rows, daysInMonth: new Date(year, month, 0).getDate(), cutoff1Day: 15 };
  } catch (e) {
    return { success: false, error: 'getAttendanceData: ' + e.message };
  }
}

// Reads everything genuinely shared across every month — connections,
// client/customer names, department-per-request, schedule timelines, and
// every attendance record on file (not filtered by month here, since
// different months need different slices of it). Read once regardless of
// how many months get computed from it afterward.
function _attLoadSharedData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var connSheet = _connGetSheet(ss);
  var connData = connSheet.getDataRange().getValues();
  var ch = _connHMap(connData[0]);

  var cliMap = {}, custMap = {};
  var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  if (cliSheet) {
    var cliData = cliSheet.getDataRange().getValues();
    var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
    for (var i = 1; i < cliData.length; i++) {
      var cid = String(cliData[i][clh['ClientID']]||''); if (!cid) continue;
      cliMap[cid] = {
        companyName: String(cliData[i][clh['CompanyName']]||''),
        accountName: String(cliData[i][clh['AccountName']]||''),
        customerId: String(cliData[i][clh['CustomerID']]||'')
      };
    }
  }
  var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
  if (custSheet) {
    var custData = custSheet.getDataRange().getValues();
    var cuh = {}; custData[0].forEach(function(c,i){ if(c) cuh[String(c)]=i; });
    for (var j = 1; j < custData.length; j++) {
      var cuid = String(custData[j][cuh['CustomerID']]||''); if (!cuid) continue;
      custMap[cuid] = String(custData[j][cuh['CustomerName']]||'');
    }
  }

  var deptByRequest = {};
  var reqSheet = _reqGetSheet(ss);
  if (reqSheet) {
    var reqData = reqSheet.getDataRange().getValues();
    var rh = {}; reqData[0].forEach(function(c,i){ if(c) rh[String(c)]=i; });
    for (var k = 1; k < reqData.length; k++) {
      var rid = String(reqData[k][rh['RequestID']]||''); if (!rid) continue;
      deptByRequest[rid] = String(reqData[k][rh['Department']]||'');
    }
  }

  var timelines = _attBuildScheduleTimelines();

  // Every attendance record on file, indexed by ConnectionID|YearMonth —
  // per-month filtering happens in _attComputeMonthRows, not here.
  var attSheet = _attGetSheet(ss);
  var attData = attSheet.getDataRange().getValues();
  var ah = {}; attData[0].forEach(function(c,i){ if(c) ah[String(c)]=i; });
  var attByKey = {};
  for (var m = 1; m < attData.length; m++) {
    var recYm = String(attData[m][ah['YearMonth']]||''); if (!recYm) continue;
    var recConnId = String(attData[m][ah['ConnectionID']]||''); if (!recConnId) continue;
    attByKey[recConnId + '|' + recYm] = {
      cutoff1ActualHours: attData[m][ah['Cutoff1ActualHours']] !== '' ? parseFloat(attData[m][ah['Cutoff1ActualHours']]) : null,
      cutoff2ActualHours: attData[m][ah['Cutoff2ActualHours']] !== '' ? parseFloat(attData[m][ah['Cutoff2ActualHours']]) : null,
      overtimeHours: parseFloat(attData[m][ah['OvertimeHours']]) || 0,
      nightDifferentialHours: parseFloat(attData[m][ah['NightDifferentialHours']]) || 0,
      salaryIncrease: parseFloat(attData[m][ah['SalaryIncrease']]) || 0,
      others: parseFloat(attData[m][ah['Others']]) || 0,
      refundHours: parseFloat(attData[m][ah['RefundHours']]) || 0,
      absenceHours: parseFloat(attData[m][ah['AbsenceHours']]) || 0,
      totalBilledHours: attData[m][ah['TotalBilledHours']] !== '' ? parseFloat(attData[m][ah['TotalBilledHours']]) : null,
      billedStatus: String(attData[m][ah['BilledStatus']]||'Not Billed'),
      billingDate: attData[m][ah['BillingDate']] ? new Date(attData[m][ah['BillingDate']]).toISOString().substring(0,10) : '',
      paymentStatus: String(attData[m][ah['PaymentStatus']]||'Not Yet Paid'),
      paymentDate: attData[m][ah['PaymentDate']] ? new Date(attData[m][ah['PaymentDate']]).toISOString().substring(0,10) : ''
    };
  }

  return { connData: connData, ch: ch, cliMap: cliMap, custMap: custMap, deptByRequest: deptByRequest, timelines: timelines, attByKey: attByKey };
}

// Computes one month's rows from already-loaded shared data — identical
// logic to what getAttendanceData always did, just no longer re-reading
// any sheet itself.
function _attComputeMonthRows(shared, month, year) {
    var connData = shared.connData, ch = shared.ch, cliMap = shared.cliMap, custMap = shared.custMap,
        deptByRequest = shared.deptByRequest, timelines = shared.timelines;

    var monthStart = new Date(year, month - 1, 1);
    var monthEnd   = new Date(year, month, 0, 23, 59, 59, 999);
    var daysInMonth = monthEnd.getDate();
    var cutoff1Day = 15; // "normally the 15th" — the split point between the two cutoffs
    var yearMonth = year + '-' + String(month).padStart(2, '0');
    var cutoff1Date = new Date(year, month - 1, cutoff1Day);
    var cutoff2Date = new Date(year, month - 1, daysInMonth);

    var rows = [];
    for (var ci = 1; ci < connData.length; ci++) {
      var status = String(connData[ci][ch['ConnectionStatus']]||'');
      if (status === 'Pending' || status === 'Accepted' || status === 'Cancelled' || status === 'Declined') continue; // never actually worked
      var connId = String(connData[ci][ch['ConnectionID']]||'');
      var vaNameForRow = String(connData[ci][ch['VAName']]||'');
      var startVal = connData[ci][ch['ActualStartDate']]; if (!startVal) continue;
      var startDate = new Date(startVal);

      if (isNaN(startDate.getTime())) {
        // Broken date — can't tell which month this connection even
        // belongs to, so show it regardless of the selected month rather
        // than silently dropping it. Flagged for the frontend to mark
        // with a warning icon; everything date-dependent is left blank.
        rows.push({
          connectionId: connId, vaName: vaNameForRow,
          clientId: String(connData[ci][ch['ClientID']]||''), customerId: '', customerName: '', accountName: '',
          status: status, department: '', hoursType: '', weeklyHours: 0, scheduleBreakdown: '',
          startDate: '', endDate: '',
          cutoff1Date: '', cutoff1ProjectedHours: null, cutoff1ActualHours: null,
          cutoff2Date: '', cutoff2ProjectedHours: null, cutoff2ActualHours: null,
          overtimeHours: 0, nightDifferentialHours: 0, salaryIncrease: 0, others: 0, refundHours: 0, absenceHours: 0,
          totalBilledHours: null, billedStatus: 'Not Billed', billingDate: '', paymentStatus: 'Not Yet Paid', paymentDate: '',
          rate: 0, ndPercent: 0,
          hasDataIssue: true, dataIssue: 'ActualStartDate is not a valid date ("' + startVal + '")'
        });
        continue;
      }
      if (startDate > monthEnd) continue; // hadn't started yet this month

      var endVal = null;
      if (status === 'Terminated' && ch['TerminationDate'] !== undefined) endVal = connData[ci][ch['TerminationDate']];
      else if (status === 'Paused' && ch['LastPausedAt'] !== undefined) endVal = connData[ci][ch['LastPausedAt']];
      // Older/migrated Terminated connections sometimes never had
      // TerminationDate populated even though status says Terminated —
      // treating that as "unknown end date, so always include it" would
      // mean a long-dead connection shows up indefinitely in every future
      // month's attendance. UpdatedAt (set whenever the row was last
      // touched, which for a Terminated row is almost always the
      // termination itself) is a far better proxy than leaving it open-ended.
      if (!endVal && status === 'Terminated' && ch['UpdatedAt'] !== undefined) {
        endVal = connData[ci][ch['UpdatedAt']];
      }
      var endDate = null;
      var endDateIssue = '';
      if (endVal) {
        var parsedEnd = new Date(endVal);
        if (isNaN(parsedEnd.getTime())) {
          endDateIssue = (status==='Terminated'?'TerminationDate':'LastPausedAt') + ' is not a valid date ("' + endVal + '")';
          // Don't know the true end window — safest is to still show the
          // connection as active for this month rather than hide it.
        } else {
          endDate = parsedEnd;
        }
      }
      if (endDate && endDate < monthStart) continue; // ended before this month started

      var clientId = String(connData[ci][ch['ClientID']]||'');
      var cliInfo = cliMap[clientId] || {};
      var custId = cliInfo.customerId || String(connData[ci][ch['CustomerID']]||'');
      var requestId = String(connData[ci][ch['RequestID']]||'');

      // Status label for THIS specific month
      var monthStatus;
      if (startDate >= monthStart && startDate <= monthEnd) monthStatus = 'New';
      else if (status === 'Terminated' && endDate && endDate >= monthStart && endDate <= monthEnd) monthStatus = 'Terminated';
      else if (status === 'Paused' && endDate && endDate >= monthStart && endDate <= monthEnd) monthStatus = 'Paused';
      else if (status === 'Terminated') monthStatus = 'Terminated';
      else if (status === 'Paused') monthStatus = 'Paused';
      else monthStatus = 'Active';

      var timeline = timelines[connId] || [];
      var latestOverall = timeline.length ? timeline[timeline.length-1] : null;

      // Projected hours are still derived live, per day, from whichever
      // schedule was in effect that day — but now summed into exactly
      // two cutoff buckets instead of kept as a day-by-day map.
      var cutoff1Projected = 0, cutoff2Projected = 0;
      var cutoff1HasSchedule = false, cutoff2HasSchedule = false;
      for (var dnum = 1; dnum <= daysInMonth; dnum++) {
        var thisDate = new Date(year, month - 1, dnum);
        var beforeStart = thisDate < startDate;
        var afterEnd = endDate && thisDate > endDate;
        var sched = _attScheduleAsOf(timeline, thisDate);
        if (beforeStart || afterEnd || !sched || sched.hoursType === 'Project Based' || !sched.breakdown) continue;
        var dayHours = 0;
        try {
          var bd = JSON.parse(sched.breakdown);
          var dayAbbr = ATT_DAY_ABBR[thisDate.getDay()];
          var match = bd.find(function(g){ return (g.days||[]).indexOf(dayAbbr) !== -1; });
          dayHours = match ? match.hoursPerDay : 0;
        } catch (e) { continue; }
        if (dnum <= cutoff1Day) { cutoff1Projected += dayHours; cutoff1HasSchedule = true; }
        else { cutoff2Projected += dayHours; cutoff2HasSchedule = true; }
      }

      var existingRec = shared.attByKey[connId + '|' + yearMonth] || {};

      rows.push({
        connectionId: connId,
        vaName: String(connData[ci][ch['VAName']]||''),
        clientId: clientId,
        customerId: custId,
        customerName: custMap[custId] || custId,
        accountName: cliInfo.accountName || cliInfo.companyName || '',
        status: monthStatus,
        department: deptByRequest[requestId] || '',
        hoursType: latestOverall ? latestOverall.hoursType : String(connData[ci][ch['HoursType']]||''),
        weeklyHours: latestOverall ? latestOverall.hours : parseFloat(connData[ci][ch['Hours']])||0,
        scheduleBreakdown: latestOverall ? latestOverall.breakdown : '',
        startDate: startDate.toISOString(),
        endDate: endDate ? endDate.toISOString() : '',
        cutoff1Date: cutoff1Date.toISOString().substring(0,10),
        cutoff1ProjectedHours: cutoff1HasSchedule ? Math.round(cutoff1Projected*100)/100 : null,
        cutoff1ActualHours: existingRec.cutoff1ActualHours !== undefined ? existingRec.cutoff1ActualHours : null,
        cutoff2Date: cutoff2Date.toISOString().substring(0,10),
        cutoff2ProjectedHours: cutoff2HasSchedule ? Math.round(cutoff2Projected*100)/100 : null,
        cutoff2ActualHours: existingRec.cutoff2ActualHours !== undefined ? existingRec.cutoff2ActualHours : null,
        overtimeHours: existingRec.overtimeHours || 0,
        nightDifferentialHours: existingRec.nightDifferentialHours || 0,
        salaryIncrease: existingRec.salaryIncrease || 0,
        others: existingRec.others || 0,
        refundHours: existingRec.refundHours || 0,
        absenceHours: existingRec.absenceHours || 0,
        totalBilledHours: existingRec.totalBilledHours !== undefined ? existingRec.totalBilledHours : null,
        billedStatus: existingRec.billedStatus || 'Not Billed',
        billingDate: existingRec.billingDate || '',
        paymentStatus: existingRec.paymentStatus || 'Not Yet Paid',
        paymentDate: existingRec.paymentDate || '',
        rate: parseFloat(connData[ci][ch['Rate']])||0,
        ndPercent: connData[ci][ch['NightDiffApplicable']] ? (parseFloat(connData[ci][ch['NightDiffPercent']])||0) : 0,
        hasDataIssue: !!endDateIssue,
        dataIssue: endDateIssue || ''
      });
    }

    rows.sort(function(a,b){ return (a.vaName||'').localeCompare(b.vaName||''); });
    return rows;
}

// Exports every VA connection across every month it was active, one tab
// per month — reuses _attComputeMonthRows directly (identical logic to
// the single-month table), so a connection terminated in January still
// shows in January's tab but correctly won't appear in February's.
function exportAllVAConnectionsByMonth(fromMonth, fromYear, toMonth, toYear) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    fromMonth = parseInt(fromMonth, 10); fromYear = parseInt(fromYear, 10);
    toMonth = parseInt(toMonth, 10); toYear = parseInt(toYear, 10);
    if (!fromMonth || !fromYear || !toMonth || !toYear) return { success: false, error: 'A valid date range is required.' };
    if (toYear < fromYear || (toYear === fromYear && toMonth < fromMonth)) return { success: false, error: '"To" must be on or after "From".' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    if (connData.length <= 1) return { success: false, error: 'No VA connections were found.' };

    var startMonth = fromMonth, startYear = fromYear;
    var endMonth = toMonth, endYear = toYear;

    var shared = _attLoadSharedData();

    var now = new Date();
    var exportSs = SpreadsheetApp.create('VA Connections Export ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss'));
    var defaultSheet = exportSs.getSheets()[0]; // the blank sheet every new spreadsheet starts with

    var monthsWritten = 0;
    var y = startYear, m = startMonth;
    while (y < endYear || (y === endYear && m <= endMonth)) {
      var rows = _attComputeMonthRows(shared, m, y);
      if (rows.length) {
        _attWriteMonthTab(exportSs, m, y, rows);
        monthsWritten++;
      }
      m++; if (m > 12) { m = 1; y++; }
    }

    // The default blank sheet only gets removed once at least one real
    // month tab exists — a spreadsheet can't have zero sheets.
    if (monthsWritten > 0) { try { exportSs.deleteSheet(defaultSheet); } catch (delDefaultEx) {} }
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + exportSs.getId() + '/export?format=xlsx';
    var response = UrlFetchApp.fetch(url, { headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() } });
    var base64 = Utilities.base64Encode(response.getContent());

    // Clean up the temporary export file from Drive now that its content
    // has been captured as base64 — nothing after this point needs it.
    try { DriveApp.getFileById(exportSs.getId()).setTrashed(true); } catch (trashEx) { Logger.log('exportAllVAConnectionsByMonth cleanup: ' + trashEx.message); }

    return { success: true, base64: base64, fileName: 'VA Connections Export.xlsx', monthsIncluded: monthsWritten };
  } catch (e) {
    return { success: false, error: 'exportAllVAConnectionsByMonth: ' + e.message };
  }
}

var ATT_EXPORT_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _attWriteMonthTab(targetSs, month, year, rows) {
  var tabName = ATT_EXPORT_MONTH_NAMES[month-1] + ' ' + year;
  var sheet = targetSs.insertSheet(tabName);
  var monthLabel = ATT_EXPORT_MONTH_NAMES[month-1] + ' ' + year;

  var addBlockHeaders = ['Additions Total','Overtime','ND Hours','ND Rate','Night Differential','Salary Increase','Others','Deductions','Refund','Absence'];
  var headers = ['Month','Connection ID','VA Name','Customer','Account','Status','Department','Hours Type','Weekly Hours',
    'Billed Status','Billing Date','Payment Status','Payment Date','Start Date','End Date','Total Billed Hours',
    'Cutoff 1 Date','Cutoff 1 Projected','Cutoff 1 Actual'].concat(addBlockHeaders,
    ['Cutoff 2 Date','Cutoff 2 Projected','Cutoff 2 Actual'], addBlockHeaders);
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');

  var out = rows.map(function(r) {
    // ND Hours is what's already tracked (nightDifferentialHours); the
    // dollar amount itself is newly computed here from the connection's
    // actual rate and its Night Differential percentage — neither of
    // those existed as their own export columns before this.
    var ndHours = r.nightDifferentialHours || 0;
    var ndRate = r.ndPercent || 0;
    var ndAmount = Math.round(ndHours * (r.rate||0) * (ndRate/100) * 100) / 100;
    // Additions Total sums only the dollar-denominated fields (ND amount,
    // Salary Increase, Others) — Overtime and ND Hours are shown for
    // reference alongside it, but aren't summed in, since they're hours,
    // not dollars, and adding hours to a dollar figure would be
    // meaningless. Deductions (Refund + Absence) are both hours, so that
    // sum is unambiguous on its own.
    var additionsTotal = Math.round((ndAmount + (r.salaryIncrease||0) + (r.others||0)) * 100) / 100;
    var deductionsTotal = Math.round(((r.refundHours||0) + (r.absenceHours||0)) * 100) / 100;

    // Overtime/Salary Increase/Others/Refund/Absence are tracked as
    // single monthly totals, not split per cutoff — the same monthly
    // figures are shown under both cutoff sections below rather than
    // guessing at an arbitrary split, since there's no per-cutoff data
    // to actually divide.
    var addBlock = [additionsTotal, r.overtimeHours||0, ndHours, ndRate, ndAmount, r.salaryIncrease||0, r.others||0, deductionsTotal, r.refundHours||0, r.absenceHours||0];

    return [
      monthLabel, r.connectionId, r.vaName, r.customerName, r.accountName, r.status, r.department, r.hoursType, r.weeklyHours,
      r.billedStatus, r.billingDate ? new Date(r.billingDate) : '', r.paymentStatus, r.paymentDate ? new Date(r.paymentDate) : '',
      r.startDate ? new Date(r.startDate) : '', r.endDate ? new Date(r.endDate) : '', r.totalBilledHours,
      r.cutoff1Date ? new Date(r.cutoff1Date) : '', r.cutoff1ProjectedHours, r.cutoff1ActualHours
    ].concat(addBlock,
      [r.cutoff2Date ? new Date(r.cutoff2Date) : '', r.cutoff2ProjectedHours, r.cutoff2ActualHours],
      addBlock);
  });
  if (out.length) sheet.getRange(2,1,out.length,headers.length).setValues(out);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
}

// Every connection worth entering billing history for — used to build
// the downloadable import template, per the request. Excludes
// Cancelled/Declined connections, since those never actually had any
// billing to speak of.
function getConnectionsForBillingImportTemplate() {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var ch = _connHMap(connData[0]);

    var cliMap = {}, custMap = {};
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (cliSheet) {
      var cliData = cliSheet.getDataRange().getValues();
      var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
      for (var ci = 1; ci < cliData.length; ci++) {
        var cid = String(cliData[ci][clh['ClientID']]||''); if (!cid) continue;
        cliMap[cid] = {
          accountName: String(cliData[ci][clh['AccountName']]||cliData[ci][clh['CompanyName']]||''),
          customerId: String(cliData[ci][clh['CustomerID']]||'')
        };
      }
    }
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSheet) {
      var custData = custSheet.getDataRange().getValues();
      var cuh = {}; custData[0].forEach(function(c,i){ if(c) cuh[String(c)]=i; });
      for (var cu = 1; cu < custData.length; cu++) {
        var cuid = String(custData[cu][cuh['CustomerID']]||''); if (!cuid) continue;
        custMap[cuid] = String(custData[cu][cuh['CustomerName']]||'');
      }
    }

    var rows = [];
    for (var i = 1; i < connData.length; i++) {
      var status = String(connData[i][ch['ConnectionStatus']]||'');
      if (status === 'Pending' || status === 'Accepted' || status === 'Cancelled' || status === 'Declined') continue;
      var clientId = String(connData[i][ch['ClientID']]||'');
      var cliInfo = cliMap[clientId] || {};
      var custId = cliInfo.customerId || String(connData[i][ch['CustomerID']]||'');
      rows.push({
        connectionId: String(connData[i][ch['ConnectionID']]||''),
        vaName: String(connData[i][ch['VAName']]||''),
        customerName: custMap[custId] || custId,
        accountName: cliInfo.accountName || '',
        status: status
      });
    }
    rows.sort(function(a,b){ return (a.vaName||'').localeCompare(b.vaName||''); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getConnectionsForBillingImportTemplate: ' + e.message };
  }
}

// Bulk-imports ONLY the 4 billing-related fields, per the request — Billing
// Month/Year, Billing Date, Billed Status, Payment Status, Payment Date.
// Deliberately does not touch hours or any other field: if a row already
// exists for this connection/month, only these fields are updated; a new
// row leaves everything else blank for a later import to fill in, rather
// than guessing values for fields this import was never given.
function importBillingRecords(rows) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!rows || !rows.length) return { success: true, saved: 0 };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _attGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var now = new Date();

    var rowIndex = {};
    for (var i = 1; i < data.length; i++) {
      var ym = String(data[i][h['YearMonth']]||''); if (!ym) continue;
      var key = String(data[i][h['ConnectionID']]||'') + '|' + ym;
      rowIndex[key] = i + 1;
    }

    var saved = 0, errors = [];
    rows.forEach(function(rec, idx) {
      if (!rec.connectionId || !rec.yearMonth) { errors.push('Row ' + (idx+2) + ': missing Connection ID or Billing Month/Year.'); return; }
      var key = rec.connectionId + '|' + rec.yearMonth;
      var existingRow = rowIndex[key];

      if (existingRow) {
        if (rec.billingDate !== undefined) sheet.getRange(existingRow, h['BillingDate']+1).setValue(rec.billingDate ? new Date(rec.billingDate) : '');
        if (rec.billedStatus !== undefined) sheet.getRange(existingRow, h['BilledStatus']+1).setValue(rec.billedStatus || 'Not Billed');
        if (rec.paymentStatus !== undefined) sheet.getRange(existingRow, h['PaymentStatus']+1).setValue(rec.paymentStatus || 'Not Yet Paid');
        if (rec.paymentDate !== undefined) sheet.getRange(existingRow, h['PaymentDate']+1).setValue(rec.paymentDate ? new Date(rec.paymentDate) : '');
        sheet.getRange(existingRow, h['UpdatedAt']+1).setValue(now);
        sheet.getRange(existingRow, h['UpdatedBy']+1).setValue(perm.user.email);
      } else {
        var arr = new Array(Object.keys(h).length).fill('');
        arr[h['RecordID']] = generateID('ATT');
        arr[h['ConnectionID']] = rec.connectionId;
        arr[h['YearMonth']] = rec.yearMonth;
        arr[h['BillingDate']] = rec.billingDate ? new Date(rec.billingDate) : '';
        arr[h['BilledStatus']] = rec.billedStatus || 'Not Billed';
        arr[h['PaymentStatus']] = rec.paymentStatus || 'Not Yet Paid';
        arr[h['PaymentDate']] = rec.paymentDate ? new Date(rec.paymentDate) : '';
        arr[h['CreatedAt']] = now;
        arr[h['CreatedBy']] = perm.user.email;
        arr[h['UpdatedAt']] = now;
        arr[h['UpdatedBy']] = perm.user.email;
        sheet.appendRow(arr);
      }
      saved++;
    });

    return { success: true, saved: saved, errors: errors };
  } catch (e) {
    return { success: false, error: 'importBillingRecords: ' + e.message };
  }
}

function saveAttendanceRecords(records) {

  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!records || !records.length) return { success: true, saved: 0 };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _attGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var now = new Date();

    // Index existing rows by ConnectionID|YearMonth for fast upsert — one
    // row per connection per month now, not one per day.
    var rowIndex = {};
    for (var i = 1; i < data.length; i++) {
      var ym = String(data[i][h['YearMonth']]||''); if (!ym) continue;
      var key = String(data[i][h['ConnectionID']]||'') + '|' + ym;
      rowIndex[key] = i + 1; // 1-based sheet row number
    }

    var numField = function(v) { return (v === '' || v === null || v === undefined) ? '' : parseFloat(v); };
    var saved = 0;
    records.forEach(function(rec) {
      if (!rec.connectionId || !rec.yearMonth) return;
      var key = rec.connectionId + '|' + rec.yearMonth;
      var existingRow = rowIndex[key];

      if (existingRow) {
        sheet.getRange(existingRow, h['Cutoff1Date']+1).setValue(rec.cutoff1Date ? new Date(rec.cutoff1Date) : '');
        sheet.getRange(existingRow, h['Cutoff1ProjectedHours']+1).setValue(numField(rec.cutoff1ProjectedHours));
        sheet.getRange(existingRow, h['Cutoff1ActualHours']+1).setValue(numField(rec.cutoff1ActualHours));
        sheet.getRange(existingRow, h['Cutoff2Date']+1).setValue(rec.cutoff2Date ? new Date(rec.cutoff2Date) : '');
        sheet.getRange(existingRow, h['Cutoff2ProjectedHours']+1).setValue(numField(rec.cutoff2ProjectedHours));
        sheet.getRange(existingRow, h['Cutoff2ActualHours']+1).setValue(numField(rec.cutoff2ActualHours));
        sheet.getRange(existingRow, h['OvertimeHours']+1).setValue(numField(rec.overtimeHours) || 0);
        sheet.getRange(existingRow, h['NightDifferentialHours']+1).setValue(numField(rec.nightDifferentialHours) || 0);
        sheet.getRange(existingRow, h['SalaryIncrease']+1).setValue(numField(rec.salaryIncrease) || 0);
        sheet.getRange(existingRow, h['Others']+1).setValue(numField(rec.others) || 0);
        sheet.getRange(existingRow, h['RefundHours']+1).setValue(numField(rec.refundHours) || 0);
        sheet.getRange(existingRow, h['AbsenceHours']+1).setValue(numField(rec.absenceHours) || 0);
        sheet.getRange(existingRow, h['TotalBilledHours']+1).setValue(numField(rec.totalBilledHours));
        sheet.getRange(existingRow, h['BilledStatus']+1).setValue(rec.billedStatus || 'Not Billed');
        sheet.getRange(existingRow, h['BillingDate']+1).setValue(rec.billingDate ? new Date(rec.billingDate) : '');
        sheet.getRange(existingRow, h['PaymentStatus']+1).setValue(rec.paymentStatus || 'Not Yet Paid');
        sheet.getRange(existingRow, h['PaymentDate']+1).setValue(rec.paymentDate ? new Date(rec.paymentDate) : '');
        sheet.getRange(existingRow, h['UpdatedAt']+1).setValue(now);
        sheet.getRange(existingRow, h['UpdatedBy']+1).setValue(perm.user.email);
      } else {
        var arr = new Array(Object.keys(h).length).fill('');
        arr[h['RecordID']] = generateID('ATT');
        arr[h['ConnectionID']] = rec.connectionId;
        arr[h['YearMonth']] = rec.yearMonth;
        arr[h['Cutoff1Date']] = rec.cutoff1Date ? new Date(rec.cutoff1Date) : '';
        arr[h['Cutoff1ProjectedHours']] = numField(rec.cutoff1ProjectedHours);
        arr[h['Cutoff1ActualHours']] = numField(rec.cutoff1ActualHours);
        arr[h['Cutoff2Date']] = rec.cutoff2Date ? new Date(rec.cutoff2Date) : '';
        arr[h['Cutoff2ProjectedHours']] = numField(rec.cutoff2ProjectedHours);
        arr[h['Cutoff2ActualHours']] = numField(rec.cutoff2ActualHours);
        arr[h['OvertimeHours']] = numField(rec.overtimeHours) || 0;
        arr[h['NightDifferentialHours']] = numField(rec.nightDifferentialHours) || 0;
        arr[h['SalaryIncrease']] = numField(rec.salaryIncrease) || 0;
        arr[h['Others']] = numField(rec.others) || 0;
        arr[h['RefundHours']] = numField(rec.refundHours) || 0;
        arr[h['AbsenceHours']] = numField(rec.absenceHours) || 0;
        arr[h['TotalBilledHours']] = numField(rec.totalBilledHours);
        arr[h['BilledStatus']] = rec.billedStatus || 'Not Billed';
        arr[h['BillingDate']] = rec.billingDate ? new Date(rec.billingDate) : '';
        arr[h['PaymentStatus']] = rec.paymentStatus || 'Not Yet Paid';
        arr[h['PaymentDate']] = rec.paymentDate ? new Date(rec.paymentDate) : '';
        arr[h['CreatedAt']] = now;
        arr[h['CreatedBy']] = perm.user.email;
        arr[h['UpdatedAt']] = now;
        arr[h['UpdatedBy']] = perm.user.email;
        sheet.appendRow(arr);
      }
      saved++;
    });

    return { success: true, saved: saved };
  } catch (e) {
    return { success: false, error: 'saveAttendanceRecords: ' + e.message };
  }
}

// Writes the attendance grid into a dedicated, formatted sheet tab (so the
// export genuinely reflects cutoff summaries/coloring, not just raw data),
// then returns that tab as a base64-encoded .xlsx the browser can download
// directly — Apps Script has no other way to hand back a real Excel file
// without leaving a Sheets tab behind as the source for it.
function exportAttendanceToExcel(month, year, rows) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Sweep up any leftover export tabs from previous runs — this
    // function used to never delete its own temporary tab, silently
    // bloating the live spreadsheet with an extra sheet on every export.
    try {
      ss.getSheets().forEach(function(sh) {
        if (/^Attendance Export /.test(sh.getName())) ss.deleteSheet(sh);
      });
    } catch (cleanupEx) { Logger.log('exportAttendanceToExcel cleanup: ' + cleanupEx.message); }

    var tabName = 'Attendance Export ' + month + '-' + year;
    var sheet = ss.insertSheet(tabName);

    var daysInMonth = new Date(year, month, 0).getDate();
    var headers = ['VA Name','Customer','Account','Status','Department','Hours Type','Weekly Hours','Start Date','End Date'];
    for (var d = 1; d <= daysInMonth; d++) headers.push(String(d));
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');

    var out = (rows||[]).map(function(r) {
      var row = [r.vaName, r.customerName, r.accountName, r.status, r.department, r.hoursType, r.weeklyHours,
                 r.startDate ? new Date(r.startDate) : '', r.endDate ? new Date(r.endDate) : ''];
      for (var d2 = 1; d2 <= daysInMonth; d2++) {
        var dateKey = new Date(year, month-1, d2).toISOString().substring(0,10);
        var actual = r.dailyActual && r.dailyActual[dateKey] ? r.dailyActual[dateKey].hours : null;
        var projected = r.dailyProjected ? r.dailyProjected[dateKey] : null;
        row.push(actual !== null && actual !== undefined ? actual : (projected !== null ? projected : ''));
      }
      return row;
    });
    if (out.length) sheet.getRange(2,1,out.length,headers.length).setValues(out);
    sheet.setFrozenColumns(1);
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx&gid=' + sheet.getSheetId();
    var response = UrlFetchApp.fetch(url, { headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() } });
    var base64 = Utilities.base64Encode(response.getContent());

    // Clean up the temporary tab now that the export is generated —
    // nothing after this point needs it to exist.
    try { ss.deleteSheet(sheet); } catch (delEx) { Logger.log('exportAttendanceToExcel tab cleanup: ' + delEx.message); }

    return { success: true, base64: base64, fileName: tabName + '.xlsx' };
  } catch (e) {
    return { success: false, error: 'exportAttendanceToExcel: ' + e.message };
  }
}