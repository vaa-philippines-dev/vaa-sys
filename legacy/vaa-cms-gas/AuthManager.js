// ─────────────────────────────────────────
// AuthManager.gs — Session, roles, permissions
// ─────────────────────────────────────────

// ── VA Rate visibility/edit rights ──────────────────────────────────────
// VA Base Rate (VirtualAssistants sheet) and VA Connection Rate
// (VAConnections sheet) are compensation data. Per policy, only
// Administrator/HR Specialist/HR Manager may ever see or set either one —
// CS Specialists (and every other role) never receive the field from the
// server at all, so there's nothing to accidentally expose in the UI.
function _canSeeVARate(role) {
  return role === CONFIG.ROLES.ADMINISTRATOR || role === CONFIG.ROLES.CS_MANAGER || role === CONFIG.ROLES.HR_SPECIALIST || role === CONFIG.ROLES.HR_MANAGER || role === CONFIG.ROLES.ACCOUNTING;
}

function getCurrentUser() {
  try {
    var email = Session.getActiveUser().getEmail();
    if (!email) return { error: 'Could not retrieve user email. Ensure the app is run as yourself.' };

    var ss;
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); }
    catch(authErr) {
      return { error: 'Auth error: ' + authErr.message };
    }

    var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);

    // Fresh deployment — the Users sheet doesn't exist yet because
    // initializeSystem() hasn't been run. Auto-initialize the spreadsheet
    // now so the first user doesn't get a blank "Initializing…" screen.
    // After initialization, fetch the (now-created) Users sheet.
    if (!sheet) {
      try {
        initializeSystem();
      } catch (initErr) {
        return { error: 'First-time setup failed: ' + initErr.message + '. Please run initializeSystem() manually from the Apps Script editor.' };
      }
      sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
      if (!sheet) {
        return { error: 'Setup incomplete: Users sheet could not be created. Run initializeSystem() manually from the Apps Script editor.' };
      }
    }

    var data = sheet.getDataRange().getValues();

    var h = {};
    var headerRow = data[0];
    for (var hi = 0; hi < headerRow.length; hi++) {
      if (headerRow[hi]) h[String(headerRow[hi])] = hi;
    }

    // Empty sheet — provision this user
    if (data.length < 2 || !data[1][0]) {
      return _provisionUser(email, sheet);
    }

    var userRow    = null;
    var userRowNum = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['Email']] || '') === email) {
        userRow    = data[i];
        userRowNum = i + 1;
        break;
      }
    }

    if (!userRow) return _provisionUser(email, sheet);

    var isActive = userRow[h['IsActive']];
    if (isActive === false || isActive === 'false' || isActive === 0) {
      return { error: 'Account is inactive. Contact your Administrator.' };
    }

    // Update LastLogin — don't let this crash the whole auth
    try { sheet.getRange(userRowNum, h['LastLogin'] + 1).setValue(new Date()); } catch (e) {}

    var permissions = _getPermissions(String(userRow[h['Role']] || ''));

    return {
      id:          String(userRow[h['UserID']] || ''),
      email:       String(userRow[h['Email']]  || ''),
      name:        String(userRow[h['Name']]   || ''),
      role:        String(userRow[h['Role']]   || ''),
      department:  h['Department'] !== undefined ? String(userRow[h['Department']] || '') : '',
      permissions: permissions
    };
  } catch (authErr) {
    return { error: 'Auth error: ' + authErr.message };
  }
}

function _provisionUser(email, sheet) {
  try {
    var newId = generateID('USR');
    var now   = new Date();
    var name  = email.split('@')[0];
    var role  = CONFIG.ROLES.CS_SPECIALIST;
    sheet.appendRow([newId, email, name, role, true, now, now]);
    return {
      id:          newId,
      email:       email,
      name:        name,
      role:        role,
      permissions: _getPermissions(role)
    };
  } catch (e) {
    return { error: 'Could not provision user: ' + e.message };
  }
}

function _getPermissions(role) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.ROLES);
    // Roles sheet absent on a fresh deployment before initializeSystem() runs.
    // Return safe read-only defaults so the app still loads rather than crashing.
    if (!sheet) {
      return { canDelete:false, canEdit:false, requiresApproval:true, canManageSettings:false };
    }
    var data  = sheet.getDataRange().getValues();

    var h = {};
    var headerRow = data[0];
    for (var hi = 0; hi < headerRow.length; hi++) {
      if (headerRow[hi]) h[String(headerRow[hi])] = hi;
    }

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RoleName']] || '') === role) {
        return {
          canDelete:         data[i][h['CanDelete']]         === true,
          canEdit:           data[i][h['CanEdit']]           === true,
          requiresApproval:  data[i][h['RequiresApproval']]  === true,
          canManageSettings: data[i][h['CanManageSettings']] === true,
          canAssignVA:       data[i][h['CanAssignVA']]       === true,
          canViewReports:    data[i][h['CanViewReports']]    === true
        };
      }
    }
  } catch (e) {
    Logger.log('_getPermissions error: ' + e.message);
  }
  return _defaultPermissions();
}

function _defaultPermissions() {
  return {
    canDelete: false, canEdit: true, requiresApproval: false,
    canManageSettings: false, canAssignVA: false, canViewReports: true
  };
}

function checkPermission(action) {
  var user = getCurrentUser();
  if (!user || user.error) return { allowed: false, reason: user && user.error, user: null };
  switch (action) {
    case 'delete':         return { allowed: !!user.permissions.canDelete,         user: user };
    case 'edit':           return { allowed: !!user.permissions.canEdit,            user: user };
    case 'manageSettings': return { allowed: !!user.permissions.canManageSettings,  user: user };
    case 'assignVA':       return { allowed: !!user.permissions.canAssignVA,        user: user };
    case 'viewReports':    return { allowed: !!user.permissions.canViewReports,     user: user };
    default:               return { allowed: true, user: user };
  }
}