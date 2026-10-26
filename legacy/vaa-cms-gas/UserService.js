// ─────────────────────────────────────────
// UserService.gs — User management
// ─────────────────────────────────────────

function getUsers(filters) {
  try {
    var perm = checkPermission('manageSettings'); // Admin only
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage users.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };

    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });
    if (h['UserID'] === undefined) return { success: false, error: 'Users sheet headers missing.' };

    filters = filters || {};
    var rows = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[h['UserID']]) continue;

      var rec = {
        userId:    String(row[h['UserID']]    || ''),
        email:     String(row[h['Email']]     || ''),
        name:      String(row[h['Name']]      || ''),
        role:      String(row[h['Role']]      || ''),
        department:h['Department'] !== undefined ? String(row[h['Department']] || '') : '',
        isActive:  row[h['IsActive']] !== false && row[h['IsActive']] !== 'false' && row[h['IsActive']] !== 0,
        createdAt: (row[h['CreatedAt']] instanceof Date) ? row[h['CreatedAt']].toISOString() : String(row[h['CreatedAt']] || ''),
        lastLogin: (row[h['LastLogin']] instanceof Date) ? row[h['LastLogin']].toISOString() : String(row[h['LastLogin']] || '')
      };

      if (filters.role     && rec.role !== filters.role) continue;
      if (filters.isActive !== undefined && rec.isActive !== filters.isActive) continue;
      rows.push(rec);
    }

    return { success: true, data: rows };
  } catch (errObj) {
    return { success: false, error: 'getUsers: ' + errObj.message };
  }
}

// Self-healing header check, same reasoning as the ActivityLogs
// EffectiveDate fix — an existing deployment's Users sheet was created
// before Department existed in the schema, so its header row never got
// that column labeled even after this code starts trying to use it.
function _ensureUsersDepartmentHeader(sheet) {
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  var headerRow = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var has = headerRow.some(function(c) { return String(c||'').trim() === 'Department'; });
  if (has) return;
  sheet.getRange(1, lastCol + 1).setValue('Department');
}

function createUser(payload) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can add users.' };

    var errors = _validateUser(payload);
    if (errors.length) return { success: false, errors: errors };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    _ensureUsersDepartmentHeader(sheet);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    // Check for duplicate email
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Email']] || '').toLowerCase() === payload.email.toLowerCase()) {
        return { success: false, error: 'A user with this email already exists.' };
      }
    }

    var now = new Date();
    var id  = generateID('USR');
    // Built by header-name lookup, not a fixed-position array — the
    // schema just grew a Department column, and a positional appendRow
    // would silently write into the wrong column if this sheet's header
    // order ever drifted from CONFIG.SCHEMA.Users (the same fragility
    // that was just fixed for ActivityLogs' _writeLog).
    var row = new Array(Math.max(sheet.getLastColumn(), 9)).fill('');
    function set(col, val) { if (h[col] !== undefined) row[h[col]] = val; }
    set('UserID', id);
    set('Email', payload.email.trim());
    set('Name', payload.name.trim());
    set('Role', payload.role);
    set('IsActive', true);
    set('CreatedAt', now);
    set('LastLogin', '');
    set('Department', payload.department || '');
    sheet.appendRow(row);

    _writeLog('User', id, 'CREATE', '', '', JSON.stringify({ email: payload.email, role: payload.role }), perm.user);
    return { success: true, id: id };
  } catch (errObj) {
    return { success: false, error: 'createUser: ' + errObj.message };
  }
}

function updateUser(userId, payload) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can edit users.' };

    var errors = _validateUser(payload, true);
    if (errors.length) return { success: false, errors: errors };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    _ensureUsersDepartmentHeader(sheet);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    // Duplicate email check (excluding self)
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['UserID']] || '') === userId) continue;
      if (String(data[i][h['Email']]  || '').toLowerCase() === payload.email.toLowerCase()) {
        return { success: false, error: 'Another user already has this email.' };
      }
    }

    for (var j = 1; j < data.length; j++) {
      if (String(data[j][h['UserID']]) !== userId) continue;
      var rowNum = j + 1;
      var old = { name: String(data[j][h['Name']] || ''), role: String(data[j][h['Role']] || ''), email: String(data[j][h['Email']] || '') };

      sheet.getRange(rowNum, h['Email'] + 1).setValue(payload.email.trim());
      sheet.getRange(rowNum, h['Name']  + 1).setValue(payload.name.trim());
      sheet.getRange(rowNum, h['Role']  + 1).setValue(payload.role);
      if (h['Department'] !== undefined) sheet.getRange(rowNum, h['Department']+1).setValue(payload.department || '');

      _logChanges('User', userId, old, payload, perm.user);
      return { success: true };
    }
    return { success: false, error: 'User not found.' };
  } catch (errObj) {
    return { success: false, error: 'updateUser: ' + errObj.message };
  }
}

function toggleUserActive(userId, isActive) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can activate/deactivate users.' };

    // Prevent deactivating yourself
    var currentUser = getCurrentUser();
    if (currentUser && currentUser.id === userId && !isActive) {
      return { success: false, error: 'You cannot deactivate your own account.' };
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['UserID']]) !== userId) continue;
      sheet.getRange(i + 1, h['IsActive'] + 1).setValue(isActive);
      _writeLog('User', userId, 'UPDATE', 'IsActive', !isActive, isActive, perm.user);
      return { success: true };
    }
    return { success: false, error: 'User not found.' };
  } catch (errObj) {
    return { success: false, error: 'toggleUserActive: ' + errObj.message };
  }
}

// Returns list of CS Specialists for assignment dropdown
function getSpecialists() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    var specialists = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[h['UserID']]) continue;
      var role     = String(row[h['Role']]     || '');
      var isActive = row[h['IsActive']] !== false && row[h['IsActive']] !== 'false' && row[h['IsActive']] !== 0;
      if ((role === CONFIG.ROLES.CS_SPECIALIST || role === CONFIG.ROLES.CS_MANAGER) && isActive) {
        specialists.push({
          userId: String(row[h['UserID']] || ''),
          email:  String(row[h['Email']]  || ''),
          name:   String(row[h['Name']]   || '')
        });
      }
    }
    return { success: true, data: specialists };
  } catch (errObj) {
    return { success: false, error: errObj.message };
  }
}

// Returns customers assigned to the current user (for CS Specialist view)
function getMyCustomers() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: user.error || 'Not authenticated.' };

    var email = user.email;
    var res   = getCustomers({});
    if (!res.success) return res;

    var assigned = res.data.filter(function (cust) {
      return String(cust.assignedSpecialist || '').toLowerCase() === email.toLowerCase();
    });

    return { success: true, data: assigned, user: user };
  } catch (errObj) {
    return { success: false, error: 'getMyCustomers: ' + errObj.message };
  }
}

function _validateUser(payload, isUpdate) {
  var errors = [];
  if (!payload.email || !payload.email.trim()) {
    errors.push('Email is required.');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) {
    errors.push('Email is not valid.');
  }
  if (!isUpdate && (!payload.name || !payload.name.trim())) errors.push('Name is required.');
  if (isUpdate    && (!payload.name || !payload.name.trim())) errors.push('Name is required.');

  var validRoles = [
    CONFIG.ROLES.ADMINISTRATOR,
    CONFIG.ROLES.CS_MANAGER,
    CONFIG.ROLES.CS_SPECIALIST,
    CONFIG.ROLES.MANAGER,
    CONFIG.ROLES.HR_SPECIALIST,
    CONFIG.ROLES.HR_MANAGER,
    CONFIG.ROLES.SERVICE_MANAGER,
    CONFIG.ROLES.ACCOUNTING,
    CONFIG.ROLES.RECRUITMENT,
    CONFIG.ROLES.TRAINING,
    CONFIG.ROLES.EXECUTIVE,
    CONFIG.ROLES.EXECUTIVE_SUPPORT
  ];
  if (!payload.role || validRoles.indexOf(payload.role) === -1) {
    errors.push('Valid role is required.');
  }
  return errors;
}

// ── Get all CS Specialists with their assigned customers and backup
function getCSSpecialistsWithData() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    // Build list of all specialists
    var specialists = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[h['UserID']]) continue;
      var rowRole = String(row[h['Role']] || '');
      if (rowRole !== CONFIG.ROLES.CS_SPECIALIST && rowRole !== CONFIG.ROLES.CS_MANAGER) continue;
      var isActive = row[h['IsActive']] !== false && row[h['IsActive']] !== 'false' && row[h['IsActive']] !== 0;
      specialists.push({
        userId:          String(row[h['UserID']] || ''),
        email:           String(row[h['Email']]  || ''),
        name:            String(row[h['Name']]   || ''),
        role:            String(row[h['Role']]   || ''),
        isActive:        isActive,
        createdAt:       (row[h['CreatedAt']] instanceof Date) ? row[h['CreatedAt']].toISOString() : String(row[h['CreatedAt']] || ''),
        lastLogin:       (row[h['LastLogin']] instanceof Date) ? row[h['LastLogin']].toISOString() : String(row[h['LastLogin']] || ''),
        customerCount:   0,
        customers:       []
      });
    }

    // Get all customers and count assigned per specialist
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var custData  = custSheet ? custSheet.getDataRange().getValues() : [[]];
    var custH = {};
    custData[0].forEach(function (col, i) { if (col) custH[String(col)] = i; });

    for (var k = 1; k < custData.length; k++) {
      var cRow = custData[k];
      if (!cRow[custH['CustomerID']]) continue;
      var specEmail = String(cRow[custH['AssignedSpecialist']] || '').toLowerCase().trim();
      var custStatus = String(cRow[custH['Status']] || '');
      for (var s = 0; s < specialists.length; s++) {
        if (specialists[s].email.toLowerCase() === specEmail) {
          // customerCount is the "Customers" column on the CS Specialists
          // list — it should reflect current active caseload only, not
          // every customer ever assigned (Paused/Terminated/etc. inflate it
          // otherwise and it stops meaning "how many am I actively serving").
          if (custStatus === CONFIG.STATUS.ACTIVE) specialists[s].customerCount++;
          specialists[s].customers.push({
            customerId:   String(cRow[custH['CustomerID']]   || ''),
            customerName: String(cRow[custH['CustomerName']] || ''),
            status:       custStatus
          });
          break;
        }
      }
    }

    return { success: true, data: specialists };
  } catch (e) {
    return { success: false, error: 'getCSSpecialistsWithData: ' + e.message };
  }
}

// ── Customer Takeovers — replaces Backup Specialist entirely ───────────
// A CS Manager assigns SPECIFIC customers to a covering specialist for a
// fixed date range, rather than one specialist blanket-covering
// everything for another. Once EndDate passes, the covering specialist
// loses access to those customers again automatically — there's nothing
// to manually expire, since every access check compares today's date
// against StartDate/EndDate fresh.
//
// Just the set of customer IDs currently, actively taken over by this
// user (today falls within StartDate..EndDate) — NOT combined with their
// own normally-assigned customers, since every caller already has its
// own "is this customer assigned to me" check; this only adds the extra
// ones a takeover grants. Cached per Apps Script execution, since this
// can be called many times in one page load and the underlying sheet
// doesn't change mid-request.
var _takeoverCustomerIdsCache = null;
function getTakeoverCustomerIdsForSpecialist(userEmail) {
  if (!userEmail) return [];
  var normalizedEmail = String(userEmail).toLowerCase().trim();
  if (!_takeoverCustomerIdsCache) {
    _takeoverCustomerIdsCache = {};
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMER_TAKEOVERS);
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
        var todayStr = _sd(new Date()); // 'YYYY-MM-DD', matching how Start/EndDate are stored
        for (var i = 1; i < data.length; i++) {
          var toEmail = String(data[i][h['TakeoverSpecialistEmail']]||'').toLowerCase().trim();
          if (!toEmail) continue;
          var toStart = String(data[i][h['StartDate']]||'');
          var toEnd = String(data[i][h['EndDate']]||'');
          if (!toStart || !toEnd) continue;
          if (todayStr < toStart || todayStr > toEnd) continue; // outside the active window
          var toCustId = String(data[i][h['CustomerID']]||''); if (!toCustId) continue;
          if (!_takeoverCustomerIdsCache[toEmail]) _takeoverCustomerIdsCache[toEmail] = [];
          _takeoverCustomerIdsCache[toEmail].push(toCustId);
        }
      }
    } catch (e) { Logger.log('getTakeoverCustomerIdsForSpecialist: ' + e.message); }
  }
  return _takeoverCustomerIdsCache[normalizedEmail] || [];
}

// Assigns one or more customers to a covering specialist for a fixed
// date range — supports the "10 of CS1's 20 customers to CS2, the other
// 10 to CS3" example directly, since customerIds is an array.
function assignCustomerTakeover(customerIds, takeoverSpecialistEmail, startDate, endDate, reason) {
  try {
    var perm = checkPermission('manageSettings');
    var currentUserForTakeover = getCurrentUser();
    var isCsManager = currentUserForTakeover && !currentUserForTakeover.error && currentUserForTakeover.role === CONFIG.ROLES.CS_MANAGER;
    if (!perm.allowed && !isCsManager) return { success: false, error: 'Only Administrators or CS Managers can assign a takeover.' };

    if (!Array.isArray(customerIds) || !customerIds.length) return { success: false, error: 'At least one customer is required.' };
    if (!takeoverSpecialistEmail) return { success: false, error: 'A covering specialist is required.' };
    var startStr = String(startDate||'').substring(0,10);
    var endStr = String(endDate||'').substring(0,10);
    if (!startStr || !endStr) return { success: false, error: 'Start and end dates are required.' };
    if (endStr < startStr) return { success: false, error: 'End date must be on or after the start date.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, CONFIG.SHEETS.CUSTOMER_TAKEOVERS, CONFIG.SCHEMA.CustomerTakeovers);
    _migrateSheetColumns(ss, CONFIG.SHEETS.CUSTOMER_TAKEOVERS, CONFIG.SCHEMA.CustomerTakeovers);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var now = new Date();
    var emailNorm = String(takeoverSpecialistEmail).toLowerCase().trim();

    var rowsToAppend = customerIds.filter(Boolean).map(function(custId) {
      var row = new Array(data[0].length).fill('');
      row[h['TakeoverID']] = generateID('TKO');
      row[h['CustomerID']] = custId;
      row[h['TakeoverSpecialistEmail']] = emailNorm;
      row[h['StartDate']] = startStr;
      row[h['EndDate']] = endStr;
      row[h['Reason']] = reason || '';
      row[h['CreatedAt']] = now;
      row[h['CreatedBy']] = perm.user ? perm.user.email : (currentUserForTakeover.email||'');
      return row;
    });
    if (rowsToAppend.length) {
      var startRow = sheet.getLastRow() + 1;
      // StartDate/EndDate must stay plain text — same reasoning as
      // ConnectionKPI's PeriodDate, since these are string-compared
      // against today's date on every access check.
      sheet.getRange(startRow, h['StartDate']+1, rowsToAppend.length, 1).setNumberFormat('@');
      sheet.getRange(startRow, h['EndDate']+1, rowsToAppend.length, 1).setNumberFormat('@');
      sheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }
    _takeoverCustomerIdsCache = null; // invalidate — next read should see this immediately
    return { success: true, count: rowsToAppend.length };
  } catch (e) {
    return { success: false, error: 'assignCustomerTakeover: ' + e.message };
  }
}

// Every takeover on file, for the CS Manager's management UI — including
// past/expired ones, so there's a record of who covered what and when.
function getCustomerTakeovers() {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMER_TAKEOVERS);
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    // Customer names, for display — takeovers only store the ID.
    var custNameById = {};
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSheet) {
      var cd = custSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
      for (var ci = 1; ci < cd.length; ci++) {
        var cid = String(cd[ci][ch['CustomerID']]||''); if (!cid) continue;
        custNameById[cid] = String(cd[ci][ch['CustomerName']]||'');
      }
    }

    var todayStr = _sd(new Date());
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var tId = String(data[i][h['TakeoverID']]||''); if (!tId) continue;
      var tCustId = String(data[i][h['CustomerID']]||'');
      var tStart = String(data[i][h['StartDate']]||'');
      var tEnd = String(data[i][h['EndDate']]||'');
      rows.push({
        takeoverId: tId,
        customerId: tCustId,
        customerName: custNameById[tCustId] || tCustId,
        takeoverSpecialistEmail: String(data[i][h['TakeoverSpecialistEmail']]||''),
        startDate: tStart,
        endDate: tEnd,
        reason: String(data[i][h['Reason']]||''),
        isActive: !!(tStart && tEnd && todayStr >= tStart && todayStr <= tEnd),
        isUpcoming: !!(tStart && todayStr < tStart),
        isExpired: !!(tEnd && todayStr > tEnd),
        createdAt: _sd(data[i][h['CreatedAt']]),
        createdBy: String(data[i][h['CreatedBy']]||'')
      });
    }
    rows.sort(function(a,b){ return new Date(b.createdAt) - new Date(a.createdAt); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getCustomerTakeovers: ' + e.message };
  }
}

// Ends a takeover early — deletes the row outright rather than adjusting
// EndDate, since this is an explicit cancellation, not a natural expiry.
function cancelCustomerTakeover(takeoverId) {
  try {
    var perm = checkPermission('manageSettings');
    var currentUserForCancel = getCurrentUser();
    var isCsManager = currentUserForCancel && !currentUserForCancel.error && currentUserForCancel.role === CONFIG.ROLES.CS_MANAGER;
    if (!perm.allowed && !isCsManager) return { success: false, error: 'Only Administrators or CS Managers can cancel a takeover.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMER_TAKEOVERS);
    if (!sheet) return { success: false, error: 'No takeovers on file.' };
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['TakeoverID']]) !== takeoverId) continue;
      sheet.deleteRow(i + 1);
      _takeoverCustomerIdsCache = null;
      return { success: true };
    }
    return { success: false, error: 'Takeover not found.' };
  } catch (e) {
    return { success: false, error: 'cancelCustomerTakeover: ' + e.message };
  }
}