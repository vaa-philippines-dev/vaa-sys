// ═══════════════════════════════════════════════════════════════════════
// CONNECTION-LEVEL BILLING DETAIL GRID (direct-entry, per request)
// ═══════════════════════════════════════════════════════════════════════
// A spreadsheet-style grid, one row per active VA connection, for a
// selected month — mirrors the existing Attendance grid's UX pattern
// (month selector, editable cells, bulk save) rather than inventing a
// new one.
//
// Reference columns (customer name, VA name, billing type, rate) are
// denormalized — cached directly on each ConnectionBillingDetail row at
// save time, rather than always re-joined live from VAConnections/
// Customers/VAConnectionCompHistory. This is a deliberate speed/freshness
// tradeoff made after the live join alone still timed out even after
// eliminating redundant per-connection reads: a value cached here can go
// stale if the source data changes later (e.g. a customer renamed), but
// it lets a repeat load of the same connection/month skip the join
// entirely. Combined with a short CacheService layer on top of the whole
// computed result, this is the main defense against the timeout.
//
// Only the billing-specific detail that has no other home (ND, overtime,
// absences, refunds, hours, billing/payment dates) was ever meant to be
// directly editable here.

// Resilient to Month being stored either way: correctly as plain text
// ("2026-05"), or as an already-corrupted Date object from before the
// plain-text fix existed (Google Sheets auto-detects a string that looks
// like a date and silently converts it on write, unless told not to).
function _acctNormalizeMonthValue(val) {
  if (val instanceof Date) {
    return val.getFullYear() + '-' + String(val.getMonth()+1).padStart(2,'0');
  }
  return String(val||'');
}

function _acctDetailSheet(ss) {
  var s = _ensureSheet(ss, CONFIG.SHEETS.ACCT_CONN_BILLING_DETAIL, CONFIG.SCHEMA.ConnectionBillingDetail);
  _migrateSheetColumns(ss, CONFIG.SHEETS.ACCT_CONN_BILLING_DETAIL, CONFIG.SCHEMA.ConnectionBillingDetail);
  return s;
}

function _mapConnBillingDetailRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    detailId: String(get('DetailID')||''),
    connectionId: String(get('ConnectionID')||''),
    month: String(get('Month')||''),
    customerName: String(get('CustomerName')||''),
    vaName: String(get('VAName')||''),
    billingType: String(get('BillingType')||''),
    rate: get('Rate') || 0,
    totalBilledServiceAmount: get('TotalBilledServiceAmount') || 0,
    billingDate: get('BillingDate'), paymentDate: get('PaymentDate'),
    projectedHours: get('ProjectedHours') || 0, actualHours: get('ActualHours') || 0,
    nightDiffHours: get('NightDiffHours') || 0,
    nightDiffFactorType: String(get('NightDiffFactorType')||'Percent'),
    nightDiffFactorValue: get('NightDiffFactorValue') || 0,
    overtimeAmount: get('OvertimeAmount') || 0,
    absencesAmount: get('AbsencesAmount') || 0,
    refundsAmount: get('RefundsAmount') || 0,
    notes: String(get('Notes')||'')
  };
}

// One row per active (Started) connection, for a given month — reference
// columns always pulled live, plus whatever detail already exists for
// this month (or sensible blanks if none yet). This is the full payload
// the grid renders from and saves back onto.
function getConnectionBillingGrid(month) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    if (!month) return { success: false, error: 'A month is required.' };
    if (!_canSeeVARate(perm.user.role)) return { success: false, error: 'Rate information is restricted.' };

    // Cache hit — skips spreadsheet access entirely for a repeated load
    // of the same month within the cache window. This is the fastest
    // possible path and directly targets timeouts that persist even
    // after minimizing the number of sheet reads, since it doesn't touch
    // the spreadsheet document at all on a hit.
    var cache = CacheService.getScriptCache();
    var cacheKey = 'acctGrid_v2_' + month; // bump the v-prefix any time this row's shape changes
    try {
      var cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (cacheReadEx) { Logger.log('getConnectionBillingGrid cache read: ' + cacheReadEx.message); }

    var result = _computeConnectionBillingGrid(month);

    // Cache the result for a short window — invalidated explicitly by
    // saveConnectionBillingGrid whenever this month's data actually
    // changes, so a save is never masked by a stale cached read.
    if (result.success) {
      try { cache.put(cacheKey, JSON.stringify(result), 300); } // 5 minutes
      catch (cacheWriteEx) { Logger.log('getConnectionBillingGrid cache write: ' + cacheWriteEx.message); }
    }
    return result;
  } catch (e) {
    return { success: false, error: 'getConnectionBillingGrid: ' + (e.message || String(e)) };
  }
}

function _computeConnectionBillingGrid(month) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var ch = _connHMap(connData[0]);

    var detailSheet = _acctDetailSheet(ss);
    var detailData = detailSheet.getDataRange().getValues();
    var dh = _hMapGeneric(detailData[0]);
    var detailByKey = {};
    for (var di = 1; di < detailData.length; di++) {
      var key = String(detailData[di][dh['ConnectionID']]||'') + '|' + _acctNormalizeMonthValue(detailData[di][dh['Month']]);
      detailByKey[key] = _mapConnBillingDetailRow(detailData[di], dh);
    }

    var monthParts = String(month).split('-');
    var monthStart = new Date(Number(monthParts[0]), Number(monthParts[1])-1, 1);
    var monthEnd = new Date(Number(monthParts[0]), Number(monthParts[1]), 0);
    var daysInMonth = monthEnd.getDate();

    // Which active connections for this month are missing a fully
    // cached detail row? Determined from VAConnections + the detail
    // sheet alone — Customers and CompHistory are only read at all if
    // this comes back non-empty, since once every connection has been
    // saved once for a given month, no row needs them anymore.
    var needsJoin = false;
    for (var ni = 1; ni < connData.length; ni++) {
      var niConnId = String(connData[ni][ch['ConnectionID']]||''); if (!niConnId) continue;
      var niStart = connData[ni][ch['ActualStartDate']]; if (!niStart) continue;
      if (new Date(niStart) > monthEnd) continue;
      var niTerm = connData[ni][ch['TerminationDate']];
      if (niTerm && new Date(niTerm) < monthStart) continue;
      var niDetail = detailByKey[niConnId + '|' + month];
      if (!niDetail || !niDetail.customerName || !niDetail.billingType) { needsJoin = true; break; }
    }

    var custById = {};
    var compHistByConnId = {};
    if (needsJoin) {
      var custRes = getCustomers({});
      if (custRes.success) custRes.data.forEach(function(c){ custById[c.customerId] = c; });

      // Read once, build an in-memory lookup — the old version called
      // getEffectiveRateAsOf per connection, which itself did a fresh
      // full sheet read every time. For many connections that's many
      // redundant reads, which is exactly what timed out.
      var compSheet = _compHistSheet(ss);
      var compData = compSheet.getDataRange().getValues();
      var comph = _hMapGeneric(compData[0]);
      for (var cpi = 1; cpi < compData.length; cpi++) {
        var cpConnId = String(compData[cpi][comph['ConnectionID']]||''); if (!cpConnId) continue;
        if (!compHistByConnId[cpConnId]) compHistByConnId[cpConnId] = [];
        compHistByConnId[cpConnId].push({
          rate: Number(compData[cpi][comph['Rate']])||0,
          effectiveDate: compData[cpi][comph['EffectiveDate']],
          endDate: compData[cpi][comph['EndDate']],
          nightDiffActive: compData[cpi][comph['NightDiffActive']] === true,
          nightDiffType: String(compData[cpi][comph['NightDiffType']]||'Percentage'),
          nightDiffValue: Number(compData[cpi][comph['NightDiffValue']])||0
        });
      }
    }

    var rows = [];
    for (var i = 1; i < connData.length; i++) {
      var connectionId = String(connData[i][ch['ConnectionID']]||''); if (!connectionId) continue;
      var startDateVal = connData[i][ch['ActualStartDate']];
      var termDateVal = connData[i][ch['TerminationDate']];
      // "Active for the selected month" — started on or before month-end,
      // and either still ongoing (no termination) or terminated on/after
      // month-start (worked at least part of this month before ending).
      if (!startDateVal) continue;
      var startDate = new Date(startDateVal);
      if (startDate > monthEnd) continue;
      if (termDateVal) {
        var termDate = new Date(termDateVal);
        if (termDate < monthStart) continue;
      }

      var customerId = String(connData[i][ch['CustomerID']]||'');
      var detail = detailByKey[connectionId + '|' + month] || null;

      try {
        // Use the cached snapshot on the detail row directly if it's fully
        // populated — no join needed for this specific row at all, even if
        // needsJoin was true for some other row this same pass.
        var customerName, billingType, rate, ndValue;
        if (detail && detail.customerName && detail.billingType) {
          customerName = detail.customerName; billingType = detail.billingType; rate = detail.rate;
          ndValue = detail.nightDiffFactorValue;
        } else {
          var customer = custById[customerId] || {};
          customerName = customer.customerName || customerId;
          billingType = customer.billingType || 'Prepaid';
          var history = compHistByConnId[connectionId] || [];
          var match = history.find(function(hEntry) {
            var eff = new Date(hEntry.effectiveDate);
            var end = hEntry.endDate ? new Date(hEntry.endDate) : null;
            return eff <= monthStart && (!end || monthStart <= end);
          });
          rate = match ? match.rate : (Number(connData[i][ch['Rate']]) || 0);
          ndValue = match ? match.nightDiffValue : 0;
        }

        var weeklyHours = Number(connData[i][ch['Hours']]) || 0;
        var projectedHours = Math.round((weeklyHours / 7) * daysInMonth * 100) / 100;

        rows.push({
          connectionId: connectionId,
          customerId: customerId, customerName: customerName,
          vaName: String(connData[i][ch['VAName']]||''),
          startDate: startDateVal ? String(startDateVal) : '',
          endDate: termDateVal ? String(termDateVal) : '',
          billingType: billingType,
          rate: rate,
          totalBilledServiceAmount: detail ? detail.totalBilledServiceAmount : Math.round(rate * (detail ? detail.projectedHours : projectedHours) * 100) / 100,
          projectedHours: detail ? detail.projectedHours : projectedHours,
          actualHours: detail ? detail.actualHours : 0,
          billingDate: detail && detail.billingDate ? String(detail.billingDate) : '',
          paymentDate: detail && detail.paymentDate ? String(detail.paymentDate) : '',
          nightDiffHours: detail ? detail.nightDiffHours : 0,
          nightDiffFactorType: detail ? detail.nightDiffFactorType : 'Percent',
          nightDiffFactorValue: detail ? detail.nightDiffFactorValue : ndValue,
          overtimeAmount: detail ? detail.overtimeAmount : 0,
          absencesAmount: detail ? detail.absencesAmount : 0,
          refundsAmount: detail ? detail.refundsAmount : 0,
          notes: detail ? detail.notes : ''
        });
      } catch (rowEx) {
        Logger.log('_computeConnectionBillingGrid: skipped connection ' + connectionId + ' (' + (detail?'had':'no') + ' existing detail row) — ' + rowEx.message);
      }
    }
    rows.sort(function(a,b){ return String(a.customerName).localeCompare(String(b.customerName)) || String(a.vaName).localeCompare(String(b.vaName)); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getConnectionBillingGrid: ' + (e.message || String(e)) };
  }
}

// Bulk save — upserts one detail row per connection for the given month.
// Mirrors saveAttendanceRecords' pattern (one call, many rows) rather
// than a round-trip per cell.
// Consolidates duplicate rows for the same ConnectionID+Month — per the
// request, only one billing record should exist per connection per
// month. Keeps whichever row was most recently updated for each key and
// removes the rest. Safe to call anytime; a no-op once the sheet is
// already clean.
function dedupeConnectionBillingDetailRows() {
  try {
    var perm = _acctPermGuard('u'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctDetailSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);

    var bestRowByKey = {}; // key -> {rowNum, updatedAt}
    var rowsToDelete = [];
    for (var i = 1; i < data.length; i++) {
      var connId = String(data[i][h['ConnectionID']]||''); if (!connId) continue;
      var key = connId + '|' + _acctNormalizeMonthValue(data[i][h['Month']]);
      var rowNum = i + 1;
      var updatedAt = data[i][h['UpdatedAt']] ? new Date(data[i][h['UpdatedAt']]) : new Date(0);
      if (!bestRowByKey[key]) {
        bestRowByKey[key] = { rowNum: rowNum, updatedAt: updatedAt };
      } else if (updatedAt >= bestRowByKey[key].updatedAt) {
        rowsToDelete.push(bestRowByKey[key].rowNum); // the previous "best" is now superseded
        bestRowByKey[key] = { rowNum: rowNum, updatedAt: updatedAt };
      } else {
        rowsToDelete.push(rowNum);
      }
    }

    // Bottom-to-top so row numbers don't shift out from under later deletes.
    rowsToDelete.sort(function(a,b){ return b - a; }).forEach(function(r){ sheet.deleteRow(r); });

    // Whatever rows survive should also have their Month column corrected
    // to plain text, in case they were part of the original corruption.
    var survivingData = sheet.getDataRange().getValues();
    var survivingH = _hMapGeneric(survivingData[0]);
    for (var si = 1; si < survivingData.length; si++) {
      var monthVal = survivingData[si][survivingH['Month']];
      if (monthVal instanceof Date) {
        var fixedMonth = _acctNormalizeMonthValue(monthVal);
        sheet.getRange(si+1, survivingH['Month']+1).setNumberFormat('@').setValue(fixedMonth);
      }
    }

    try { CacheService.getScriptCache().removeAll(Object.keys(bestRowByKey).map(function(k){ return 'acctGrid_v2_' + k.split('|')[1]; })); }
    catch (cacheEx) { Logger.log('dedupeConnectionBillingDetailRows cache invalidation: ' + cacheEx.message); }

    return { success: true, removed: rowsToDelete.length, remaining: Object.keys(bestRowByKey).length };
  } catch (e) {
    return { success: false, error: 'dedupeConnectionBillingDetailRows: ' + e.message };
  }
}

function saveConnectionBillingGrid(month, rows) {
  try {
    var perm = _acctPermGuard('u'); if (!perm.allowed) return perm;
    if (!month || !rows || !rows.length) return { success: false, error: 'Month and at least one row are required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctDetailSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var now = new Date();
    var numCols = data[0].length;

    var existingRowNumByKey = {};
    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][h['ConnectionID']]||'') + '|' + _acctNormalizeMonthValue(data[i][h['Month']]);
      existingRowNumByKey[key] = i + 1;
    }

    var newRows = [];
    var saved = 0;
    rows.forEach(function(r) {
      if (!r.connectionId) return;
      var key = r.connectionId + '|' + month;
      var cm = {
        // Denormalized reference snapshot — cached here so a future load
        // of this same connection/month can skip the Customers/
        // CompHistory join entirely.
        'CustomerName': r.customerName || '', 'VAName': r.vaName || '',
        'BillingType': r.billingType || '', 'Rate': Number(r.rate)||0,
        'TotalBilledServiceAmount': (Number(r.rate)||0) * (Number(r.projectedHours)||0),
        'BillingDate': r.billingDate ? new Date(r.billingDate) : '',
        'PaymentDate': r.paymentDate ? new Date(r.paymentDate) : '',
        'ProjectedHours': Number(r.projectedHours)||0, 'ActualHours': Number(r.actualHours)||0,
        'NightDiffHours': Number(r.nightDiffHours)||0,
        'NightDiffFactorType': r.nightDiffFactorType || 'Percent',
        'NightDiffFactorValue': Number(r.nightDiffFactorValue)||0,
        'OvertimeAmount': Number(r.overtimeAmount)||0,
        'AbsencesAmount': Number(r.absencesAmount)||0,
        'RefundsAmount': Number(r.refundsAmount)||0,
        'Notes': r.notes || '',
        'UpdatedAt': now, 'UpdatedBy': perm.user.email
      };

      if (existingRowNumByKey[key]) {
        // One setValues call for this row's full width, instead of one
        // setValue call per individual column — each of those was its
        // own separate API round-trip.
        var rowNum = existingRowNumByKey[key];
        var existingRow = data[rowNum - 1].slice();
        Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) existingRow[h[col]] = cm[col]; });
        // Month must stay plain text — Google Sheets auto-detects
        // "2026-05" as a date and silently converts it on write unless
        // told otherwise, which would break every future key lookup for
        // this exact row (ConnectionID + '|' + Month never matching
        // again, since the stored value is no longer that string at all).
        sheet.getRange(rowNum, h['Month']+1).setNumberFormat('@');
        sheet.getRange(rowNum, 1, 1, numCols).setValues([existingRow]);
      } else {
        var newRow = data[0].map(function(){ return ''; });
        cm['DetailID'] = generateID('CBD'); cm['ConnectionID'] = r.connectionId; cm['Month'] = month;
        cm['CreatedAt'] = now; cm['CreatedBy'] = perm.user.email;
        Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) newRow[h[col]] = cm[col]; });
        newRows.push(newRow);
      }
      saved++;
    });

    // Every genuinely new row appended in a single batched write, rather
    // than one appendRow call per row.
    if (newRows.length) {
      var appendStartRow = sheet.getLastRow() + 1;
      sheet.getRange(appendStartRow, h['Month']+1, newRows.length, 1).setNumberFormat('@');
      sheet.getRange(appendStartRow, 1, newRows.length, numCols).setValues(newRows);
    }

    // Invalidate this month's cached grid — a save must never be masked
    // by a stale cached read on the next load.
    try { CacheService.getScriptCache().remove('acctGrid_v2_' + month); }
    catch (cacheEx) { Logger.log('saveConnectionBillingGrid cache invalidation: ' + cacheEx.message); }

    _writeLog('Accounting', month, 'BILLING_DETAIL_GRID_SAVED', 'RowsSaved', '', String(saved), perm.user);
    return { success: true, saved: saved };
  } catch (e) {
    return { success: false, error: 'saveConnectionBillingGrid: ' + (e.message || String(e)) };
  }
}