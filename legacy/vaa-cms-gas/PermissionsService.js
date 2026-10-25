// ═══════════════════════════════════════════════════════════════════════
// COMPREHENSIVE PERMISSIONS SYSTEM
// ═══════════════════════════════════════════════════════════════════════
// Single source of truth for module × role CRUD permissions, plus
// granular field-level overrides for specific sensitive fields (e.g.
// Rate). Seeded with defaults that closely match the app's existing,
// scattered role checks (checkPermission('edit') etc.) so turning this
// on doesn't suddenly lock anyone out of what they could already do.
//
// Honest scope note: this file gives every module a real, working,
// centralized permission check to migrate to (checkModulePermission /
// checkFieldVisibility), and the Customer module's delete action has
// been wired to it as a concrete, working example. Migrating every other
// module's existing permission checks to this system is real, separate
// follow-up work — this turn builds the system and proves the pattern,
// it doesn't retrofit the entire app in one pass.

function _permSheet(ss) { return _ensureSheet(ss, CONFIG.SHEETS.MODULE_PERMISSIONS, CONFIG.SCHEMA.ModulePermissions); }
function _fieldPermSheet(ss) { return _ensureSheet(ss, CONFIG.SHEETS.FIELD_PERMISSIONS, CONFIG.SCHEMA.FieldPermissions); }

function _permAllRoles() { return Object.keys(CONFIG.ROLES).map(function(k){ return CONFIG.ROLES[k]; }); }

// Sensible defaults matching the app's existing behavior as closely as
// possible — Administrator always full access; most operational roles
// get Create/Read/Update but not Delete; Executive/Executive Support get
// Read-heavy access; HR-specific modules restricted from CS-side roles
// and vice versa. This only ever fills in gaps — see _permEnsureSeeded.
function _permDefaultFor(module, role) {
  if (role === 'Administrator') return { c: true, r: true, u: true, d: true };
  var full = ['CS Manager', 'Service Manager', 'HR Manager', 'Manager'];
  var isFullRole = full.indexOf(role) !== -1;

  switch (module) {
    case 'Customers':
    case 'Accounts (Clients)':
    case 'Service Requests':
    case 'Concerns & Inquiries':
      if (['CS Specialist','CS Manager','Service Manager','Manager'].indexOf(role) !== -1) return { c: true, r: true, u: true, d: isFullRole };
      if (['Accounting','Executive','Executive Support'].indexOf(role) !== -1) return { c: false, r: true, u: false, d: false };
      return { c: false, r: false, u: false, d: false };
    case 'VA Database':
    case 'VA Connections':
      if (['CS Specialist','CS Manager','Service Manager','HR Specialist','HR Manager','Recruitment Specialist','Training Manager'].indexOf(role) !== -1) return { c: true, r: true, u: true, d: isFullRole };
      if (['Accounting','Executive','Executive Support'].indexOf(role) !== -1) return { c: false, r: true, u: false, d: false };
      return { c: false, r: false, u: false, d: false };
    case 'VA Rates & Compensation':
      if (['HR Specialist','HR Manager','Accounting'].indexOf(role) !== -1) return { c: true, r: true, u: true, d: role === 'HR Manager' };
      if (role === 'Administrator') return { c: true, r: true, u: true, d: true };
      return { c: false, r: false, u: false, d: false }; // CS-side roles: no visibility by default
    case 'Account Meetings':
      if (['CS Specialist','CS Manager','Service Manager','Manager'].indexOf(role) !== -1) return { c: true, r: true, u: true, d: isFullRole };
      return { c: false, r: true, u: false, d: false };
    case 'Playbook':
      if (['CS Specialist','CS Manager','Manager'].indexOf(role) !== -1) return { c: true, r: true, u: true, d: isFullRole };
      return { c: false, r: true, u: false, d: false };
    case 'Reports':
      if (['CS Manager','Service Manager','HR Manager','Manager','Executive','Executive Support','Administrator'].indexOf(role) !== -1) return { c: false, r: true, u: false, d: false };
      return { c: false, r: false, u: false, d: false };
    case 'Settings':
      return { c: false, r: false, u: false, d: false }; // Administrator-only, granted above
    case 'Billing & Payments':
      // §8 of the plan: Accounting role gets full CRUD access, per the
      // request. Read-only for management, no access for everyone else
      // by default — CS-side roles specifically should not see billing
      // detail unless an Administrator explicitly grants it via the
      // Permissions page.
      if (role === 'Accounting') return { c: true, r: true, u: true, d: true };
      if (['Executive','Executive Support','CS Manager'].indexOf(role) !== -1) return { c: false, r: true, u: false, d: false };
      return { c: false, r: false, u: false, d: false };
    case 'CS Specialists':
      // Team/staff management — same shape as most other operational
      // modules: full access for management roles, read-only for CS
      // Specialist themselves (seeing their own team), none for the rest.
      if (isFullRole) return { c: true, r: true, u: true, d: true };
      if (role === 'CS Specialist') return { c: false, r: true, u: false, d: false };
      return { c: false, r: false, u: false, d: false };
    case 'Follow-Ups':
      // Day-to-day CS operational work — CS Specialist and CS Manager
      // both get full access per the request; everyone else defaults to
      // none unless explicitly granted. CS Manager is already covered by
      // isFullRole below; CS Specialist needs its own explicit case.
      if (isFullRole || role === 'CS Specialist') return { c: true, r: true, u: true, d: true };
      return { c: false, r: false, u: false, d: false };
    case 'Users':
      // Account/role management is far more sensitive than any other
      // module here — granting access to it can grant access to
      // everything else. Restricted to Administrator only by default;
      // anyone else needs it explicitly granted, not assumed.
      return { c: false, r: false, u: false, d: false };
    default:
      return { c: false, r: false, u: false, d: false };
  }
}

// Fills in any (module, role) pairs missing from the sheet with computed
// defaults — called lazily so a brand-new module added to
// CONFIG.PERMISSION_MODULES automatically gets sensible rows the first
// time the matrix is read, rather than needing a manual seed step.
function _permEnsureSeeded(ss) {
  var sheet = _permSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _hMapGeneric(data[0]);
  var existing = {};
  for (var i = 1; i < data.length; i++) {
    existing[String(data[i][h['Module']]||'') + '|' + String(data[i][h['Role']]||'')] = true;
  }
  var now = new Date();
  var newRows = [];
  CONFIG.PERMISSION_MODULES.forEach(function(module) {
    _permAllRoles().forEach(function(role) {
      var key = module + '|' + role;
      if (existing[key]) return;
      var def = _permDefaultFor(module, role);
      newRows.push([module, role, def.c, def.r, def.u, def.d, now, 'system-default']);
    });
  });
  // One batched write instead of one appendRow per missing combination —
  // each appendRow is its own API call, and with 14 modules × 12 roles
  // that's up to 168 individual round-trips on a single call if nothing
  // has been seeded yet, which is exactly the kind of thing that times out.
  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
}

// Returns the full matrix: { modules: [...], roles: [...], grid: { module: { role: {c,r,u,d} } } }
function getPermissionsMatrix() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can view or manage permissions.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    _permEnsureSeeded(ss);
    var sheet = _permSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);

    var grid = {};
    CONFIG.PERMISSION_MODULES.forEach(function(m){ grid[m] = {}; });
    for (var i = 1; i < data.length; i++) {
      var module = String(data[i][h['Module']]||'');
      var role = String(data[i][h['Role']]||'');
      if (!grid[module]) continue; // module no longer in the registry — ignore stale rows
      grid[module][role] = {
        c: data[i][h['CanCreate']] === true,
        r: data[i][h['CanRead']] === true,
        u: data[i][h['CanUpdate']] === true,
        d: data[i][h['CanDelete']] === true
      };
    }
    return { success: true, modules: CONFIG.PERMISSION_MODULES, roles: _permAllRoles(), grid: grid };
  } catch (e) {
    return { success: false, error: 'getPermissionsMatrix: ' + e.message };
  }
}

// action is one of 'c','r','u','d'. Toggles a single cell.
function updateModulePermission(module, role, action, value) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage permissions.' };
    if (role === 'Administrator') return { success: false, error: 'Administrator always has full access and can\'t be restricted.' };

    var colByAction = { c: 'CanCreate', r: 'CanRead', u: 'CanUpdate', d: 'CanDelete' };
    var col = colByAction[action];
    if (!col) return { success: false, error: 'Invalid action.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    _permEnsureSeeded(ss);
    var sheet = _permSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Module']]) !== module || String(data[i][h['Role']]) !== role) continue;
      sheet.getRange(i+1, h[col]+1).setValue(!!value);
      sheet.getRange(i+1, h['UpdatedAt']+1).setValue(new Date());
      sheet.getRange(i+1, h['UpdatedBy']+1).setValue(perm.user.email);
      _writeLog('Permissions', module + ':' + role, 'PERMISSION_CHANGED', col, String(!value), String(!!value), perm.user);
      return { success: true };
    }
    return { success: false, error: 'Module/role pair not found.' };
  } catch (e) {
    return { success: false, error: 'updateModulePermission: ' + e.message };
  }
}

// ── Field-level permissions ─────────────────────────────────────────

function getFieldPermissionsMatrix() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can view or manage permissions.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _fieldPermSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);

    var grid = {}; // grid[module][field][role] = 'None'|'Read'|'Edit'
    Object.keys(CONFIG.PERMISSION_FIELDS).forEach(function(module) {
      grid[module] = {};
      CONFIG.PERMISSION_FIELDS[module].forEach(function(field) { grid[module][field] = {}; });
    });
    for (var i = 1; i < data.length; i++) {
      var module = String(data[i][h['Module']]||'');
      var field = String(data[i][h['Field']]||'');
      var role = String(data[i][h['Role']]||'');
      if (!grid[module] || !grid[module][field]) continue;
      grid[module][field][role] = String(data[i][h['Visibility']]||'');
    }
    return { success: true, fields: CONFIG.PERMISSION_FIELDS, roles: _permAllRoles(), grid: grid };
  } catch (e) {
    return { success: false, error: 'getFieldPermissionsMatrix: ' + e.message };
  }
}

function updateFieldPermission(module, field, role, visibility) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can manage permissions.' };
    if (['None','Read','Edit'].indexOf(visibility) === -1) return { success: false, error: 'Invalid visibility level.' };
    if (role === 'Administrator' && visibility !== 'Edit') return { success: false, error: 'Administrator always has full field visibility and can\'t be restricted.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _fieldPermSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var now = new Date();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Module']]) !== module || String(data[i][h['Field']]) !== field || String(data[i][h['Role']]) !== role) continue;
      var oldVal = String(data[i][h['Visibility']]||'');
      sheet.getRange(i+1, h['Visibility']+1).setValue(visibility);
      sheet.getRange(i+1, h['UpdatedAt']+1).setValue(now);
      sheet.getRange(i+1, h['UpdatedBy']+1).setValue(perm.user.email);
      _writeLog('Permissions', module + ':' + field + ':' + role, 'FIELD_PERMISSION_CHANGED', 'Visibility', oldVal, visibility, perm.user);
      return { success: true };
    }
    var row = data[0].map(function(){ return ''; });
    var cm = { 'Module': module, 'Field': field, 'Role': role, 'Visibility': visibility, 'UpdatedAt': now, 'UpdatedBy': perm.user.email };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    _writeLog('Permissions', module + ':' + field + ':' + role, 'FIELD_PERMISSION_CHANGED', 'Visibility', '(default)', visibility, perm.user);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'updateFieldPermission: ' + e.message };
  }
}

// ── Centralized checks — the pattern other modules migrate to ──────────

// The real, working, centralized replacement for scattered
// checkPermission('edit')-style checks — module-aware, not just
// role-aware. Falls back to a safe "deny" if the current user's role
// isn't in the matrix at all, rather than silently allowing.
function checkModulePermission(module, action) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { allowed: false, user: null, reason: user && user.error };
    if (user.role === 'Administrator') return { allowed: true, user: user };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    _permEnsureSeeded(ss);
    var sheet = _permSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var colByAction = { c: 'CanCreate', r: 'CanRead', u: 'CanUpdate', d: 'CanDelete' };
    var col = colByAction[action];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Module']]) !== module || String(data[i][h['Role']]) !== user.role) continue;
      return { allowed: data[i][h[col]] === true, user: user };
    }
    return { allowed: false, user: user, reason: 'No permission entry for this role/module.' };
  } catch (e) {
    return { allowed: false, user: null, reason: 'checkModulePermission: ' + e.message };
  }
}

// Returns 'None' | 'Read' | 'Edit' for a specific field — falls back to
// the module-level Update permission if no field-specific override
// exists (i.e. a field with no row here just behaves like any other
// field in that module).
function checkFieldVisibility(module, field) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return 'None';
    if (user.role === 'Administrator') return 'Edit';

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _fieldPermSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Module']]) !== module || String(data[i][h['Field']]) !== field || String(data[i][h['Role']]) !== user.role) continue;
      return String(data[i][h['Visibility']]||'') || 'Read';
    }
    // No override for this field/role — fall back to the module's own
    // Update permission (edit if they can update the module, read
    // otherwise, assuming they can at least read the module).
    var modPerm = checkModulePermission(module, 'u');
    if (modPerm.allowed) return 'Edit';
    var readPerm = checkModulePermission(module, 'r');
    return readPerm.allowed ? 'Read' : 'None';
  } catch (e) {
    return 'None';
  }
}

// Confirmation-required delete wrapper — logs the attempt regardless of
// outcome, and requires the caller to have already gotten an explicit
// confirmation from the person (confirmText must match exactly). This is
// the pattern any module's delete action should route through once
// migrated to this system.
function confirmedModuleDelete(module, entityId, entityLabel, confirmText) {
  try {
    var permCheck = checkModulePermission(module, 'd');
    if (!permCheck.allowed) return { success: false, error: 'You don\'t have permission to delete in ' + module + '.' };
    if (confirmText !== entityLabel && confirmText !== 'DELETE') {
      return { success: false, error: 'Confirmation text didn\'t match — nothing was deleted.' };
    }
    _writeLog('Permissions', module + ':' + entityId, 'CONFIRMED_DELETE', '', entityLabel, '', permCheck.user);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'confirmedModuleDelete: ' + e.message };
  }
}