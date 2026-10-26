// ─────────────────────────────────────────
// SettingsService.gs — System Settings CRUD
// ─────────────────────────────────────────

function getAllSettings() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };

    var headers = data[0];
    var h = {};
    headers.forEach(function (col, i) { h[col] = i; });

    if (h['SettingID'] === undefined) {
      return { success: false, error: 'Settings sheet headers missing. Re-run initializeSystem().' };
    }

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[h['SettingID']]) continue;
      rows.push({
        settingId:        row[h['SettingID']],
        category:         row[h['Category']],
        value:            row[h['Value']],
        label:            row[h['Label']],
        sortOrder:        row[h['SortOrder']],
        isActive:         row[h['IsActive']],
        parentDepartment: h['ParentDepartment'] !== undefined ? String(row[h['ParentDepartment']]||'') : '',
        timezone:         h['Timezone']         !== undefined ? String(row[h['Timezone']]||'')         : '',
        createdAt: (row[h['CreatedAt']] instanceof Date) ? row[h['CreatedAt']].toISOString() : String(row[h['CreatedAt']] || ''),
        updatedAt: (row[h['UpdatedAt']] instanceof Date) ? row[h['UpdatedAt']].toISOString() : String(row[h['UpdatedAt']] || '')
      });
    }

    rows.sort(function (rowA, rowB) {
      if (rowA.category !== rowB.category) return rowA.category.localeCompare(rowB.category);
      return (rowA.sortOrder || 0) - (rowB.sortOrder || 0);
    });

    return { success: true, data: rows };
  } catch (errObj) {
    return { success: false, error: errObj.message };
  }
}

function createSetting(payload) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage settings.' };

    var validationErrors = _validateSetting(payload);
    if (validationErrors.length) return { success: false, errors: validationErrors };

    // Check for duplicate value within same category
    var existingCheck = _settingExists(payload.category, payload.value, null);
    if (existingCheck) return { success: false, error: 'A "' + payload.value + '" entry already exists in ' + payload.category + '.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
    var now   = new Date();
    var newId = generateID('SET');

    // Get next sort order for this category
    var nextSort = _getNextSortOrder(sheet, payload.category);

    // Build row using header map so column order doesn't matter
    var hRow = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    var hMap = {}; hRow.forEach(function(col,i){ if(col) hMap[String(col)]=i; });
    var rowArr = new Array(hRow.length).fill('');
    function sc(col,val){ if(hMap[col]!==undefined) rowArr[hMap[col]]=val; }
    sc('SettingID',  newId);
    sc('Category',   payload.category.trim());
    sc('Value',      payload.value.trim());
    sc('Label',      payload.label ? payload.label.trim() : payload.value.trim());
    sc('SortOrder',  nextSort);
    sc('IsActive',   true);
    sc('CreatedAt',  now);
    sc('UpdatedAt',  now);
    sc('ParentDepartment', payload.parentDepartment ? payload.parentDepartment.trim() : '');
    sc('Timezone', payload.timezone ? payload.timezone.trim() : '');
    sheet.appendRow(rowArr);

    _writeLog('Setting', newId, 'CREATE', '', '', JSON.stringify({ category: payload.category, value: payload.value }), perm.user);
    return { success: true, id: newId };
  } catch (errObj) {
    return { success: false, error: errObj.message };
  }
}

function updateSetting(settingId, payload) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage settings.' };

    var validationErrors = _validateSetting(payload);
    if (validationErrors.length) return { success: false, errors: validationErrors };

    // Check for duplicate value within same category (excluding self)
    var existingCheck = _settingExists(payload.category, payload.value, settingId);
    if (existingCheck) return { success: false, error: 'A "' + payload.value + '" entry already exists in ' + payload.category + '.' };

    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var sheet   = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var h = {};
    headers.forEach(function (col, i) { h[col] = i; });

    for (var i = 1; i < data.length; i++) {
      if (data[i][h['SettingID']] !== settingId) continue;
      var rowNum = i + 1;
      var oldVal = data[i][h['Value']];
      var now    = new Date();

      sheet.getRange(rowNum, h['Value']     + 1).setValue(payload.value.trim());
      sheet.getRange(rowNum, h['Label']     + 1).setValue(payload.label ? payload.label.trim() : payload.value.trim());
      sheet.getRange(rowNum, h['IsActive']  + 1).setValue(payload.isActive !== undefined ? payload.isActive : true);
      if (h['ParentDepartment'] !== undefined && payload.parentDepartment !== undefined) {
        sheet.getRange(rowNum, h['ParentDepartment'] + 1).setValue(payload.parentDepartment.trim());
      }
      if (h['Timezone'] !== undefined && payload.timezone !== undefined) {
        sheet.getRange(rowNum, h['Timezone'] + 1).setValue(payload.timezone.trim());
      }
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(now);

      if (oldVal !== payload.value.trim()) {
        _writeLog('Setting', settingId, 'UPDATE', 'value', oldVal, payload.value.trim(), perm.user);
      }
      return { success: true };
    }
    return { success: false, error: 'Setting not found.' };
  } catch (errObj) {
    return { success: false, error: errObj.message };
  }
}

function deleteSetting(settingId) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage settings.' };

    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var sheet   = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var h = {};
    headers.forEach(function (col, i) { h[col] = i; });

    for (var i = 1; i < data.length; i++) {
      if (data[i][h['SettingID']] !== settingId) continue;
      _writeLog('Setting', settingId, 'DELETE', '', data[i][h['Value']], '', perm.user);
      sheet.deleteRow(i + 1);
      return { success: true };
    }
    return { success: false, error: 'Setting not found.' };
  } catch (errObj) {
    return { success: false, error: errObj.message };
  }
}

function toggleSettingActive(settingId, isActive) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage settings.' };

    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var sheet   = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var h = {};
    headers.forEach(function (col, i) { h[col] = i; });

    for (var i = 1; i < data.length; i++) {
      if (data[i][h['SettingID']] !== settingId) continue;
      var rowNum = i + 1;
      sheet.getRange(rowNum, h['IsActive']  + 1).setValue(isActive);
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(new Date());
      _writeLog('Setting', settingId, 'UPDATE', 'isActive', !isActive, isActive, perm.user);
      return { success: true };
    }
    return { success: false, error: 'Setting not found.' };
  } catch (errObj) {
    return { success: false, error: errObj.message };
  }
}

function reorderSettings(category, orderedIds) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage settings.' };

    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var sheet   = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var h = {};
    headers.forEach(function (col, i) { h[col] = i; });

    // Build a map of settingId -> row number
    var rowMap = {};
    for (var i = 1; i < data.length; i++) {
      var rowId = data[i][h['SettingID']];
      if (rowId) rowMap[rowId] = i + 1;
    }

    // Apply new sort orders
    orderedIds.forEach(function (settingId, idx) {
      if (rowMap[settingId]) {
        sheet.getRange(rowMap[settingId], h['SortOrder'] + 1).setValue(idx + 1);
        sheet.getRange(rowMap[settingId], h['UpdatedAt'] + 1).setValue(new Date());
      }
    });

    return { success: true };
  } catch (errObj) {
    return { success: false, error: errObj.message };
  }
}

// ── Helpers
function _validateSetting(payload) {
  var errs = [];
  var validCategories = ['Category', 'Type', 'CountryRegion', 'Department', 'Service', 'TerminationReason', 'VARequestLostReason', 'InquiryType', 'InquiryLostReason'];
  if (!payload.category || !payload.category.trim())  errs.push('Category is required.');
  if (!payload.value    || !payload.value.trim())     errs.push('Value is required.');
  if (validCategories.indexOf(payload.category) === -1) errs.push('Invalid category: ' + payload.category);
  return errs;
}

function _settingExists(category, value, excludeId) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  var data  = sheet.getDataRange().getValues();
  var headers = data[0];
  var h = {};
  headers.forEach(function (col, i) { h[col] = i; });

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[h['SettingID']] === excludeId) continue;
    if (row[h['Category']] === category &&
        row[h['Value']].toString().toLowerCase() === value.toString().toLowerCase()) {
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// WR TEMPLATE SETTINGS — per-department Regular/Project-Based WR template
// links and target Drive folder, plus one global filename pattern.
// ═══════════════════════════════════════════════════════════════════════
function getWRTemplateSettings() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, CONFIG.SHEETS.WR_TEMPLATE_SETTINGS, CONFIG.SCHEMA.WRTemplateSettings);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var byDept = {}; var filenamePattern = '';
    for (var i = 1; i < data.length; i++) {
      var dept = String(data[i][h['Department']]||''); if (!dept) continue;
      if (dept === '__GLOBAL__') { filenamePattern = String(data[i][h['FilenamePattern']]||''); continue; }
      byDept[dept] = {
        settingId: String(data[i][h['SettingID']]||''),
        department: dept,
        regularTemplateLink: String(data[i][h['RegularTemplateLink']]||''),
        projectTemplateLink: String(data[i][h['ProjectTemplateLink']]||''),
        folderLink: String(data[i][h['FolderLink']]||'')
      };
    }
    return { success: true, byDepartment: byDept, filenamePattern: filenamePattern || 'WR - {CustomerName} - {VAName} - {Type}' };
  } catch (e) {
    return { success: false, error: 'getWRTemplateSettings: ' + e.message };
  }
}

function saveWRTemplateSetting(department, payload) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can update WR Template settings.' };
    if (!department) return { success: false, error: 'Department is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, CONFIG.SHEETS.WR_TEMPLATE_SETTINGS, CONFIG.SCHEMA.WRTemplateSettings);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var now = new Date();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Department']]||'') !== department) continue;
      var rowNum = i + 1;
      sheet.getRange(rowNum, h['RegularTemplateLink']+1).setValue(payload.regularTemplateLink || '');
      sheet.getRange(rowNum, h['ProjectTemplateLink']+1).setValue(payload.projectTemplateLink || '');
      sheet.getRange(rowNum, h['FolderLink']+1).setValue(payload.folderLink || '');
      sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(perm.user.email);
      return { success: true };
    }
    // Not found — append a new row for this department
    var newId = generateID('WRT');
    var arr = new Array(Object.keys(h).length).fill('');
    arr[h['SettingID']] = newId;
    arr[h['Department']] = department;
    arr[h['RegularTemplateLink']] = payload.regularTemplateLink || '';
    arr[h['ProjectTemplateLink']] = payload.projectTemplateLink || '';
    arr[h['FolderLink']] = payload.folderLink || '';
    arr[h['UpdatedAt']] = now;
    arr[h['UpdatedBy']] = perm.user.email;
    sheet.appendRow(arr);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'saveWRTemplateSetting: ' + e.message };
  }
}

function saveWRFilenamePattern(pattern) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can update this setting.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, CONFIG.SHEETS.WR_TEMPLATE_SETTINGS, CONFIG.SCHEMA.WRTemplateSettings);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var now = new Date();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Department']]||'') !== '__GLOBAL__') continue;
      sheet.getRange(i+1, h['FilenamePattern']+1).setValue(pattern || '');
      sheet.getRange(i+1, h['UpdatedAt']+1).setValue(now);
      sheet.getRange(i+1, h['UpdatedBy']+1).setValue(perm.user.email);
      return { success: true };
    }
    var arr = new Array(Object.keys(h).length).fill('');
    arr[h['SettingID']] = generateID('WRT');
    arr[h['Department']] = '__GLOBAL__';
    arr[h['FilenamePattern']] = pattern || '';
    arr[h['UpdatedAt']] = now;
    arr[h['UpdatedBy']] = perm.user.email;
    sheet.appendRow(arr);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'saveWRFilenamePattern: ' + e.message };
  }
}