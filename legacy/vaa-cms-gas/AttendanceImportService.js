// ═══════════════════════════════════════════════════════════════════════
// ATTENDANCE — BULK IMPORT (§2.13, §4.10 of the Accounting plan)
// ═══════════════════════════════════════════════════════════════════════
// Column-mapped CSV import with a required preview step before
// committing (mirrors the pattern established for Invoice Generation in
// AccountingService.gs). Valid rows are never blocked by invalid ones —
// each row is judged independently. A VA/date combination that already
// exists from a different source is never silently overwritten; it's
// surfaced for the person importing to explicitly choose to skip or
// overwrite.

function _attImportBatchSheet(ss) { return _ensureSheet(ss, CONFIG.SHEETS.IMPORT_BATCHES, CONFIG.SCHEMA.ImportBatches); }

// Resolves a VA name from an import file to an active ("Started")
// connection — the file only ever knows the VA's name, never our
// internal ConnectionID.
function _attBuildActiveVAIndex() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _connGetSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _connHMap(data[0]);
  var byName = {};
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['ConnectionStatus']]||'') !== 'Started') continue;
    var name = String(data[i][h['VAName']]||'').trim().toLowerCase();
    if (!name) continue;
    byName[name] = String(data[i][h['ConnectionID']]||'');
  }
  return byName;
}

// Existing (connectionId|date) pairs already on file, from any source —
// this is what duplicate detection checks against.
function _attBuildExistingRecordIndex() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _attGetSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _hMapGeneric(data[0]);
  var index = {};
  for (var i = 1; i < data.length; i++) {
    var connId = String(data[i][h['ConnectionID']]||'');
    var dateVal = data[i][h['Date']];
    if (!connId || !dateVal) continue;
    var dateKey = _attDateKey(dateVal);
    index[connId + '|' + dateKey] = { rowNum: i + 1, existingHours: data[i][h['ActualHours']] };
  }
  return index;
}
function _attDateKey(dateVal) {
  var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// Parses + validates every row without writing anything — the required
// preview step before commitAttendanceImport actually inserts rows.
// columnMapping = { vaName: 'header name in file', date: '...',
// regularHours: '...', nightDiffQualifyingHours: '...' (optional) }
function previewAttendanceImport(csvText, columnMapping) {
  try {
    var perm = checkModulePermission('Billing & Payments', 'c');
    if (!perm.allowed) return { success: false, error: 'You don\'t have permission to import attendance data.' };
    if (!csvText || !csvText.trim()) return { success: false, error: 'No CSV data provided.' };
    if (!columnMapping || !columnMapping.vaName || !columnMapping.date || !columnMapping.regularHours) {
      return { success: false, error: 'Column mapping for VA Name, Date, and Regular Hours is required.' };
    }

    var lines = csvText.replace(/\r/g, '').split('\n').filter(function(l){ return l.trim(); });
    if (lines.length < 2) return { success: false, error: 'CSV needs a header row plus at least one data row.' };
    var headerCells = lines[0].split(',').map(function(c){ return c.trim(); });
    var colIdx = {}; headerCells.forEach(function(c,i){ colIdx[c] = i; });

    ['vaName','date','regularHours'].forEach(function(k){
      if (colIdx[columnMapping[k]] === undefined) throw new Error('Column "' + columnMapping[k] + '" not found in the file header.');
    });

    var vaIndex = _attBuildActiveVAIndex();
    var existingIndex = _attBuildExistingRecordIndex();
    var now = new Date();
    var twoYearsAgo = new Date(now); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    var valid = [], invalid = [], duplicates = [];
    var seenInFile = {}; // catches the same VA/date appearing twice within this same file

    for (var li = 1; li < lines.length; li++) {
      var cells = lines[li].split(',').map(function(c){ return c.trim(); });
      var rowNum = li + 1;
      var vaNameRaw = cells[colIdx[columnMapping.vaName]] || '';
      var dateRaw = cells[colIdx[columnMapping.date]] || '';
      var hoursRaw = cells[colIdx[columnMapping.regularHours]] || '';
      var ndRaw = columnMapping.nightDiffQualifyingHours && colIdx[columnMapping.nightDiffQualifyingHours] !== undefined
        ? (cells[colIdx[columnMapping.nightDiffQualifyingHours]] || '') : '';

      if (!vaNameRaw || !dateRaw || hoursRaw === '') {
        invalid.push({ row: rowNum, reason: 'Missing VA Name, Date, or Regular Hours.', raw: cells.join(', ') });
        continue;
      }
      var connectionId = vaIndex[vaNameRaw.trim().toLowerCase()];
      if (!connectionId) {
        invalid.push({ row: rowNum, reason: 'VA "' + vaNameRaw + '" not found or not currently Active/Started.', raw: cells.join(', ') });
        continue;
      }
      var parsedDate = new Date(dateRaw);
      if (isNaN(parsedDate.getTime())) {
        invalid.push({ row: rowNum, reason: 'Date "' + dateRaw + '" is not a valid date.', raw: cells.join(', ') });
        continue;
      }
      if (parsedDate > now || parsedDate < twoYearsAgo) {
        invalid.push({ row: rowNum, reason: 'Date "' + dateRaw + '" is outside a plausible range (future, or more than 2 years ago).', raw: cells.join(', ') });
        continue;
      }
      var hours = Number(hoursRaw);
      if (isNaN(hours) || hours < 0) {
        invalid.push({ row: rowNum, reason: 'Hours "' + hoursRaw + '" must be a non-negative number.', raw: cells.join(', ') });
        continue;
      }
      // Flagged, not blocked — a genuinely unusual value still imports,
      // just with a warning attached for the person to review.
      var warning = hours > 24 ? 'Hours (' + hours + ') exceed a plausible daily maximum — imported anyway, please verify.' : '';

      var ndHours = ndRaw !== '' ? Number(ndRaw) : 0;
      if (ndRaw !== '' && (isNaN(ndHours) || ndHours < 0)) {
        invalid.push({ row: rowNum, reason: 'Night Differential hours "' + ndRaw + '" must be a non-negative number.', raw: cells.join(', ') });
        continue;
      }

      var dateKey = _attDateKey(parsedDate);
      var recordKey = connectionId + '|' + dateKey;
      var entry = { row: rowNum, vaName: vaNameRaw, connectionId: connectionId, date: dateKey, regularHours: hours, nightDiffQualifyingHours: ndHours, warning: warning };

      if (seenInFile[recordKey]) {
        invalid.push({ row: rowNum, reason: 'Duplicate VA/date within this same file (also on row ' + seenInFile[recordKey] + ').', raw: cells.join(', ') });
        continue;
      }
      seenInFile[recordKey] = rowNum;

      if (existingIndex[recordKey]) {
        entry.existingHours = existingIndex[recordKey].existingHours;
        duplicates.push(entry);
      } else {
        valid.push(entry);
      }
    }

    return {
      success: true,
      totalRows: lines.length - 1,
      valid: valid, invalid: invalid, duplicates: duplicates,
      summary: { validCount: valid.length, invalidCount: invalid.length, duplicateCount: duplicates.length }
    };
  } catch (e) {
    return { success: false, error: 'previewAttendanceImport: ' + e.message };
  }
}

// Commits an import — inserts every valid row plus any duplicates the
// person explicitly chose to overwrite (duplicateResolutions is an array
// of connectionId|date keys to overwrite; anything not in that list is
// skipped, not silently applied). Always creates an ImportBatches row,
// even for a batch that ends up Failed, so nothing imported is ever
// untraceable to what uploaded it.
function commitAttendanceImport(csvText, columnMapping, fileName, duplicateResolutions) {
  try {
    var perm = checkModulePermission('Billing & Payments', 'c');
    if (!perm.allowed) return { success: false, error: 'You don\'t have permission to import attendance data.' };

    var previewRes = previewAttendanceImport(csvText, columnMapping);
    if (!previewRes.success) return previewRes;

    var resolveSet = {};
    (duplicateResolutions || []).forEach(function(key){ resolveSet[key] = true; });

    var rowsToInsert = previewRes.valid.slice();
    previewRes.duplicates.forEach(function(d) {
      var key = d.connectionId + '|' + d.date;
      if (resolveSet[key]) rowsToInsert.push(d);
    });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _attGetSheet(ss);
    _migrateSheetColumns(ss, CONFIG.SHEETS.ATTENDANCE_RECORDS, CONFIG.SCHEMA.AttendanceRecords);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var existingIndex = _attBuildExistingRecordIndex();

    var now = new Date();
    var batchId = generateID('BATCH');
    var imported = 0;

    rowsToInsert.forEach(function(entry) {
      var recordKey = entry.connectionId + '|' + entry.date;
      var existing = existingIndex[recordKey];
      if (existing && resolveSet[recordKey]) {
        // Overwrite — explicitly chosen by the person importing, not automatic.
        sheet.getRange(existing.rowNum, h['ActualHours']+1).setValue(entry.regularHours);
        if (h['NightDiffQualifyingHours'] !== undefined) sheet.getRange(existing.rowNum, h['NightDiffQualifyingHours']+1).setValue(entry.nightDiffQualifyingHours);
        sheet.getRange(existing.rowNum, h['Source']+1).setValue('Imported');
        sheet.getRange(existing.rowNum, h['ImportBatchID']+1).setValue(batchId);
        sheet.getRange(existing.rowNum, h['UpdatedAt']+1).setValue(now);
        sheet.getRange(existing.rowNum, h['UpdatedBy']+1).setValue(perm.user.email);
        imported++;
        return;
      }
      var row = data[0].map(function(){ return ''; });
      var cm = {
        'RecordID': generateID('ATT'), 'ConnectionID': entry.connectionId,
        'Date': new Date(entry.date), 'ActualHours': entry.regularHours,
        'NightDiffQualifyingHours': entry.nightDiffQualifyingHours,
        'Source': 'Imported', 'ImportBatchID': batchId,
        'UpdatedAt': now, 'UpdatedBy': perm.user.email
      };
      Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
      sheet.appendRow(row);
      imported++;
    });

    var status = previewRes.invalid.length === 0 ? 'Success' : (imported > 0 ? 'Partial' : 'Failed');
    var batchSheet = _attImportBatchSheet(ss);
    var batchData = batchSheet.getDataRange().getValues();
    var bh = _hMapGeneric(batchData[0]);
    var batchRow = batchData[0].map(function(){ return ''; });
    var bcm = {
      'BatchID': batchId, 'UploadedBy': perm.user.email, 'DateUploaded': now, 'FileName': fileName || 'unknown.csv',
      'RowsTotal': previewRes.totalRows, 'RowsImported': imported,
      'RowsRejected': previewRes.invalid.length, 'RowsDuplicate': previewRes.duplicates.length,
      'Status': status, 'ErrorLog': JSON.stringify(previewRes.invalid)
    };
    Object.keys(bcm).forEach(function(col){ if (bh[col] !== undefined) batchRow[bh[col]] = bcm[col]; });
    batchSheet.appendRow(batchRow);

    _writeLog('Accounting', batchId, 'ATTENDANCE_IMPORTED', 'RowsImported', '', String(imported), perm.user);
    return { success: true, batchId: batchId, imported: imported, rejected: previewRes.invalid.length, status: status };
  } catch (e) {
    return { success: false, error: 'commitAttendanceImport: ' + e.message };
  }
}

function getImportBatches() {
  try {
    var perm = checkModulePermission('Billing & Payments', 'r');
    if (!perm.allowed) return { success: false, error: 'You don\'t have permission to view import history.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _attImportBatchSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      function get(col) { return h[col] !== undefined ? data[i][h[col]] : ''; }
      rows.push({
        batchId: String(get('BatchID')||''), uploadedBy: String(get('UploadedBy')||''),
        dateUploaded: get('DateUploaded'), fileName: String(get('FileName')||''),
        rowsTotal: get('RowsTotal')||0, rowsImported: get('RowsImported')||0,
        rowsRejected: get('RowsRejected')||0, rowsDuplicate: get('RowsDuplicate')||0,
        status: String(get('Status')||'')
      });
    }
    rows.sort(function(a,b){ return new Date(b.dateUploaded) - new Date(a.dateUploaded); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getImportBatches: ' + e.message };
  }
}

// ── Closes the Phase 2-4 gap: real attendance data as an ActualHours source ──
// Every calc function in Calculations.gs (Phase 2) required actualHours
// as a manual parameter, since there was no attendance-import source to
// derive it from. Now there is — this sums real AttendanceRecords for a
// connection/month, so a caller can use this instead of typing hours in
// by hand every time. Calculations.gs's functions are intentionally left
// as-is (still accepting an explicit actualHours parameter) rather than
// changed to call this automatically — that keeps manual override always
// possible, with this as the value a caller would typically pass in now
// that it can be derived rather than always guessed.
function getActualHoursFromAttendance(connectionId, yearMonth) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _attGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var parts = String(yearMonth).split('-');
    var year = Number(parts[0]), month = Number(parts[1]);

    var totalHours = 0, totalNdHours = 0, recordCount = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      var dateVal = data[i][h['Date']]; if (!dateVal) continue;
      var d = new Date(dateVal);
      if (d.getFullYear() !== year || (d.getMonth()+1) !== month) continue;
      totalHours += Number(data[i][h['ActualHours']]) || 0;
      if (h['NightDiffQualifyingHours'] !== undefined) totalNdHours += Number(data[i][h['NightDiffQualifyingHours']]) || 0;
      recordCount++;
    }
    return { success: true, actualHours: Math.round(totalHours*100)/100, ndQualifyingHours: Math.round(totalNdHours*100)/100, recordCount: recordCount };
  } catch (e) {
    return { success: false, error: 'getActualHoursFromAttendance: ' + e.message };
  }
}