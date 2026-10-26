// ═══════════════════════════════════════════════════════════════════════
// VA DATABASE
// ═══════════════════════════════════════════════════════════════════════
// getVAs / createVA / updateVA / getVAById — called throughout the app
// (VA Database module, Celebrations, Playbook, Router.gs's getVAList,
// getVAById wrapper) but this file itself was missing from the working
// set for this session. Rebuilt here from every call site's expected
// payload/field shape. If a differently-named or differently-shaped
// version of this file already exists in the live Apps Script project,
// reconcile field names before replacing it outright — this was written
// to match current usage, not to guess at anything beyond that.

function _vaGetSheet(ss) {
  return _ensureSheet(ss, CONFIG.SHEETS.VIRTUAL_ASSISTANTS, CONFIG.SCHEMA.VirtualAssistants);
}

function _vaHMap(headerRow) {
  var h = {};
  headerRow.forEach(function(c, i) { if (c) h[String(c).trim()] = i; });
  return h;
}

// Maps one VA row to a plain object. includeRate controls whether
// BaseRate is present at all — compensation data, HR-only, per the
// schema's own documented intent (_canSeeVARate in AuthManager.gs).
function _mapVARow(row, h, includeRate) {
  function get(col) {
    if (h[col] === undefined) return '';
    var v = row[h[col]];
    if (v instanceof Date) return v.toISOString();
    return v == null ? '' : v;
  }
  var rec = {
    vaId:          String(get('VAID') || ''),
    vaName:        String(get('VAName') || ''),
    email:         String(get('Email') || ''),
    department:    String(get('Department') || ''),
    service:       String(get('Service') || ''),
    gender:        String(get('Gender') || ''),
    status:        String(get('Status') || 'Active'),
    notes:         String(get('Notes') || ''),
    birthday:      get('Birthday'),
    hireDate:      get('HireDate'),
    portfolioLink: String(get('PortfolioLink') || ''),
    createdAt:     get('CreatedAt'),
    updatedAt:     get('UpdatedAt')
  };
  if (includeRate) rec.baseRate = get('BaseRate');
  return rec;
}

function getVAs(filters) {
  try {
    filters = filters || {};
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _vaGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _vaHMap(data[0]);
    if (h['VAID'] === undefined) return { success: true, data: [] };

    var includeRate = _canSeeVARate(perm.user.role);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['VAID']]) continue;
      if (filters.status && String(data[i][h['Status']]||'') !== filters.status) continue;
      if (filters.department && String(data[i][h['Department']]||'') !== filters.department) continue;
      rows.push(_mapVARow(data[i], h, includeRate));
    }
    rows.sort(function(a,b){ return (a.vaName||'').localeCompare(b.vaName||''); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getVAs: ' + e.message };
  }
}

function getVAById(vaId) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _vaGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: false, error: 'VA not found.' };
    var h = _vaHMap(data[0]);
    var includeRate = _canSeeVARate(perm.user.role);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['VAID']]) !== vaId) continue;
      return { success: true, data: _mapVARow(data[i], h, includeRate) };
    }
    return { success: false, error: 'VA not found.' };
  } catch (e) {
    return { success: false, error: 'getVAById: ' + e.message };
  }
}

function createVA(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!payload || !String(payload.vaName||'').trim()) return { success: false, errors: ['VA Name is required.'] };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _vaGetSheet(ss);
    _migrateSheetColumns(ss, CONFIG.SHEETS.VIRTUAL_ASSISTANTS, CONFIG.SCHEMA.VirtualAssistants);
    var h = _vaHMap(sheet.getDataRange().getValues()[0]);
    var id = generateID('VA');
    var now = new Date();

    var rowArr = [];
    Object.keys(h).forEach(function(col) { rowArr[h[col]] = ''; });
    var colMap = {
      'VAID': id,
      'VAName': String(payload.vaName||'').trim(),
      'Email': String(payload.email||'').trim(),
      'Department': payload.department||'',
      'Service': String(payload.service||'').trim(),
      'Gender': payload.gender||'',
      'Status': payload.status||'Active',
      'Notes': String(payload.notes||''),
      'Birthday': payload.birthday ? new Date(payload.birthday) : '',
      'HireDate': payload.hireDate ? _parseDateInput(payload.hireDate) : '',
      'PortfolioLink': String(payload.portfolioLink||'').trim(),
      'CreatedAt': now,
      'UpdatedAt': now
    };
    // BaseRate is only ever present in colMap (and therefore written) if
    // the caller actually sent it — the frontend itself only includes
    // this field in the payload when the rate input is present in the
    // DOM, which is HR/Admin-only, so this is a second, independent gate
    // rather than the only one.
    if (payload.baseRate !== undefined && _canSeeVARate(perm.user.role)) colMap['BaseRate'] = payload.baseRate;

    Object.keys(colMap).forEach(function(col) {
      if (h[col] !== undefined) rowArr[h[col]] = colMap[col];
    });
    sheet.appendRow(rowArr);
    _writeLog('VirtualAssistant', id, 'CREATE', 'VA', '', colMap['VAName'], perm.user);
    return { success: true, id: id };
  } catch (e) {
    return { success: false, error: 'createVA: ' + e.message };
  }
}

function updateVA(vaId, payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!payload || !String(payload.vaName||'').trim()) return { success: false, errors: ['VA Name is required.'] };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _vaGetSheet(ss);
    _migrateSheetColumns(ss, CONFIG.SHEETS.VIRTUAL_ASSISTANTS, CONFIG.SCHEMA.VirtualAssistants);
    var data = sheet.getDataRange().getValues();
    var h = _vaHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['VAID']]) !== vaId) continue;
      var rowNum = i + 1;
      var colMap = {
        'VAName': String(payload.vaName||'').trim(),
        'Email': String(payload.email||'').trim(),
        'Department': payload.department||'',
        'Service': String(payload.service||'').trim(),
        'Gender': payload.gender||'',
        'Status': payload.status||'Active',
        'Notes': String(payload.notes||''),
        'Birthday': payload.birthday ? new Date(payload.birthday) : '',
        'HireDate': payload.hireDate ? _parseDateInput(payload.hireDate) : '',
        'PortfolioLink': String(payload.portfolioLink||'').trim(),
        'UpdatedAt': new Date()
      };
      if (payload.baseRate !== undefined && _canSeeVARate(perm.user.role)) colMap['BaseRate'] = payload.baseRate;

      Object.keys(colMap).forEach(function(col) {
        if (h[col] !== undefined) sheet.getRange(rowNum, h[col]+1).setValue(colMap[col]);
      });
      _writeLog('VirtualAssistant', vaId, 'UPDATE', 'VA', '', colMap['VAName'], perm.user);
      return { success: true };
    }
    return { success: false, error: 'VA not found.' };
  } catch (e) {
    return { success: false, error: 'updateVA: ' + e.message };
  }
}