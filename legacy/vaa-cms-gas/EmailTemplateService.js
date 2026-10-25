// ─────────────────────────────────────────
// EmailTemplateService.gs — Email Templates CRUD
// Templates back the Birthdays & Anniversaries module's editable email
// previews. Categories are fixed (Birthday/Anniversary × Notify/Follow-up)
// so the celebration list always has something to load, but admins can add
// as many additional templates per category as they like — the picker on
// the preview screen lets CS choose among all active templates in that
// category, defaulting to whichever is flagged IsDefault.
// ─────────────────────────────────────────

function _etGetSheet(ss) {
  return _ensureSheet(ss, CONFIG.SHEETS.EMAIL_TEMPLATES, CONFIG.SCHEMA.EmailTemplates);
}

function _etHMap(headerRow) {
  var h = {};
  for (var i = 0; i < headerRow.length; i++) {
    if (headerRow[i]) h[String(headerRow[i]).trim()] = i;
  }
  return h;
}

function _sdET(val) {
  if (val instanceof Date) return val.toISOString();
  if (val === null || val === undefined) return '';
  return String(val);
}

// "January 12, 2026" — for date VALUES shown directly in an email body
// (birthdays, etc.), where a raw ISO timestamp would look wrong to a
// recipient. Kept separate from _sdET, which other callers still need as
// a raw/internal timestamp.
function _formatLongDate(val) {
  if (!val) return '';
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function _mapTemplateRow(r, h) {
  function get(col) {
    if (h[col] === undefined) return '';
    var v = r[h[col]];
    if (v instanceof Date) return v.toISOString();
    return String(v == null ? '' : v);
  }
  return {
    templateId: get('TemplateID'),
    module:     get('Module') || 'Celebrations',
    category:   get('Category'),
    name:       get('Name'),
    subject:    get('Subject'),
    body:       get('Body'),
    imageUrl:   get('ImageUrl'),
    isHtml:     h['IsHtml'] !== undefined ? _toBool(r[h['IsHtml']]) : false,
    isActive:   h['IsActive']  !== undefined ? _toBool(r[h['IsActive']])  : true,
    isDefault:  h['IsDefault'] !== undefined ? _toBool(r[h['IsDefault']]) : false,
    createdAt:  get('CreatedAt'),
    createdBy:  get('CreatedBy'),
    updatedAt:  get('UpdatedAt'),
    updatedBy:  get('UpdatedBy')
  };
}

function getEmailTemplates(filters) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _etGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _etHMap(data[0]);
    filters = filters || {};

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['TemplateID']]) continue;
      var rec = _mapTemplateRow(r, h);
      if (filters.module && rec.module !== filters.module) continue;
      if (filters.category && rec.category !== filters.category) continue;
      if (filters.activeOnly && !rec.isActive) continue;
      rows.push(rec);
    }
    // Module first, then defaults within each category, then alphabetical by name
    rows.sort(function(a, b) {
      if (a.module !== b.module) return a.module.localeCompare(b.module);
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getEmailTemplates: ' + e.message };
  }
}

function getEmailTemplateById(templateId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _etGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _etHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['TemplateID']]) === templateId) {
        return { success: true, data: _mapTemplateRow(data[i], h) };
      }
    }
    return { success: false, error: 'Template not found.' };
  } catch (e) {
    return { success: false, error: 'getEmailTemplateById: ' + e.message };
  }
}

// Returns the template to preload into the editable preview for a given
// category: the one flagged IsDefault if there is one, else the first
// active template in that category, else null (caller falls back to a
// blank subject/body so the CS can still type one from scratch).
function getDefaultTemplateForCategory(category) {
  try {
    var res = getEmailTemplates({ category: category, activeOnly: true });
    if (!res.success || !res.data.length) return { success: true, data: null };
    var def = res.data.find(function(t) { return t.isDefault; }) || res.data[0];
    return { success: true, data: def };
  } catch (e) {
    return { success: false, error: 'getDefaultTemplateForCategory: ' + e.message };
  }
}

function _ensureEmailTemplateModuleHeader(sheet) {
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  var headerRow = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var has = headerRow.some(function(c) { return String(c||'').trim() === 'Module'; });
  if (has) return;
  sheet.getRange(1, lastCol + 1).setValue('Module');
}

function createEmailTemplate(payload) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage email templates.' };

    var errors = _validateTemplate(payload);
    if (errors.length) return { success: false, errors: errors };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _etGetSheet(ss);
    _ensureEmailTemplateModuleHeader(sheet);
    var now   = new Date();
    var id    = generateID('EMT');

    // If this is marked default, un-default any existing default in the same module+category first
    if (payload.isDefault) _clearDefaultsInCategory(sheet, payload.module || 'Celebrations', payload.category);

    var hRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var hMap = _etHMap(hRow);
    var rowData = hRow.map(function(){ return ''; });
    var colMap = {
      'TemplateID': id,
      'Module':     payload.module || 'Celebrations',
      'Category':   payload.category || '',
      'Name':       payload.name.trim(),
      'Subject':    payload.subject || '',
      'Body':       payload.body     || '',
      'ImageUrl':   payload.imageUrl  || '',
      'IsHtml':     !!payload.isHtml,
      'IsActive':   payload.isActive !== undefined ? !!payload.isActive : true,
      'IsDefault':  !!payload.isDefault,
      'CreatedAt':  now,
      'CreatedBy':  perm.user.email,
      'UpdatedAt':  now,
      'UpdatedBy':  perm.user.email
    };
    Object.keys(colMap).forEach(function(col){ if (hMap[col] !== undefined) rowData[hMap[col]] = colMap[col]; });
    sheet.appendRow(rowData);

    _writeLog('EmailTemplate', id, 'CREATE', '', '', JSON.stringify({ name: payload.name, category: payload.category }), perm.user);
    return { success: true, id: id };
  } catch (e) {
    return { success: false, error: 'createEmailTemplate: ' + e.message };
  }
}

function updateEmailTemplate(templateId, payload) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage email templates.' };

    var errors = _validateTemplate(payload);
    if (errors.length) return { success: false, errors: errors };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _etGetSheet(ss);
    _ensureEmailTemplateModuleHeader(sheet);
    var data  = sheet.getDataRange().getValues();
    var h     = _etHMap(data[0]);

    if (payload.isDefault) _clearDefaultsInCategory(sheet, payload.module || 'Celebrations', payload.category, templateId);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['TemplateID']]) !== templateId) continue;
      var rowNum = i + 1;
      var colMap = {
        'Module':    payload.module || 'Celebrations',
        'Category':  payload.category || '',
        'Name':      payload.name.trim(),
        'Subject':   payload.subject || '',
        'Body':      payload.body     || '',
        'ImageUrl':  payload.imageUrl  || '',
        'IsHtml':    !!payload.isHtml,
        'IsActive':  payload.isActive !== undefined ? !!payload.isActive : true,
        'IsDefault': !!payload.isDefault,
        'UpdatedAt': new Date(),
        'UpdatedBy': perm.user.email
      };
      Object.keys(colMap).forEach(function(col){ if (h[col] !== undefined) sheet.getRange(rowNum, h[col]+1).setValue(colMap[col]); });
      _writeLog('EmailTemplate', templateId, 'UPDATE', 'profile', '', payload.name, perm.user);
      return { success: true };
    }
    return { success: false, error: 'Template not found.' };
  } catch (e) {
    return { success: false, error: 'updateEmailTemplate: ' + e.message };
  }
}

function deleteEmailTemplate(templateId) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage email templates.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _etGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _etHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['TemplateID']]) !== templateId) continue;
      _writeLog('EmailTemplate', templateId, 'DELETE', '', String(data[i][h['Name']]||''), '', perm.user);
      sheet.deleteRow(i + 1);
      return { success: true };
    }
    return { success: false, error: 'Template not found.' };
  } catch (e) {
    return { success: false, error: 'deleteEmailTemplate: ' + e.message };
  }
}

function _clearDefaultsInCategory(sheet, module, category, exceptTemplateId) {
  var data = sheet.getDataRange().getValues();
  var h = _etHMap(data[0]);
  if (h['IsDefault'] === undefined) return;
  for (var i = 1; i < data.length; i++) {
    if (h['Module'] !== undefined && String(data[i][h['Module']]||'Celebrations') !== module) continue;
    if (String(data[i][h['Category']]||'') !== (category||'')) continue;
    if (exceptTemplateId && String(data[i][h['TemplateID']]) === exceptTemplateId) continue;
    if (_toBool(data[i][h['IsDefault']])) {
      sheet.getRange(i + 1, h['IsDefault'] + 1).setValue(false);
    }
  }
}

function _validateTemplate(payload) {
  var errors = [];
  if (!payload) { errors.push('Missing template data.'); return errors; }
  var module = payload.module || 'Celebrations';
  if (CONFIG.EMAIL_TEMPLATE_MODULES.indexOf(module) === -1) errors.push('Invalid module: ' + module);
  // Category only applies within the Celebrations module — other modules
  // (e.g. Customer Onboarding) don't use it at all, so it's neither
  // required nor validated for them.
  if (module === 'Celebrations') {
    var validCategories = Object.keys(CONFIG.EMAIL_TEMPLATE_CATEGORY).map(function(k){ return CONFIG.EMAIL_TEMPLATE_CATEGORY[k]; });
    if (!payload.category) errors.push('Category is required.');
    else if (validCategories.indexOf(payload.category) === -1) errors.push('Invalid category: ' + payload.category);
  }
  if (!payload.name || !payload.name.trim()) errors.push('Template Name is required.');
  if (!payload.subject || !payload.subject.trim()) errors.push('Subject is required.');
  if (!payload.body || !payload.body.trim()) errors.push('Body is required.');
  return errors;
}

// Merge {{placeholder}} tokens into a template string. Unknown placeholders
// are left as-is (rather than silently dropped) so a typo is visible and
// fixable in the editable preview, instead of disappearing into blank text.
function _mergeTemplate(str, vars) {
  if (!str) return '';
  return str.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function(match, key) {
    return (vars && vars[key] !== undefined && vars[key] !== null) ? String(vars[key]) : match;
  });
}