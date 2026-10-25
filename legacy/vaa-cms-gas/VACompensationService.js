// ═══════════════════════════════════════════════════════════════════════
// VA COMPENSATION TRACKING — Rate History, Night Differential, Bond
// ═══════════════════════════════════════════════════════════════════════
// Data foundation for a future payroll module: projected hours × rate,
// plus "additions" (night differential based on % or flat-$ rate ×
// user-entered eligible hours per cutoff, and a flat monthly salary
// increase layered on top of rate rather than changing rate itself).
// This file builds the tracking/history layer that module will
// eventually read from — not the payroll computation engine itself.

function _compHistSheet(ss) {
  return _ensureSheet(ss, CONFIG.SHEETS.VA_CONNECTION_COMP_HISTORY, CONFIG.SCHEMA.VAConnectionCompHistory);
}
function _bondSheet(ss) {
  return _ensureSheet(ss, CONFIG.SHEETS.VA_BONDS, CONFIG.SCHEMA.VABonds);
}
function _hMapGeneric(headerRow) {
  var h = {}; headerRow.forEach(function(c,i){ if (c) h[String(c).trim()] = i; });
  return h;
}

// Low-level "close the currently-open period, append a new one" — shared
// by addCompHistoryEntry (the full manual-entry form) and
// assignVAConnectionRate (VAConnectionService.gs's older, simpler "Set
// Rate" button), so a rate change is captured in the history timeline
// regardless of which UI path was used to make it. Kept separate from
// addCompHistoryEntry itself specifically to avoid recursion, since
// addCompHistoryEntry syncs back to assignVAConnectionRate — this
// function is the shared core neither one recursively calls the other
// through. Silently skips if nothing actually changed, to avoid a
// meaningless duplicate entry every time the rate is "changed" to the
// same value it already was.
function _syncCompHistoryOnRateChange(connectionId, newRate, newNightDiffApplicable, newNightDiffPercent, userEmail) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _compHistSheet(ss);
    _migrateSheetColumns(ss, CONFIG.SHEETS.VA_CONNECTION_COMP_HISTORY, CONFIG.SCHEMA.VAConnectionCompHistory);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var now = new Date();

    var openRowIdx = -1, openRow = null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      if (data[i][h['EndDate']]) continue;
      openRowIdx = i; openRow = data[i];
      break; // there should only ever be one open period per connection
    }

    var effectiveNewRate = Number(newRate);
    var effectiveNdActive = !!newNightDiffApplicable;
    var effectiveNdValue = effectiveNdActive ? Number(newNightDiffPercent) : 0;

    if (openRow) {
      var sameRate = Number(openRow[h['Rate']]||0) === effectiveNewRate;
      var sameNd = !!openRow[h['NightDiffActive']] === effectiveNdActive &&
        (!effectiveNdActive || Number(openRow[h['NightDiffValue']]||0) === effectiveNdValue);
      if (sameRate && sameNd) return; // nothing actually changed — skip
      sheet.getRange(openRowIdx+1, h['EndDate']+1).setValue(now);
    }

    var row = data[0].map(function(){ return ''; });
    var cm = {
      'CompHistoryID':  generateID('COMP'),
      'ConnectionID':   connectionId,
      'Rate':           effectiveNewRate,
      'EffectiveDate':  now,
      'NightDiffActive':effectiveNdActive,
      'NightDiffType':  effectiveNdActive ? 'Percentage' : '', // this path only ever sets a %-type rate (the older "Set Rate" UI has no Fixed-$ option)
      'NightDiffValue': effectiveNdActive ? effectiveNdValue : '',
      'MonthlySalaryIncrease': openRow ? (openRow[h['MonthlySalaryIncrease']]||0) : 0, // carried over — this path doesn't touch salary increase
      'Notes':          'Auto-logged from rate assignment',
      'CreatedAt':      now,
      'CreatedBy':      userEmail || 'system'
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
  } catch (e) { Logger.log('_syncCompHistoryOnRateChange: ' + e.message); }
}

function _mapCompHistoryRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    compHistoryId:        String(get('CompHistoryID') || ''),
    connectionId:         String(get('ConnectionID') || ''),
    rate:                 get('Rate'),
    effectiveDate:        get('EffectiveDate'),
    endDate:              get('EndDate'),
    nightDiffActive:      !!get('NightDiffActive'),
    nightDiffType:        String(get('NightDiffType') || ''),
    nightDiffValue:       get('NightDiffValue'),
    monthlySalaryIncrease:get('MonthlySalaryIncrease') || 0,
    notes:                String(get('Notes') || ''),
    createdAt:            get('CreatedAt'),
    createdBy:            String(get('CreatedBy') || '')
  };
}
function _mapBondRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    bondId:          String(get('BondID') || ''),
    connectionId:    String(get('ConnectionID') || ''),
    amount:          get('Amount'),
    status:          String(get('Status') || ''),
    startDate:       get('StartDate'),
    expectedEndDate: get('ExpectedEndDate'),
    releaseDate:     get('ReleaseDate'),
    notes:           String(get('Notes') || ''),
    createdAt:       get('CreatedAt'),
    createdBy:       String(get('CreatedBy') || ''),
    updatedAt:       get('UpdatedAt'),
    updatedBy:       String(get('UpdatedBy') || '')
  };
}

// ── Compensation (rate / night diff / salary increase) history ─────────

function getCompHistoryForConnection(connectionId) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!_canSeeVARate(perm.user.role)) return { success: false, error: 'Rate information is restricted.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _compHistSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _hMapGeneric(data[0]);

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      rows.push(_mapCompHistoryRow(data[i], h));
    }
    rows.sort(function(a,b){ return new Date(b.effectiveDate||0) - new Date(a.effectiveDate||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getCompHistoryForConnection: ' + e.message };
  }
}

// Adds a new compensation period, closing out whatever period is
// currently open (EndDate blank) for this connection by setting its
// EndDate to the day before the new period's EffectiveDate — so at any
// point in time, exactly one period per connection is ever "current."
function addCompHistoryEntry(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!_canSeeVARate(perm.user.role)) return { success: false, error: 'Rate information is restricted.' };
    if (!payload || !payload.connectionId) return { success: false, error: 'connectionId is required.' };
    if (!payload.effectiveDate) return { success: false, error: 'Effective date is required.' };
    if (payload.rate === undefined || payload.rate === '' || isNaN(Number(payload.rate))) {
      return { success: false, error: 'A valid rate is required.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _compHistSheet(ss);
    _migrateSheetColumns(ss, CONFIG.SHEETS.VA_CONNECTION_COMP_HISTORY, CONFIG.SCHEMA.VAConnectionCompHistory);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var newEffective = _parseDateInput(payload.effectiveDate);

    // Close out the currently-open period (if any) for this connection —
    // "open" means EndDate is blank. The new period starts the day after
    // whatever was open, ends the day before this new EffectiveDate.
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== payload.connectionId) continue;
      if (data[i][h['EndDate']]) continue; // already closed
      var dayBefore = new Date(newEffective); dayBefore.setDate(dayBefore.getDate() - 1);
      sheet.getRange(i+1, h['EndDate']+1).setValue(dayBefore);
    }

    var id = generateID('COMP');
    var now = new Date();
    var row = data[0].map(function(){ return ''; });
    var cm = {
      'CompHistoryID':        id,
      'ConnectionID':         payload.connectionId,
      'Rate':                 Number(payload.rate),
      'EffectiveDate':        newEffective,
      'EndDate':              payload.endDate ? _parseDateInput(payload.endDate) : '',
      'NightDiffActive':      !!payload.nightDiffActive,
      'NightDiffType':        payload.nightDiffActive ? (payload.nightDiffType || 'Percentage') : '',
      'NightDiffValue':       payload.nightDiffActive ? (Number(payload.nightDiffValue) || 0) : '',
      'MonthlySalaryIncrease':payload.monthlySalaryIncrease ? Number(payload.monthlySalaryIncrease) : 0,
      'Notes':                payload.notes || '',
      'CreatedAt':            now,
      'CreatedBy':            perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    _writeLog('VAConnection', payload.connectionId, 'COMP_HISTORY_ADDED', '', 'Rate ' + payload.rate + ' eff. ' + _formatLongDate(newEffective), '', perm.user);

    // Keep VAConnections.Rate (the "current, up-to-date rate" the
    // connection itself carries) in sync with this new period — this
    // history sheet is the source of truth for the timeline, but the
    // connection's own Rate column is what everything else in the app
    // (Rate Agreement display, the VA Rates list, etc.) actually reads.
    // Only syncs when this new period has no EndDate — i.e. it's
    // genuinely the new current state, not a backdated historical entry
    // being inserted into the middle of the timeline.
    if (!payload.endDate) {
      try {
        assignVAConnectionRate(payload.connectionId, {
          rate: Number(payload.rate),
          nightDiffApplicable: !!payload.nightDiffActive,
          nightDiffPercent: (payload.nightDiffActive && payload.nightDiffType !== 'Fixed') ? Number(payload.nightDiffValue) : undefined
        });
      } catch (syncEx) { Logger.log('addCompHistoryEntry sync to VAConnections: ' + syncEx.message); }
    }

    return { success: true, id: id };
  } catch (e) {
    return { success: false, error: 'addCompHistoryEntry: ' + e.message };
  }
}

// Bulk import of rate-history rows — expects a CSV with columns:
// ConnectionID, Rate, EffectiveDate, NightDiffActive, NightDiffType,
// NightDiffValue, MonthlySalaryIncrease, Notes (header row required,
// column order doesn't matter). Each row is appended as its own period —
// does NOT auto-close open periods the way addCompHistoryEntry does,
// since an import is expected to represent a complete, ordered history
// where the caller has already set EndDate on every row except the
// current one. Returns counts and any row-level errors rather than
// failing the whole import over one bad row.
function importCompHistoryCSV(csvText) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!_canSeeVARate(perm.user.role)) return { success: false, error: 'Rate information is restricted.' };
    if (!csvText || !csvText.trim()) return { success: false, error: 'No CSV data provided.' };

    var lines = csvText.replace(/\r/g, '').split('\n').filter(function(l){ return l.trim(); });
    if (lines.length < 2) return { success: false, error: 'CSV needs a header row plus at least one data row.' };
    var headerCells = lines[0].split(',').map(function(c){ return c.trim(); });
    var colIdx = {}; headerCells.forEach(function(c,i){ colIdx[c] = i; });
    if (colIdx['ConnectionID'] === undefined || colIdx['Rate'] === undefined || colIdx['EffectiveDate'] === undefined) {
      return { success: false, error: 'CSV must include at least ConnectionID, Rate, and EffectiveDate columns.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _compHistSheet(ss);
    _migrateSheetColumns(ss, CONFIG.SHEETS.VA_CONNECTION_COMP_HISTORY, CONFIG.SCHEMA.VAConnectionCompHistory);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var now = new Date();

    var imported = 0, errors = [];
    var currentByConn = {}; // connectionId -> best "current" row seen so far
    for (var li = 1; li < lines.length; li++) {
      var cells = lines[li].split(',').map(function(c){ return c.trim(); });
      var connectionId = cells[colIdx['ConnectionID']];
      var rateVal = cells[colIdx['Rate']];
      var effDateVal = cells[colIdx['EffectiveDate']];
      if (!connectionId || !rateVal || !effDateVal) { errors.push('Row ' + (li+1) + ': missing ConnectionID, Rate, or EffectiveDate.'); continue; }
      if (isNaN(Number(rateVal))) { errors.push('Row ' + (li+1) + ': Rate "' + rateVal + '" is not a number.'); continue; }
      var effDate = new Date(effDateVal);
      if (isNaN(effDate.getTime())) { errors.push('Row ' + (li+1) + ': EffectiveDate "' + effDateVal + '" is not a valid date.'); continue; }

      var nightDiffActive = colIdx['NightDiffActive'] !== undefined && /^(true|yes|1)$/i.test(cells[colIdx['NightDiffActive']]||'');
      var endDateVal = colIdx['EndDate'] !== undefined ? cells[colIdx['EndDate']] : '';
      var row = data[0].map(function(){ return ''; });
      var cm = {
        'CompHistoryID':        generateID('COMP'),
        'ConnectionID':         connectionId,
        'Rate':                 Number(rateVal),
        'EffectiveDate':        effDate,
        'EndDate':              endDateVal ? new Date(endDateVal) : '',
        'NightDiffActive':      nightDiffActive,
        'NightDiffType':        nightDiffActive ? (colIdx['NightDiffType'] !== undefined ? (cells[colIdx['NightDiffType']]||'Percentage') : 'Percentage') : '',
        'NightDiffValue':       nightDiffActive ? Number(colIdx['NightDiffValue'] !== undefined ? (cells[colIdx['NightDiffValue']]||0) : 0) : '',
        'MonthlySalaryIncrease':colIdx['MonthlySalaryIncrease'] !== undefined ? (Number(cells[colIdx['MonthlySalaryIncrease']]) || 0) : 0,
        'Notes':                colIdx['Notes'] !== undefined ? (cells[colIdx['Notes']]||'') : '',
        'CreatedAt':            now,
        'CreatedBy':            perm.user.email
      };
      Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
      sheet.appendRow(row);
      imported++;

      // Track the best "current" candidate per connection — no EndDate
      // means genuinely current; among several with no EndDate (or none
      // tracked yet), the latest EffectiveDate wins.
      if (!cm['EndDate']) {
        var existing = currentByConn[connectionId];
        if (!existing || effDate > existing.effDate) {
          currentByConn[connectionId] = { rate: cm['Rate'], effDate: effDate, nightDiffActive: nightDiffActive, nightDiffType: cm['NightDiffType'], nightDiffValue: cm['NightDiffValue'] };
        }
      }
    }
    Object.keys(currentByConn).forEach(function(connId) {
      var cur = currentByConn[connId];
      try {
        assignVAConnectionRate(connId, {
          rate: cur.rate,
          nightDiffApplicable: !!cur.nightDiffActive,
          nightDiffPercent: (cur.nightDiffActive && cur.nightDiffType !== 'Fixed') ? Number(cur.nightDiffValue) : undefined
        });
      } catch (syncEx) { Logger.log('importCompHistoryCSV sync to VAConnections for ' + connId + ': ' + syncEx.message); }
    });
    _writeLog('System', 'COMP_HISTORY_IMPORT', 'BULK_IMPORT', '', imported + ' rows imported', errors.length + ' errors', perm.user);
    return { success: true, imported: imported, errors: errors };
  } catch (e) {
    return { success: false, error: 'importCompHistoryCSV: ' + e.message };
  }
}

// ── Bond ─────────────────────────────────────────────────────────────

function getBondForConnection(connectionId) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!_canSeeVARate(perm.user.role)) return { success: false, error: 'Bond information is restricted.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _bondSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: null };
    var h = _hMapGeneric(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      return { success: true, data: _mapBondRow(data[i], h) };
    }
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: 'getBondForConnection: ' + e.message };
  }
}

// Creates or updates the single bond record for a connection. Defaults —
// applied only when creating a new bond, not overriding an explicit
// value — are Amount 0.50 and ExpectedEndDate = StartDate + 6 months.
function upsertBond(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!_canSeeVARate(perm.user.role)) return { success: false, error: 'Bond information is restricted.' };
    if (!payload || !payload.connectionId) return { success: false, error: 'connectionId is required.' };

    var validStatuses = ['Pending', 'Released', 'Forfeited', 'No Bond'];
    var status = validStatuses.indexOf(payload.status) !== -1 ? payload.status : 'Pending';

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _bondSheet(ss);
    _migrateSheetColumns(ss, CONFIG.SHEETS.VA_BONDS, CONFIG.SCHEMA.VABonds);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var now = new Date();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== payload.connectionId) continue;
      var rowNum = i + 1;
      var cm = {
        'Amount':          payload.amount !== undefined && payload.amount !== '' ? Number(payload.amount) : data[i][h['Amount']],
        'Status':          status,
        'StartDate':       payload.startDate ? _parseDateInput(payload.startDate) : data[i][h['StartDate']],
        'ExpectedEndDate': payload.expectedEndDate ? _parseDateInput(payload.expectedEndDate) : data[i][h['ExpectedEndDate']],
        'ReleaseDate':     payload.releaseDate ? _parseDateInput(payload.releaseDate) : (status === 'Released' ? data[i][h['ReleaseDate']] : ''),
        'Notes':           payload.notes !== undefined ? payload.notes : data[i][h['Notes']],
        'UpdatedAt':       now,
        'UpdatedBy':       perm.user.email
      };
      Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) sheet.getRange(rowNum, h[col]+1).setValue(cm[col]); });
      _writeLog('VAConnection', payload.connectionId, 'BOND_UPDATED', '', status, '', perm.user);
      return { success: true };
    }

    // No existing bond for this connection — create one, applying
    // defaults only where the caller didn't specify a value.
    var startDate = payload.startDate ? _parseDateInput(payload.startDate) : now;
    var defaultExpectedEnd = new Date(startDate); defaultExpectedEnd.setMonth(defaultExpectedEnd.getMonth() + 6);
    var id = generateID('BOND');
    var row = data[0].map(function(){ return ''; });
    var cmNew = {
      'BondID':          id,
      'ConnectionID':    payload.connectionId,
      'Amount':          payload.amount !== undefined && payload.amount !== '' ? Number(payload.amount) : 0.50,
      'Status':          status,
      'StartDate':       startDate,
      'ExpectedEndDate': payload.expectedEndDate ? _parseDateInput(payload.expectedEndDate) : defaultExpectedEnd,
      'ReleaseDate':     payload.releaseDate ? _parseDateInput(payload.releaseDate) : '',
      'Notes':           payload.notes || '',
      'CreatedAt':       now,
      'CreatedBy':       perm.user.email,
      'UpdatedAt':       now,
      'UpdatedBy':       perm.user.email
    };
    Object.keys(cmNew).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cmNew[col]; });
    sheet.appendRow(row);
    _writeLog('VAConnection', payload.connectionId, 'BOND_CREATED', '', status, '', perm.user);
    return { success: true, id: id };
  } catch (e) {
    return { success: false, error: 'upsertBond: ' + e.message };
  }
}

// ── Combined fetch for the frontend's compensation modal ───────────────

function getVAConnectionCompensationProfile(connectionId) {
  try {
    var histRes = getCompHistoryForConnection(connectionId);
    var bondRes = getBondForConnection(connectionId);
    if (!histRes.success) return histRes;
    if (!bondRes.success) return bondRes;
    return {
      success: true,
      data: {
        history: histRes.data,
        current: histRes.data.length ? histRes.data[0] : null, // sorted newest-first already
        bond: bondRes.data
      }
    };
  } catch (e) {
    return { success: false, error: 'getVAConnectionCompensationProfile: ' + e.message };
  }
}