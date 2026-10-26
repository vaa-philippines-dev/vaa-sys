// ═══════════════════════════════════════════════════════════
// PerformanceReportService.gs — the "Performance Report"
// ═══════════════════════════════════════════════════════════
//
// One full year (Jan–Dec) × department (+ Total) grid, five/six sections:
//   1. Customer Accounts  — reuses getCustomerAccountReport's "customers" data
//   2. Connections        — reuses getCustomerAccountReport's "clients" data
//      (same underlying engine as the existing Customer/Account Report —
//      this is deliberate: that function already computes month-end
//      snapshot semantics correctly, including the "paused and resumed in
//      the same month doesn't count as either" behavior, since it only
//      ever looks at each month's END state.)
//   3. Hours               — computed fresh here from VAConnectionHoursLog
//   4. KPI Performance      — empty placeholder, data to be added later
//   5. Retention & Meetings — empty placeholder, data to be added later
//
// Departments come from Settings (Department category) — not hardcoded —
// so this stays in sync with however departments are actually configured.

function getPerformanceReport(year) {
  try {
    var y = parseInt(year, 10) || new Date().getFullYear();
    var months = [];
    for (var m = 0; m < 12; m++) months.push(y + '-' + String(m + 1).padStart(2, '0'));

    var caRes = getCustomerAccountReport({ months: months });
    if (!caRes.success) return caRes;

    var hoursRes = _perfComputeHoursSection(months, caRes.departments);
    if (hoursRes.success) {
      months.forEach(function(ym) {
        var custMonth = caRes.monthly.customers[ym];
        Object.keys(hoursRes.data[ym] || {}).forEach(function(d) {
          var lookupDept = (d === 'Total') ? '(All)' : d; // '(All)' is the real deduplicated bucket
          var activeCount = (custMonth && custMonth.data && custMonth.data[lookupDept] && custMonth.data[lookupDept].active) || 0;
          hoursRes.data[ym][d].avgHoursPerActiveClient = activeCount > 0
            ? Math.round((hoursRes.data[ym][d].totalHoursThisMonth / activeCount) * 10) / 10
            : 0;
        });
      });
    }

    // "Pending" for Connections — a Service Request ticket filed for a
    // department that hasn't yet resulted in a Started connection, as of
    // that month's end. Distinct from "no active VAs" (an account that HAD
    // a VA and lost it) — this is "asked for one, doesn't have one yet."
    _perfAddPendingConnections(caRes.monthly.clients, months, caRes.departments);

    return {
      success: true,
      year: y,
      months: months,
      monthLabels: caRes.monthLabels,
      departments: caRes.departments,
      customerAccounts: caRes.monthly.customers,
      connections: caRes.monthly.clients,
      hours: hoursRes,
      // Empty on purpose — these two sections have no data source yet.
      kpi: { rows: ['kpiOnTarget', 'kpiOffTarget', 'kpiOnTargetPct'], data: {} },
      retention: { rows: ['offboardingMeetings', 'offboardingCoveragePct', 'firstFollowupMeetings', 'followupCoveragePct'], data: {} }
    };
  } catch (e) {
    return { success: false, error: 'getPerformanceReport: ' + e.message };
  }
}

function _perfAddPendingConnections(clientsMonthly, months, departments) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!reqSheet) return;
    var reqData = reqSheet.getDataRange().getValues();
    var rh = {}; reqData[0].forEach(function(c,i){ if(c) rh[String(c)]=i; });

    // requestId → whether it ever got a Started connection, and when that
    // first happened (so "pending as of month X" can tell whether it was
    // still pending at that point).
    var startedByRequest = {};
    if (connSheet) {
      var connData = connSheet.getDataRange().getValues();
      var ch = {}; connData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
      for (var ci = 1; ci < connData.length; ci++) {
        if (String(connData[ci][ch['ConnectionStatus']]||'') !== 'Started') continue;
        var rid = String(connData[ci][ch['RequestID']]||''); if (!rid) continue;
        var startDate = connData[ci][ch['ActualStartDate']];
        if (!startedByRequest[rid] || (startDate && new Date(startDate) < new Date(startedByRequest[rid]))) {
          startedByRequest[rid] = startDate || new Date();
        }
      }
    }

    var deptList = departments.filter(function(d){ return d !== '(All)'; });

    months.forEach(function(ym) {
      var parts = ym.split('-'); var yy = parseInt(parts[0],10), mm = parseInt(parts[1],10)-1;
      var monthEnd = new Date(yy, mm+1, 0, 23,59,59,999);
      var counts = {}; deptList.concat(['(All)']).forEach(function(d){ counts[d] = 0; });

      for (var ri = 1; ri < reqData.length; ri++) {
        var createdAt = reqData[ri][rh['CreatedAt']]; if (!createdAt) continue;
        if (new Date(createdAt) > monthEnd) continue; // ticket didn't exist yet as of this month
        var reqId = String(reqData[ri][rh['RequestID']]||''); if (!reqId) continue;
        var startedAt = startedByRequest[reqId];
        if (startedAt && new Date(startedAt) <= monthEnd) continue; // already connected by month-end
        var status = String(reqData[ri][rh['Status']]||'');
        if (status === 'Closed - Lost') continue; // dead ticket, not a pending one
        var dept = String(reqData[ri][rh['Department']]||'');
        if (dept && deptList.indexOf(dept) !== -1) counts[dept] = (counts[dept]||0) + 1;
        counts['(All)'] = (counts['(All)']||0) + 1;
      }

      if (!clientsMonthly[ym]) return;
      Object.keys(counts).forEach(function(d) {
        if (!clientsMonthly[ym].data[d]) clientsMonthly[ym].data[d] = {};
        clientsMonthly[ym].data[d].pendingConnection = counts[d];
      });
    });
  } catch (e) {
    Logger.log('_perfAddPendingConnections: ' + e.message);
  }
}

function _perfComputeHoursSection(months, departments) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var reqSheet  = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var logSheet  = ss.getSheetByName('VAConnectionHoursLog');
    if (!connSheet || !logSheet) return { success: false, error: 'Required sheets missing.' };

    var connData = connSheet.getDataRange().getValues();
    var ch = {}; connData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
    var reqData = reqSheet ? reqSheet.getDataRange().getValues() : [[]];
    var rh = {}; (reqData[0]||[]).forEach(function(c,i){ if(c) rh[String(c)]=i; });
    var logData = logSheet.getDataRange().getValues();
    var lh = {}; logData[0].forEach(function(c,i){ if(c) lh[String(c)]=i; });

    // requestId → department (for attributing a connection's hours to a dept)
    var deptByRequest = {};
    for (var ri = 1; ri < reqData.length; ri++) {
      var rid = String(reqData[ri][rh['RequestID']]||''); if (!rid) continue;
      deptByRequest[rid] = String(reqData[ri][rh['Department']]||'');
    }
    // connectionId → {department, requestId, requestType, clientId, customerId}
    var connMeta = {};
    for (var ci = 1; ci < connData.length; ci++) {
      var connId = String(connData[ci][ch['ConnectionID']]||''); if (!connId) continue;
      var rId = String(connData[ci][ch['RequestID']]||'');
      connMeta[connId] = {
        department: deptByRequest[rId] || '',
        requestId: rId,
        vaName: String(connData[ci][ch['VAName']]||'Unknown VA'),
        clientId: String(connData[ci][ch['ClientID']]||''),
        customerId: String(connData[ci][ch['CustomerID']]||'')
      };
    }
    var reqTypeByRequest = {};
    for (var ri2 = 1; ri2 < reqData.length; ri2++) {
      var rid2 = String(reqData[ri2][rh['RequestID']]||''); if (!rid2) continue;
      reqTypeByRequest[rid2] = String(reqData[ri2][rh['RequestType']]||'');
    }

    // Build every connection's full log history once, sorted, so we can
    // answer "what was in effect at end of month X" and "what changed
    // during month X" for every connection without re-scanning per month.
    var logsByConn = {};
    for (var li = 1; li < logData.length; li++) {
      var lConnId = String(logData[li][lh['ConnectionID']]||''); if (!lConnId) continue;
      // Per the same confirmation workflow as _hoursBuildTimeline in
      // VAHoursService.gs — a Pending or Cancelled change hasn't
      // actually taken effect, so it shouldn't factor into computed
      // hours for this report either. Blank ApplyStatus (rows logged
      // before this field existed) is treated as Applied, for backward
      // compatibility.
      var lApplyStatus = lh['ApplyStatus'] !== undefined ? String(logData[li][lh['ApplyStatus']] || '') : '';
      if (lApplyStatus === 'Pending' || lApplyStatus === 'Cancelled') continue;
      if (!logsByConn[lConnId]) logsByConn[lConnId] = [];
      logsByConn[lConnId].push({
        changeType: String(logData[li][lh['ChangeType']]||''),
        prevHours: parseFloat(logData[li][lh['PrevHours']]) || 0,
        newHours: parseFloat(logData[li][lh['NewHours']]) || 0,
        hoursType: String(logData[li][lh['NewHoursType']]||''),
        effectiveDate: logData[li][lh['EffectiveDate']],
        effectiveDateObj: new Date(logData[li][lh['EffectiveDate']])
      });
    }
    Object.keys(logsByConn).forEach(function(cid){
      logsByConn[cid].sort(function(a,b){ return a.effectiveDateObj - b.effectiveDateObj; });
    });

    function hoursAsOf(connId, asOfDate) {
      var logs = logsByConn[connId] || [];
      var result = { hours: 0, hoursType: '' };
      logs.forEach(function(l) {
        // Matches the Hours & Schedule module's own reference logic for
        // "what's the real underlying schedule" — Project Hours Entry is a
        // one-off addition (Project Based only), and Limited Period is a
        // deliberately temporary override (it creates its own start+revert
        // pair of log rows), neither of which represents a genuine
        // redefinition of the connection's actual schedule.
        if (l.changeType === 'Project Hours Entry' || l.changeType === 'Limited Period') return;
        if (l.effectiveDateObj <= asOfDate) { result.hours = l.newHours; result.hoursType = l.hoursType || result.hoursType; }
      });
      return result;
    }

    var deptList = departments.filter(function(d){ return d !== '(All)'; });
    var data = {}; // ym → dept → {metric: value}
    var records = {}; // ym → dept → metric → [{name, amount}]
    var TOTAL = 'Total';
    function pushRecord(ym, dept, metric, name, amount) {
      if (!records[ym][dept]) records[ym][dept] = {};
      if (!records[ym][dept][metric]) records[ym][dept][metric] = [];
      records[ym][dept][metric].push({ name: name, amount: amount });
    }

    months.forEach(function(ym, idx) {
      var parts = ym.split('-'); var yy = parseInt(parts[0],10), mm = parseInt(parts[1],10)-1;
      var monthEnd = new Date(yy, mm+1, 0, 23,59,59,999);
      var monthStart = new Date(yy, mm, 1);
      var prevMonthEnd = new Date(yy, mm, 0, 23,59,59,999);

      data[ym] = {}; records[ym] = {};
      deptList.concat([TOTAL]).forEach(function(d){
        data[ym][d] = {
          totalHoursPrevMonth: 0, totalHoursThisMonth: 0, totalHoursThisMonthRegular: 0, totalHoursThisMonthProject: 0,
          hoursAddedNew: 0, hoursAddedAdditional: 0, hoursAddedMoreHours: 0,
          hoursLostChurned: 0, hoursLostReductions: 0
        };
        records[ym][d] = {};
      });

      Object.keys(connMeta).forEach(function(connId) {
       try {
        var meta = connMeta[connId];
        var dept = meta.department || '';
        if (deptList.indexOf(dept) === -1) dept = null; // unmatched dept — still counts toward Total only

        var nowState = hoursAsOf(connId, monthEnd);
        var prevState = hoursAsOf(connId, prevMonthEnd);
        if (nowState.hours > 0) {
          if (dept) { data[ym][dept].totalHoursThisMonth += nowState.hours; pushRecord(ym, dept, 'totalHoursThisMonth', meta.vaName, nowState.hours); }
          data[ym][TOTAL].totalHoursThisMonth += nowState.hours;
          pushRecord(ym, TOTAL, 'totalHoursThisMonth', meta.vaName, nowState.hours);
          var isProject = String(nowState.hoursType).trim().toLowerCase() === 'project based';
          if (dept) { data[ym][dept][isProject?'totalHoursThisMonthProject':'totalHoursThisMonthRegular'] += nowState.hours; }
          data[ym][TOTAL][isProject?'totalHoursThisMonthProject':'totalHoursThisMonthRegular'] += nowState.hours;
        }
        if (prevState.hours > 0) {
          if (dept) data[ym][dept].totalHoursPrevMonth += prevState.hours;
          data[ym][TOTAL].totalHoursPrevMonth += prevState.hours;
        }

        // Hours added/lost — scan this connection's log entries that fall within this month
        (logsByConn[connId]||[]).forEach(function(l) {
          var d2 = l.effectiveDateObj;
          if (d2 < monthStart || d2 > monthEnd) return;
          var reqType = reqTypeByRequest[meta.requestId] || '';
          if (l.changeType === 'Initial Assignment' || l.changeType === 'Initial Migration') {
            var added = l.newHours;
            var bucket = (reqType === 'New') ? 'hoursAddedNew' : 'hoursAddedAdditional';
            if (dept) { data[ym][dept][bucket] += added; pushRecord(ym, dept, bucket, meta.vaName, added); }
            data[ym][TOTAL][bucket] += added;
            pushRecord(ym, TOTAL, bucket, meta.vaName, added);
          } else if (l.changeType === 'Project Hours Entry') {
            if (dept) { data[ym][dept].hoursAddedMoreHours += l.newHours; pushRecord(ym, dept, 'hoursAddedMoreHours', meta.vaName, l.newHours); }
            data[ym][TOTAL].hoursAddedMoreHours += l.newHours;
            pushRecord(ym, TOTAL, 'hoursAddedMoreHours', meta.vaName, l.newHours);
          } else if (l.changeType === 'Hours/Schedule Update' || l.changeType === 'Limited Period') {
            var diff = l.newHours - l.prevHours;
            if (diff > 0) {
              if (dept) { data[ym][dept].hoursAddedMoreHours += diff; pushRecord(ym, dept, 'hoursAddedMoreHours', meta.vaName, diff); }
              data[ym][TOTAL].hoursAddedMoreHours += diff;
              pushRecord(ym, TOTAL, 'hoursAddedMoreHours', meta.vaName, diff);
            } else if (diff < 0) {
              if (dept) { data[ym][dept].hoursLostReductions += Math.abs(diff); pushRecord(ym, dept, 'hoursLostReductions', meta.vaName, Math.abs(diff)); }
              data[ym][TOTAL].hoursLostReductions += Math.abs(diff);
              pushRecord(ym, TOTAL, 'hoursLostReductions', meta.vaName, Math.abs(diff));
            }
          }
        });
       } catch (perConnEx) {
         Logger.log('_perfComputeHoursSection connection ' + connId + ': ' + perConnEx.message);
       }
      });

      // Churned (Terminated) connections this month — attribute their
      // last-known hours as lost.
      for (var cci = 1; cci < connData.length; cci++) {
        var cStatus = String(connData[cci][ch['ConnectionStatus']]||'');
        if (cStatus !== 'Terminated') continue;
        var cTermDate = connData[cci][ch['TerminationDate']];
        if (!cTermDate) continue;
        var td = new Date(cTermDate);
        if (td < monthStart || td > monthEnd) continue;
        var cConnId = String(connData[cci][ch['ConnectionID']]||'');
        var meta2 = connMeta[cConnId] || {};
        var lastHours = hoursAsOf(cConnId, td).hours;
        var dept2 = (meta2.department && deptList.indexOf(meta2.department) !== -1) ? meta2.department : null;
        if (dept2) { data[ym][dept2].hoursLostChurned += lastHours; pushRecord(ym, dept2, 'hoursLostChurned', meta2.vaName||'Unknown VA', lastHours); }
        data[ym][TOTAL].hoursLostChurned += lastHours;
        pushRecord(ym, TOTAL, 'hoursLostChurned', meta2.vaName||'Unknown VA', lastHours);
      }
    });

    // Auto-calculations, per month/dept
    Object.keys(data).forEach(function(ym) {
      Object.keys(data[ym]).forEach(function(d) {
        var r = data[ym][d];
        r.grossHoursAdded = r.hoursAddedNew + r.hoursAddedAdditional + r.hoursAddedMoreHours;
        r.grossHoursLost = r.hoursLostChurned + r.hoursLostReductions;
        r.netDeltaHours = r.grossHoursAdded - r.grossHoursLost;
        r.netExpChurnPct = r.totalHoursPrevMonth > 0 ? Math.round((r.netDeltaHours / r.totalHoursPrevMonth) * 1000) / 10 : 0;
      });
    });

    return { success: true, data: data, records: records };
  } catch (e) {
    return { success: false, error: '_perfComputeHoursSection: ' + e.message };
  }
}

// Exports whatever the Performance Report is currently showing — the
// client already knows which sections/subgroups are collapsed, so it
// sends exactly the visible rows/columns rather than this function trying
// to re-derive visibility state. Writes them into a dedicated, formatted
// sheet tab (so section header colors and bold Total columns genuinely
// carry over), then returns that tab as a base64 .xlsx — same approach as
// the Attendance module's export, since Apps Script has no other way to
// hand back a real Excel file without a Sheets tab as its source.
function exportPerformanceReportToExcel(year, headerRows, dataRows) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Sweep up any leftover export tabs from previous runs — this
    // function used to never delete its own temporary tab, silently
    // bloating the live spreadsheet with an extra sheet on every export.
    try {
      ss.getSheets().forEach(function(sh) {
        if (/^Performance Report /.test(sh.getName())) ss.deleteSheet(sh);
      });
    } catch (cleanupEx) { Logger.log('exportPerformanceReportToExcel cleanup: ' + cleanupEx.message); }

    var tabName = 'Performance Report ' + year;
    var sheet = ss.insertSheet(tabName);

    if (headerRows && headerRows.length) {
      var hRange = sheet.getRange(1, 1, headerRows.length, headerRows[0].length);
      hRange.setValues(headerRows).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    }
    var startRow = (headerRows ? headerRows.length : 0) + 1;
    if (dataRows && dataRows.length) {
      var maxCols = dataRows.reduce(function(m,r){ return Math.max(m, r.length); }, 1);
      var padded = dataRows.map(function(r) {
        var row = r.slice();
        while (row.length < maxCols) row.push('');
        return row;
      });
      var dRange = sheet.getRange(startRow, 1, padded.length, maxCols);
      dRange.setValues(padded);
      // Bold any row whose first cell looks like a section title (all-caps
      // short label) or is flagged with a leading "§" marker from the
      // client — keeps some visual structure without trying to fully
      // replicate every collapsible/color detail from the live table.
      padded.forEach(function(row, i) {
        if (String(row[0]||'').indexOf('§') === 0) {
          sheet.getRange(startRow+i, 1, 1, maxCols).setFontWeight('bold').setBackground('#e2e8f0');
        }
      });
    }
    sheet.setFrozenRows(headerRows ? headerRows.length : 1);
    sheet.setFrozenColumns(1);
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx&gid=' + sheet.getSheetId();
    var response = UrlFetchApp.fetch(url, { headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() } });
    var base64 = Utilities.base64Encode(response.getContent());

    // Clean up the temporary tab now that the export is generated —
    // nothing after this point needs it to exist.
    try { ss.deleteSheet(sheet); } catch (delEx) { Logger.log('exportPerformanceReportToExcel tab cleanup: ' + delEx.message); }

    return { success: true, base64: base64, fileName: tabName + '.xlsx' };
  } catch (e) {
    return { success: false, error: 'exportPerformanceReportToExcel: ' + e.message };
  }
}

// Per the request — a standalone Termination Reasons breakdown, shown
// via its own button on the Performance Report page. Broken down by
// month or week (granularity param), and for each reason/period, split
// into the plain total count vs. how many of those were a client
// TOTALLY leaving (TOC — the client had no other Started connection
// left at all), vs. one VA on an account changing while the account
// itself carries on with another. Same TOC/EOC distinction the
// Terminated (TOC) / End of Contract (EOC) metrics elsewhere in this
// app already make (getCustomerAccountReport, Router.gs) — computed
// independently here from each client's current connection statuses.
function getTerminationReasonsReport(granularity, fromDateStr, toDateStr) {
  try {
    granularity = (granularity === 'week') ? 'week' : 'month';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!connSheet) return { success: true, granularity: granularity, reasons: [], periods: [], cells: {} };
    var cliSheet  = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);

    // Per the request — defaults to Year-to-Date when no range is given
    // (the frontend always sends one, but this keeps the function safe
    // to call on its own too). Both bounds are date-only, inclusive.
    var rangeFrom, rangeTo;
    if (fromDateStr) {
      var ffParts = String(fromDateStr).split('-');
      rangeFrom = new Date(Number(ffParts[0]), Number(ffParts[1])-1, Number(ffParts[2]), 0, 0, 0);
    } else {
      var nowForRange = new Date();
      rangeFrom = new Date(nowForRange.getFullYear(), 0, 1, 0, 0, 0);
    }
    if (toDateStr) {
      var ttParts = String(toDateStr).split('-');
      rangeTo = new Date(Number(ttParts[0]), Number(ttParts[1])-1, Number(ttParts[2]), 23, 59, 59);
    } else {
      rangeTo = new Date();
      rangeTo.setHours(23, 59, 59, 999);
    }

    var connData = connSheet.getDataRange().getValues();
    var coh = {}; connData[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });

    var cliData = cliSheet ? cliSheet.getDataRange().getValues() : [[]];
    var clh = {}; (cliData[0]||[]).forEach(function(c,i){ if(c) clh[String(c)]=i; });
    var cliDisplayNameById = {}, cliCustIdById = {};
    for (var ci = 1; ci < cliData.length; ci++) {
      var cid = String(cliData[ci][clh['ClientID']]||''); if (!cid) continue;
      var company = clh['CompanyName'] !== undefined ? String(cliData[ci][clh['CompanyName']]||'') : '';
      var account = clh['AccountName'] !== undefined ? String(cliData[ci][clh['AccountName']]||'') : '';
      cliDisplayNameById[cid] = company + (account ? ' — ' + account : '');
      cliCustIdById[cid] = clh['CustomerID'] !== undefined ? String(cliData[ci][clh['CustomerID']]||'') : '';
    }

    var custData = custSheet ? custSheet.getDataRange().getValues() : [[]];
    var ch = {}; (custData[0]||[]).forEach(function(c,i){ if(c) ch[String(c)]=i; });
    var custNameById = {};
    for (var cui = 1; cui < custData.length; cui++) {
      var cuid = String(custData[cui][ch['CustomerID']]||''); if (!cuid) continue;
      custNameById[cuid] = String(custData[cui][ch['CustomerName']]||'');
    }

    // Same noon-anchoring fix as getCustomerAccountReport's own toD()
    // (Router.gs) — a date-only TerminationDate cell reads back as
    // midnight in the spreadsheet's own timezone; re-anchored at noon
    // here too so it can't shift a day when serialized/displayed, or a
    // termination landing in the wrong month/week bucket.
    function safeDate(v) {
      if (!v) return null;
      var d = (v instanceof Date) ? v : new Date(v);
      if (isNaN(d.getTime())) return null;
      var ymd = Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd').split('-');
      return new Date(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2]), 12, 0, 0);
    }

    // Per the request — a termination reason is often one long, detailed,
    // multi-clause explanation: a short category, then an em dash, then
    // free-text elaboration that can itself contain more "/"-separated
    // detail (e.g. "Attitude/Commitment Issues — from pause to
    // termination / VA could not commit to schedule / ..."). Only the
    // part before the FIRST em dash is treated as the reportable main
    // category — "Attitude/Commitment Issues" here, not the whole
    // sentence — since the category itself can legitimately contain a
    // "/" (as in this exact example), splitting on "/" first would have
    // cut the category apart incorrectly. Falls back to the whole
    // (trimmed) string when there's no dash separator at all — a short
    // reason with no elaboration is already just its own category.
    function extractMainReason(raw) {
      var s = String(raw || '').trim();
      if (!s) return '';
      var dashIdx = s.indexOf(' — ');
      if (dashIdx === -1) dashIdx = s.indexOf(' - ');
      return (dashIdx === -1 ? s : s.substring(0, dashIdx).trim());
    }

    // Period key — month 'YYYY-MM', or week keyed by that week's own
    // Monday date 'YYYY-MM-DD' (simpler and unambiguous vs. an ISO week
    // number, and easy to sort/display either way).
    function periodKey(d) {
      if (granularity === 'week') {
        var dow = d.getDay();
        var diffToMonday = (dow === 0) ? 6 : dow - 1;
        var monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMonday);
        return Utilities.formatDate(monday, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
      }
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2, '0');
    }

    // "Totally left (TOC)" — this client has NO OTHER Started connection
    // remaining, as of right now. Built once, up front, from every
    // connection's CURRENT status per client.
    var otherStartedByClient = {}; // clientId -> count of currently-Started connections
    for (var si = 1; si < connData.length; si++) {
      if (!connData[si][coh['ConnectionID']]) continue;
      if (String(connData[si][coh['ConnectionStatus']]||'') !== 'Started') continue;
      var sCliId = String(connData[si][coh['ClientID']]||''); if (!sCliId) continue;
      otherStartedByClient[sCliId] = (otherStartedByClient[sCliId]||0) + 1;
    }

    var reasonTotals = {}; // reason -> total count, for sorting
    var periodSet = {};
    var cells = {}; // reason -> period -> { total, tocCount, records: [] }

    for (var i = 1; i < connData.length; i++) {
      if (!connData[i][coh['ConnectionID']]) continue;
      if (String(connData[i][coh['ConnectionStatus']]||'') !== 'Terminated') continue;
      var rawReason = coh['TerminationReason'] !== undefined ? String(connData[i][coh['TerminationReason']]||'') : '';
      if (!rawReason.trim()) continue;
      var mainReason = extractMainReason(rawReason);
      if (!mainReason) continue;
      var termD = safeDate(coh['TerminationDate'] !== undefined ? connData[i][coh['TerminationDate']] : null);
      if (!termD) continue;
      if (termD < rangeFrom || termD > rangeTo) continue;

      var cliId  = String(connData[i][coh['ClientID']]||'');
      var custId = cliCustIdById[cliId] || (coh['CustomerID']!==undefined ? String(connData[i][coh['CustomerID']]||'') : '');
      var pKey = periodKey(termD);
      var isTOC = !(otherStartedByClient[cliId] > 0);

      var rec = {
        connectionId: String(connData[i][coh['ConnectionID']]||''),
        vaName: coh['VAName'] !== undefined ? String(connData[i][coh['VAName']]||'') : '',
        accountName: cliDisplayNameById[cliId] || '',
        customerName: custNameById[custId] || '',
        clientId: cliId,
        customerId: custId,
        connTerminationDate: termD.toISOString(),
        fullReason: rawReason,
        isTOC: isTOC
      };

      reasonTotals[mainReason] = (reasonTotals[mainReason]||0) + 1;
      periodSet[pKey] = true;
      if (!cells[mainReason]) cells[mainReason] = {};
      if (!cells[mainReason][pKey]) cells[mainReason][pKey] = { total: 0, tocCount: 0, records: [] };
      cells[mainReason][pKey].total++;
      cells[mainReason][pKey].records.push(rec);
      if (isTOC) cells[mainReason][pKey].tocCount++;
    }

    var reasons = Object.keys(reasonTotals).sort(function(a,b){ return reasonTotals[b] - reasonTotals[a]; });
    var periods = Object.keys(periodSet).sort();

    return { success: true, granularity: granularity, reasons: reasons, periods: periods, cells: cells };
  } catch (e) {
    return { success: false, error: 'getTerminationReasonsReport: ' + e.message };
  }
}