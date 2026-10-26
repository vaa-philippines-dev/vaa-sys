// ─────────────────────────────────────────
// VAConnectionService.gs — VA assignment & notes
// ─────────────────────────────────────────

function _connGetSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.VA_CONNECTIONS);
    var headers = CONFIG.SCHEMA.VAConnections;
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // Self-heals any column added to the schema after this sheet already
    // existed live — e.g. TerminationDate silently never being written
    // because the live sheet predated that column being added. Every
    // caller of this function benefits automatically, rather than each
    // one needing its own explicit migration call.
    _migrateSheetColumns(ss, CONFIG.SHEETS.VA_CONNECTIONS, CONFIG.SCHEMA.VAConnections);
  }
  return sheet;
}

function _notesGetSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTION_NOTES);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.VA_CONNECTION_NOTES);
    var headers = CONFIG.SCHEMA.VAConnectionNotes;
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _connHMap(headerRow) {
  var h = {};
  for (var i = 0; i < headerRow.length; i++) {
    if (headerRow[i]) h[String(headerRow[i]).trim()] = i;
  }
  return h;
}

// Whether any Started (Active) VA connection exists for a given account
// (clientId) or, if customerId is given instead, across every account
// belonging to that customer. Used to block terminating a customer/
// account while it still has active connections, per the request —
// Started specifically, not Paused, since a Paused connection is a
// distinct state the request treats separately ("the last active VA has
// been paused OR terminated").
function _hasActiveVAConnections(clientId, customerId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var connSheet = _connGetSheet(ss);
  var connData = connSheet.getDataRange().getValues();
  var ch = _connHMap(connData[0]);

  var clientIdsToCheck = null;
  if (!clientId && customerId) {
    // Every account (Client) belonging to this customer.
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    clientIdsToCheck = {};
    if (cliSheet) {
      var cliData = cliSheet.getDataRange().getValues();
      var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
      for (var ci = 1; ci < cliData.length; ci++) {
        if (String(cliData[ci][clh['CustomerID']]||'') === customerId) {
          clientIdsToCheck[String(cliData[ci][clh['ClientID']]||'')] = true;
        }
      }
    }
  }

  for (var i = 1; i < connData.length; i++) {
    if (String(connData[i][ch['ConnectionStatus']]||'') !== CONFIG.VA_CONNECTION_STATUS.STARTED) continue;
    var rowClientId = String(connData[i][ch['ClientID']]||'');
    if (clientId) { if (rowClientId === clientId) return true; }
    else if (clientIdsToCheck && clientIdsToCheck[rowClientId]) return true;
  }
  return false;
}

function getVAConnections(filters) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };

    var h = _connHMap(data[0]);
    if (h['ConnectionID'] === undefined) return { success: true, data: [] };

    var currentUser = getCurrentUser();
    var includeRate = currentUser && !currentUser.error && _canSeeVARate(currentUser.role);

    // Service Manager only ever sees VA Connections for their own
    // department. Connections don't store Department directly — it comes
    // from the associated request — so this builds a lookup only when
    // actually needed, rather than joining for every caller regardless of role.
    var serviceManagerDept = null;
    var deptByRequestForScope = {};
    if (currentUser && !currentUser.error && currentUser.role === CONFIG.ROLES.SERVICE_MANAGER) {
      serviceManagerDept = (currentUser.department || '').toLowerCase().trim();
      try {
        var reqSheetForScope = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
        if (reqSheetForScope) {
          var reqDataForScope = reqSheetForScope.getDataRange().getValues();
          var rhForScope = {}; reqDataForScope[0].forEach(function(c,i){ if(c) rhForScope[String(c)]=i; });
          for (var rsi = 1; rsi < reqDataForScope.length; rsi++) {
            var rsiId = String(reqDataForScope[rsi][rhForScope['RequestID']]||''); if (!rsiId) continue;
            deptByRequestForScope[rsiId] = String(reqDataForScope[rsi][rhForScope['Department']]||'').toLowerCase().trim();
          }
        }
      } catch (scopeEx) { Logger.log('getVAConnections dept scope: ' + scopeEx.message); }
    }

    filters = filters || {};
    var rows = [];

    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['ConnectionID']]) continue;
      // Filter on raw row values before the (non-trivial) _mapConnRow
      // transformation, per the fix above — avoids mapping rows that
      // would just be discarded a moment later anyway.
      if (filters.requestId && String(r[h['RequestID']]||'') !== filters.requestId) continue;
      if (filters.vaId && String(r[h['VAID']]||'') !== filters.vaId) continue;
      var rec = _mapConnRow(r, h, includeRate);
      if (serviceManagerDept && deptByRequestForScope[rec.requestId] !== serviceManagerDept) continue;
      rows.push(rec);
    }
    rows.sort(function (a, b) {
      return new Date(a.assignedAt || 0) - new Date(b.assignedAt || 0);
    });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getVAConnections: ' + e.message };
  }
}

// ── Assign/update the pay Rate on a VA Connection — HR-only ────────────
// Deliberately NOT gated by the generic checkPermission('edit') (which is
// role-configurable via the Roles sheet) — this is a hardcoded policy rule:
// only Administrator/HR Specialist/HR Manager may ever set this field,
// regardless of how the Roles sheet is configured. The actual rate value is
// intentionally kept OUT of the shared ActivityLogs entry below — Activity
// Logs' visibility is controlled by the configurable Permissions settings,
// which could include roles (like CS Specialist) that must never see a
// rate — so leaking the number into that log would defeat the purpose.
// Extracts a Drive file/folder ID from any of the common URL shapes Google
// produces (a Sheets edit URL, a shared file link, a folder link, or a bare
// ID typed in directly).
function _extractDriveId(urlOrId) {
  if (!urlOrId) return '';
  var s = String(urlOrId).trim();
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{15,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{15,})/) || s.match(/\/folders\/([a-zA-Z0-9_-]{15,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(s)) return s; // already looks like a bare ID
  return '';
}

// Fills in {CustomerName}/{VAName}/{Type} (and a couple of other useful
// tokens) in the configured filename pattern.
function _fillWRFilenamePattern(pattern, tokens) {
  return (pattern || 'WR - {CustomerName} - {VAName} - {Type}').replace(/\{(\w+)\}/g, function(match, key) {
    return tokens[key] !== undefined ? tokens[key] : match;
  });
}

// Copies the department's configured WR template (Regular or Project-Based,
// based on hoursType) into the configured Drive folder, names it per the
// configured filename pattern, saves the new file's link onto the
// connection, and returns it.
function generateWRFromTemplate(connectionId, hoursType) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var h = _connHMap(connData[0]);

    var connRowNum = -1, vaName = '', clientId = '', customerId = '', requestId = '';
    for (var i = 1; i < connData.length; i++) {
      if (String(connData[i][h['ConnectionID']]) !== connectionId) continue;
      connRowNum = i + 1;
      vaName     = String(connData[i][h['VAName']]||'');
      clientId   = String(connData[i][h['ClientID']]||'');
      customerId = String(connData[i][h['CustomerID']]||'');
      requestId  = String(connData[i][h['RequestID']]||'');
      break;
    }
    if (connRowNum === -1) return { success: false, error: 'VA Connection not found.' };

    // Department comes from the originating Service Request — not stored
    // on the connection itself.
    var department = '';
    if (requestId) {
      var reqSheet = _reqGetSheet(ss);
      var reqData = reqSheet.getDataRange().getValues();
      var rh = {}; reqData[0].forEach(function(c,idx){ if(c) rh[String(c)]=idx; });
      for (var j = 1; j < reqData.length; j++) {
        if (String(reqData[j][rh['RequestID']]||'') !== requestId) continue;
        department = String(reqData[j][rh['Department']]||'');
        break;
      }
    }
    if (!department) return { success: false, error: 'This connection has no Department on file — cannot determine which WR template to use.' };

    var wrSettingsRes = getWRTemplateSettings();
    if (!wrSettingsRes.success) return wrSettingsRes;
    var deptSetting = wrSettingsRes.byDepartment[department];
    if (!deptSetting) return { success: false, error: 'No WR Template configured for "' + department + '" — set one up in Settings first.' };

    var isProject = String(hoursType||'').trim().toLowerCase() === 'project based';
    var templateLink = isProject ? deptSetting.projectTemplateLink : deptSetting.regularTemplateLink;
    if (!templateLink) return { success: false, error: 'No ' + (isProject?'Project-Based':'Regular') + ' WR template configured for "' + department + '".' };
    if (!deptSetting.folderLink) return { success: false, error: 'No destination Drive folder configured for "' + department + '".' };

    var templateId = _extractDriveId(templateLink);
    var folderId   = _extractDriveId(deptSetting.folderLink);
    if (!templateId) return { success: false, error: 'Could not read a file ID from the configured template link.' };
    if (!folderId)   return { success: false, error: 'Could not read a folder ID from the configured folder link.' };

    // Customer/account names for the filename
    var customerName = '', accountName = '';
    try {
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet && customerId) {
        var custData = custSheet.getDataRange().getValues();
        var ch = {}; custData[0].forEach(function(c,idx){ if(c) ch[String(c)]=idx; });
        for (var k = 1; k < custData.length; k++) {
          if (String(custData[k][ch['CustomerID']]||'') !== customerId) continue;
          customerName = String(custData[k][ch['CustomerName']]||'');
          break;
        }
      }
      var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet && clientId) {
        var cliData = cliSheet.getDataRange().getValues();
        var clh = {}; cliData[0].forEach(function(c,idx){ if(c) clh[String(c)]=idx; });
        for (var m = 1; m < cliData.length; m++) {
          if (String(cliData[m][clh['ClientID']]||'') !== clientId) continue;
          accountName = String(cliData[m][clh['AccountName']]||cliData[m][clh['CompanyName']]||'');
          break;
        }
      }
    } catch (nameEx) { Logger.log('generateWRFromTemplate name lookup: ' + nameEx.message); }

    var fileName = _fillWRFilenamePattern(wrSettingsRes.filenamePattern, {
      CustomerName: customerName || customerId, VAName: vaName || '', AccountName: accountName || '',
      Type: isProject ? 'Project-based' : 'Regular', Department: department
    });

    var templateFile = DriveApp.getFileById(templateId);
    var targetFolder = DriveApp.getFolderById(folderId);
    var newFile = templateFile.makeCopy(fileName, targetFolder);
    var newUrl = newFile.getUrl();

    connSheet.getRange(connRowNum, h['WRLink']+1).setValue(newUrl);
    connSheet.getRange(connRowNum, h['UpdatedAt']+1).setValue(new Date());
    connSheet.getRange(connRowNum, h['UpdatedBy']+1).setValue(perm.user.email);
    _writeLog('VAConnection', connectionId, 'CREATE', 'WRLink', '', newUrl, perm.user);

    return { success: true, url: newUrl, fileName: fileName };
  } catch (e) {
    return { success: false, error: 'generateWRFromTemplate: ' + e.message };
  }
}

function exportVAConnectionsToExcel(headerRows, dataRows) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    // CSV field escaping per standard rules — wrap in quotes if the value
    // contains a comma, quote, or newline; double any embedded quotes.
    function csvField(v) {
      var s = (v === null || v === undefined) ? '' : String(v);
      if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    function csvRow(row) { return row.map(csvField).join(','); }

    var lines = [];
    (headerRows || []).forEach(function(row) { lines.push(csvRow(row)); });
    (dataRows || []).forEach(function(row) { lines.push(csvRow(row)); });
    var csvContent = lines.join('\r\n');

    var fileName = 'VA Connections Export ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'UTC', 'yyyy-MM-dd HHmm') + '.csv';
    var base64 = Utilities.base64Encode(csvContent, Utilities.Charset.UTF_8);

    return { success: true, base64: base64, fileName: fileName };
  } catch (e) {
    return { success: false, error: 'exportVAConnectionsToExcel: ' + e.message };
  }
}

function updateVAConnectionWRLink(connectionId, wrLink) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);
    if (h['WRLink'] === undefined) return { success: false, error: 'WRLink column not found — run initializeSystem() to add it.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rowNum = i + 1;
      var oldLink = String(data[i][h['WRLink']]||'');
      sheet.getRange(rowNum, h['WRLink']    + 1).setValue(wrLink || '');
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);
      _writeLog('VAConnection', connectionId, 'UPDATE', 'WRLink', oldLink, wrLink||'', perm.user);
      return { success: true };
    }
    return { success: false, error: 'VA Connection not found.' };
  } catch (e) {
    return { success: false, error: 'updateVAConnectionWRLink: ' + e.message };
  }
}

// Administrator-only — direct link to the underlying Google Sheet's
// VAConnections tab, where the raw rate/RA data actually lives, for bulk
// editing/auditing outside the app's own forms.
function getVAConnectionsSheetLink() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) return { success: false, error: 'Only Administrators can open the underlying sheet.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var url = ss.getUrl() + '#gid=' + sheet.getSheetId();
    return { success: true, url: url };
  } catch (e) {
    return { success: false, error: 'getVAConnectionsSheetLink: ' + e.message };
  }
}

function assignVAConnectionRate(connectionId, rateOrPayload) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (!_canSeeVARate(user.role)) return { success: false, error: 'Only Administrators, CS Managers, HR Specialists, and HR Managers can set a VA Connection rate.' };

    // Backward-compatible — accepts either a plain rate number (older
    // callers) or a full payload object with the RA detail fields.
    var payload = (rateOrPayload && typeof rateOrPayload === 'object') ? rateOrPayload : { rate: rateOrPayload };
    var rateNum = parseFloat(payload.rate);
    if (isNaN(rateNum) || rateNum < 0) return { success: false, error: 'Enter a valid, non-negative rate.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);
    if (h['Rate'] === undefined) return { success: false, error: 'Rate column not found — run initializeSystem() to add it.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rowNum = i + 1;
      var now = new Date();
      sheet.getRange(rowNum, h['Rate']      + 1).setValue(rateNum);
      sheet.getRange(rowNum, h['RateSetBy'] + 1).setValue(user.email);
      sheet.getRange(rowNum, h['RateSetAt'] + 1).setValue(now);

      // RA detail fields — all optional, only written if the caller
      // actually provided them (payload came from the fuller RA form,
      // not just a bare rate number).
      if (payload.nightDiffApplicable !== undefined && h['NightDiffApplicable'] !== undefined) {
        sheet.getRange(rowNum, h['NightDiffApplicable']+1).setValue(!!payload.nightDiffApplicable);
      }
      if (payload.nightDiffPercent !== undefined && h['NightDiffPercent'] !== undefined) {
        // Defaults to 10% when applicable and left blank — the typical rate.
        var ndPercent = (payload.nightDiffPercent === '' || payload.nightDiffPercent === null) ? 10 : parseFloat(payload.nightDiffPercent);
        sheet.getRange(rowNum, h['NightDiffPercent']+1).setValue(isNaN(ndPercent) ? 10 : ndPercent);
      }
      if (payload.trainingBondApplicable !== undefined && h['TrainingBondApplicable'] !== undefined) {
        sheet.getRange(rowNum, h['TrainingBondApplicable']+1).setValue(!!payload.trainingBondApplicable);
      }
      if (payload.trainingBondAmount !== undefined && h['TrainingBondAmount'] !== undefined) {
        sheet.getRange(rowNum, h['TrainingBondAmount']+1).setValue(parseFloat(payload.trainingBondAmount)||0);
      }
      if (payload.trainingBondMonths !== undefined && h['TrainingBondMonths'] !== undefined) {
        sheet.getRange(rowNum, h['TrainingBondMonths']+1).setValue(parseFloat(payload.trainingBondMonths)||0);
      }
      if (payload.incrementalWageApplicable !== undefined && h['IncrementalWageApplicable'] !== undefined) {
        sheet.getRange(rowNum, h['IncrementalWageApplicable']+1).setValue(!!payload.incrementalWageApplicable);
      }
      if (payload.raSentDate !== undefined && h['RASentDate'] !== undefined) {
        sheet.getRange(rowNum, h['RASentDate']+1).setValue(payload.raSentDate ? _parseDateInput(payload.raSentDate) : '');
      }
      // Any edit to the rate or its terms invalidates a prior Accounting
      // confirmation — it needs to be re-confirmed against the new terms.
      if (h['RAConfirmedBy'] !== undefined) sheet.getRange(rowNum, h['RAConfirmedBy']+1).setValue('');
      if (h['RAConfirmedAt'] !== undefined) sheet.getRange(rowNum, h['RAConfirmedAt']+1).setValue('');

      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(user.email);
      // Capture this in the compensation history timeline too — this
      // function's own responsibility is VAConnections.Rate, but the
      // history sheet needs to reflect every rate change regardless of
      // which UI path made it, not just the newer Add Period form.
      try {
        _syncCompHistoryOnRateChange(connectionId, rateNum, payload.nightDiffApplicable, payload.nightDiffPercent, user.email);
      } catch (histSyncEx) { Logger.log('assignVAConnectionRate history sync: ' + histSyncEx.message); }
      _writeLog('VAConnection', connectionId, 'UPDATE', 'Rate', '(hidden)', '(hidden — HR-only field)', user);
      return { success: true };
    }
    return { success: false, error: 'VA Connection not found.' };
  } catch (e) {
    return { success: false, error: 'assignVAConnectionRate: ' + e.message };
  }
}

// Accounting's sign-off that the rate + RA terms are correct before final.
// Deliberately a separate, narrow function (not folded into
// assignVAConnectionRate) — Accounting confirms, they don't set the rate.
function confirmRAByAccounting(connectionId) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ACCOUNTING && user.role !== CONFIG.ROLES.ADMINISTRATOR) {
      return { success: false, error: 'Only Accounting (or Administrator) can confirm the RA.' };
    }
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);
    if (h['RAConfirmedBy'] === undefined) return { success: false, error: 'RA confirmation column not found — run initializeSystem() to add it.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rowNum = i + 1;
      if (!(parseFloat(data[i][h['Rate']]) > 0)) return { success: false, error: 'No rate has been set on this connection yet.' };
      sheet.getRange(rowNum, h['RAConfirmedBy']+1).setValue(user.email);
      sheet.getRange(rowNum, h['RAConfirmedAt']+1).setValue(new Date());
      _writeLog('VAConnection', connectionId, 'UPDATE', 'RAConfirmedBy', '', user.email, user);
      return { success: true };
    }
    return { success: false, error: 'VA Connection not found.' };
  } catch (e) {
    return { success: false, error: 'confirmRAByAccounting: ' + e.message };
  }
}

// Shared by assignVA and updateVAConnectionStatus — CS Specialists are
// explicitly allowed to assign VAs AND accept/decline them, regardless of
// the configurable canAssignVA Roles-sheet setting.
// Lets a CS Specialist (or Administrator) directly correct a connection's
// ActualStartDate/TerminationDate — e.g. fixing a typo or a date that was
// never entered correctly in the first place. Deliberately NOT written to
// Activity Logs: this is a data-correction tool, not a real lifecycle
// event (the actual start/termination actions already log themselves
// elsewhere, at the time they happen).
function updateVAConnectionDates(connectionId, payload) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: 'Not signed in.' };
    if (user.role !== CONFIG.ROLES.CS_SPECIALIST && user.role !== CONFIG.ROLES.ADMINISTRATOR) {
      return { success: false, error: 'Only CS Specialists can edit connection dates directly.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _connHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rowNum = i + 1;
      // Per the request — checked BEFORE anything is written. A blank end date used to be turned
      // into "now" (by _safeParseDateNoon), which could stamp a termination date onto a connection
      // that never ended. Now: blank on a Terminated/Cancelled connection is refused (it must keep
      // its Termination Date); blank on any other connection just means "no end date"; anything
      // entered must be a real date.
      var newEnd = undefined; // undefined = leave the cell alone
      if (payload.dateEnded !== undefined && h['TerminationDate'] !== undefined) {
        var rawEnd = String(payload.dateEnded || '').trim();
        var curStatus = String(data[i][h['ConnectionStatus']] || '');
        var isTerminal = (curStatus === CONFIG.VA_CONNECTION_STATUS.TERMINATED || curStatus === CONFIG.VA_CONNECTION_STATUS.CANCELLED);
        if (!rawEnd) {
          if (isTerminal) return { success: false, error: 'A ' + curStatus.toLowerCase() + ' connection must have a Termination Date — it can\'t be cleared.' };
          newEnd = '';
        } else {
          var pe = _safeParseDateNoon(rawEnd);
          if (isNaN(pe.getTime())) return { success: false, error: 'The Termination Date isn\'t a valid date.' };
          newEnd = pe;
        }
      }
      if (payload.dateStarted !== undefined && h['ActualStartDate'] !== undefined) {
        var ps = _safeParseDateNoon(payload.dateStarted);
        sheet.getRange(rowNum, h['ActualStartDate']+1).setValue(isNaN(ps.getTime()) ? '' : ps);
      }
      if (newEnd !== undefined) sheet.getRange(rowNum, h['TerminationDate']+1).setValue(newEnd);
      return { success: true };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'updateVAConnectionDates: ' + e.message };
  }
}

function _checkAssignVAPermission() {
  var perm = checkPermission('assignVA');
  if (!perm.allowed) {
    var user = getCurrentUser();
    if (user && !user.error && (user.role === CONFIG.ROLES.CS_SPECIALIST || user.role === CONFIG.ROLES.SERVICE_MANAGER)) {
      perm = { allowed: true, user: user };
    }
  }
  return perm;
}

// Swaps out the VA on an existing connection — for CS Specialist/CS
// Manager/Service Manager/Administrator to correct a mis-assignment or
// change plans before the VA has actually started, without going through
// the full termination/replacement request flow. Only allowed while the
// connection is Pending or Accepted; once Started, use the proper
// termination/replacement flow instead — swapping the VA in place at that
// point would corrupt the connection's own history.
function changeAssignedVA(connectionId, newVAId, reason) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: 'Not signed in.' };
    var allowedRoles = [CONFIG.ROLES.CS_SPECIALIST, CONFIG.ROLES.CS_MANAGER, CONFIG.ROLES.SERVICE_MANAGER, CONFIG.ROLES.ADMINISTRATOR];
    if (allowedRoles.indexOf(user.role) === -1) {
      return { success: false, error: 'Only CS Specialists, CS Managers, Service Managers, or Administrators can change the assigned VA.' };
    }
    if (!connectionId || !newVAId) return { success: false, error: 'Connection and new VA are both required.' };

    var vaRes = getVAById(newVAId);
    if (!vaRes.success) return { success: false, error: 'VA not found.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rowNum = i + 1;
      var currentStatus = String(data[i][h['ConnectionStatus']]||'');
      if (currentStatus !== CONFIG.VA_CONNECTION_STATUS.PENDING && currentStatus !== CONFIG.VA_CONNECTION_STATUS.ACCEPTED) {
        return { success: false, error: 'Can only change the VA while the connection is Pending or Accepted — this one is ' + currentStatus + '. Use a Termination/Replacement request instead.' };
      }
      var oldVAName = String(data[i][h['VAName']]||'');
      if (String(data[i][h['VAID']]) === String(newVAId)) {
        return { success: false, error: 'That is already the assigned VA.' };
      }

      sheet.getRange(rowNum, h['VAID']+1).setValue(newVAId);
      sheet.getRange(rowNum, h['VAName']+1).setValue(vaRes.data.vaName);
      // Reset to Pending — the new VA still needs to accept, regardless
      // of whatever the previous VA's status was.
      sheet.getRange(rowNum, h['ConnectionStatus']+1).setValue(CONFIG.VA_CONNECTION_STATUS.PENDING);

      // Real bug fixed here: VA Prep / Rate Agreement / Kick-Off Call
      // are this SPECIFIC VA's own completed steps — they were never
      // reset when the VA underneath them changed, so a swapped-in VA
      // silently inherited the outgoing VA's "done" checkmarks despite
      // never having gone through Prep, Rate Agreement, or a Kick-Off
      // Call themselves. Worse, once the outgoing VA had reached
      // Accepted, the request's own CurrentStage had already advanced to
      // Start VA — and stage recalculation never moves backward past
      // VA-Client Connection Call (by design, elsewhere), so the
      // request was left permanently stuck at Start VA with a
      // connection sitting back at Pending and no Accept/Decline button
      // ever able to appear for it (that button only shows at Kick Off
      // Call / VA-Client Connection Call stage). Clearing these here,
      // and force-recalculating below, is what actually unsticks it.
      if (h['VAPrepDone']          !== undefined) sheet.getRange(rowNum, h['VAPrepDone']+1).setValue(false);
      if (h['VAPrepStartDate']     !== undefined) sheet.getRange(rowNum, h['VAPrepStartDate']+1).setValue('');
      if (h['VAPrepEndDate']       !== undefined) sheet.getRange(rowNum, h['VAPrepEndDate']+1).setValue('');
      if (h['RateAgreementDone']   !== undefined) sheet.getRange(rowNum, h['RateAgreementDone']+1).setValue(false);
      if (h['RateAgreementDoneAt'] !== undefined) sheet.getRange(rowNum, h['RateAgreementDoneAt']+1).setValue('');
      if (h['RateAgreementDoneBy'] !== undefined) sheet.getRange(rowNum, h['RateAgreementDoneBy']+1).setValue('');
      if (h['RateAgreementNotes']  !== undefined) sheet.getRange(rowNum, h['RateAgreementNotes']+1).setValue('');
      if (h['KickOffCallDone']     !== undefined) sheet.getRange(rowNum, h['KickOffCallDone']+1).setValue(false);
      if (h['KickOffCallDoneAt']   !== undefined) sheet.getRange(rowNum, h['KickOffCallDoneAt']+1).setValue('');
      if (h['KickOffCallDoneBy']   !== undefined) sheet.getRange(rowNum, h['KickOffCallDoneBy']+1).setValue('');

      if (h['Notes'] !== undefined) {
        var existingNotes = String(data[i][h['Notes']]||'');
        var changeNote = 'Changed from ' + oldVAName + ' to ' + vaRes.data.vaName + (reason ? ': ' + reason : '');
        sheet.getRange(rowNum, h['Notes']+1).setValue(existingNotes ? existingNotes + '\n' + changeNote : changeNote);
      }
      sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(user.email);

      _writeLog('VAConnection', connectionId, 'UPDATE', 'VAID', oldVAName, vaRes.data.vaName, user);

      // Force the request's displayed stage to fall back in line with
      // this connection's now-reset progress — the regular, guarded
      // _wfRecalculateRequestStage refuses to move a request backward
      // once it's reached VA-Client Connection Call or later, which is
      // exactly why this got stuck; a VA swap is a deliberate restart
      // and is meant to move it backward.
      try {
        var requestIdForRecalc = String(data[i][h['RequestID']]||'');
        if (requestIdForRecalc) _wfForceRecalculateRequestStage(requestIdForRecalc, user);
      } catch (recalcEx) { Logger.log('changeAssignedVA stage recalc: ' + recalcEx.message); }

      return { success: true, vaName: vaRes.data.vaName };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'changeAssignedVA: ' + e.message };
  }
}

// Same computation as _wfRecalculateRequestStage (WorkflowService.gs),
// but WITHOUT its "never move the request's stage backward past
// VA-Client Connection Call" guard. That guard exists to stop routine
// drift from silently regressing a request that's already deep into
// Start VA/Completed — appropriate for the many places that call the
// guarded version after an ordinary action. A VA swap via
// changeAssignedVA is different: it's a deliberate restart of one
// connection's own progress, and the request's displayed stage
// genuinely needs to be allowed to fall back below VA-Client Connection
// Call to reflect that, or the very state this exists to fix — a
// Pending connection with no Accept/Decline button available because
// the stage is stuck ahead of it — recurs every time a VA is swapped
// out after reaching Accepted.
function _wfForceRecalculateRequestStage(requestId, user) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reqSheet = _wfGetReqSheet(ss);
    var reqData = reqSheet.getDataRange().getValues();
    var reqH = _reqHMap(reqData[0]);
    var curStageLabel = '', paymentConfirmed = false;
    for (var ri = 1; ri < reqData.length; ri++) {
      if (String(reqData[ri][reqH['RequestID']]||'') !== requestId) continue;
      curStageLabel = reqH['CurrentStage'] !== undefined ? String(reqData[ri][reqH['CurrentStage']]||'') : '';
      var payStatus = reqH['PaymentStatus'] !== undefined ? String(reqData[ri][reqH['PaymentStatus']]||'') : '';
      paymentConfirmed = (payStatus === 'Paid' || payStatus === 'Add to Next Bill');
      break;
    }
    var curIdx = WF_DISPLAY_ORDER.findIndex(function(key) { return WORKFLOW_STAGES[key].label === curStageLabel; });
    var vaAssignmentIdx = WF_DISPLAY_ORDER.indexOf('VA_ASSIGNMENT');
    if (curIdx < vaAssignmentIdx) return; // nothing to recompute from yet

    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var connH = _connHMap(connData[0]);
    var conns = [];
    if (connH['ConnectionID'] !== undefined && connH['RequestID'] !== undefined) {
      for (var cri = 1; cri < connData.length; cri++) {
        if (!connData[cri][connH['ConnectionID']]) continue;
        if (String(connData[cri][connH['RequestID']]||'') !== requestId) continue;
        conns.push(_mapConnRow(connData[cri], connH, false));
      }
    }
    var maxIdx = vaAssignmentIdx;
    var finalConn = conns.find(function(c) { return c.isFinalVA; });
    // Same fix as _wfRecalculateRequestStage (WorkflowService.gs) — a
    // Declined/Cancelled/Terminated connection's stale progress
    // shouldn't count toward the fallback max when no Final VA is
    // currently designated.
    var IN_CONTENTION_STATUSES = { 'Declined': true, 'Cancelled': true, 'Terminated': true };
    var connsForMax = finalConn ? [finalConn] : conns.filter(function(c) { return !IN_CONTENTION_STATUSES[c.connectionStatus]; });
    connsForMax.forEach(function(c) {
      var idx = _wfConnStageIndex(c, paymentConfirmed);
      if (idx > maxIdx) maxIdx = idx;
    });
    if (maxIdx === curIdx) return; // already correct

    var newStageKey = WF_DISPLAY_ORDER[maxIdx];
    var direction = maxIdx > curIdx ? 'advanced' : 'returned';
    _wfAdvance(requestId, newStageKey, user, 'Stage ' + direction + ' automatically — VA changed, restarting this connection\'s progress.', true);
  } catch (e) {
    Logger.log('_wfForceRecalculateRequestStage error: ' + e.message);
  }
}

// Administrator/CS Manager only — a callable, one-off correction for a
// request whose displayed stage got stuck ahead of its connections' real
// progress (the exact symptom the changeAssignedVA fix above prevents
// going forward, but doesn't retroactively repair for requests it
// already happened to before this fix existed). Safe to call on a
// request that ISN'T actually stuck — it's a no-op if the computed
// stage already matches what's currently shown.
function fixStuckRequestStage(requestId) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR && user.role !== CONFIG.ROLES.CS_MANAGER) {
      return { success: false, error: 'Only Administrators or CS Managers can force a stage recalculation.' };
    }
    if (!requestId) return { success: false, error: 'Request ID is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reqSheet = _reqGetSheet(ss);
    var reqData = reqSheet.getDataRange().getValues();
    var reqH = _reqHMap(reqData[0]);
    var stageBefore = '';
    var found = false;
    for (var ri = 1; ri < reqData.length; ri++) {
      if (String(reqData[ri][reqH['RequestID']]||'') !== requestId) continue;
      found = true;
      stageBefore = reqH['CurrentStage'] !== undefined ? String(reqData[ri][reqH['CurrentStage']]||'') : '';
      break;
    }
    if (!found) return { success: false, error: 'Request not found.' };

    _wfForceRecalculateRequestStage(requestId, user);

    // Re-read to report back exactly what changed (or didn't).
    var reqData2 = _reqGetSheet(ss).getDataRange().getValues();
    var stageAfter = stageBefore;
    for (var rj = 1; rj < reqData2.length; rj++) {
      if (String(reqData2[rj][reqH['RequestID']]||'') !== requestId) continue;
      stageAfter = reqH['CurrentStage'] !== undefined ? String(reqData2[rj][reqH['CurrentStage']]||'') : '';
      break;
    }
    return { success: true, requestId: requestId, stageBefore: stageBefore, stageAfter: stageAfter, changed: stageBefore !== stageAfter };
  } catch (e) {
    return { success: false, error: 'fixStuckRequestStage: ' + e.message };
  }
}

// Un-marks IsFinalVA on every existing connection for a request — shared
// by assignVA (when a new connection is explicitly designated final at
// assignment time) and setFinalVA below (for re-designating after the
// fact). Takes the sheet/header map already open by the caller rather
// than re-fetching them, since both callers already have them.
function _clearFinalVAForRequest(sheet, h, requestId, exceptConnectionId) {
  if (h['IsFinalVA'] === undefined) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['RequestID']]||'') !== requestId) continue;
    if (exceptConnectionId && String(data[i][h['ConnectionID']]) === exceptConnectionId) continue;
    if (_toBool(data[i][h['IsFinalVA']])) {
      sheet.getRange(i+1, h['IsFinalVA']+1).setValue(false);
    }
  }
}

// Re-designates which connection is the final VA on a request — e.g. if
// the initially-assigned VA doesn't work out and a different one from
// the same request's other connections should carry forward through VA
// Preparation/Mock Interview and Rate Agreement instead. Only one
// connection per request is ever final at a time.
function setFinalVA(connectionId, finalVADate) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Only Managers and above can designate the final VA.' };
    if (!connectionId) return { success: false, error: 'Connection ID is required.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);
    if (h['IsFinalVA'] === undefined) return { success: false, error: 'IsFinalVA column not found — run initializeSystem() to add it.' };

    var requestId = '', vaName = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      requestId = String(data[i][h['RequestID']]||'');
      vaName    = String(data[i][h['VAName']]||'');
      break;
    }
    if (!requestId) return { success: false, error: 'Connection not found.' };

    _clearFinalVAForRequest(sheet, h, requestId, connectionId);

    // Re-read after the clear above, since row positions/values may have
    // shifted in the in-memory copy — safer to look the target row up
    // fresh than to trust the index found before the clear ran.
    var data2 = sheet.getDataRange().getValues();
    for (var j = 1; j < data2.length; j++) {
      if (String(data2[j][h['ConnectionID']]) !== connectionId) continue;
      sheet.getRange(j+1, h['IsFinalVA']+1).setValue(true);
      if (h['FinalVADate'] !== undefined) sheet.getRange(j+1, h['FinalVADate']+1).setValue(finalVADate ? new Date(finalVADate) : new Date());
      sheet.getRange(j+1, h['UpdatedAt']+1).setValue(new Date());
      sheet.getRange(j+1, h['UpdatedBy']+1).setValue(perm.user.email);
      break;
    }
    _writeLog('VAConnection', connectionId, 'UPDATE', 'IsFinalVA', 'false', 'true', perm.user);

    // Per the request — VA Preparation/Mock Interview, Rate Agreement,
    // Kick Off Call, and VA-Client Connection Call are conducted per
    // Assigned VA, so designating a new Final VA can move the request's
    // own displayed stage in either direction: forward if this VA hasn't
    // started VA Prep yet, or back if it hasn't progressed as far as
    // wherever the request currently sits.
    //
    // Real bug fixed here: this used to call the regular, GUARDED
    // _wfRecalculateRequestStage — which explicitly refuses to move a
    // request's stage backward once it's reached VA-Client Connection
    // Call or later. That guard is correct for everyday drift, but it
    // directly contradicts this function's own stated intent above: if
    // the OTHER pending candidate (while nobody was Final yet) had
    // progressed far enough to push the request's displayed stage up
    // that far — a real possibility, since the "no Final VA yet"
    // fallback takes the furthest progress across every still-in-
    // contention candidate — choosing the LESS-progressed one as Final
    // was silently blocked from correcting it. Designating a Final VA is
    // exactly the kind of deliberate event that must be allowed to move
    // the stage backward regardless, so this uses the force variant
    // instead, same as a VA swap via changeAssignedVA already does.
    _wfForceRecalculateRequestStage(requestId, perm.user);

    return { success: true, vaName: vaName };
  } catch (e) {
    return { success: false, error: 'setFinalVA: ' + e.message };
  }
}

function assignVA(payload) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Only Managers and above can assign VAs.' };
    if (!payload || !payload.requestId) return { success: false, error: 'Request ID is required.' };
    if (!payload.vaId)                  return { success: false, error: 'VA is required.' };

    var reqRes = getVARequestById(payload.requestId);
    if (!reqRes.success) return { success: false, error: 'Request not found.' };
    var req = reqRes.data;
    if (req.status === CONFIG.VA_REQUEST_STATUS.CLOSED_WON ||
        req.status === CONFIG.VA_REQUEST_STATUS.CLOSED_LOST) {
      return { success: false, error: 'Cannot assign VA to a closed request.' };
    }

    var vaRes = getVAById(payload.vaId);
    if (!vaRes.success) return { success: false, error: 'VA not found.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var hRow  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var h     = _connHMap(hRow);
    var now   = new Date();
    var id    = generateID('CONN');
    var isBuffer = payload.isBuffer === true;

    // Hours at assignment time: use whatever was explicitly passed in this
    // payload, falling back to what the originating request had on file —
    // closes the gap where a newly-assigned connection used to start with
    // completely blank Hours/HoursType until someone applied a separate
    // "Hours Update" change afterward.
    var hours     = (payload.hours !== undefined && payload.hours !== '') ? payload.hours     : req.hours;
    var hoursType = payload.hoursType || req.hoursType || '';
    var hoursBreakdownRaw = payload.hoursBreakdown || req.hoursBreakdown || '';

    // Final VA — the one actually proceeding through VA Preparation/Mock
    // Interview and Rate Agreement. Auto-true if this is the first
    // connection on the request (nothing else to compare against);
    // otherwise only true if explicitly designated via the payload —
    // and if so, any previous final VA on this same request is un-marked
    // first, since exactly one should ever be final at a time.
    var existingConnsForFinal = getVAConnections({ requestId: payload.requestId });
    var hasExistingConns = existingConnsForFinal.success && existingConnsForFinal.data.length > 0;
    var isFinalVA = !hasExistingConns || payload.isFinalVA === true;
    if (isFinalVA && hasExistingConns) {
      _clearFinalVAForRequest(sheet, h, payload.requestId);
    }

    var colMap = {
      'ConnectionID':    id,
      'RequestID':       payload.requestId,
      'VAID':            payload.vaId,
      'VAName':          vaRes.data.vaName,
      'ClientID':        req.clientId   || '',
      'CustomerID':      req.customerId || '',
      'CustomerName':    _connLookupCustomerName(req.customerId),
      'AssignedBy':      perm.user.email,
      'AssignedAt':      now,
      'IsFinalVA':       isFinalVA,
      'IsBuffer':        isBuffer,
      'ConnectionStatus':CONFIG.VA_CONNECTION_STATUS.PENDING,
      'Hours':           hours     || '',
      'HoursType':       hoursType || '',
      'VAConnectionDate':'',
      'ActualStartDate': '',
      'TerminationDate': '',
      'ReplacedByConnectionID': '',
      'Notes':           payload.notes || '',
      'UpdatedAt':       now,
      'UpdatedBy':       perm.user.email
    };

    var rowData = hRow.map(function (col) {
      return col && colMap.hasOwnProperty(col) ? colMap[col] : '';
    });
    sheet.appendRow(rowData);

    // Seed this connection's hours history from day one, rather than
    // leaving it with zero entries until someone applies a change later
    // (see migrateVAConnectionHours() in VAHoursService.gs for the same
    // backfill applied retroactively to older connections).
    if (hours) {
      try {
        var logSheet0 = _ensureSheet(ss, 'VAConnectionHoursLog', CONFIG.SCHEMA.VAConnectionHoursLog);
        var breakdown0 = hoursBreakdownRaw || JSON.stringify(_hoursFallbackBreakdown(hours, ''));
        // Bug fix: this row used to leave NewScheduleType blank — meaning
        // a connection with no later Hours/Schedule Update logged had NO
        // schedule type recorded anywhere in its history at all. Pulling it
        // from the originating request now, same as Hours/HoursType already were.
        var initialScheduleType = req.scheduleType || '';
        var initialRequiredPHTime = req.requiredPHTime || '';
                var hoursLogRow0 = {};
        hoursLogRow0['LogID'] = generateID('HCL');
        hoursLogRow0['ConnectionID'] = id;
        hoursLogRow0['ChangeType'] = 'Initial Assignment';
        hoursLogRow0['NewHours'] = hours;
        hoursLogRow0['NewHoursType'] = hoursType;
        hoursLogRow0['NewConnectionType'] = 'Regular';
        hoursLogRow0['NewScheduleType'] = initialScheduleType;
        hoursLogRow0['EffectiveDate'] = now;
        hoursLogRow0['Notes'] = 'Set at VA assignment time.';
        hoursLogRow0['LoggedBy'] = perm.user.email;
        hoursLogRow0['CreatedAt'] = now;
        hoursLogRow0['NewScheduleBreakdown'] = breakdown0;
        hoursLogRow0['RequiredPHTime'] = initialRequiredPHTime;
        // Per the request — RequiredClientTime was previously missing
        // from this row entirely (the old positional array only ever
        // had 27 values against this sheet's 28+ columns at the time),
        // so it's added here now.
        hoursLogRow0['RequiredClientTime'] = req.requiredClientTime || '';
        hoursLogRow0['NightDiffApplicableAtSchedule'] = !!req.nightDiffApplicableAtSchedule;
        hoursLogRow0['BreaksIncludedInTotal'] = req.breaksIncludedInTotal !== undefined ? !!req.breaksIncludedInTotal : true;
        // Initial Assignment applies immediately — same reasoning as the
        // exception in applyVAConnectionHoursChange_ (this is a VA's
        // very first schedule setup, not a change to confirm/cancel).
        hoursLogRow0['ApplyStatus'] = 'Applied';
        hoursLogRow0['AppliedAt'] = now;
        hoursLogRow0['AppliedBy'] = perm.user.email;
        _hoursLogAppendByHeader(logSheet0, hoursLogRow0);
      } catch (hoursLogEx) { Logger.log('assignVA hours log: ' + hoursLogEx.message); }
    }

    if (req.status === CONFIG.VA_REQUEST_STATUS.OPEN) {
      _setRequestStatus(payload.requestId, CONFIG.VA_REQUEST_STATUS.IN_PROGRESS, perm.user);
    }

    _writeLog('VAConnection', id, 'CREATE', 'AssignedVA',
      '', vaRes.data.vaName + (isBuffer ? ' (Buffer)' : ''), perm.user);
    try { _wfRecalculateRequestStage(payload.requestId, perm.user); } catch (wfAssignEx) { Logger.log('assignVA stage recalc: ' + wfAssignEx.message); }
    // Real bug fixed here — same reasoning as the flush() added to
    // _wfAdvance (WorkflowService.gs): _wfRecalculateRequestStage only
    // flushes if it actually decides a stage change is needed. A brand
    // new connection at Pending often doesn't move the stage at all, in
    // which case this row's own appendRow() above was never explicitly
    // flushed — and the person very often opens this same request's
    // detail view immediately after assigning, loading its Timeline
    // right away. This guarantees the new connection is visible
    // regardless of whether a stage change happened alongside it.
    SpreadsheetApp.flush();
    return { success: true, id: id, vaName: vaRes.data.vaName };
  } catch (e) {
    return { success: false, error: 'assignVA: ' + e.message };
  }
}

function updateVAConnectionStatus(connectionId, newStatus, dateValue) {

  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Only Managers and above can update VA connection status.' };

    var validStatuses = Object.values(CONFIG.VA_CONNECTION_STATUS);
    if (validStatuses.indexOf(newStatus) === -1) {
      return { success: false, error: 'Invalid status: ' + newStatus };
    }
    // Per the request — Terminated / Cancelled used to be settable here with no TerminationDate
    // recorded at all. Ending a connection now always goes through terminateVAConnection, the one
    // place that records the date (dateValue is the termination date).
    if (newStatus === CONFIG.VA_CONNECTION_STATUS.TERMINATED || newStatus === CONFIG.VA_CONNECTION_STATUS.CANCELLED) {
      return terminateVAConnection(connectionId, dateValue, '', '', newStatus);
    }

    // Only whoever currently owns the request's stage can Accept/Decline
    // a VA connection — Administrator always allowed, and CS Manager can
    // additionally act on any CS Specialist/Executive-owned stage. Same
    // ownership rule the frontend's own _wfCanActOnRequest already uses
    // to decide what to show; this is the actual enforcement, since a
    // hidden/disabled button alone is only a UX measure, not a guarantee.
    if (newStatus === CONFIG.VA_CONNECTION_STATUS.ACCEPTED || newStatus === CONFIG.VA_CONNECTION_STATUS.DECLINED) {
      // Per the request — Service Manager can only Assign a VA, not
      // Accept/Decline one afterward, even though they own the VA
      // Assignment stage this normally happens during. Blanket
      // restriction, checked before the stage-ownership logic below
      // (which would otherwise allow it, since they are that owner).
      if (perm.user.role === 'Service Manager') {
        return { success: false, error: 'Service Managers can only Assign a VA — Accept/Decline is handled by the CS Specialist.' };
      }
      // Per the request — Accept/Decline is always restricted to CS
      // Specialist, CS Manager, or Administrator, regardless of which
      // role happens to own the request's current stage. Tying this to
      // the stage owner was the wrong model: it produced a confusing
      // "Only Service Manager can Accept/Decline" message whenever a
      // request sat at a stage Service Manager owns, even though they're
      // explicitly blocked from this action just above.
      if (perm.user.role !== 'Administrator' && perm.user.role !== 'CS Specialist' && perm.user.role !== 'CS Manager') {
        return { success: false, error: 'Only the CS Specialist, CS Manager, or Administrator can Accept/Decline a VA connection.' };
      }
      // Per the request — Accept/Decline only happens at Kick Off Call /
      // VA-Client Connection Call, not at every stage a connection
      // happens to be Pending. A hidden frontend button alone isn't a
      // real security boundary, so this is enforced here too.
      try {
        var connSheetForStageCheck = _connGetSheet(SpreadsheetApp.getActiveSpreadsheet());
        var connDataForStageCheck = connSheetForStageCheck.getDataRange().getValues();
        var connHForStageCheck = _connHMap(connDataForStageCheck[0]);
        var reqIdForStageCheck = '';
        var kickOffDoneForStageCheck = false;
        for (var scci = 1; scci < connDataForStageCheck.length; scci++) {
          if (String(connDataForStageCheck[scci][connHForStageCheck['ConnectionID']]||'') !== connectionId) continue;
          reqIdForStageCheck = String(connDataForStageCheck[scci][connHForStageCheck['RequestID']]||'');
          kickOffDoneForStageCheck = connHForStageCheck['KickOffCallDone'] !== undefined && _toBool(connDataForStageCheck[scci][connHForStageCheck['KickOffCallDone']]);
          break;
        }
        // Per the request — Kick-Off Call is now its own explicit,
        // per-connection step that must be marked done before
        // Accept/Decline becomes available for that specific VA.
        if (reqIdForStageCheck && !kickOffDoneForStageCheck) {
          return { success: false, error: 'Mark the Kick-Off Call complete for this VA first.' };
        }
        if (reqIdForStageCheck) {
          var reqSheetForStageCheck = _wfGetReqSheet(SpreadsheetApp.getActiveSpreadsheet());
          var reqDataForStageCheck = reqSheetForStageCheck.getDataRange().getValues();
          var reqHForStageCheck = _reqHMap(reqDataForStageCheck[0]);
          for (var scri = 1; scri < reqDataForStageCheck.length; scri++) {
            if (String(reqDataForStageCheck[scri][reqHForStageCheck['RequestID']]||'') !== reqIdForStageCheck) continue;
            var stageForStageCheck = reqHForStageCheck['CurrentStage'] !== undefined ? String(reqDataForStageCheck[scri][reqHForStageCheck['CurrentStage']]||'') : '';
            if (stageForStageCheck !== 'Kick Off Call' && stageForStageCheck !== 'VA-Client Connection Call') {
              return { success: false, error: 'Accept/Decline is only available once this request reaches Kick Off Call.' };
            }
            break;
          }
        }
      } catch (stageCheckEx) { Logger.log('updateVAConnectionStatus stage check: ' + stageCheckEx.message); }
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rowNum    = i + 1;
      var oldStatus = String(data[i][h['ConnectionStatus']] || '');
      var requestId = String(data[i][h['RequestID']]        || '');
      var vaName    = String(data[i][h['VAName']]           || '');
      var now       = new Date();

      sheet.getRange(rowNum, h['ConnectionStatus'] + 1).setValue(newStatus);
      sheet.getRange(rowNum, h['UpdatedAt']        + 1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy']        + 1).setValue(perm.user.email);


      // If the connection being declined was the Final VA, and other
      // candidates exist for this same request, automatically promote
      // the earliest-assigned remaining candidate to Final VA — per the
      // request, a request shouldn't be left with no Final VA just
      // because the current one was declined while others are still
      // pending/accepted.
      if (newStatus === CONFIG.VA_CONNECTION_STATUS.DECLINED && h['IsFinalVA'] !== undefined
          && _toBool(data[i][h['IsFinalVA']]) && requestId) {
        try {
          var nextCandidateId = null, nextCandidateCreatedAt = null;
          for (var nci = 1; nci < data.length; nci++) {
            if (nci === i) continue;
            if (String(data[nci][h['RequestID']]||'') !== requestId) continue;
            var nciStatus = String(data[nci][h['ConnectionStatus']]||'');
            if (nciStatus !== CONFIG.VA_CONNECTION_STATUS.PENDING && nciStatus !== CONFIG.VA_CONNECTION_STATUS.ACCEPTED) continue;
            var nciCreatedAt = data[nci][h['CreatedAt']] ? new Date(data[nci][h['CreatedAt']]) : new Date(0);
            if (!nextCandidateId || nciCreatedAt < nextCandidateCreatedAt) {
              nextCandidateId = String(data[nci][h['ConnectionID']]||'');
              nextCandidateCreatedAt = nciCreatedAt;
            }
          }
          if (nextCandidateId) {
            var reassignRes = setFinalVA(nextCandidateId);
            if (!reassignRes || !reassignRes.success) {
              Logger.log('updateVAConnectionStatus auto-reassign Final VA: setFinalVA returned failure — ' + (reassignRes && reassignRes.error));
            }
          }
        } catch (finalVaEx) { Logger.log('updateVAConnectionStatus auto-reassign Final VA: ' + finalVaEx.message); }
      }

      if (newStatus === CONFIG.VA_CONNECTION_STATUS.ACCEPTED && h['VAConnectionDate'] !== undefined) {
        sheet.getRange(rowNum, h['VAConnectionDate'] + 1).setValue(dateValue || now);
      }
      var actualStartDateForMeetings = null;
      if (newStatus === CONFIG.VA_CONNECTION_STATUS.STARTED && h['ActualStartDate'] !== undefined) {
        actualStartDateForMeetings = dateValue || now;
        sheet.getRange(rowNum, h['ActualStartDate'] + 1).setValue(actualStartDateForMeetings);
      }
      if (newStatus === CONFIG.VA_CONNECTION_STATUS.STARTED && h['PayrollStatus'] !== undefined && !String(data[i][h['PayrollStatus']]||'').trim()) {
        sheet.getRange(rowNum, h['PayrollStatus'] + 1).setValue('Not Yet Added');
      }

      _writeLog('VAConnection', connectionId, 'UPDATE', 'ConnectionStatus',
        oldStatus, newStatus, perm.user, dateValue || now);

      if (newStatus === CONFIG.VA_CONNECTION_STATUS.ACCEPTED) {
        // Per the request — VA Prep/Rate Agreement/Kick Off Call are
        // conducted per Assigned VA; the request's own displayed stage
        // is recalculated from the maximum progress across all of them,
        // rather than this connection's own Accept event driving a
        // separate, hardcoded advance.
        _wfRecalculateRequestStage(requestId, perm.user);

        // Once one connection on this request is Accepted, any other
        // connection still sitting Pending is a duplicate that never
        // became a real commitment — delete it outright. A Declined one
        // is a meaningful, retained outcome and is left alone.
        try {
          var rowsToDelete = [];
          for (var di = 1; di < data.length; di++) {
            if (di === i) continue;
            if (String(data[di][h['RequestID']]||'') !== requestId) continue;
            if (String(data[di][h['ConnectionStatus']]||'') === CONFIG.VA_CONNECTION_STATUS.PENDING) {
              rowsToDelete.push(di + 1);
            }
          }
          rowsToDelete.sort(function(a,b){ return b - a; }); // descending, so deleting doesn't shift the next target's row number
          rowsToDelete.forEach(function(rn) { sheet.deleteRow(rn); });
        } catch (cleanupEx) { Logger.log('updateVAConnectionStatus pending-duplicate cleanup: ' + cleanupEx.message); }
      }
      if (newStatus === CONFIG.VA_CONNECTION_STATUS.STARTED) {
        try { _wfAdvance(requestId, 'COMPLETED', perm.user, vaName + ' started.'); }
        catch (wfEx) { Logger.log('updateVAConnectionStatus workflow advance (Started): ' + wfEx.message); }
      }

      // If a VA is declined once the request has moved into VA-Client
      // Connection Call (or any stage from there through Start VA — a
      // decline can happen even that late), and there's no other
      // connection on this request still Pending or Accepted, the
      // request loops back to VA Assignment so a new VA can be sourced.
      // This is what makes the whole process repeat until the ticket is
      // actually closed, rather than getting stuck with no VA and no
      // path forward. _wfAdvance logs to the same workflow history the
      // Timeline reads from, so this loop-back is automatically captured
      // there too.
      // If a VA is declined once the request has moved past VA
      // Assignment (Recruitment - Sourcing onward, all the way through
      // Start VA — a decline can happen at any of these), and there's no
      // other connection on this request still Pending or Accepted, the
      // request loops back to VA Assignment so a new VA can be sourced.
      // This is what makes the whole process repeat until the ticket is
      // actually closed, rather than getting stuck at whichever later
      // stage it was at with no VA and no path forward. _wfAdvance logs
      // to the same workflow history the Timeline reads from, so this
      // loop-back is automatically captured there too.
      if (newStatus === CONFIG.VA_CONNECTION_STATUS.DECLINED) {
        // Per the request — declining a connection can send the
        // request's own displayed stage either back to VA Assignment
        // (if no other Assigned VA remains in contention) or back to
        // wherever a remaining VA has actually progressed to (e.g. Rate
        // Agreement, if that's as far as it's gotten) — this now
        // recalculates from the real state of every connection rather
        // than only handling the "no other VA" case.
        _wfRecalculateRequestStage(requestId, perm.user);
      }

      if (newStatus === CONFIG.VA_CONNECTION_STATUS.STARTED) {
        _closeRequestAsWon(requestId, perm.user, actualStartDateForMeetings);
        // Activate the customer and account when VA starts
        var activationRes = _activateCustomerAndAccount(requestId, perm.user, actualStartDateForMeetings, String(data[i][h['ClientID']] || ''), String(data[i][h['CustomerID']] || ''));
        // Generate the account's standard check-in meeting schedule
        // (2wk/1mo/2mo/3mo/6mo/1yr) — ONLY if this account doesn't already
        // have one. A second/third VA starting on an account that's already
        // scheduled does not get its own schedule; it just joins the active
        // VA list on whichever meetings are still upcoming.
        try {
          var clientIdForMeetings   = String(data[i][h['ClientID']]   || '');
          var customerIdForMeetings = String(data[i][h['CustomerID']] || '');
          var activeIdsForMeetings  = _getActiveConnectionIdsForClient(clientIdForMeetings);
          generateMeetingsForAccount(clientIdForMeetings, customerIdForMeetings,
            connectionId, requestId, actualStartDateForMeetings, activeIdsForMeetings);
          _syncActiveVAsOnUpcomingMeetings(clientIdForMeetings);
        } catch (meetErr) {
          Logger.log('generateMeetingsForAccount (on start): ' + meetErr.message);
        }
      }
      // A VA going Cancelled/Declined after having been Started also changes
      // who's "active" on the account — keep upcoming meetings' VA list current.
      if (newStatus === CONFIG.VA_CONNECTION_STATUS.CANCELLED) {
        try {
          var clientIdForSync = String(data[i][h['ClientID']] || '');
          if (clientIdForSync) _syncActiveVAsOnUpcomingMeetings(clientIdForSync);
        } catch (syncErr) {
          Logger.log('_syncActiveVAsOnUpcomingMeetings (on cancel): ' + syncErr.message);
        }
        // Per the same reasoning as Decline above — this connection
        // dropping out of contention can require the request's
        // displayed stage to fall back to wherever a remaining VA has
        // actually progressed to.
        _wfRecalculateRequestStage(requestId, perm.user);
      }
      var cascadeClientId = String(data[i][h['ClientID']] || '');
      var cascadeCustomerId = String(data[i][h['CustomerID']] || '');
      var cascadeInfo = (oldStatus === CONFIG.VA_CONNECTION_STATUS.STARTED)
        ? _checkAndCascadeLastActiveConnection(data, h, connectionId, cascadeClientId, cascadeCustomerId, perm.user, newStatus)
        : { isLastForClient: false, isLastForCustomer: false, clientPaused: false, customerPaused: false, offerChoice: false };
      return {
        success: true, requestId: requestId, vaName: vaName, newStatus: newStatus,
        clientId: cascadeClientId, customerId: cascadeCustomerId,
        isLastForClient: cascadeInfo.isLastForClient, isLastForCustomer: cascadeInfo.isLastForCustomer,
        clientPaused: cascadeInfo.clientPaused, customerPaused: cascadeInfo.customerPaused, offerChoice: cascadeInfo.offerChoice,
        // Non-empty only if activating the account/customer hit an error on a Started connection.
        activationWarning: (typeof activationRes !== 'undefined' && activationRes && activationRes.errors && activationRes.errors.length) ? activationRes.errors.join('; ') : ''
      };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'updateVAConnectionStatus: ' + e.message };
  }
}

// Toggles a connection's payroll status — HR Specialist marks it added
// once it's genuinely been set up in payroll. Only Started connections
// are meaningful here (a connection that never started never needed
// payroll in the first place), enforced rather than assumed.
function setVAConnectionPayrollStatus(connectionId, status) {
  try {
    var perm = getCurrentUser();
    if (!perm || perm.error) return { success: false, error: 'Not signed in.' };
    if (perm.role !== 'HR Specialist' && perm.role !== 'HR Manager' && perm.role !== 'Administrator') {
      return { success: false, error: 'Only HR Specialist, HR Manager, or Administrator can update payroll status.' };
    }
    if (['Not Yet Added', 'Added'].indexOf(status) === -1) {
      return { success: false, error: 'Invalid payroll status: ' + status };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _connHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var connStatus = String(data[i][h['ConnectionStatus']]||'');
      if (connStatus !== CONFIG.VA_CONNECTION_STATUS.STARTED) {
        return { success: false, error: 'Only a Started connection can have a payroll status.' };
      }
      var oldStatus = String(data[i][h['PayrollStatus']]||'');
      var rowNum = i + 1;
      sheet.getRange(rowNum, h['PayrollStatus']+1).setValue(status);
      sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(perm.email);
      _writeLog('VAConnection', connectionId, 'UPDATE', 'PayrollStatus', oldStatus, status, perm);
      return { success: true };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'setVAConnectionPayrollStatus: ' + e.message };
  }
}

// Every Started connection still sitting at "Not Yet Added" — the HR
// Specialist dashboard's queue of what still needs setting up in payroll.
function getConnectionsNotYetInPayroll() {
  try {
    var perm = getCurrentUser();
    if (!perm || perm.error) return { success: false, error: 'Not signed in.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _connHMap(data[0]);
    var includeRate = _canSeeVARate(perm.role);

    // Client/Customer name lookups — _mapConnRow only carries the raw IDs.
    var cliMap = {}, custMap = {};
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (cliSheet) {
      var cliData = cliSheet.getDataRange().getValues();
      var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
      for (var ci = 1; ci < cliData.length; ci++) {
        var cid = String(cliData[ci][clh['ClientID']]||''); if (!cid) continue;
        cliMap[cid] = {
          companyName: String(cliData[ci][clh['CompanyName']]||''),
          accountName: String(cliData[ci][clh['AccountName']]||''),
          customerId: String(cliData[ci][clh['CustomerID']]||'')
        };
      }
    }
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSheet) {
      var custData = custSheet.getDataRange().getValues();
      var cuh = {}; custData[0].forEach(function(c,i){ if(c) cuh[String(c)]=i; });
      for (var cu = 1; cu < custData.length; cu++) {
        var cuid = String(custData[cu][cuh['CustomerID']]||''); if (!cuid) continue;
        custMap[cuid] = String(custData[cu][cuh['CustomerName']]||'');
      }
    }

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionStatus']]||'') !== CONFIG.VA_CONNECTION_STATUS.STARTED) continue;
      if (String(data[i][h['PayrollStatus']]||'') !== 'Not Yet Added') continue;
      var rec = _mapConnRow(data[i], h, includeRate);
      var cliInfo = cliMap[rec.clientId] || {};
      var custId = cliInfo.customerId || rec.customerId;
      rec.customerName = custMap[custId] || custId;
      rec.accountName = cliInfo.accountName || cliInfo.companyName || '';
      rows.push(rec);
    }
    rows.sort(function(a,b){ return new Date(a.actualStartDate||0) - new Date(b.actualStartDate||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getConnectionsNotYetInPayroll: ' + e.message };
  }
}

function _cancelOpenConnections(requestId, user) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);
    var openStatuses = [CONFIG.VA_CONNECTION_STATUS.PENDING, CONFIG.VA_CONNECTION_STATUS.ACCEPTED];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      if (openStatuses.indexOf(String(data[i][h['ConnectionStatus']] || '')) !== -1) {
        sheet.getRange(i + 1, h['ConnectionStatus'] + 1).setValue(CONFIG.VA_CONNECTION_STATUS.CANCELLED);
        // Per the request — a cancelled connection records when it ended, same as a terminated one.
        if (h['TerminationDate'] !== undefined && !data[i][h['TerminationDate']]) sheet.getRange(i + 1, h['TerminationDate'] + 1).setValue(new Date());
        sheet.getRange(i + 1, h['UpdatedAt']        + 1).setValue(new Date());
        sheet.getRange(i + 1, h['UpdatedBy']        + 1).setValue(user ? user.email : 'System');
      }
    }
  } catch (e) {
    Logger.log('_cancelOpenConnections error: ' + e.message);
  }
}

function addVAConnectionNote(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!payload || !payload.requestId)                    return { success: false, error: 'Request ID is required.' };
    // connectionId may be synthetic '__req_XXX' when no VA connection exists yet
    if (!payload.connectionId) payload.connectionId = '__req_' + (payload.requestId||'unknown');
    if (!payload.content || !payload.content.trim())       return { success: false, error: 'Note content is required.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _notesGetSheet(ss);
    var id    = generateID('NOTE');
    var now   = new Date();
    var postedAt = now;
    if (payload.postDate) {
      var parsedPost = _parseDateInput(payload.postDate);
      if (!isNaN(parsedPost.getTime())) postedAt = parsedPost;
    }

    sheet.appendRow([
      id,
      payload.connectionId,
      payload.requestId,
      perm.user.email,
      perm.user.name || perm.user.email,
      payload.content.trim(),
      postedAt
    ]);

    // Posting a note now also counts as the acknowledgement/update for
    // whoever currently owns the request's stage — merged into one action
    // rather than two separate systems. Only recorded if the poster is
    // actually the current stage's owner (or an Administrator) — a note
    // from someone else on the request (e.g. a CS Manager just checking
    // in) shouldn't reset another role's 24-hour clock. Silently skipped
    // for stages that don't use acknowledgements at all (Request Intake,
    // Management Approval, Completed) or if anything about this lookup
    // fails — the note itself has already saved successfully either way.
    try {
      var reqSheetForAck = _reqGetSheet(ss);
      var reqDataForAck = reqSheetForAck.getDataRange().getValues();
      var rhForAck = _reqHMap(reqDataForAck[0]);
      for (var ai = 1; ai < reqDataForAck.length; ai++) {
        if (String(reqDataForAck[ai][rhForAck['RequestID']]) !== payload.requestId) continue;
        var ackStage = rhForAck['CurrentStage'] !== undefined ? String(reqDataForAck[ai][rhForAck['CurrentStage']]||'') : '';
        var ackRoleRaw = rhForAck['PersonInChargeRole'] !== undefined ? String(reqDataForAck[ai][rhForAck['PersonInChargeRole']]||'') : '';
        var ackRole = ackRoleRaw || _wfDefaultRoleForStage(ackStage);
        // Self-heal — the field was actually blank in the sheet, so
        // write the computed value back now rather than relying on this
        // same fallback again on every future read/action for this
        // request.
        if (!ackRoleRaw && ackRole && rhForAck['PersonInChargeRole'] !== undefined) {
          try { reqSheetForAck.getRange(ai + 1, rhForAck['PersonInChargeRole'] + 1).setValue(ackRole); } catch (healEx) { Logger.log('addVAConnectionNote PersonInChargeRole self-heal: ' + healEx.message); }
        }
        var excludedStage = !ackStage || ackStage === 'Request Intake' || ackStage === 'Management Approval' || ackStage === 'Completed';
        if (!excludedStage && (perm.user.role === ackRole || perm.user.role === CONFIG.ROLES.ADMINISTRATOR)) {
          var ackSheet = _wfGetAckSheet(ss);
          ackSheet.appendRow([generateID('ACK'), payload.requestId, ackStage, payload.content.trim(), perm.user.name || perm.user.email, perm.user.email, now]);
        }
        break;
      }
    } catch (ackEx) { Logger.log('addVAConnectionNote ack merge: ' + ackEx.message); }

    return {
      success:     true,
      id:          id,
      authorName:  perm.user.name  || perm.user.email,
      authorEmail: perm.user.email,
      content:     payload.content.trim(),
      createdAt:   postedAt.toISOString()
    };
  } catch (e) {
    return { success: false, error: 'addVAConnectionNote: ' + e.message };
  }
}

// Administrator-only — notes are otherwise a permanent record of what
// happened and who said it (including acknowledgements, which are merged
// into note-posting), so deleting one should be a rare, deliberate action
// rather than something any note-poster can do to their own entries.
function deleteVAConnectionNote(noteId) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: 'Not signed in.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) {
      return { success: false, error: 'Only Administrators can delete a note.' };
    }
    if (!noteId) return { success: false, error: 'Note ID is required.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _notesGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = {}; data[0].forEach(function(c,i){ if(c) h[String(c).trim()]=i; });
    if (h['NoteID'] === undefined) return { success: false, error: 'Notes sheet not found.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['NoteID']]) !== String(noteId)) continue;
      var requestIdForLog = h['RequestID'] !== undefined ? String(data[i][h['RequestID']]||'') : '';
      var contentForLog   = h['Content']   !== undefined ? String(data[i][h['Content']]||'')   : '';
      sheet.deleteRow(i + 1);
      _writeLog('VARequest', requestIdForLog, 'DELETE', 'note', contentForLog.substring(0, 200), '', user);
      return { success: true };
    }
    return { success: false, error: 'Note not found.' };
  } catch (e) {
    return { success: false, error: 'deleteVAConnectionNote: ' + e.message };
  }
}

function getVAConnectionNotes(requestId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _notesGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };

    var h = _connHMap(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['NoteID']]) continue;
      if (String(r[h['RequestID']]) !== requestId) continue;
      var ts = r[h['CreatedAt']];
      rows.push({
        noteId:      String(r[h['NoteID']]       || ''),
        connectionId:String(r[h['ConnectionID']] || ''),
        requestId:   String(r[h['RequestID']]    || ''),
        authorEmail: String(r[h['AuthorEmail']]  || ''),
        authorName:  String(r[h['AuthorName']]   || ''),
        content:     String(r[h['Content']]      || ''),
        createdAt:   (ts instanceof Date) ? ts.toISOString() : String(ts || '')
      });
    }
    rows.sort(function (a, b) {
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getVAConnectionNotes: ' + e.message };
  }
}

function _setRequestStatus(requestId, status, user) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _reqGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _reqHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]) !== requestId) continue;
      sheet.getRange(i + 1, h['Status']    + 1).setValue(status);
      sheet.getRange(i + 1, h['UpdatedAt'] + 1).setValue(new Date());
      sheet.getRange(i + 1, h['UpdatedBy'] + 1).setValue(user ? user.email : 'System');
      return;
    }
  } catch (e) {
    Logger.log('_setRequestStatus error: ' + e.message);
  }
}

function _mapConnRow(r, h, includeRate) {
  function get(col) {
    if (h[col] === undefined) return '';
    var v = r[h[col]];
    if (v instanceof Date) return v.toISOString();
    return String(v == null ? '' : v);
  }
  var rec = {
    connectionId:     get('ConnectionID'),
    requestId:        get('RequestID'),
    vaId:             get('VAID'),
    vaName:           get('VAName'),
    assignedBy:       get('AssignedBy'),
    assignedAt:       get('AssignedAt'),
    isBuffer:         r[h['IsBuffer']] === true || r[h['IsBuffer']] === 'true',
    isFinalVA:        h['IsFinalVA'] !== undefined ? (r[h['IsFinalVA']] === true || r[h['IsFinalVA']] === 'true') : false,
    // When this VA was designated Final — used by getRequestWorkflowTimeline
    // (WorkflowService.gs) to anchor the Timeline's "completed" markers to
    // THIS candidate's own journey, not a previous Final VA's stale history.
    finalVADate:      get('FinalVADate'),
    rateAgreementDone:   h['RateAgreementDone'] !== undefined ? (r[h['RateAgreementDone']] === true || r[h['RateAgreementDone']] === 'true') : false,
    vaPrepDone:          h['VAPrepDone'] !== undefined ? (r[h['VAPrepDone']] === true || r[h['VAPrepDone']] === 'true') : false,
    vaPrepStartDate:     get('VAPrepStartDate'),
    vaPrepEndDate:       get('VAPrepEndDate'),
    kickOffCallDone:     h['KickOffCallDone'] !== undefined ? (r[h['KickOffCallDone']] === true || r[h['KickOffCallDone']] === 'true') : false,
    kickOffCallDoneAt:   get('KickOffCallDoneAt'),
    kickOffCallDoneBy:   get('KickOffCallDoneBy'),
    rateAgreementDoneAt: get('RateAgreementDoneAt'),
    rateAgreementDoneBy: get('RateAgreementDoneBy'),
    rateAgreementNotes:  get('RateAgreementNotes'),
    connectionStatus: get('ConnectionStatus'),
    connectionType:   get('ConnectionType') || 'Regular',
    hours:            parseFloat(get('Hours')||'0') || 0,
    hoursType:        get('HoursType') || 'Weekly',
    vaConnectionDate: get('VAConnectionDate'),
    actualStartDate:    get('ActualStartDate'),
    terminationDate:    get('TerminationDate'),
    terminationReason:  get('TerminationReason') || (((get('ConnectionStatus')==='Terminated'||get('ConnectionStatus')==='Cancelled')) ? get('Notes') : ''),
    terminationRequestedBy: get('TerminationRequestedBy'),
    terminationRequestedAt: get('TerminationRequestedAt'),
    terminationRequestedDate: get('TerminationRequestedDate'),
    terminationRequestReason: get('TerminationRequestReason'),
    replacedByConnectionId: get('ReplacedByConnectionID'),
    lastPausedAt:      get('LastPausedAt'),
    lastResumedAt:     get('LastResumedAt'),
    wrLink:            get('WRLink'),
    payrollStatus:     get('PayrollStatus'),
    clientId:          get('ClientID'),
    customerId:        get('CustomerID'),
    notes:             get('Notes'),
    updatedAt:         get('UpdatedAt'),
    updatedBy:         get('UpdatedBy')
  };
  // Rate is HR-only (Administrator/HR Specialist/HR Manager) — every caller
  // below computes includeRate once from the current user's role and passes
  // it through, so CS Specialists (and everyone else) never receive this
  // field from the server at all, not just a hidden-in-the-UI value.
  if (includeRate) {
    rec.rate       = parseFloat(get('Rate')||'0') || 0;
    rec.rateSetBy  = get('RateSetBy');
    rec.rateSetAt  = get('RateSetAt');
    rec.nightDiffApplicable     = _toBool(r[h['NightDiffApplicable']]);
    rec.nightDiffPercent        = h['NightDiffPercent'] !== undefined && r[h['NightDiffPercent']] !== '' ? (parseFloat(r[h['NightDiffPercent']]) || 10) : 10;
    rec.trainingBondApplicable  = _toBool(r[h['TrainingBondApplicable']]);
    rec.trainingBondAmount      = parseFloat(get('TrainingBondAmount')||'0') || 0;
    rec.trainingBondMonths      = parseFloat(get('TrainingBondMonths')||'0') || 0;
    rec.incrementalWageApplicable = _toBool(r[h['IncrementalWageApplicable']]);
    rec.raSentDate    = get('RASentDate');
    rec.raConfirmedBy = get('RAConfirmedBy');
    rec.raConfirmedAt = get('RAConfirmedAt');
  }
  return rec;
}

// ── Activate customer + account when a VA starts
// All currently-Started VA connection IDs for a given account — used both
// when generating a meeting schedule (the initial snapshot) and whenever
// that snapshot needs to be refreshed as VAs join/leave the account.
function _getActiveConnectionIdsForClient(clientId) {
  if (!clientId) return [];
  try {
    var res = getVAConnections({});
    if (!res.success) return [];
    return res.data
      .filter(function (c) { return c.clientId === clientId && c.connectionStatus === CONFIG.VA_CONNECTION_STATUS.STARTED; })
      .map(function (c) { return c.connectionId; });
  } catch (e) {
    Logger.log('_getActiveConnectionIdsForClient: ' + e.message);
    return [];
  }
}

function _activateCustomerAndAccount(requestId, user, vaStartDate, fallbackClientId, fallbackCustomerId) {
  // Per the request — when the first VA Connection on a customer/account
  // starts (as a brand-new customer/account, or after it was reactivated and
  // set back to Pending), both the account AND the customer move to Active.
  // Anything not already Active is activated (Pending, or a leftover
  // Terminated/Paused/etc.). Three hardening changes over the earlier version:
  //  1. The request row's own ClientID/CustomerID can be blank on older
  //     records, which silently skipped the customer — the connection's own
  //     IDs are now used as a fallback, and a blank customer is resolved
  //     through the account.
  //  2. Account and customer are activated independently, so one failing
  //     can no longer stop the other, and any failure is returned (not just
  //     logged) so the caller can surface it.
  //  3. Columns like UpdatedAt are only written if they exist, instead of
  //     throwing and abandoning the rest.
  var result = { accountActivated: false, customerActivated: false, clientId: '', customerId: '', errors: [] };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reqSheet = _reqGetSheet(ss);
    var reqData  = reqSheet.getDataRange().getValues();
    var rh = {};
    reqData[0].forEach(function(col, i){ if(col) rh[String(col).trim()]=i; });
    var clientId = '', customerId = '';
    for (var i = 1; i < reqData.length; i++) {
      if (String(reqData[i][rh['RequestID']]) !== requestId) continue;
      clientId   = String(reqData[i][rh['ClientID']]   || '').trim();
      customerId = String(reqData[i][rh['CustomerID']] || '').trim();
      break;
    }
    if (!clientId)   clientId   = String(fallbackClientId   || '').trim();
    if (!customerId) customerId = String(fallbackCustomerId || '').trim();
    var now = new Date();
    // StatusDate reflects when the VA actually started (can be backdated),
    // not the moment this cascade happened to run.
    var statusDate = vaStartDate || now;

    function activateRow(sheetName, idCol, id, logType) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet || !id) return { found: false, changed: false, linkedCustomerId: '' };
      var data = sheet.getDataRange().getValues();
      var h = {}; data[0].forEach(function(c, i){ if (c) h[String(c).trim()] = i; });
      if (h[idCol] === undefined || h['Status'] === undefined) return { found: false, changed: false, linkedCustomerId: '' };
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][h[idCol]]).trim() !== id) continue;
        var linked = h['CustomerID'] !== undefined ? String(data[r][h['CustomerID']] || '').trim() : '';
        var cur = String(data[r][h['Status']] || '');
        if (cur === 'Active') return { found: true, changed: false, linkedCustomerId: linked };
        sheet.getRange(r + 1, h['Status'] + 1).setValue('Active');
        if (h['StatusDate'] !== undefined) sheet.getRange(r + 1, h['StatusDate'] + 1).setValue(statusDate);
        if (h['UpdatedAt']  !== undefined) sheet.getRange(r + 1, h['UpdatedAt']  + 1).setValue(now);
        if (h['UpdatedBy']  !== undefined) sheet.getRange(r + 1, h['UpdatedBy']  + 1).setValue(user ? user.email : 'System');
        _writeLog(logType, id, _classifyStatusChangeAction(cur, 'Active'), 'Status', cur, 'Active', user, statusDate);
        return { found: true, changed: true, linkedCustomerId: linked };
      }
      return { found: false, changed: false, linkedCustomerId: '' };
    }

    if (clientId) {
      try {
        var a = activateRow('Clients', 'ClientID', clientId, 'Account');
        result.accountActivated = a.changed;
        if (!customerId && a.linkedCustomerId) customerId = a.linkedCustomerId;
      } catch (ea) { result.errors.push('Account: ' + ea.message); Logger.log('_activateCustomerAndAccount (account): ' + ea.message); }
    }
    if (customerId) {
      try {
        result.customerActivated = activateRow('Customers', 'CustomerID', customerId, 'Customer').changed;
      } catch (ec) { result.errors.push('Customer: ' + ec.message); Logger.log('_activateCustomerAndAccount (customer): ' + ec.message); }
    }
    result.clientId = clientId; result.customerId = customerId;
    SpreadsheetApp.flush();
  } catch (e) {
    result.errors.push(e.message);
    Logger.log('_activateCustomerAndAccount error: ' + e.message);
  }
  return result;
}

// Administrator/CS Manager only — undoes a connection that was marked
// Started by mistake (a CS clicking "Mark Started" on the wrong VA, a
// wrong request, etc.). This is the exact reverse of the four things
// updateVAConnectionStatus(..., 'Started', ...) does:
//   1. Connection: Started → Accepted, ActualStartDate cleared.
//   2. Request: Closed - Won → In Progress, stage Completed → Start VA.
//   3. Account/Customer: Active → Pending — but ONLY if this was the
//      only Started connection they had (an account with a second,
//      genuinely-started VA stays Active; reusing the same "is this the
//      last one" count _checkAndCascadeLastActiveConnection already
//      uses for the opposite direction, just aimed at Pending instead
//      of Paused, since nothing here was ever legitimately active).
// It deliberately does NOT touch any auto-generated Account Meeting
// schedule from generateMeetingsForAccount — deleting history that may
// already be referenced elsewhere (reports, later meetings) is a bigger
// decision than this function should make silently. Flagged back in the
// return value so the caller can decide.
//
// Refuses to run unless the connection/request are in EXACTLY the state
// this specific action produces (Started / Closed - Won / Completed) —
// this is a targeted undo of one specific mistake, not a general
// "reopen a closed request" tool.
function revertMistakenVAStart(connectionId) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR && user.role !== CONFIG.ROLES.CS_MANAGER) {
      return { success: false, error: 'Only Administrators or CS Managers can revert a mistaken Start.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var connH = _connHMap(connData[0]);
    var connRowIdx = -1, requestId = '', clientId = '', customerId = '', vaName = '', oldActualStartDate = '', oldPayrollStatus = '';
    for (var i = 1; i < connData.length; i++) {
      if (String(connData[i][connH['ConnectionID']]||'') !== connectionId) continue;
      connRowIdx = i;
      requestId       = String(connData[i][connH['RequestID']]   || '');
      clientId        = String(connData[i][connH['ClientID']]    || '');
      customerId      = String(connData[i][connH['CustomerID']]  || '');
      vaName          = String(connData[i][connH['VAName']]      || '');
      oldActualStartDate = connH['ActualStartDate'] !== undefined ? connData[i][connH['ActualStartDate']] : '';
      oldPayrollStatus   = connH['PayrollStatus']    !== undefined ? String(connData[i][connH['PayrollStatus']]||'') : '';
      break;
    }
    if (connRowIdx === -1) return { success: false, error: 'VA Connection not found.' };
    if (String(connData[connRowIdx][connH['ConnectionStatus']]||'') !== CONFIG.VA_CONNECTION_STATUS.STARTED) {
      return { success: false, error: 'This connection is not currently Started — nothing to revert.' };
    }
    if (!requestId) return { success: false, error: 'This connection has no linked Service Request.' };

    var reqSheet = _reqGetSheet(ss);
    var reqData  = reqSheet.getDataRange().getValues();
    var reqH     = _reqHMap(reqData[0]);
    var reqRowIdx = -1;
    for (var ri = 1; ri < reqData.length; ri++) {
      if (String(reqData[ri][reqH['RequestID']]||'') !== requestId) continue;
      reqRowIdx = ri;
      break;
    }
    if (reqRowIdx === -1) return { success: false, error: 'Linked Service Request not found.' };
    var reqStatus = String(reqData[reqRowIdx][reqH['Status']]||'');
    var reqStage  = reqH['CurrentStage'] !== undefined ? String(reqData[reqRowIdx][reqH['CurrentStage']]||'') : '';
    if (reqStatus !== CONFIG.VA_REQUEST_STATUS.CLOSED_WON || reqStage !== WORKFLOW_STAGES.COMPLETED.label) {
      return { success: false, error: 'This request is not in the exact state produced by Mark Started (Closed - Won / Completed) — refusing to auto-revert. Check and correct it manually.' };
    }

    var now = new Date();
    var rowNum = connRowIdx + 1;

    // 1. Connection: undo Started.
    connSheet.getRange(rowNum, connH['ConnectionStatus']+1).setValue(CONFIG.VA_CONNECTION_STATUS.ACCEPTED);
    if (connH['ActualStartDate'] !== undefined) connSheet.getRange(rowNum, connH['ActualStartDate']+1).setValue('');
    // Only clear PayrollStatus if it's still exactly the auto-default
    // this same Start action set — if payroll has since actually been
    // set up for real, that's a genuine downstream fact, not part of
    // the mistake, and is left alone.
    var payrollCleared = false;
    if (connH['PayrollStatus'] !== undefined && oldPayrollStatus === 'Not Yet Added') {
      connSheet.getRange(rowNum, connH['PayrollStatus']+1).setValue('');
      payrollCleared = true;
    }
    connSheet.getRange(rowNum, connH['UpdatedAt']+1).setValue(now);
    connSheet.getRange(rowNum, connH['UpdatedBy']+1).setValue(user.email);
    _writeLog('VAConnection', connectionId, 'REVERT', 'ConnectionStatus', CONFIG.VA_CONNECTION_STATUS.STARTED, CONFIG.VA_CONNECTION_STATUS.ACCEPTED, user, now, 'Reverted a mistaken Mark Started.');

    // 2. Request: undo Closed - Won / Completed.
    reqSheet.getRange(reqRowIdx+1, reqH['Status']+1).setValue(CONFIG.VA_REQUEST_STATUS.IN_PROGRESS);
    if (reqH['CompletedAt'] !== undefined) reqSheet.getRange(reqRowIdx+1, reqH['CompletedAt']+1).setValue('');
    if (reqH['ClosedAt']    !== undefined) reqSheet.getRange(reqRowIdx+1, reqH['ClosedAt']+1).setValue('');
    reqSheet.getRange(reqRowIdx+1, reqH['UpdatedAt']+1).setValue(now);
    reqSheet.getRange(reqRowIdx+1, reqH['UpdatedBy']+1).setValue(user.email);
    _writeLog('VARequest', requestId, 'REVERT', 'Status', CONFIG.VA_REQUEST_STATUS.CLOSED_WON, CONFIG.VA_REQUEST_STATUS.IN_PROGRESS, user, now, 'Reverted a mistaken Mark Started for ' + vaName + '.');
    try { _wfAdvance(requestId, 'START_VA', user, 'Reverted — ' + vaName + ' was marked Started by mistake; returned to Start VA.', true); }
    catch (wfEx) { Logger.log('revertMistakenVAStart _wfAdvance: ' + wfEx.message); }

    // 3. Account/Customer: undo Active, but only if this was genuinely
    // the only Started connection they had.
    var accountReverted = false, customerReverted = false;
    try {
      if (clientId || customerId) {
        var clientStartedCountOther = 0, customerStartedCountOther = 0;
        for (var k = 1; k < connData.length; k++) {
          if (k === connRowIdx) continue;
          if (String(connData[k][connH['ConnectionStatus']]||'') !== CONFIG.VA_CONNECTION_STATUS.STARTED) continue;
          if (clientId   && String(connData[k][connH['ClientID']]  ||'') === clientId)   clientStartedCountOther++;
          if (customerId && String(connData[k][connH['CustomerID']]||'') === customerId) customerStartedCountOther++;
        }
        if (clientId && clientStartedCountOther === 0) {
          var cliRes = getClientById(clientId);
          if (cliRes.success && cliRes.data.status === 'Active') {
            var cliUpd = updateClient(clientId, { status: CONFIG.STATUS.PENDING });
            accountReverted = !!(cliUpd && cliUpd.success);
          }
        }
        if (customerId && customerStartedCountOther === 0) {
          var custRes = getCustomerById(customerId);
          if (custRes.success && custRes.data.status === 'Active') {
            var custUpd = updateCustomer(customerId, { status: CONFIG.STATUS.PENDING });
            customerReverted = !!(custUpd && custUpd.success);
          }
        }
      }
    } catch (cascadeEx) { Logger.log('revertMistakenVAStart account/customer cascade: ' + cascadeEx.message); }

    return {
      success: true,
      requestId: requestId,
      revertedTo: { connectionStatus: CONFIG.VA_CONNECTION_STATUS.ACCEPTED, requestStage: WORKFLOW_STAGES.START_VA.label },
      accountReverted: accountReverted,
      customerReverted: customerReverted,
      payrollStatusCleared: payrollCleared,
      note: 'Any Account Meeting schedule already generated when this VA started was NOT removed — review the Account Meetings tab for this account and delete manually if it should not exist yet.'
    };
  } catch (e) {
    return { success: false, error: 'revertMistakenVAStart: ' + e.message };
  }
}

// ── Get all active (Started) VA connections — for the VA Connections module
function getActiveVAConnections(filters) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };

    var h = _connHMap(data[0]);
    var currentUser = getCurrentUser();
    var includeRate = currentUser && !currentUser.error && _canSeeVARate(currentUser.role);
    // Build request lookup for dept/service enrichment
    var reqLookup = {};
    try {
      var reqSh2 = _reqGetSheet(ss);
      if (reqSh2) {
        var rd2 = reqSh2.getDataRange().getValues();
        var rh2 = {}; rd2[0].forEach(function(col,idx){ if(col) rh2[String(col)]=idx; });
        for (var ri2=1;ri2<rd2.length;ri2++) {
          var rid2=String(rd2[ri2][rh2['RequestID']]||''); if(!rid2) continue;
          reqLookup[rid2]={
            department: String(rd2[ri2][rh2['Department']]||''),
            service:    String(rd2[ri2][rh2['Service']]||''),
            requestType:String(rd2[ri2][rh2['RequestType']]||''),
            clientId:   String(rd2[ri2][rh2['ClientID']]||''),
            customerId: String(rd2[ri2][rh2['CustomerID']]||'')
          };
        }
      }
    } catch(rEx2) { Logger.log('reqLookup: '+rEx2.message); }
    filters = filters || {};
    var rows = [];

    // Build client and customer name lookups
    var cliLookup  = {};
    var custLookup = {};
    var csAssignedByCustomerId = {};
    try {
      var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet) {
        var cd = cliSheet.getDataRange().getValues();
        var ch = _connHMap(cd[0]);
        for (var ci = 1; ci < cd.length; ci++) {
          if (cd[ci][ch['ClientID']]) cliLookup[String(cd[ci][ch['ClientID']])] = { company: String(cd[ci][ch['CompanyName']]||''), account: String(cd[ci][ch['AccountName']]||'') };
        }
      }
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var custd = custSheet.getDataRange().getValues();
        var cush  = _connHMap(custd[0]);
        for (var cui = 1; cui < custd.length; cui++) {
          if (custd[cui][cush['CustomerID']]) custLookup[String(custd[cui][cush['CustomerID']])] = String(custd[cui][cush['CustomerName']]||'');
          if (custd[cui][cush['CustomerID']] && cush['AssignedSpecialist'] !== undefined) {
            csAssignedByCustomerId[String(custd[cui][cush['CustomerID']])] = String(custd[cui][cush['AssignedSpecialist']]||'');
          }
        }
      }
    } catch(ex) { Logger.log('lookup: ' + ex.message); }

    // Whether this connection has any linked Inquiry (a concern raised
    // before termination, or the termination ticket itself) — per the
    // request, drives the new "IR" column. Skipped for the Export flow,
    // which never uses this data — reading the entire Inquiries sheet on
    // every export was pure wasted overhead.
    var inquiryByConnId = {};
    if (!filters.forExport) {
      try {
        var iqSheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
        if (iqSheet) {
          var iqd = iqSheet.getDataRange().getValues();
          var iqh = {}; iqd[0].forEach(function(c,idx){ if(c) iqh[String(c)]=idx; });
          if (iqh['RelatedConnectionID'] !== undefined) {
            for (var iqi = 1; iqi < iqd.length; iqi++) {
              var iqConnId = String(iqd[iqi][iqh['RelatedConnectionID']]||''); if (!iqConnId) continue;
              inquiryByConnId[iqConnId] = (inquiryByConnId[iqConnId] || 0) + 1;
            }
          }
        }
      } catch (iqEx) { Logger.log('getActiveVAConnections inquiry lookup: ' + iqEx.message); }
    }

    // Scope the Export flow to a CS Specialist's own customers, per the
    // request ("their VA connections") — every other role/caller
    // continues to see everything, unchanged. Built once here rather
    // than per-row, and checked inline in the main loop below.
    var myVisibleCustomerIdsForExport = null;
    if (filters.forExport) {
      var exportUser = getCurrentUser();
      if (exportUser && !exportUser.error && exportUser.role === CONFIG.ROLES.CS_SPECIALIST) {
        myVisibleCustomerIdsForExport = {};
        var myEmailForExport = (exportUser.email||'').toLowerCase().trim();
        try {
          var custSheetForExport = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
          if (custSheetForExport) {
            var custDataForExport = custSheetForExport.getDataRange().getValues();
            var custHForExport = _connHMap(custDataForExport[0]);
            for (var cei = 1; cei < custDataForExport.length; cei++) {
              var ceCustId = String(custDataForExport[cei][custHForExport['CustomerID']]||'').trim(); if (!ceCustId) continue;
              var ceSpec = custHForExport['AssignedSpecialist'] !== undefined ? String(custDataForExport[cei][custHForExport['AssignedSpecialist']]||'').toLowerCase().trim() : '';
              if (ceSpec === myEmailForExport) myVisibleCustomerIdsForExport[ceCustId] = true;
            }
          }
          getTakeoverCustomerIdsForSpecialist(myEmailForExport).forEach(function(cid){ myVisibleCustomerIdsForExport[cid] = true; });
        } catch (scopeEx) { Logger.log('getActiveVAConnections export scoping: ' + scopeEx.message); }
      }
    }

    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['ConnectionID']]) continue;
      var rec = _mapConnRow(r, h, includeRate);
      var rl2=reqLookup[rec.requestId]||{};
      rec.department=rl2.department||'';
      rec.service=rl2.service||'';
      rec.requestType=rl2.requestType||'';
      // Self-heal a blank/stale ClientID or CustomerID on the connection
      // itself, using its originating request's values instead — an
      // older data gap, same pattern as other backfill fixes this
      // session. Only kicks in when the connection's own field is
      // actually missing; a connection with its own valid ClientID is
      // never overridden even if it happens to differ from the request
      // (e.g. after a Change VA that intentionally re-pointed it).
      if (!rec.clientId && rl2.clientId) rec.clientId = rl2.clientId;
      if (!rec.customerId && rl2.customerId) rec.customerId = rl2.customerId;

      // VA Connections module shows Started connections by default
      // End of Contract = Cancelled Non-Regular connections (ConnectionType
      // renamed from "Project Based" to "Non-Regular" — per the request)
      if (filters.status === 'End of Contract') {
        if (rec.connectionStatus !== 'Cancelled' || rec.connectionType !== 'Non-Regular') continue;
      } else if (filters.status) {
        if (rec.connectionStatus !== filters.status) continue;
      } else {
        // "All" tab (no explicit status filter) — per the request,
        // Pending/Accepted/Declined aren't their own dedicated tabs and
        // shouldn't show up here either, since they're still mid-workflow
        // rather than an actual VA connection outcome.
        if (rec.connectionStatus === 'Pending' || rec.connectionStatus === 'Accepted' || rec.connectionStatus === 'Declined') continue;
      }
      if (filters.clientId   && rec.clientId   !== filters.clientId)   continue;
      if (filters.customerId && rec.customerId !== filters.customerId) continue;
      if (myVisibleCustomerIdsForExport && !myVisibleCustomerIdsForExport[rec.customerId]) continue;

      // Enrich with names
      var cli  = cliLookup[rec.clientId]   || {};
      var cust = custLookup[rec.customerId] || '';
      rec.companyName  = cli.company  || rec.clientId;
      rec.accountName  = cli.account  || '';
      rec.customerName = cust         || rec.customerId;
      rec.csAssignedEmail = csAssignedByCustomerId[rec.customerId] || '';
      rec.hasInquiry = !!inquiryByConnId[rec.connectionId];
      rec.inquiryCount = inquiryByConnId[rec.connectionId] || 0;

      rows.push(rec);
    }

    rows.sort(function (a, b) { return new Date(b.actualStartDate || b.assignedAt || 0) - new Date(a.actualStartDate || a.assignedAt || 0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getActiveVAConnections: ' + e.message };
  }
}

// ── HR Rate Assignment page data — ALL VA Connections (any status), with
// Rate info and a needsRate flag, restricted to Administrator/HR Specialist/
// HR Manager. Unlike getActiveVAConnections (which defaults to Started-only
// and is used by the general VA Connections module), this deliberately
// returns every connection regardless of status, since HR needs to see the
// full picture of what does/doesn't have a rate yet — including connections
// still Pending or Accepted (not yet Started).
// For the VA Database's profile modal — every connection a VA has ever
// had, with readable Customer/Account names (not just raw IDs). No rate
// data included and deliberately NOT rate-gated: this should be visible
// to anyone who can see the VA Database page at all, unlike
// getVAConnectionsForRateAssignment below.
function getVAConnectionsForVAProfile(vaId) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _connHMap(data[0]);

    var cliLookup = {}, custLookup = {};
    try {
      var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet) {
        var cd = cliSheet.getDataRange().getValues();
        var ch = _connHMap(cd[0]);
        for (var ci = 1; ci < cd.length; ci++) {
          if (cd[ci][ch['ClientID']]) cliLookup[String(cd[ci][ch['ClientID']])] = { company: String(cd[ci][ch['CompanyName']]||''), account: String(cd[ci][ch['AccountName']]||'') };
        }
      }
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var custd = custSheet.getDataRange().getValues();
        var cush  = _connHMap(custd[0]);
        for (var cui = 1; cui < custd.length; cui++) {
          if (custd[cui][cush['CustomerID']]) custLookup[String(custd[cui][cush['CustomerID']])] = String(custd[cui][cush['CustomerName']]||'');
        }
      }
    } catch (ex) { Logger.log('getVAConnectionsForVAProfile lookup: ' + ex.message); }

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['ConnectionID']]) continue;
      if (String(r[h['VAID']]) !== String(vaId)) continue;
      var rec = _mapConnRow(r, h, false); // includeRate=false — no compensation data here
      var cli  = cliLookup[rec.clientId]    || {};
      var cust = custLookup[rec.customerId] || '';
      rec.accountName  = cli.account || '';
      rec.customerName = cust        || rec.customerId;
      rows.push(rec);
    }
    rows.sort(function (a, b) { return new Date(b.assignedAt || 0) - new Date(a.assignedAt || 0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getVAConnectionsForVAProfile: ' + e.message };
  }
}

function getVAConnectionsForRateAssignment() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (!_canSeeVARate(user.role)) return { success: false, error: 'This page is only available to CS Managers, HR Specialists, HR Managers, and Administrators.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _connHMap(data[0]);

    // Client/customer name lookups — same pattern as getActiveVAConnections
    var cliLookup = {}, custLookup = {};
    try {
      var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliSheet) {
        var cd = cliSheet.getDataRange().getValues();
        var ch = _connHMap(cd[0]);
        for (var ci = 1; ci < cd.length; ci++) {
          if (cd[ci][ch['ClientID']]) cliLookup[String(cd[ci][ch['ClientID']])] = { company: String(cd[ci][ch['CompanyName']]||''), account: String(cd[ci][ch['AccountName']]||'') };
        }
      }
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var custd = custSheet.getDataRange().getValues();
        var cush  = _connHMap(custd[0]);
        for (var cui = 1; cui < custd.length; cui++) {
          if (custd[cui][cush['CustomerID']]) custLookup[String(custd[cui][cush['CustomerID']])] = String(custd[cui][cush['CustomerName']]||'');
        }
      }
    } catch (ex) { Logger.log('getVAConnectionsForRateAssignment lookup: ' + ex.message); }

    // Department/Service — lives on the request, not the connection itself.
    var deptByRequest = {}, serviceByRequest = {};
    try {
      var reqSheetForRate = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
      if (reqSheetForRate) {
        var reqDataForRate = reqSheetForRate.getDataRange().getValues();
        var reqHForRate = _connHMap(reqDataForRate[0]);
        for (var rri = 1; rri < reqDataForRate.length; rri++) {
          var rriId = String(reqDataForRate[rri][reqHForRate['RequestID']]||''); if (!rriId) continue;
          deptByRequest[rriId]    = String(reqDataForRate[rri][reqHForRate['Department']]||'');
          serviceByRequest[rriId] = String(reqDataForRate[rri][reqHForRate['Service']]||'');
        }
      }
    } catch (deptEx) { Logger.log('getVAConnectionsForRateAssignment dept lookup: ' + deptEx.message); }

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['ConnectionID']]) continue;
      var rec = _mapConnRow(r, h, true); // includeRate=true — this function is HR/Admin-only, already gated above
      var cli  = cliLookup[rec.clientId]    || {};
      var cust = custLookup[rec.customerId] || '';
      rec.companyName  = cli.company || rec.clientId;
      rec.accountName  = cli.account || '';
      rec.customerName = cust        || rec.customerId;
      rec.department   = deptByRequest[rec.requestId]    || '';
      rec.service      = serviceByRequest[rec.requestId] || '';
      // Cancelled/Declined connections never went anywhere — not a gap worth flagging
      rec.needsRate = (!(rec.rate > 0)) && rec.connectionStatus !== 'Cancelled' && rec.connectionStatus !== 'Declined';
      rows.push(rec);
    }
    rows.sort(function (a, b) { return new Date(b.assignedAt || 0) - new Date(a.assignedAt || 0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getVAConnectionsForRateAssignment: ' + e.message };
  }
}

// ── Terminate a VA connection
// Shared by pauseVAConnection and terminateVAConnection. Counts remaining
// Started connections for the account and customer (excluding the one just
// acted on) and, if none remain, automatically pauses whichever of them
// were still Active — a customer/account sitting Active with zero active
// VAs would immediately violate the Account/Customer Status Consistency
// audit check. Pause (not Terminate) is the default here specifically so
// it's the reversible, lower-stakes action; the frontend follows up with an
// optional prompt to escalate to Terminated instead.
function _checkAndCascadeLastActiveConnection(data, h, excludeConnectionId, clientId, customerId, user, connNewStatus) {
  var isLastForClient = false, isLastForCustomer = false;
  if (!clientId && !customerId) return { isLastForClient: false, isLastForCustomer: false, clientPaused: false, customerPaused: false, offerChoice: false };

  var clientStartedCount = 0, customerStartedCount = 0;
  for (var k = 1; k < data.length; k++) {
    if (String(data[k][h['ConnectionID']]) === excludeConnectionId) continue;
    if (String(data[k][h['ConnectionStatus']] || '') !== CONFIG.VA_CONNECTION_STATUS.STARTED) continue;
    var kClient   = String(data[k][h['ClientID']]   || '');
    var kCustomer = String(data[k][h['CustomerID']] || '');
    if (clientId   && kClient   === clientId)   clientStartedCount++;
    if (customerId && kCustomer === customerId) customerStartedCount++;
  }
  isLastForClient   = clientId   ? (clientStartedCount === 0)   : false;
  isLastForCustomer = customerId ? (customerStartedCount === 0) : false;

  var clientPaused = false, customerPaused = false;
  var isLastAnywhere = isLastForClient || isLastForCustomer;

  // Terminated (the connection's own new status, not what happens to the
  // account/customer) doesn't auto-cascade — it just reports back what's
  // now eligible, per the request that this specific case should be an
  // offered choice (Pause or Terminate), not an automatic action. Paused
  // (and everything else — Cancelled, etc.) keeps the original
  // auto-cascade-to-Paused behavior unchanged.
  if (connNewStatus === CONFIG.VA_CONNECTION_STATUS.TERMINATED) {
    return { isLastForClient: isLastForClient, isLastForCustomer: isLastForCustomer, clientPaused: false, customerPaused: false, offerChoice: isLastAnywhere };
  }

  try {
    if (isLastForClient && clientId) {
      var cliRes = getClientById(clientId);
      if (cliRes.success && cliRes.data.status === 'Active') {
        var cliUpd = updateClient(clientId, { status: CONFIG.STATUS.PAUSED });
        clientPaused = !!(cliUpd && cliUpd.success);
      }
    }
    if (isLastForCustomer && customerId) {
      var custRes = getCustomerById(customerId);
      if (custRes.success && custRes.data.status === 'Active') {
        var custUpd = updateCustomer(customerId, { status: CONFIG.STATUS.PAUSED });
        customerPaused = !!(custUpd && custUpd.success);
      }
    }
  } catch (cascadeEx) {
    Logger.log('_checkAndCascadeLastActiveConnection: ' + cascadeEx.message);
  }

  return { isLastForClient: isLastForClient, isLastForCustomer: isLastForCustomer, clientPaused: clientPaused, customerPaused: customerPaused, offerChoice: false };
}

// Administrator/CS Manager only — corrects a wrong termination date on
// an already-terminated connection, without needing to reverse and redo
// the whole termination flow.
function updateVAConnectionTerminationDate(connectionId, newDate) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR && user.role !== CONFIG.ROLES.CS_MANAGER) {
      return { success: false, error: 'Only Administrators or CS Managers can edit the termination date.' };
    }
    var parsedDate = _safeParseDateNoon(newDate);
    if (!newDate || isNaN(parsedDate.getTime())) return { success: false, error: 'Invalid date.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _connHMap(data[0]);
    if (h['TerminationDate'] === undefined) return { success: false, error: 'TerminationDate column not found.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      if (String(data[i][h['ConnectionStatus']]||'') !== CONFIG.VA_CONNECTION_STATUS.TERMINATED) {
        return { success: false, error: 'This connection is not marked Terminated.' };
      }
      var rowNum = i + 1;
      var oldDate = data[i][h['TerminationDate']];
      var oldDateStr = oldDate instanceof Date ? oldDate.toISOString() : String(oldDate||'');
      sheet.getRange(rowNum, h['TerminationDate']+1).setValue(parsedDate);
      sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(user.email);
      _writeLog('VAConnection', connectionId, 'UPDATE', 'TerminationDate', oldDateStr, parsedDate.toISOString(), user);
      return { success: true };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'updateVAConnectionTerminationDate: ' + e.message };
  }
}

// Edits the termination reason after the fact, per the request — same
// restriction and structure as updateVAConnectionTerminationDate above.
function updateVAConnectionTerminationReason(connectionId, newReason) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR && user.role !== CONFIG.ROLES.CS_MANAGER) {
      return { success: false, error: 'Only Administrators or CS Managers can edit the termination reason.' };
    }
    newReason = (newReason || '').trim();
    if (!newReason) return { success: false, error: 'A reason is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _connHMap(data[0]);
    if (h['TerminationReason'] === undefined) return { success: false, error: 'TerminationReason column not found.' };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      if (String(data[i][h['ConnectionStatus']]||'') !== CONFIG.VA_CONNECTION_STATUS.TERMINATED) {
        return { success: false, error: 'This connection is not marked Terminated.' };
      }
      var rowNum = i + 1;
      var oldReason = String(data[i][h['TerminationReason']]||'');
      sheet.getRange(rowNum, h['TerminationReason']+1).setValue(newReason);
      sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(user.email);
      _writeLog('VAConnection', connectionId, 'UPDATE', 'TerminationReason', oldReason, newReason, user);
      return { success: true };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'updateVAConnectionTerminationReason: ' + e.message };
  }
}

// One-time backfill, per the request — terminateVAConnection already
// correctly writes TerminationDate on every termination going forward,
// but any connection terminated before this logic existed would still
// have it blank. Uses UpdatedAt as the best available approximation of
// when the status was actually last changed, since that's set alongside
// ConnectionStatus on every write.
function backfillMissingTerminationDates() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can run this.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _connHMap(data[0]);
    if (h['TerminationDate'] === undefined) return { success: false, error: 'TerminationDate column missing.' };

    var fixed = 0;
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][h['ConnectionStatus']]||'');
      if (status !== CONFIG.VA_CONNECTION_STATUS.TERMINATED && status !== CONFIG.VA_CONNECTION_STATUS.CANCELLED) continue;
      if (data[i][h['TerminationDate']]) continue; // already has one
      var fallbackDate = data[i][h['UpdatedAt']] || data[i][h['CreatedAt']] || new Date();
      sheet.getRange(i + 1, h['TerminationDate'] + 1).setValue(fallbackDate);
      fixed++;
    }
    return { success: true, fixed: fixed };
  } catch (e) {
    return { success: false, error: 'backfillMissingTerminationDates: ' + e.message };
  }
}

// One-time backfill, per the request — the decline loop-back fix above
// only prevents this going forward; any request already stuck at a
// later stage with a declined VA and no other Pending/Accepted
// connection (like the one reported) needs this to actually get
// unstuck. Reuses the exact same safe check as the live fix.
function backfillStuckRequestsMissingVA() {
  try {
    // No in-app permission gate — meant to be run directly from the
    // Apps Script editor, where editor access already implies full
    // trust. A checkPermission('manageSettings') gate here would fail
    // silently (returning an error with nothing processed) for whoever
    // runs it if their account isn't separately registered as
    // Administrator in the app's own Users sheet.
    var backfillUser = getCurrentUser();
    if (!backfillUser || backfillUser.error) return { success: false, error: 'Could not identify the running user.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var reqSheet = _wfGetReqSheet(ss);
    var reqData = reqSheet.getDataRange().getValues();
    var reqH = _reqHMap(reqData[0]);
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var connH = _connHMap(connData[0]);

    var STAGE_ORDER = ['Request Intake','Management Approval','VA Assignment','Recruitment - Sourcing','Training','VA Preparation & Mock Interview','Payment Confirmation','Rate Agreement','Kick Off Call','VA-Client Connection Call','Start VA','Completed'];
    var vaAssignmentIdx = STAGE_ORDER.indexOf('VA Assignment');

    // Group connections by RequestID once, rather than re-scanning the
    // full sheet per request.
    var connsByRequest = {};
    for (var ci = 1; ci < connData.length; ci++) {
      var crReqId = String(connData[ci][connH['RequestID']]||''); if (!crReqId) continue;
      if (!connsByRequest[crReqId]) connsByRequest[crReqId] = [];
      connsByRequest[crReqId].push(String(connData[ci][connH['ConnectionStatus']]||''));
    }

    var fixed = 0, fixedRequestIds = [], errors = [];
    for (var ri = 1; ri < reqData.length; ri++) {
      try {
        var reqId = String(reqData[ri][reqH['RequestID']]||''); if (!reqId) continue;
        var status = String(reqData[ri][reqH['Status']]||'');
        if (status === 'Closed - Won' || status === 'Closed - Lost') continue; // already resolved — leave alone

        var stage = String(reqData[ri][reqH['CurrentStage']]||'');
        var stageIdx = STAGE_ORDER.indexOf(stage);
        if (stageIdx <= vaAssignmentIdx) continue; // not past VA Assignment

        var statuses = connsByRequest[reqId] || [];
        if (!statuses.length) continue; // no connections at all — a different, separate concern
        var hasActiveConn = statuses.some(function(s){ return s === 'Pending' || s === 'Accepted'; });
        if (hasActiveConn) continue; // genuinely fine — still has a live candidate

        _wfAdvance(reqId, 'VA_ASSIGNMENT', backfillUser, 'Backfill — request was stuck at ' + stage + ' with no VA still Pending/Accepted; looped back to VA Assignment.', true);
        fixed++;
        fixedRequestIds.push(reqId);
      } catch (perRequestEx) {
        errors.push({ row: ri + 1, error: perRequestEx.message });
      }
    }
    return { success: true, fixed: fixed, requestIds: fixedRequestIds, errors: errors };
  } catch (e) {
    return { success: false, error: 'backfillStuckRequestsMissingVA: ' + e.message };
  }
}

// Per fixing a genuine timezone bug — "new Date('YYYY-MM-DD')" parses as
// UTC midnight, which can silently display as the day before once
// serialized to the frontend and rendered in a browser whose local
// timezone is behind UTC. Anchoring at noon eliminates this regardless
// of which side (script or browser) the timezone difference is on.
function _safeParseDateNoon(input) {
  if (!input) return new Date();
  if (input instanceof Date) return input;
  var parts = String(input).split(/[-T]/).slice(0, 3);
  if (parts.length !== 3) return new Date(input);
  var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return new Date(input);
  // Real bug fixed here: this used to build "noon" in the SCRIPT's timezone (new Date(y, m-1, d, 12)),
  // but the sheet DISPLAYS dates in the SPREADSHEET's timezone. When the two differ (e.g. a script set to a
  // US timezone, a spreadsheet in Manila) noon in one is already the NEXT day in the other — so a date
  // entered as Oct 15 showed up in the sheet as Oct 16. Noon UTC is the same calendar day everywhere from
  // UTC-11 to UTC+11, whatever the script, spreadsheet or browser timezone is.
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

// The calendar day ('yyyy-MM-dd') a date value refers to. A date-only string is taken exactly as written
// (no timezone shifting); a real Date is read in the given timezone. '' if it can't be understood.
// For a date that comes from a form. A date-only string ('YYYY-MM-DD') is stored as noon UTC — see
// _safeParseDateNoon — instead of new Date('YYYY-MM-DD'), which is MIDNIGHT UTC and so shows as the previous
// day in any spreadsheet that is behind UTC. Anything carrying a time (or already a Date) is left exactly as
// given, so timestamps keep their time.
function _parseDateInput(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return _safeParseDateNoon(input.trim());
  return new Date(input);
}

function _calendarDayString(v, tz) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(v);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function terminateVAConnection(connectionId, terminationDate, reason, replacedByVAId, explicitResult, bypassSMRestriction) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (terminationDate) {
      // Real bug fixed here: this compared new Date('YYYY-MM-DD') — which JavaScript reads as MIDNIGHT UTC —
      // against the current moment. For anyone ahead of UTC (e.g. Philippine time, UTC+8), "today" is still
      // in the future until 8 AM, so terminating a VA with today's date was refused as a "future date".
      // Dates are now compared as calendar DAYS in the spreadsheet's timezone. One day of tolerance is
      // allowed on top of that, because the date picker uses the user's own local date, which can legitimately
      // be a day ahead of (or behind) the spreadsheet's timezone; anything further ahead is still refused.
      var tzForCheck = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      var termDayForCheck = _calendarDayString(terminationDate, tzForCheck);
      var latestAllowedDay = Utilities.formatDate(new Date(new Date().getTime() + 86400000), tzForCheck, 'yyyy-MM-dd');
      if (termDayForCheck && termDayForCheck > latestAllowedDay) {
        return { success: false, error: 'Termination date (' + termDayForCheck + ') cannot be in the future.' };
      }
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rowNum  = i + 1;
      var now     = new Date();
      var termDate = _safeParseDateNoon(terminationDate);
      // Per the request — TerminationDate must always be saved. A missing date already defaults to
      // today (_safeParseDateNoon); an unparseable one used to be written through as an invalid
      // value, so it's rejected here, before anything on the connection is touched.
      if (!termDate || isNaN(termDate.getTime())) return { success: false, error: 'A valid termination date is required.' };
      var priorStatus = String(data[i][h['ConnectionStatus']]||'');

      // A Service Manager's termination only requests it — the CS
      // Assigned (or CS Manager/Administrator) still needs to actually
      // terminate it. ConnectionStatus is never touched here; only the
      // pending-request fields are, so the connection stays exactly as
      // it was until someone with full authority acts on it.
      //
      // bypassSMRestriction skips this entirely — used only when this is
      // called from a source that already represents a final decision
      // on its own (e.g. a termination ticket closed as Pushed Through,
      // after its own clearance process), not a casual click on the
      // main Terminate button that should still be downgraded to a
      // request for a Service Manager.
      if (perm.user.role === CONFIG.ROLES.SERVICE_MANAGER && !bypassSMRestriction) {
        if (h['TerminationRequestedBy'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedBy']+1).setValue(perm.user.email);
        if (h['TerminationRequestedAt'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedAt']+1).setValue(now);
        if (h['TerminationRequestedDate'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedDate']+1).setValue(termDate);
        if (h['TerminationRequestReason'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestReason']+1).setValue(reason || '');
        sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(now);
        sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(perm.user.email);
        _writeLog('VAConnection', connectionId, 'TERMINATION_REQUESTED', '', '', reason || '', perm.user, termDate);
        return { success: true, requiresApproval: true, connectionId: connectionId };
      }

      // Explicit choice from the Terminate modal wins when given; otherwise
      // fall back to the automatic default — Started becomes Terminated,
      // anything else (never got underway) becomes Cancelled.
      var newStatus = (explicitResult === CONFIG.VA_CONNECTION_STATUS.TERMINATED || explicitResult === CONFIG.VA_CONNECTION_STATUS.CANCELLED)
        ? explicitResult
        : ((priorStatus === CONFIG.VA_CONNECTION_STATUS.STARTED)
            ? CONFIG.VA_CONNECTION_STATUS.TERMINATED
            : CONFIG.VA_CONNECTION_STATUS.CANCELLED);

      var clientId   = String(data[i][h['ClientID']]   || '');
      var customerId = String(data[i][h['CustomerID']] || '');

      sheet.getRange(rowNum, h['ConnectionStatus']    + 1).setValue(newStatus);
      if (h['TerminationDate']       !== undefined) sheet.getRange(rowNum, h['TerminationDate']       + 1).setValue(termDate);
      if (h['TerminationReason']     !== undefined) sheet.getRange(rowNum, h['TerminationReason']     + 1).setValue(reason || '');
      if (h['ReplacedByConnectionID']!== undefined && replacedByVAId) sheet.getRange(rowNum, h['ReplacedByConnectionID'] + 1).setValue(replacedByVAId);
      // This is now actually being actioned — clear any pending request
      // that led here, rather than leaving a stale request sitting
      // alongside an already-terminated connection.
      if (h['TerminationRequestedBy'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedBy']+1).setValue('');
      if (h['TerminationRequestedAt'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedAt']+1).setValue('');
      if (h['TerminationRequestedDate'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedDate']+1).setValue('');
      if (h['TerminationRequestReason'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestReason']+1).setValue('');
      sheet.getRange(rowNum, h['UpdatedAt']  + 1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy']  + 1).setValue(perm.user.email);

      SpreadsheetApp.flush();
      // Belt and braces: confirm the date actually landed in the cell, and write it again if not.
      if (h['TerminationDate'] !== undefined && !sheet.getRange(rowNum, h['TerminationDate'] + 1).getValue()) {
        sheet.getRange(rowNum, h['TerminationDate'] + 1).setValue(termDate);
      }
      _writeLog('VAConnection', connectionId, 'UPDATE', 'ConnectionStatus',
        priorStatus, newStatus, perm.user, termDate);
      if (reason) _writeLog('VAConnection', connectionId, 'UPDATE', 'TerminationReason', '', reason, perm.user, termDate);

      // Cascade check — only meaningful when the connection had actually
      // Started (a Cancelled-instead-of-Terminated connection was never
      // really "active" in the first place, so there's nothing to cascade).
      var cascade = (priorStatus === CONFIG.VA_CONNECTION_STATUS.STARTED)
        ? _checkAndCascadeLastActiveConnection(data, h, connectionId, clientId, customerId, perm.user, newStatus)
        : { isLastForClient: false, isLastForCustomer: false, clientPaused: false, customerPaused: false, offerChoice: false };

      return {
        success: true, newStatus: newStatus, clientId: clientId, customerId: customerId,
        isLastForClient: cascade.isLastForClient, isLastForCustomer: cascade.isLastForCustomer,
        clientPaused: cascade.clientPaused, customerPaused: cascade.customerPaused, offerChoice: cascade.offerChoice
      };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'terminateVAConnection: ' + e.message };
  }
}

// ── Pause a VA connection
function pauseVAConnection(connectionId, pauseDateStr) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _connHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rowNum    = i + 1;
      var oldStatus = String(data[i][h['ConnectionStatus']] || '');
      var newStatus = oldStatus === 'Paused' ? 'Started' : 'Paused'; // toggle
      var now       = new Date();

      // Use the caller-supplied pause date when pausing; use now for resume.
      // This lets the CS backdate a pause to the actual date it happened.
      var eventDate = now;
      if (newStatus === 'Paused' && pauseDateStr) {
        var pd = new Date(pauseDateStr);
        if (!isNaN(pd.getTime())) eventDate = pd;
      }

      sheet.getRange(rowNum, h['ConnectionStatus'] + 1).setValue(newStatus);
      sheet.getRange(rowNum, h['UpdatedAt']        + 1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy']        + 1).setValue(perm.user.email);

      // Resuming is also "changed to Started" — same safe guard as
      // updateVAConnectionStatus's initial-Start path, per the request.
      if (newStatus === 'Started' && h['PayrollStatus'] !== undefined && !String(data[i][h['PayrollStatus']]||'').trim()) {
        sheet.getRange(rowNum, h['PayrollStatus'] + 1).setValue('Not Yet Added');
      }

      // Generate the account's meeting schedule too, if it somehow never
      // got one — generateMeetingsForAccount already guards against
      // duplicates, so this is a safety net, not a re-trigger for
      // accounts that already have one. Anchored to the connection's
      // original ActualStartDate, not the resume date, so the cadence
      // isn't shifted by a pause/resume cycle.
      if (newStatus === 'Started') {
        try {
          var clientIdForResumeMeetings = String(data[i][h['ClientID']]||'');
          var customerIdForResumeMeetings = String(data[i][h['CustomerID']]||'');
          var requestIdForResumeMeetings = String(data[i][h['RequestID']]||'');
          var origStartRaw = data[i][h['ActualStartDate']];
          var origStartDate = origStartRaw ? (origStartRaw instanceof Date ? origStartRaw : new Date(origStartRaw)) : now;
          if (isNaN(origStartDate.getTime())) origStartDate = now;
          var activeIdsForResumeMeetings = _getActiveConnectionIdsForClient(clientIdForResumeMeetings);
          generateMeetingsForAccount(clientIdForResumeMeetings, customerIdForResumeMeetings,
            connectionId, requestIdForResumeMeetings, origStartDate, activeIdsForResumeMeetings);
          _syncActiveVAsOnUpcomingMeetings(clientIdForResumeMeetings);
        } catch (resumeMeetErr) { Logger.log('generateMeetingsForAccount (on resume): ' + resumeMeetErr.message); }

        // Per the request — the request itself should carry the started
        // VA's name too, not just the connection record.
        try {
          var vaNameForAssigned = String(data[i][h['VAName']]||'');
          var requestIdForAssigned = String(data[i][h['RequestID']]||'');
          if (vaNameForAssigned && requestIdForAssigned) {
            var reqSheetForAssigned = _wfGetReqSheet(ss);
            var reqDataForAssigned = reqSheetForAssigned.getDataRange().getValues();
            var reqHForAssigned = _reqHMap(reqDataForAssigned[0]);
            if (reqHForAssigned['AssignedVA'] !== undefined) {
              for (var rai = 1; rai < reqDataForAssigned.length; rai++) {
                if (String(reqDataForAssigned[rai][reqHForAssigned['RequestID']]||'') !== requestIdForAssigned) continue;
                reqSheetForAssigned.getRange(rai+1, reqHForAssigned['AssignedVA']+1).setValue(vaNameForAssigned);
                break;
              }
            }
          }
        } catch (assignedVAErr) { Logger.log('updateVAConnectionStatus AssignedVA write: ' + assignedVAErr.message); }

        // Per the request — the account only becomes Active once a VA
        // connection under it has actually Started (not merely been
        // accepted/assigned). Cascades to the parent Customer too, via
        // the same existing mechanism used elsewhere for Customer status
        // consistency — both changes are logged.
        try {
          if (clientIdForResumeMeetings) {
            var cliSheetForActivate = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
            var cliDataForActivate = cliSheetForActivate.getDataRange().getValues();
            var clhForActivate = {}; cliDataForActivate[0].forEach(function(c,idx){ if(c) clhForActivate[String(c)]=idx; });
            for (var cai = 1; cai < cliDataForActivate.length; cai++) {
              if (String(cliDataForActivate[cai][clhForActivate['ClientID']]||'') !== clientIdForResumeMeetings) continue;
              var currentCliStatus = String(cliDataForActivate[cai][clhForActivate['Status']]||'');
              if (currentCliStatus !== 'Active') {
                cliSheetForActivate.getRange(cai+1, clhForActivate['Status']+1).setValue('Active');
                if (clhForActivate['StatusDate'] !== undefined) cliSheetForActivate.getRange(cai+1, clhForActivate['StatusDate']+1).setValue(now);
                if (clhForActivate['UpdatedAt'] !== undefined) cliSheetForActivate.getRange(cai+1, clhForActivate['UpdatedAt']+1).setValue(now);
                if (clhForActivate['UpdatedBy'] !== undefined) cliSheetForActivate.getRange(cai+1, clhForActivate['UpdatedBy']+1).setValue(perm.user.email);
                _writeLog('Client', clientIdForResumeMeetings, _classifyStatusChangeAction(currentCliStatus, 'Active'), 'Status', currentCliStatus, 'Active', perm.user);
                if (customerIdForResumeMeetings) _checkAndCascadeCustomerStatus(customerIdForResumeMeetings, perm.user);
              }
              break;
            }
          }
        } catch (activateErr) { Logger.log('updateVAConnectionStatus account activation: ' + activateErr.message); }
      }

      // Log the pause/resume event with the effective date
      var eventType = newStatus === 'Paused' ? 'Paused' : 'Resumed';
      _logVAConnectionPauseEvent(connectionId, eventType, eventDate, perm.user);
      var summaryCol = newStatus === 'Paused' ? 'LastPausedAt' : 'LastResumedAt';
      if (h[summaryCol] !== undefined) {
        sheet.getRange(rowNum, h[summaryCol] + 1).setValue(eventDate);
      }

      _writeLog('VAConnection', connectionId, 'UPDATE', 'ConnectionStatus', oldStatus, newStatus, perm.user, eventDate);

      // When pausing: check if this is the last Started connection for both
      // the account (clientId) and the customer (customerId) — if so,
      // they've already been auto-paused by the shared helper below; the
      // frontend follows up with an optional prompt to escalate to
      // Terminated instead of leaving them Paused.
      var clientId   = String(data[i][h['ClientID']]  || '');
      var customerId = String(data[i][h['CustomerID']] || '');
      var cascade = { isLastForClient: false, isLastForCustomer: false, clientPaused: false, customerPaused: false };
      if (newStatus === 'Paused') {
        cascade = _checkAndCascadeLastActiveConnection(data, h, connectionId, clientId, customerId, perm.user);
      }

      return {
        success: true, newStatus: newStatus,
        clientId: clientId, customerId: customerId,
        isLastForClient: cascade.isLastForClient, isLastForCustomer: cascade.isLastForCustomer,
        clientPaused: cascade.clientPaused, customerPaused: cascade.customerPaused
      };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'pauseVAConnection: ' + e.message };
  }
}

function _logVAConnectionPauseEvent(connectionId, eventType, eventDate, user) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, CONFIG.SHEETS.VA_CONNECTION_PAUSE_LOG, CONFIG.SCHEMA.VAConnectionPauseLog);
    sheet.appendRow([
      generateID('PAU'), connectionId, eventType, eventDate,
      user ? user.email : '', new Date()
    ]);
  } catch (e) {
    Logger.log('_logVAConnectionPauseEvent: ' + e.message);
  }
}

// Full pause/resume history for one connection, most recent first —
// powers the "Pause History" list on the VA Connection profile/modal.
function getVAConnectionPauseLog(connectionId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTION_PAUSE_LOG);
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      rows.push({
        logId:     String(data[i][h['LogID']]||''),
        eventType: String(data[i][h['EventType']]||''),
        eventDate: _sd(data[i][h['EventDate']]),
        loggedBy:  String(data[i][h['LoggedBy']]||''),
        createdAt: _sd(data[i][h['CreatedAt']])
      });
    }
    rows.sort(function(a,b){ return new Date(b.eventDate||0) - new Date(a.eventDate||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getVAConnectionPauseLog: ' + e.message };
  }
}

// ── Get a single VA Connection by ID (for modal view)
function getVAConnectionById(connectionId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: false, error: 'Not found.' };
    var h = _connHMap(data[0]);
    var currentUser = getCurrentUser();
    var includeRate = currentUser && !currentUser.error && _canSeeVARate(currentUser.role);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      var rec = _mapConnRow(data[i], h, includeRate);
      // Enrich with client/customer names — customerName comes from the
      // cached column on the Client row itself (see CustomerName in
      // Code.gs's Clients schema), not a separate scan of the Customers
      // sheet — that row is already being read right here anyway.
      try {
        var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
        if (cliSheet && rec.clientId) {
          var cd = cliSheet.getDataRange().getValues();
          var ch = _connHMap(cd[0]);
          for (var j = 1; j < cd.length; j++) {
            if (String(cd[j][ch['ClientID']]) === rec.clientId) {
              rec.companyName = String(cd[j][ch['CompanyName']] || '');
              rec.accountName = String(cd[j][ch['AccountName']] || '');
              if (ch['CustomerName'] !== undefined) rec.customerName = String(cd[j][ch['CustomerName']] || '');
              break;
            }
          }
        }
        // Fallback for a deployment where the CustomerName cache hasn't
        // been backfilled yet (run backfillClientCustomerNames() once to
        // fix this properly) — only scans Customers if we still don't
        // have a name after checking the cache above.
        if (!rec.customerName) {
          var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
          if (custSheet && rec.customerId) {
            var custd = custSheet.getDataRange().getValues();
            var cush  = _connHMap(custd[0]);
            for (var k = 1; k < custd.length; k++) {
              if (String(custd[k][cush['CustomerID']]) === rec.customerId) {
                rec.customerName = String(custd[k][cush['CustomerName']] || '');
                break;
              }
            }
          }
        }
      } catch(ex) { Logger.log('enrich: ' + ex.message); }
      // Enrich with department/service from VARequests
      try {
        var reqSh3 = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
        if (reqSh3 && rec.requestId) {
          var reqD3 = reqSh3.getDataRange().getValues();
          var reqH3 = {}; reqD3[0].forEach(function(col,idx){ if(col) reqH3[String(col)]=idx; });
          for (var m3=1; m3<reqD3.length; m3++) {
            if (String(reqD3[m3][reqH3['RequestID']]||'') !== rec.requestId) continue;
            rec.department   = String(reqD3[m3][reqH3['Department']]  ||'');
            rec.service      = String(reqD3[m3][reqH3['Service']]     ||'');
            rec.requestType  = String(reqD3[m3][reqH3['RequestType']] ||'');
            rec.reqHours     = parseFloat(reqD3[m3][reqH3['Hours']]   ||'0')||0;
            rec.scheduleType = String(reqD3[m3][reqH3['ScheduleType']]||'');
            rec.scheduleDays = String(reqD3[m3][reqH3['ScheduleDays']]||'');
            rec.clientTimezone = reqH3['ClientTimezone'] !== undefined ? String(reqD3[m3][reqH3['ClientTimezone']]||'') : '';
            break;
          }
        }
      } catch(ex3) { Logger.log('dept enrich: '+ex3.message); }

      // CS Assigned — the customer's own assigned specialist, resolved to
      // a readable name via UserService's lookup (the Customers sheet
      // itself only stores the email). Used in place of Department/
      // Service in the modal header.
      try {
        if (rec.customerId) {
          var custSheetCS = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
          if (custSheetCS) {
            var custdCS = custSheetCS.getDataRange().getValues();
            var cushCS  = _connHMap(custdCS[0]);
            for (var csi = 1; csi < custdCS.length; csi++) {
              if (String(custdCS[csi][cushCS['CustomerID']]||'') !== rec.customerId) continue;
              var csEmail = cushCS['AssignedSpecialist'] !== undefined ? String(custdCS[csi][cushCS['AssignedSpecialist']]||'') : '';
              rec.csAssignedEmail = csEmail;
              break;
            }
          }
        }
      } catch (csEx) { Logger.log('CS Assigned enrich: ' + csEx.message); }

      // Current schedule state — from the connection's own hours-change
      // history (VAConnectionHoursLog), which is now the PRIMARY source for
      // scheduleType/hoursType/requiredPHTime too, not just the day
      // breakdown. Hours and schedule can change after assignment, so the
      // log reflects what's actually in effect now; the original request
      // (read above) is only used as a fallback for whichever of these
      // fields the log doesn't have anything for.
      try {
        var curSchedResult = getVAConnectionCurrentSchedule(connectionId);
        if (curSchedResult.success) {
          if (curSchedResult.breakdown) rec.hoursBreakdown = JSON.stringify(curSchedResult.breakdown);
          if (curSchedResult.scheduleType)   rec.scheduleType   = curSchedResult.scheduleType;
          if (curSchedResult.requiredPHTime) rec.requiredPHTime = curSchedResult.requiredPHTime;
          if (curSchedResult.requiredClientTime) rec.requiredClientTime = curSchedResult.requiredClientTime;
          // rec.hours was previously left at its stale, separately-cached
          // value from the VAConnections sheet, which could drift out of
          // sync with hoursType (e.g. a stale total paired with a type it
          // no longer matched) and get double-counted on display.
          // weeklyHours is already correctly derived from the actual
          // current breakdown, so it's used directly, with hoursType
          // forced to 'Weekly' since this is now definitively a weekly
          // total, not a per-day value.
          if (curSchedResult.weeklyHours !== undefined && curSchedResult.weeklyHours !== null && curSchedResult.weeklyHours !== '') {
            rec.hours = curSchedResult.weeklyHours;
            rec.hoursType = 'Weekly';
          } else if (curSchedResult.hoursType) {
            rec.hoursType = curSchedResult.hoursType;
          }
        }
        rec.hoursType = rec.hoursType || '';
      } catch (ex4) {
        Logger.log('schedule enrich: ' + ex4.message);
      }

      // Fetch notes/thread
      var notesRes = getVAConnectionNotes(rec.requestId);
      rec.thread = (notesRes && notesRes.success) ? notesRes.data : [];
      return { success: true, data: rec };
    }
    return { success: false, error: 'Connection not found.' };
  } catch (e) {
    return { success: false, error: 'getVAConnectionById: ' + e.message };
  }
}

// ── Hours / Schedule Changes ──────────────────────────────────────────────

// Returns active VA connections with their current hours/schedule info,
// enriched with client and customer names for the picker.
function getConnectionsForHoursChange_(filters) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var ss        = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var cliSheet  = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);

    var cliMap = {}, custMap = {};
    if (cliSheet) {
      var cd = cliSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c,i){ if(c) ch[String(c).trim()]=i; });
      for (var ci = 1; ci < cd.length; ci++) {
        var cid = String(cd[ci][ch['ClientID']]||'');
        if (cid) cliMap[cid] = { company: String(cd[ci][ch['CompanyName']]||''), account: String(cd[ci][ch['AccountName']]||''), custId: String(cd[ci][ch['CustomerID']]||'') };
      }
    }
    if (custSheet) {
      var kd = custSheet.getDataRange().getValues();
      var kh = {}; kd[0].forEach(function(c,i){ if(c) kh[String(c).trim()]=i; });
      for (var ki = 1; ki < kd.length; ki++) {
        var kid = String(kd[ki][kh['CustomerID']]||'');
        if (!kid) continue;
        custMap[kid] = String(kd[ki][kh['CustomerName']]||'');
      }
    }

    // Bug fix: this used to call getVAConnectionCurrentSchedule() — which
    // re-reads the ENTIRE VAConnectionHoursLog sheet — once PER CONNECTION
    // in the loop below. With any real number of connections that's an
    // O(N×M) sheet scan that could run long enough to make every page using
    // this function (the Change Log, the Add Change modal, All Connections)
    // look permanently stuck loading. Reading the log once here and
    // indexing it by connection is the same data, computed once.
    var breakdownByConn = {}; // connectionId → latest {date, breakdown}
    try {
      var logSheet = ss.getSheetByName('VAConnectionHoursLog');
      if (logSheet) {
        var ld = logSheet.getDataRange().getValues();
        var lh = {}; ld[0].forEach(function(c,i){ if(c) lh[String(c)]=i; });
        for (var li = 1; li < ld.length; li++) {
          var ctype = String(ld[li][lh['ChangeType']]||'');
          if (ctype === 'Limited Period' || ctype === 'Project Hours Entry') continue;
          var lConnId = String(ld[li][lh['ConnectionID']]||''); if (!lConnId) continue;
          var breakdownRaw = lh['NewScheduleBreakdown'] !== undefined ? ld[li][lh['NewScheduleBreakdown']] : '';
          if (!breakdownRaw) continue;
          var effDate = ld[li][lh['EffectiveDate']];
          if (!breakdownByConn[lConnId] || new Date(effDate) > new Date(breakdownByConn[lConnId].date)) {
            breakdownByConn[lConnId] = { date: effDate, breakdown: breakdownRaw };
          }
        }
      }
    } catch (logEx) { Logger.log('getConnectionsForHoursChange_ log index: ' + logEx.message); }

    // Department/Service aren't stored on the connection itself — they
    // come from whichever Service Request the connection originated from.
    var deptByRequest = {}, serviceByRequest = {}, tzByRequest = {};
    // The account / customer each request belongs to — used when a connection's own
    // ClientID / CustomerID is blank (see the row loop below).
    var clientByRequest = {}, customerByRequest = {};
    try {
      var reqSheetDept = _reqGetSheet(ss);
      if (reqSheetDept) {
        var rdd = reqSheetDept.getDataRange().getValues();
        var rhd = {}; rdd[0].forEach(function(c,i){ if(c) rhd[String(c)]=i; });
        for (var rdi = 1; rdi < rdd.length; rdi++) {
          var rDeptReqId = String(rdd[rdi][rhd['RequestID']]||''); if (!rDeptReqId) continue;
          deptByRequest[rDeptReqId]    = String(rdd[rdi][rhd['Department']]||'');
          serviceByRequest[rDeptReqId] = String(rdd[rdi][rhd['Service']]||'');
          tzByRequest[rDeptReqId]      = rhd['ClientTimezone'] !== undefined ? String(rdd[rdi][rhd['ClientTimezone']]||'') : '';
          clientByRequest[rDeptReqId]   = rhd['ClientID']   !== undefined ? String(rdd[rdi][rhd['ClientID']]||'').trim()   : '';
          customerByRequest[rDeptReqId] = rhd['CustomerID'] !== undefined ? String(rdd[rdi][rhd['CustomerID']]||'').trim() : '';
        }
      }
    } catch (deptEx) { Logger.log('getConnectionsForHoursChange_ dept index: ' + deptEx.message); }

    var data = connSheet.getDataRange().getValues();
    var h    = _connHMap(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][h['ConnectionStatus']]||'').trim();
      // Cancelled/Declined connections never went anywhere — exclude those,
      // but otherwise show everything (Pending/Accepted included), not just
      // Started/Paused, so the "All Connections" view is actually complete.
      if (status === 'Cancelled' || status === 'Declined') continue;
      var connId   = String(data[i][h['ConnectionID']]||'');
      var reqIdForRow = String(data[i][h['RequestID']]||'');
      // Real bug fixed here: the account was taken ONLY from this connection row's own ClientID,
      // which is blank on some connections — so the VA showed no customer/account, and the
      // Add Hours / Schedule Change form (which lists accounts first, then their VAs) had no
      // account to pick and so never offered the VA. Falls back to the account/customer of the
      // Service Request the connection came from, which is always set.
      var clientId = String(data[i][h['ClientID']]||'').trim() || clientByRequest[reqIdForRow] || '';
      var cliInfo  = cliMap[clientId] || {};
      var custId   = cliInfo.custId || String(data[i][h['CustomerID']]||'').trim() || customerByRequest[reqIdForRow] || '';
      rows.push({
        connectionId:    connId,
        vaId:            String(data[i][h['VAID']]||''),
        vaName:          String(data[i][h['VAName']]||''),
        clientId:        clientId,
        customerId:      custId,
        companyName:     cliInfo.company || clientId,
        accountName:     cliInfo.account || '',
        customerName:    custMap[custId] || (h['CustomerName'] !== undefined ? String(data[i][h['CustomerName']]||'') : '') || custId,
        connectionStatus:status,
        connectionType:  String(data[i][h['ConnectionType']]||''),
        department:      deptByRequest[reqIdForRow] || '',
        service:         serviceByRequest[reqIdForRow] || '',
        clientTimezone:  tzByRequest[reqIdForRow] || '',
        hours:           String(data[i][h['Hours']]||''),
        hoursType:       String(data[i][h['HoursType']]||''),
        scheduleType:    '',
        scheduleDays:    '',
        hoursBreakdown:  breakdownByConn[connId] ? breakdownByConn[connId].breakdown : '',
        actualStartDate: String(data[i][h['ActualStartDate']]||'')
      });
    }
    // Sort by customer + VA name
    rows.sort(function(a,b){ return (a.customerName+a.vaName).localeCompare(b.customerName+b.vaName); });
    return { success: true, data: rows };
  } catch(e) {
    return { success: false, error: 'getConnectionsForHoursChange: ' + e.message };
  }
}

// Applies a hours/schedule/type change to a VA connection.
// Logs the before/after to VAConnectionHoursLog for audit trail.
// payload: { connectionId, newHours, newHoursType, newConnectionType,
//            newScheduleType, newScheduleDays, newScheduleNotes,
//            limitHours, limitFrom, limitTo, limitNotes, effectiveDate, notes }
// Marks a freshly-appended Hours/Schedule change log entry as Pending,
// per the new confirmation workflow — a CS Specialist's own change must
// be explicitly confirmed (or cancelled) before it actually takes
// effect. Set as a follow-up write after appendRow completes, rather
// than adding to appendRow's own argument list, since this sheet is
// explicitly position-sensitive (see the schema comment in Code.gs) and
// this avoids any risk of shifting existing columns.
// Per the request — EVERY row written to VAConnectionHoursLog goes through this. The row is built from the
// sheet's own header row, by column NAME, never by position: a fixed-position array silently puts values in the
// wrong columns the moment the sheet's column order differs from the code's (columns added later, inserted or
// moved by hand). Headers are matched trimmed. If the code writes a column the sheet doesn't have yet, that
// column is added at the end rather than the value being dropped.
function _hoursLogAppendByHeader(logSheet, values) {
  var lastCol = logSheet.getLastColumn();
  var hRow = logSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(c) { return String(c == null ? '' : c).trim(); });
  var h = {};
  hRow.forEach(function(c, i) { if (c && h[c] === undefined) h[c] = i; });
  var added = [];
  Object.keys(values).forEach(function(name) {
    if (h[name] === undefined) {
      var col = hRow.length + 1;
      logSheet.getRange(1, col).setValue(name);
      hRow.push(name); h[name] = col - 1; added.push(name);
    }
  });
  var row = new Array(hRow.length).fill('');
  Object.keys(values).forEach(function(name) {
    var v = values[name];
    row[h[name]] = (v === undefined || v === null) ? '' : v;
  });
  logSheet.appendRow(row);
  if (added.length) Logger.log('_hoursLogAppendByHeader: added missing column(s) to VAConnectionHoursLog: ' + added.join(', '));
  return { rowNumber: logSheet.getLastRow(), addedColumns: added };
}

function _hoursSetApplyStatusPending(logSheet, logId) {
  try {
    var lastRow = logSheet.getLastRow();
    var headerRow = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0];
    var lh = {}; headerRow.forEach(function(c,i){ if(c) lh[String(c).trim()]=i; });
    if (lh['ApplyStatus'] === undefined) return; // sheet not yet migrated — nothing to set
    logSheet.getRange(lastRow, lh['ApplyStatus']+1).setValue('Pending');
  } catch (e) {
    Logger.log('_hoursSetApplyStatusPending: ' + e.message);
  }
}
function _hoursSetApplyStatusApplied(logSheet, logId, byEmail) {
  try {
    var lastRow = logSheet.getLastRow();
    var headerRow = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0];
    var lh = {}; headerRow.forEach(function(c,i){ if(c) lh[String(c).trim()]=i; });
    if (lh['ApplyStatus'] === undefined) return; // sheet not yet migrated — nothing to set
    logSheet.getRange(lastRow, lh['ApplyStatus']+1).setValue('Applied');
    if (lh['AppliedAt'] !== undefined) logSheet.getRange(lastRow, lh['AppliedAt']+1).setValue(new Date());
    if (lh['AppliedBy'] !== undefined) logSheet.getRange(lastRow, lh['AppliedBy']+1).setValue(byEmail||'');
  } catch (e) {
    Logger.log('_hoursSetApplyStatusApplied: ' + e.message);
  }
}

function confirmHoursChange(logId) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!logId) return { success: false, error: 'Log ID is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!logSheet) return { success: false, error: 'Hours log not found.' };
    var logData = logSheet.getDataRange().getValues();
    var lh = {}; logData[0].forEach(function(c,i){ if(c) lh[String(c).trim()]=i; });
    if (lh['ApplyStatus'] === undefined) return { success: false, error: 'This spreadsheet hasn\'t been migrated for the new confirmation workflow yet.' };

    var rowIdx = -1;
    for (var li = 1; li < logData.length; li++) {
      if (String(logData[li][lh['LogID']]) === String(logId)) { rowIdx = li; break; }
    }
    if (rowIdx === -1) return { success: false, error: 'Log entry not found.' };

    var currentApplyStatus = String(logData[rowIdx][lh['ApplyStatus']]||'');
    if (currentApplyStatus === 'Cancelled') return { success: false, error: 'This change was already cancelled and cannot be confirmed.' };
    if (currentApplyStatus === 'Applied') return { success: false, error: 'This change was already confirmed.' };

    var connectionId = String(logData[rowIdx][lh['ConnectionID']]||'');
    var changeType    = String(logData[rowIdx][lh['ChangeType']]||'');

    // Per the request — only the "default" (Hours/Schedule Change) path
    // ever had a direct write to the connection's own row; Limited
    // Period and Project Hours Entry changes are already fully reflected
    // through the log itself once the hours-calculation engine
    // (_hoursBuildTimeline) reads this entry as no longer Pending, so
    // there's nothing further to apply for those here.
    if (changeType !== 'Limited Period' && changeType !== 'Project Hours Entry') {
      var connSheet = _connGetSheet(ss);
      var connData  = connSheet.getDataRange().getValues();
      var ch = _connHMap(connData[0]);
      for (var ci = 1; ci < connData.length; ci++) {
        if (String(connData[ci][ch['ConnectionID']]||'') !== connectionId) continue;
        var rowNum = ci + 1;
        var updates = {};
        var newHours          = lh['NewHours']          !== undefined ? logData[rowIdx][lh['NewHours']]          : '';
        var newHoursType      = lh['NewHoursType']      !== undefined ? logData[rowIdx][lh['NewHoursType']]      : '';
        var newConnectionType = lh['NewConnectionType'] !== undefined ? logData[rowIdx][lh['NewConnectionType']] : '';
        var newScheduleType   = lh['NewScheduleType']   !== undefined ? logData[rowIdx][lh['NewScheduleType']]   : '';
        var newScheduleDays   = lh['NewScheduleDays']   !== undefined ? logData[rowIdx][lh['NewScheduleDays']]   : '';
        if (newHours          !== '' && newHours          !== undefined) updates['Hours']          = newHours;
        if (newHoursType      !== '' && newHoursType      !== undefined) updates['HoursType']      = newHoursType;
        if (newConnectionType !== '' && newConnectionType !== undefined) updates['ConnectionType'] = newConnectionType;
        if (newScheduleType   !== '' && newScheduleType   !== undefined) updates['ScheduleType']   = newScheduleType;
        if (newScheduleDays   !== '' && newScheduleDays   !== undefined) updates['ScheduleDays']   = newScheduleDays;
        updates['UpdatedAt'] = new Date();
        updates['UpdatedBy'] = perm.user.email;
        Object.keys(updates).forEach(function(col) {
          if (ch[col] !== undefined) connSheet.getRange(rowNum, ch[col] + 1).setValue(updates[col]);
        });
        break;
      }
    }

    if (lh['ApplyStatus'] !== undefined) logSheet.getRange(rowIdx+1, lh['ApplyStatus']+1).setValue('Applied');
    if (lh['AppliedAt']   !== undefined) logSheet.getRange(rowIdx+1, lh['AppliedAt']+1).setValue(new Date());
    if (lh['AppliedBy']   !== undefined) logSheet.getRange(rowIdx+1, lh['AppliedBy']+1).setValue(perm.user.email);

    return { success: true };
  } catch (e) {
    return { success: false, error: 'confirmHoursChange: ' + e.message };
  }
}

function cancelHoursChange(logId, reason) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!logId) return { success: false, error: 'Log ID is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!logSheet) return { success: false, error: 'Hours log not found.' };
    var logData = logSheet.getDataRange().getValues();
    var lh = {}; logData[0].forEach(function(c,i){ if(c) lh[String(c).trim()]=i; });
    if (lh['ApplyStatus'] === undefined) return { success: false, error: 'This spreadsheet hasn\'t been migrated for the new confirmation workflow yet.' };

    var rowIdx = -1;
    for (var li = 1; li < logData.length; li++) {
      if (String(logData[li][lh['LogID']]) === String(logId)) { rowIdx = li; break; }
    }
    if (rowIdx === -1) return { success: false, error: 'Log entry not found.' };

    var currentApplyStatus = String(logData[rowIdx][lh['ApplyStatus']]||'');
    if (currentApplyStatus === 'Applied') return { success: false, error: 'This change was already confirmed and cannot be cancelled — undo it with a new Hours/Schedule change instead.' };
    if (currentApplyStatus === 'Cancelled') return { success: false, error: 'This change was already cancelled.' };

    // No connSheet write ever happened for a still-Pending change, per
    // the new workflow — nothing to undo there, just mark it Cancelled.
    if (lh['ApplyStatus']  !== undefined) logSheet.getRange(rowIdx+1, lh['ApplyStatus']+1).setValue('Cancelled');
    if (lh['CancelledAt']  !== undefined) logSheet.getRange(rowIdx+1, lh['CancelledAt']+1).setValue(new Date());
    if (lh['CancelledBy']  !== undefined) logSheet.getRange(rowIdx+1, lh['CancelledBy']+1).setValue(perm.user.email);
    if (lh['CancelReason'] !== undefined) logSheet.getRange(rowIdx+1, lh['CancelReason']+1).setValue(reason || '');

    return { success: true };
  } catch (e) {
    return { success: false, error: 'cancelHoursChange: ' + e.message };
  }
}

function applyVAConnectionHoursChange_(payload) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!payload.connectionId) return { success: false, error: 'Connection ID required.' };

    var ss        = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var data      = connSheet.getDataRange().getValues();
    var h         = _connHMap(data[0]);
    var now       = new Date();

    // Recompute requiredPHTime server-side from requiredClientTime, per
    // the PH-time rework, rather than trusting whatever the frontend's
    // own preview call happened to send — this is the authoritative
    // value, derived the same way as everywhere else.
    if (payload.requiredClientTime) {
      try {
        var connTzLookupData = data;
        var connTzLookupH = h;
        var reqIdForTz = '';
        for (var tzi = 1; tzi < connTzLookupData.length; tzi++) {
          if (String(connTzLookupData[tzi][connTzLookupH['ConnectionID']]) !== payload.connectionId) continue;
          reqIdForTz = String(connTzLookupData[tzi][connTzLookupH['RequestID']]||'');
          break;
        }
        var reqSheetForTz = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
        if (reqIdForTz && reqSheetForTz) {
          var reqDataForTz = reqSheetForTz.getDataRange().getValues();
          var reqHForTz = {}; reqDataForTz[0].forEach(function(c,i){ if(c) reqHForTz[String(c)]=i; });
          for (var rti = 1; rti < reqDataForTz.length; rti++) {
            if (String(reqDataForTz[rti][reqHForTz['RequestID']]||'') !== reqIdForTz) continue;
            var clientTzForConv = reqHForTz['ClientTimezone'] !== undefined ? String(reqDataForTz[rti][reqHForTz['ClientTimezone']]||'') : '';
            if (clientTzForConv) {
              payload.requiredPHTime = convertClientTimeToPH(payload.requiredClientTime, clientTzForConv, payload.effectiveDate || new Date());
            }
            break;
          }
        }
      } catch (tzConvEx) { Logger.log('applyVAConnectionHoursChange_ PH conversion: ' + tzConvEx.message); }
    }

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== payload.connectionId) continue;
      var rowNum = i + 1;

      // Capture previous values for the log
      var prev = {
        hours:          String(data[i][h['Hours']]          || ''),
        hoursType:      String(data[i][h['HoursType']]      || ''),
        connectionType: String(data[i][h['ConnectionType']] || ''),
        scheduleType:   '', scheduleDays: ''
      };
      // Previous schedule breakdown, if any — pulled from this connection's
      // own most recent hours-log entry (VAConnections has no schedule
      // columns of its own; the log is the only place this lives).
      var prevBreakdownResult = getVAConnectionCurrentSchedule(payload.connectionId);
      var prevBreakdownJson = (prevBreakdownResult.success && prevBreakdownResult.breakdown) ? JSON.stringify(prevBreakdownResult.breakdown) : '';
      var prevWeeklyHours = (prevBreakdownResult.success && prevBreakdownResult.weeklyHours) ? prevBreakdownResult.weeklyHours : parseFloat(prev.hours) || 0;

      var logSheet = _ensureSheet(ss, 'VAConnectionHoursLog', CONFIG.SCHEMA.VAConnectionHoursLog);

      // ── Limited Period: creates TWO records bracketing the window —
      // one applying the limited hours starting on LimitFrom, one reverting
      // back to whatever schedule was in effect immediately before it,
      // effective the day after LimitTo. The hours-calculation engine
      // (VAHoursService.gs) treats every log entry as an ordinary schedule
      // period boundary, so these two rows naturally bracket the limited
      // window without needing any special-case "override" logic — that's
      // simpler and matches how every other change is recorded.
      if (payload.changeType === 'Limited Period') {
        if (!payload.limitHours || !payload.limitFrom || !payload.limitTo) {
          return { success: false, error: 'Limit hours, from date, and to date are all required.' };
        }
        var limitFromDate = _parseDateInput(payload.limitFrom);
        var limitToDate   = _parseDateInput(payload.limitTo);
        var revertDate     = new Date(limitToDate); revertDate.setDate(revertDate.getDate() + 1);

        // Scale the prior day-by-day pattern proportionally to the new
        // limited weekly total, so the same days stay worked, just at
        // adjusted hours — only when there IS a prior day breakdown to
        // scale (Project Based connections have none, so just use the
        // limited figure directly as a flat total for those).
        var limitedBreakdownJson = '';
        if (prevBreakdownResult.success && prevBreakdownResult.breakdown && prevWeeklyHours > 0) {
          var scale = parseFloat(payload.limitHours) / prevWeeklyHours;
          var scaledBreakdown = prevBreakdownResult.breakdown.map(function(g) {
            return { days: g.days, hoursPerDay: Math.round(g.hoursPerDay * scale * 100) / 100 };
          });
          limitedBreakdownJson = JSON.stringify(scaledBreakdown);
        }

        var logIdStart = generateID('HCL');
        _hoursLogAppendByHeader(logSheet, {
          LogID: logIdStart,
          ConnectionID: payload.connectionId,
          ChangeType: 'Limited Period',
          PrevHours: prev.hours,
          NewHours: payload.limitHours,
          PrevHoursType: prev.hoursType,
          NewHoursType: prev.hoursType,
          PrevConnectionType: prev.connectionType,
          NewConnectionType: prev.connectionType,
          PrevScheduleType: '',
          NewScheduleType: '',
          PrevScheduleDays: '',
          NewScheduleDays: '',
          LimitHours: payload.limitHours,
          LimitFrom: limitFromDate,
          LimitTo: limitToDate,
          LimitNotes: payload.limitNotes || '',
          EffectiveDate: limitFromDate,
          Notes: 'Limited Period start — reverts automatically to the prior schedule on ' + Utilities.formatDate(revertDate, Session.getScriptTimeZone()||'UTC', 'yyyy-MM-dd') + (payload.limitNotes ? '. Reason: ' + payload.limitNotes : '.'),
          LoggedBy: perm.user.email,
          CreatedAt: now,
          PrevScheduleBreakdown: prevBreakdownJson,
          NewScheduleBreakdown: limitedBreakdownJson,
          RequestedBy: '',
          RequiredPHTime: '',
          NightDiffApplicableAtSchedule: false,
          BreaksIncludedInTotal: true,
          RequiredClientTime: ''
        });
        _hoursSetApplyStatusPending(logSheet, logIdStart);

        var logIdEnd = generateID('HCL');
        _hoursLogAppendByHeader(logSheet, {
          LogID: logIdEnd,
          ConnectionID: payload.connectionId,
          ChangeType: 'Limited Period',
          PrevHours: payload.limitHours,
          NewHours: prev.hours,
          PrevHoursType: prev.hoursType,
          NewHoursType: prev.hoursType,
          PrevConnectionType: prev.connectionType,
          NewConnectionType: prev.connectionType,
          PrevScheduleType: '',
          NewScheduleType: '',
          PrevScheduleDays: '',
          NewScheduleDays: '',
          LimitHours: payload.limitHours,
          LimitFrom: limitFromDate,
          LimitTo: limitToDate,
          LimitNotes: payload.limitNotes || '',
          EffectiveDate: revertDate,
          Notes: 'Limited Period end — reverting to the schedule that was in effect before ' + Utilities.formatDate(limitFromDate, Session.getScriptTimeZone()||'UTC', 'yyyy-MM-dd') + '.',
          LoggedBy: perm.user.email,
          CreatedAt: now,
          PrevScheduleBreakdown: limitedBreakdownJson,
          NewScheduleBreakdown: prevBreakdownJson,
          RequestedBy: '',
          RequiredPHTime: '',
          NightDiffApplicableAtSchedule: false,
          BreaksIncludedInTotal: true,
          RequiredClientTime: ''
        });
        _hoursSetApplyStatusPending(logSheet, logIdEnd);

        // The connection row's own Hours/HoursType are a cached display
        // value — update to the limited figure now, since that's what's
        // actually in effect starting today. There's no scheduler here to
        // automatically flip it back on the revert date, so it's worth a
        // manual check once the limited period ends if that cached value
        // matters somewhere Hours/HoursType is read directly rather than
        // through the log.
        if (h['Hours']     !== undefined) connSheet.getRange(rowNum, h['Hours']+1).setValue(payload.limitHours);
        connSheet.getRange(rowNum, h['UpdatedAt']+1).setValue(now);
        connSheet.getRange(rowNum, h['UpdatedBy']+1).setValue(perm.user.email);

        _writeLog('VAConnection', payload.connectionId, 'UPDATE', 'Hours/Schedule',
          JSON.stringify(prev), JSON.stringify({ limitedHours: payload.limitHours, from: payload.limitFrom, to: payload.limitTo }), perm.user, limitFromDate);

        return { success: true, logId: logIdStart, revertLogId: logIdEnd };
      }

      // Per the request — every change type except Initial Assignment no
      // longer applies to the connection row immediately. Initial
      // Assignment is a VA's very first schedule setup when they start
      // (not a change to an existing schedule) and still needs to take
      // effect right away; everything else is logged as Pending here,
      // with the actual connSheet update deferred to confirmHoursChange,
      // only once a CS Specialist explicitly confirms it.
      var isInitialAssignment = payload.changeType === 'Initial Assignment';
      if (isInitialAssignment) {
        var initUpdates = {};
        if (payload.newHours          !== undefined) initUpdates['Hours']          = payload.newHours;
        if (payload.newHoursType      !== undefined) initUpdates['HoursType']      = payload.newHoursType;
        if (payload.newConnectionType !== undefined) initUpdates['ConnectionType'] = payload.newConnectionType;
        if (payload.newScheduleType   !== undefined) initUpdates['ScheduleType']   = payload.newScheduleType;
        if (payload.newScheduleDays   !== undefined) initUpdates['ScheduleDays']   = payload.newScheduleDays;
        initUpdates['UpdatedAt'] = now;
        initUpdates['UpdatedBy'] = perm.user.email;
        Object.keys(initUpdates).forEach(function(col) {
          if (h[col] !== undefined) connSheet.getRange(rowNum, h[col] + 1).setValue(initUpdates[col]);
        });
      }

      var logId    = generateID('HCL');
      var effDate  = payload.effectiveDate ? _parseDateInput(payload.effectiveDate) : now;
      _hoursLogAppendByHeader(logSheet, {
        LogID: logId,
        ConnectionID: payload.connectionId,
        ChangeType: payload.changeType || 'Hours/Schedule Change',
        PrevHours: prev.hours,
        NewHours: payload.newHours || '',
        PrevHoursType: prev.hoursType,
        NewHoursType: payload.newHoursType || '',
        PrevConnectionType: prev.connectionType,
        NewConnectionType: payload.newConnectionType || '',
        PrevScheduleType: prev.scheduleType,
        NewScheduleType: payload.newScheduleType || '',
        PrevScheduleDays: prev.scheduleDays,
        NewScheduleDays: payload.newScheduleDays || '',
        LimitHours: '',
        LimitFrom: '',
        LimitTo: '',
        LimitNotes: '',
        EffectiveDate: effDate,
        Notes: payload.notes || '',
        LoggedBy: perm.user.email,
        CreatedAt: now,
        PrevScheduleBreakdown: prevBreakdownJson,
        NewScheduleBreakdown: payload.newScheduleBreakdown || '',
        RequestedBy: '',
        RequiredPHTime: payload.requiredPHTime || '',
        NightDiffApplicableAtSchedule: !!payload.nightDiffApplicableAtSchedule,
        BreaksIncludedInTotal: payload.breaksIncludedInTotal !== undefined ? !!payload.breaksIncludedInTotal : true,
        RequiredClientTime: payload.requiredClientTime || ''
      });
      if (isInitialAssignment) {
        _hoursSetApplyStatusApplied(logSheet, logId, perm.user.email);
      } else {
        _hoursSetApplyStatusPending(logSheet, logId);
      }

      _writeLog('VAConnection', payload.connectionId, 'UPDATE', 'Hours/Schedule',
        JSON.stringify(prev), JSON.stringify({ hours: payload.newHours, type: payload.newConnectionType }), perm.user, effDate);

      return { success: true, logId: logId };
    }
    return { success: false, error: 'Connection not found.' };
  } catch(e) {
    return { success: false, error: 'applyVAConnectionHoursChange: ' + e.message };
  }
}

function _hoursLogMapRow(data, i, h) {
  return {
    connectionId:       String(data[i][h['ConnectionID']]      ||''),
    logId:              String(data[i][h['LogID']]             ||''),
    changeType:         String(data[i][h['ChangeType']]        ||''),
    prevHours:          String(data[i][h['PrevHours']]         ||''),
    newHours:           String(data[i][h['NewHours']]          ||''),
    prevHoursType:      String(data[i][h['PrevHoursType']]     ||''),
    newHoursType:       String(data[i][h['NewHoursType']]      ||''),
    prevConnectionType: String(data[i][h['PrevConnectionType']]||''),
    newConnectionType:  String(data[i][h['NewConnectionType']] ||''),
    prevScheduleType:   String(data[i][h['PrevScheduleType']]  ||''),
    newScheduleType:    String(data[i][h['NewScheduleType']]   ||''),
    prevScheduleDays:   String(data[i][h['PrevScheduleDays']]  ||''),
    newScheduleDays:    String(data[i][h['NewScheduleDays']]   ||''),
    prevScheduleBreakdown: h['PrevScheduleBreakdown'] !== undefined ? String(data[i][h['PrevScheduleBreakdown']]||'') : '',
    newScheduleBreakdown: h['NewScheduleBreakdown'] !== undefined ? String(data[i][h['NewScheduleBreakdown']]||'') : '',
    limitHours:         String(data[i][h['LimitHours']]        ||''),
    limitFrom:          data[i][h['LimitFrom']] ? (data[i][h['LimitFrom']] instanceof Date ? data[i][h['LimitFrom']].toISOString() : String(data[i][h['LimitFrom']])) : '',
    limitTo:            data[i][h['LimitTo']]   ? (data[i][h['LimitTo']]   instanceof Date ? data[i][h['LimitTo']].toISOString()   : String(data[i][h['LimitTo']]))   : '',
    limitNotes:         String(data[i][h['LimitNotes']]        ||''),
    effectiveDate:      data[i][h['EffectiveDate']] ? (data[i][h['EffectiveDate']] instanceof Date ? data[i][h['EffectiveDate']].toISOString() : String(data[i][h['EffectiveDate']])) : '',
    notes:              String(data[i][h['Notes']]             ||''),
    loggedBy:           String(data[i][h['LoggedBy']]          ||''),
    requestedBy:        h['RequestedBy']    !== undefined ? String(data[i][h['RequestedBy']]||'')    : '',
    requiredPHTime:     h['RequiredPHTime'] !== undefined ? String(data[i][h['RequiredPHTime']]||'') : '',
    requiredClientTime: h['RequiredClientTime'] !== undefined ? String(data[i][h['RequiredClientTime']]||'') : '',
    nightDiffApplicable: h['NightDiffApplicableAtSchedule'] !== undefined ? _toBool(data[i][h['NightDiffApplicableAtSchedule']]) : false,
    breaksIncluded:     h['BreaksIncludedInTotal'] !== undefined ? _toBool(data[i][h['BreaksIncludedInTotal']]) : true,
    applyStatus:        h['ApplyStatus'] !== undefined && data[i][h['ApplyStatus']] ? String(data[i][h['ApplyStatus']]) : 'Applied',
    appliedBy:          h['AppliedBy'] !== undefined ? String(data[i][h['AppliedBy']]||'') : '',
    cancelReason:       h['CancelReason'] !== undefined ? String(data[i][h['CancelReason']]||'') : '',
    createdAt:          data[i][h['CreatedAt']] ? (data[i][h['CreatedAt']] instanceof Date ? data[i][h['CreatedAt']].toISOString() : String(data[i][h['CreatedAt']])) : ''
  };
}

// Returns the full hours change log for a specific VA connection.
function getVAConnectionHoursLog_(connectionId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c).trim()]=i; });
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      rows.push(_hoursLogMapRow(data, i, h));
    }
    rows.sort(function(a,b){ return new Date(b.createdAt||0)-new Date(a.createdAt||0); });
    return { success: true, data: rows };
  } catch(e) {
    return { success: false, error: 'getVAConnectionHoursLog: ' + e.message };
  }
}

// Bulk version — reads VAConnectionHoursLog ONCE for every connection at
// once, rather than the page calling the single-connection version in a
// loop (which meant one full-sheet-read AND one network round trip per
// connection — the actual cause of the Hours & Schedule Changes page
// looking permanently stuck loading with any real number of connections).
// Edits an existing VAConnectionHoursLog entry — effective date, hours,
// notes, and the full schedule (type, day-by-day breakdown, required PH
// time, night differential/breaks flags). Corrects this entry's own
// recorded values directly; doesn't recompute anything downstream or
// create a new log row.
function updateHoursLogEntry(logId, payload) {
  try {
    var perm = _checkAssignVAPermission();
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!sheet) return { success: false, error: 'VAConnectionHoursLog sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['LogID']]||'') !== logId) continue;
      var rowNum = i + 1;
      var changeType = String(data[i][h['ChangeType']]||'');

      if (payload.effectiveDate) {
        var d = _parseDateInput(payload.effectiveDate);
        if (!isNaN(d.getTime())) sheet.getRange(rowNum, h['EffectiveDate']+1).setValue(d);
      }
      if (payload.notes !== undefined) {
        sheet.getRange(rowNum, h['Notes']+1).setValue(payload.notes || '');
      }
      // Hours only makes sense to edit for entries where NewHours is a
      // standalone figure (an addition, or a straightforward new total) —
      // Initial Assignment/Migration and Hours/Schedule Update entries all
      // qualify; Limited Period's two bracketing rows are left alone since
      // editing one without the other would desync the pair.
      if (payload.newHours !== undefined && payload.newHours !== '' && changeType !== 'Limited Period') {
        sheet.getRange(rowNum, h['NewHours']+1).setValue(parseFloat(payload.newHours) || 0);
      }
      // Full schedule fields, per the request — same "not for Limited
      // Period" exception as Hours above, since that ChangeType's two
      // bracketing rows need to stay in sync with each other rather than
      // be edited independently.
      if (changeType !== 'Limited Period') {
        if (payload.newHoursType !== undefined && h['NewHoursType'] !== undefined) {
          sheet.getRange(rowNum, h['NewHoursType']+1).setValue(payload.newHoursType || '');
        }
        if (payload.newScheduleType !== undefined && h['NewScheduleType'] !== undefined) {
          sheet.getRange(rowNum, h['NewScheduleType']+1).setValue(payload.newScheduleType || '');
        }
        if (payload.newScheduleDays !== undefined && h['NewScheduleDays'] !== undefined) {
          sheet.getRange(rowNum, h['NewScheduleDays']+1).setValue(payload.newScheduleDays || '');
        }
        if (payload.newScheduleBreakdown !== undefined && h['NewScheduleBreakdown'] !== undefined) {
          sheet.getRange(rowNum, h['NewScheduleBreakdown']+1).setValue(payload.newScheduleBreakdown || '');
        }
        if (payload.requiredClientTime !== undefined && h['RequiredClientTime'] !== undefined) {
          sheet.getRange(rowNum, h['RequiredClientTime']+1).setValue(payload.requiredClientTime || '');
        }
        var phTimeToStore = payload.requiredPHTime || '';
        if (payload.requiredClientTime) {
          try {
            var connIdForTz = h['ConnectionID'] !== undefined ? String(data[i][h['ConnectionID']]||'') : '';
            var connSheetForTz = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
            var reqIdForTz2 = '';
            if (connSheetForTz && connIdForTz) {
              var connDataForTz = connSheetForTz.getDataRange().getValues();
              var connHForTz = {}; connDataForTz[0].forEach(function(c,i2){ if(c) connHForTz[String(c)]=i2; });
              for (var czi = 1; czi < connDataForTz.length; czi++) {
                if (String(connDataForTz[czi][connHForTz['ConnectionID']]||'') !== connIdForTz) continue;
                reqIdForTz2 = String(connDataForTz[czi][connHForTz['RequestID']]||'');
                break;
              }
            }
            var reqSheetForTz2 = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
            if (reqIdForTz2 && reqSheetForTz2) {
              var reqDataForTz2 = reqSheetForTz2.getDataRange().getValues();
              var reqHForTz2 = {}; reqDataForTz2[0].forEach(function(c,i3){ if(c) reqHForTz2[String(c)]=i3; });
              for (var rzi = 1; rzi < reqDataForTz2.length; rzi++) {
                if (String(reqDataForTz2[rzi][reqHForTz2['RequestID']]||'') !== reqIdForTz2) continue;
                var clientTzForEntry = reqHForTz2['ClientTimezone'] !== undefined ? String(reqDataForTz2[rzi][reqHForTz2['ClientTimezone']]||'') : '';
                if (clientTzForEntry) {
                  var refDateForEntry = payload.effectiveDate || data[i][h['EffectiveDate']] || new Date();
                  phTimeToStore = convertClientTimeToPH(payload.requiredClientTime, clientTzForEntry, refDateForEntry);
                }
                break;
              }
            }
          } catch (tzConvEx2) { Logger.log('updateHoursLogEntry PH conversion: ' + tzConvEx2.message); }
        }
        if (h['RequiredPHTime'] !== undefined) {
          sheet.getRange(rowNum, h['RequiredPHTime']+1).setValue(phTimeToStore);
        }
        if (payload.nightDiffApplicable !== undefined && h['NightDiffApplicableAtSchedule'] !== undefined) {
          sheet.getRange(rowNum, h['NightDiffApplicableAtSchedule']+1).setValue(!!payload.nightDiffApplicable);
        }
        if (payload.breaksIncluded !== undefined && h['BreaksIncludedInTotal'] !== undefined) {
          sheet.getRange(rowNum, h['BreaksIncludedInTotal']+1).setValue(!!payload.breaksIncluded);
        }
      }

      _writeLog('VAConnectionHoursLog', logId, 'UPDATE', 'entry', '', 'Edited via Hours & Schedule Changes', perm.user);
      return { success: true };
    }
    return { success: false, error: 'Log entry not found.' };
  } catch (e) {
    return { success: false, error: 'updateHoursLogEntry: ' + e.message };
  }
}

function getAllVAConnectionHoursLogs_() {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c).trim()]=i; });
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['ConnectionID']]) continue;
      rows.push(_hoursLogMapRow(data, i, h));
    }
    rows.sort(function(a,b){ return new Date(b.createdAt||0)-new Date(a.createdAt||0); });

    // Enrich each row with acknowledgement status — a change needs at
    // least one Service Manager, one HR person (Specialist or Manager),
    // and one Accounting person before it counts as fully acknowledged.
    try {
      var ackSheet = _ensureSheet(ss, 'HoursChangeAcknowledgements', CONFIG.SCHEMA.HoursChangeAcknowledgements);
      var ackData = ackSheet.getDataRange().getValues();
      var acksByLog = {};
      if (ackData.length > 1) {
        var ah = {}; ackData[0].forEach(function(c,i){ if(c) ah[String(c).trim()]=i; });
        for (var ai = 1; ai < ackData.length; ai++) {
          var alid = String(ackData[ai][ah['LogID']]||''); if (!alid) continue;
          if (!acksByLog[alid]) acksByLog[alid] = [];
          acksByLog[alid].push({
            role: String(ackData[ai][ah['AcknowledgedByRole']]||''),
            by:   String(ackData[ai][ah['AcknowledgedByName']]||ackData[ai][ah['AcknowledgedBy']]||''),
            notes: String(ackData[ai][ah['Notes']]||''),
            at:   _iqSD ? _iqSD(ackData[ai][ah['CreatedAt']]) : String(ackData[ai][ah['CreatedAt']]||'')
          });
        }
      }
      rows.forEach(function(row) {
        var acks = acksByLog[row.logId] || [];
        var hasServiceManager = acks.some(function(a){ return a.role === 'Service Manager'; });
        var hasHR = acks.some(function(a){ return a.role === 'HR Specialist' || a.role === 'HR Manager'; });
        var hasAccounting = acks.some(function(a){ return a.role === 'Accounting'; });
        row.acknowledgements = acks;
        row.ackStatus = { serviceManager: hasServiceManager, hr: hasHR, accounting: hasAccounting };
        row.fullyAcknowledged = hasServiceManager && hasHR && hasAccounting;
      });
    } catch (ackEnrichEx) { Logger.log('getAllVAConnectionHoursLogs_ ack enrich: ' + ackEnrichEx.message); }

    return { success: true, data: rows };
  } catch(e) {
    return { success: false, error: 'getAllVAConnectionHoursLogs: ' + e.message };
  }
}

// A change needs sign-off from at least one Service Manager, one HR
// person (Specialist or Manager), and one Accounting person before it's
// considered fully confirmed — see getAllVAConnectionHoursLogs_ above for
// where "fully acknowledged" actually gets computed from these rows.
function acknowledgeHoursChange(logId, notes) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: 'Not signed in.' };
    var allowedRoles = [CONFIG.ROLES.SERVICE_MANAGER, CONFIG.ROLES.HR_SPECIALIST, CONFIG.ROLES.HR_MANAGER, CONFIG.ROLES.ACCOUNTING, CONFIG.ROLES.ADMINISTRATOR];
    if (allowedRoles.indexOf(user.role) === -1) {
      return { success: false, error: 'Only Service Manager, HR, Accounting, or Administrator can acknowledge hours/schedule changes.' };
    }
    if (!logId) return { success: false, error: 'Log ID is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!logSheet) return { success: false, error: 'Hours log not found.' };
    var logData = logSheet.getDataRange().getValues();
    var lh = {}; logData[0].forEach(function(c,i){ if(c) lh[String(c).trim()]=i; });
    var logExists = false;
    var logApplyStatus = '';
    for (var li = 1; li < logData.length; li++) {
      if (String(logData[li][lh['LogID']]) === String(logId)) {
        logExists = true;
        logApplyStatus = lh['ApplyStatus'] !== undefined ? String(logData[li][lh['ApplyStatus']]||'') : '';
        break;
      }
    }
    if (!logExists) return { success: false, error: 'Log entry not found.' };
    // Per the new confirmation workflow — a Pending or Cancelled change
    // hasn't actually taken effect, so acknowledging it wouldn't mean
    // anything. Matches the frontend, which already doesn't show the
    // Acknowledge action for either of these; this is the same
    // enforcement on the backend too.
    if (logApplyStatus === 'Pending') return { success: false, error: 'This change is still Pending confirmation and hasn\'t taken effect yet — nothing to acknowledge.' };
    if (logApplyStatus === 'Cancelled') return { success: false, error: 'This change was cancelled and never took effect — nothing to acknowledge.' };

    var ackSheet = _ensureSheet(ss, 'HoursChangeAcknowledgements', CONFIG.SCHEMA.HoursChangeAcknowledgements);
    var ackData = ackSheet.getDataRange().getValues();
    var ah = {}; ackData[0].forEach(function(c,i){ if(c) ah[String(c).trim()]=i; });
    // Administrator acknowledges as themselves, not impersonating one of
    // the three required roles — an Administrator ack alone would never
    // satisfy the Service Manager/HR/Accounting requirement on its own,
    // by design.
    var ackRole = (user.role === CONFIG.ROLES.ADMINISTRATOR) ? 'Administrator' : user.role;
    // Don't double-count — if this same role already acknowledged, treat
    // a repeat click as updating their notes rather than adding a duplicate.
    for (var ei = 1; ei < ackData.length; ei++) {
      if (String(ackData[ei][ah['LogID']]) === String(logId) && String(ackData[ei][ah['AcknowledgedByRole']]) === ackRole) {
        ackSheet.getRange(ei+1, ah['Notes']+1).setValue(notes||'');
        ackSheet.getRange(ei+1, ah['CreatedAt']+1).setValue(new Date());
        return { success: true };
      }
    }
    ackSheet.appendRow([generateID('HACK'), logId, ackRole, user.email, user.name||user.email, notes||'', new Date()]);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'acknowledgeHoursChange: ' + e.message };
  }
}

// Adds a project-hours entry for a project-based VA connection.
// Logs additional hours worked beyond a connection's base schedule — e.g. a
// Project Based VA putting in extra hours, or a Weekly VA covering overtime.
// requestedBy records whether the VA or the Client asked for it.
function addProjectHoursEntry_(connectionId, hoursAdded, description, entryDate, requestedBy) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!sheet) {
      sheet = ss.insertSheet('VAConnectionHoursLog');
      sheet.appendRow(CONFIG.SCHEMA.VAConnectionHoursLog);
      sheet.setFrozenRows(1);
    }
    // Header-mapped, not positional — this sheet has grown a few columns
    // over time (see the schema comments in Code.gs), and a fixed-position
    // array would silently misalign once more columns get added.
        var logId = generateID('PHE');
    var eDate = entryDate ? _parseDateInput(entryDate) : new Date();
    var now   = new Date();
    var hoursLogRowP = {};
    hoursLogRowP['LogID'] = logId;
    hoursLogRowP['ConnectionID'] = connectionId;
    hoursLogRowP['ChangeType'] = 'Project Hours Entry';
    hoursLogRowP['NewHours'] = hoursAdded;
    hoursLogRowP['EffectiveDate'] = eDate;
    hoursLogRowP['Notes'] = description || '';
    hoursLogRowP['LoggedBy'] = perm.user.email;
    hoursLogRowP['CreatedAt'] = now;
    hoursLogRowP['RequestedBy'] = requestedBy === 'Client' ? 'Client' : 'VA';
    _hoursLogAppendByHeader(sheet, hoursLogRowP);

    // If this connection's account/customer is currently Paused, logging
    // real additional hours is a concrete sign work has actually resumed —
    // auto-resume them straight to Active (not the Pending
    // reactivate-and-verify model used for Terminated/Cancelled, since this
    // is driven by an unambiguous, already-happened event rather than a
    // speculative decision to try reactivating).
    var resumeInfo = { clientResumed: false, customerResumed: false };
    try {
      var connSheet = _connGetSheet(ss);
      var connData  = connSheet.getDataRange().getValues();
      var connH     = _connHMap(connData[0]);
      for (var ci = 1; ci < connData.length; ci++) {
        if (String(connData[ci][connH['ConnectionID']]) !== connectionId) continue;
        var connType = String(connData[ci][connH['ConnectionType']]||'');
        var connHoursType = String(connData[ci][connH['HoursType']]||'');
        // Per the request — ConnectionType's own "Project-based" value
        // renamed to "Non-Regular" system-wide. HoursType is a separate
        // field and keeps its own "Project Based" value unchanged.
        if (connType !== 'Non-Regular' && connHoursType !== 'Project Based') break; // only Project Based / Non-Regular connections trigger this
        var clientId   = String(connData[ci][connH['ClientID']]  ||'');
        var customerId = String(connData[ci][connH['CustomerID']]||'');
        if (clientId) {
          var cliRes = getClientById(clientId);
          if (cliRes.success && cliRes.data.status === 'Paused') {
            var cliUpd = updateClient(clientId, { status: 'Active' });
            resumeInfo.clientResumed = !!(cliUpd && cliUpd.success);
          }
        }
        if (customerId) {
          var custRes = getCustomerById(customerId);
          if (custRes.success && custRes.data.status === 'Paused') {
            var custUpd = updateCustomer(customerId, { status: 'Active' });
            resumeInfo.customerResumed = !!(custUpd && custUpd.success);
          }
        }
        break;
      }
    } catch (resumeEx) {
      Logger.log('addProjectHoursEntry_ resume check: ' + resumeEx.message);
    }

    return { success: true, logId: logId, clientResumed: resumeInfo.clientResumed, customerResumed: resumeInfo.customerResumed };
  } catch(e) {
    return { success: false, error: 'addProjectHoursEntry: ' + e.message };
  }
}

// Per the request — one-time, Administrator-only migration: ConnectionType's
// "Project-based" value has been renamed to "Non-Regular" system-wide. All
// the code that reads/writes/displays this field was already updated to
// use the new value — this is what updates the EXISTING rows on the
// VAConnections tab itself, so historical data matches the new terminology
// too, not just anything created going forward. Matches both formats seen
// in this codebase's own history ("Project Based" and "Project-based") via
// normalized comparison, so either one gets picked up regardless of which
// was actually on file for a given row.
function migrateConnectionTypeToNonRegular() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) return { success: false, error: 'Only Administrators can run this migration.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _connHMap(data[0]);
    if (h['ConnectionType'] === undefined) return { success: false, error: 'ConnectionType column not found on VAConnections.' };

    var updatedRows = [];
    for (var i = 1; i < data.length; i++) {
      var raw = String(data[i][h['ConnectionType']] || '');
      var norm = raw.toLowerCase().replace(/[\s-]/g, '');
      if (norm !== 'projectbased') continue; // already 'Non-Regular', 'Regular', 'Buffer', or anything else — leave alone
      sheet.getRange(i + 1, h['ConnectionType'] + 1).setValue('Non-Regular');
      var connIdForLog = h['ConnectionID'] !== undefined ? String(data[i][h['ConnectionID']] || '') : '';
      updatedRows.push(connIdForLog || ('row ' + (i + 1)));
    }
    SpreadsheetApp.flush();
    if (updatedRows.length) {
      _writeLog('VAConnection', 'BULK', 'UPDATE', 'ConnectionType', 'Project-based', 'Non-Regular', user,
        null, updatedRows.length + ' connection(s) migrated: ' + updatedRows.slice(0, 20).join(', ') + (updatedRows.length > 20 ? '…' : ''));
    }
    return { success: true, updatedCount: updatedRows.length };
  } catch (e) {
    return { success: false, error: 'migrateConnectionTypeToNonRegular: ' + e.message };
  }
}


// Per the request — VAConnections.CustomerName was being left empty on every
// new connection: assignVA builds each row from a fixed field map, and
// CustomerName wasn't in it, so that column fell through to blank. Looked up
// from the Customers sheet by CustomerID.
function _connLookupCustomerName(customerId) {
  try {
    if (!customerId) return '';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!sh || sh.getLastRow() < 2) return '';
    var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function(c){ return String(c).trim(); });
    var idCol = hdr.indexOf('CustomerID'), nameCol = hdr.indexOf('CustomerName');
    if (idCol < 0 || nameCol < 0) return '';
    var m = sh.getRange(2, idCol + 1, sh.getLastRow() - 1, 1).createTextFinder(String(customerId)).matchEntireCell(true).findNext();
    return m ? String(sh.getRange(m.getRow(), nameCol + 1).getValue() || '') : '';
  } catch (e) { return ''; }
}

// Keeps VAConnections.CustomerName correct when a Customer is renamed —
// called from updateCustomer alongside the existing cascade to Accounts.
// Matches on CustomerID, or (for older rows whose CustomerID is blank) on a
// ClientID belonging to that customer.
function _cascadeCustomerNameToConnections(customerId, newName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c, i){ if (c) h[String(c).trim()] = i; });
    if (h['CustomerName'] === undefined) return;
    var clientIds = {};
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (cliSheet && cliSheet.getLastRow() > 1) {
      var cd = cliSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c, i){ if (c) ch[String(c).trim()] = i; });
      if (ch['ClientID'] !== undefined && ch['CustomerID'] !== undefined) {
        for (var i = 1; i < cd.length; i++) if (String(cd[i][ch['CustomerID']]).trim() === String(customerId)) clientIds[String(cd[i][ch['ClientID']]).trim()] = true;
      }
    }
    var changed = 0;
    var col = [];
    for (var r = 1; r < data.length; r++) {
      var cur = data[r][h['CustomerName']];
      var rowCust = h['CustomerID'] !== undefined ? String(data[r][h['CustomerID']] || '').trim() : '';
      var rowCli  = h['ClientID']   !== undefined ? String(data[r][h['ClientID']]   || '').trim() : '';
      var belongs = rowCust ? (rowCust === String(customerId)) : !!clientIds[rowCli];
      if (belongs && String(cur || '') !== newName) { col.push([newName]); changed++; } else col.push([cur]);
    }
    if (changed) sheet.getRange(2, h['CustomerName'] + 1, col.length, 1).setValues(col);
  } catch (e) { Logger.log('_cascadeCustomerNameToConnections error: ' + e.message); }
}

// One-time / repeatable, Administrator-only: fills any blank (or stale)
// VAConnections.CustomerName from the Customers sheet. Uses the row's
// CustomerID, falling back to its Account's customer when CustomerID is
// blank. Safe to run again — rows already correct are left alone.
function backfillConnectionCustomerNames() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) return { success: false, error: 'Only Administrators can run this.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _connGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c, i){ if (c) h[String(c).trim()] = i; });
    if (h['CustomerName'] === undefined) return { success: false, error: 'No CustomerName column found on VAConnections.' };
    var nameById = {};
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSheet && custSheet.getLastRow() > 1) {
      var cu = custSheet.getDataRange().getValues();
      var cuh = {}; cu[0].forEach(function(c, i){ if (c) cuh[String(c).trim()] = i; });
      for (var i = 1; i < cu.length; i++) nameById[String(cu[i][cuh['CustomerID']] || '').trim()] = String(cu[i][cuh['CustomerName']] || '');
    }
    var custByClient = {};
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (cliSheet && cliSheet.getLastRow() > 1) {
      var cl = cliSheet.getDataRange().getValues();
      var clh = {}; cl[0].forEach(function(c, i){ if (c) clh[String(c).trim()] = i; });
      if (clh['ClientID'] !== undefined && clh['CustomerID'] !== undefined) {
        for (var j = 1; j < cl.length; j++) custByClient[String(cl[j][clh['ClientID']] || '').trim()] = String(cl[j][clh['CustomerID']] || '').trim();
      }
    }
    var updated = 0, unresolved = 0, col = [];
    for (var r = 1; r < data.length; r++) {
      var cur = data[r][h['CustomerName']];
      var id = h['CustomerID'] !== undefined ? String(data[r][h['CustomerID']] || '').trim() : '';
      if (!id && h['ClientID'] !== undefined) id = custByClient[String(data[r][h['ClientID']] || '').trim()] || '';
      var nm = id ? (nameById[id] || '') : '';
      if (nm) { if (String(cur || '') !== nm) { col.push([nm]); updated++; } else col.push([cur]); }
      else { col.push([cur]); if (!String(cur || '').trim() && String(data[r][0] || '').trim()) unresolved++; }
    }
    if (col.length) sheet.getRange(2, h['CustomerName'] + 1, col.length, 1).setValues(col);
    SpreadsheetApp.flush();
    return { success: true, updatedCount: updated, unresolvedCount: unresolved };
  } catch (e) {
    return { success: false, error: 'backfillConnectionCustomerNames: ' + e.message };
  }
}


// Per the request — one-time / repeatable, Administrator-only repair: any
// Account or Customer that has a currently-Started VA Connection but isn't
// Active gets activated, with its status date set to the earliest start date
// among its Started connections (not today). Catches records that slipped
// through before the hardening above, and is the fix for the Audit's
// "Not Activated Despite a Started VA Connection" list.
function activateAccountsWithStartedConnections() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) return { success: false, error: 'Only Administrators can run this.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cliSheet = ss.getSheetByName('Clients'), custSheet = ss.getSheetByName('Customers');
    var cliData = cliSheet.getDataRange().getValues(), cuData = custSheet.getDataRange().getValues();
    var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c).trim()]=i; });
    var cuh  = {}; cuData[0].forEach(function(c,i){ if(c) cuh[String(c).trim()]=i; });
    var connData = _connGetSheet(ss).getDataRange().getValues();
    var ch = _connHMap(connData[0]);
    var custOfClient = {};
    for (var i = 1; i < cliData.length; i++) custOfClient[String(cliData[i][clh['ClientID']]).trim()] = String(cliData[i][clh['CustomerID']] || '').trim();
    var startByClient = {}, startByCustomer = {};
    for (var r = 1; r < connData.length; r++) {
      if (String(connData[r][ch['ConnectionStatus']] || '') !== CONFIG.VA_CONNECTION_STATUS.STARTED) continue;
      var st = ch['ActualStartDate'] !== undefined ? connData[r][ch['ActualStartDate']] : '';
      var stD = st ? new Date(st) : new Date();
      if (isNaN(stD.getTime())) stD = new Date();
      var cl = String(connData[r][ch['ClientID']] || '').trim();
      var cu = String(connData[r][ch['CustomerID']] || '').trim() || custOfClient[cl] || '';
      if (cl && (!startByClient[cl] || stD < startByClient[cl])) startByClient[cl] = stD;
      if (cu && (!startByCustomer[cu] || stD < startByCustomer[cu])) startByCustomer[cu] = stD;
    }
    var now = new Date(), accounts = 0, customers = 0;
    function run(sheet, data, h, idCol, startMap, logType, tally) {
      for (var k = 1; k < data.length; k++) {
        var id = String(data[k][h[idCol]] || '').trim();
        if (!id || !startMap[id]) continue;
        var cur = String(data[k][h['Status']] || '');
        if (cur === 'Active') continue;
        sheet.getRange(k + 1, h['Status'] + 1).setValue('Active');
        if (h['StatusDate'] !== undefined) sheet.getRange(k + 1, h['StatusDate'] + 1).setValue(startMap[id]);
        if (h['UpdatedAt']  !== undefined) sheet.getRange(k + 1, h['UpdatedAt']  + 1).setValue(now);
        if (h['UpdatedBy']  !== undefined) sheet.getRange(k + 1, h['UpdatedBy']  + 1).setValue(user.email);
        _writeLog(logType, id, _classifyStatusChangeAction(cur, 'Active'), 'Status', cur, 'Active (repair: Started VA Connection on file)', user, startMap[id]);
        tally.n++;
      }
    }
    var ta = { n: 0 }, tc = { n: 0 };
    run(cliSheet, cliData, clh, 'ClientID', startByClient, 'Account', ta);
    run(custSheet, cuData, cuh, 'CustomerID', startByCustomer, 'Customer', tc);
    SpreadsheetApp.flush();
    return { success: true, accountsActivated: ta.n, customersActivated: tc.n };
  } catch (e) {
    return { success: false, error: 'activateAccountsWithStartedConnections: ' + e.message };
  }
}


// Per the request — repairs the root cause of "VA doesn't show an account": fills any VA
// Connection whose ClientID / CustomerID (and CustomerName, if that column exists) is blank,
// from the Service Request it came from. Administrator-only; safe to run again — rows that
// already have a value are left alone.
function fillMissingConnectionClientIds() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) return { success: false, error: 'Only Administrators can run this.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var data = connSheet.getDataRange().getValues();
    var h = _connHMap(data[0]);
    if (h['ClientID'] === undefined || h['RequestID'] === undefined) return { success: false, error: 'ClientID / RequestID column not found on VAConnections.' };

    var reqSheet = _reqGetSheet(ss), reqInfo = {};
    var rd = reqSheet.getDataRange().getValues();
    var rh = {}; rd[0].forEach(function(c, i){ if (c) rh[String(c).trim()] = i; });
    for (var i = 1; i < rd.length; i++) {
      var rid = String(rd[i][rh['RequestID']] || '').trim(); if (!rid) continue;
      reqInfo[rid] = { client: String(rd[i][rh['ClientID']] || '').trim(), customer: String(rd[i][rh['CustomerID']] || '').trim() };
    }
    var customerOfClient = {};
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (cliSheet && cliSheet.getLastRow() > 1) {
      var cd = cliSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c, i){ if (c) ch[String(c).trim()] = i; });
      for (var j = 1; j < cd.length; j++) customerOfClient[String(cd[j][ch['ClientID']] || '').trim()] = String(cd[j][ch['CustomerID']] || '').trim();
    }
    var nameById = {};
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSheet && custSheet.getLastRow() > 1) {
      var ku = custSheet.getDataRange().getValues();
      var kh = {}; ku[0].forEach(function(c, i){ if (c) kh[String(c).trim()] = i; });
      for (var k = 1; k < ku.length; k++) nameById[String(ku[k][kh['CustomerID']] || '').trim()] = String(ku[k][kh['CustomerName']] || '');
    }

    var cliCol = [], custCol = [], nameCol = [], nClient = 0, nCust = 0, nName = 0, stillMissing = 0;
    for (var r = 1; r < data.length; r++) {
      var cli = String(data[r][h['ClientID']] || '').trim();
      var cus = h['CustomerID'] !== undefined ? String(data[r][h['CustomerID']] || '').trim() : '';
      var nm  = h['CustomerName'] !== undefined ? String(data[r][h['CustomerName']] || '').trim() : '';
      var info = reqInfo[String(data[r][h['RequestID']] || '').trim()] || {};
      if (!cli && info.client)   { cli = info.client; nClient++; }
      if (!cus && h['CustomerID'] !== undefined) { var guess = info.customer || customerOfClient[cli] || ''; if (guess) { cus = guess; nCust++; } }
      if (!nm && h['CustomerName'] !== undefined && cus && nameById[cus]) { nm = nameById[cus]; nName++; }
      if (!cli && String(data[r][h['ConnectionID']] || '').trim()) stillMissing++;
      cliCol.push([cli]); custCol.push([cus]); nameCol.push([nm]);
    }
    var n = data.length - 1;
    if (n > 0) {
      if (nClient) connSheet.getRange(2, h['ClientID'] + 1, n, 1).setValues(cliCol);
      if (nCust && h['CustomerID'] !== undefined) connSheet.getRange(2, h['CustomerID'] + 1, n, 1).setValues(custCol);
      if (nName && h['CustomerName'] !== undefined) connSheet.getRange(2, h['CustomerName'] + 1, n, 1).setValues(nameCol);
    }
    SpreadsheetApp.flush();
    return { success: true, clientIdsFilled: nClient, customerIdsFilled: nCust, namesFilled: nName, stillMissing: stillMissing };
  } catch (e) {
    return { success: false, error: 'fillMissingConnectionClientIds: ' + e.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// SERVICE REQUEST — "THIS REQUEST HAS BEEN UPDATED"
// ════════════════════════════════════════════════════════════════════
// Per the request — once a Hours / Schedule Change has been APPLIED on a VA
// Connection (schedule changed, night differential applied, hours changed, ...),
// the Service Request it came from should say so and show what changed. The
// before/after of every applied change is already recorded in
// VAConnectionHoursLog; this reads it back per request. Only Applied entries
// count (Pending / Cancelled changes haven't taken effect), and the initial
// schedule set at assignment is the starting point, not a change.

function _fmtScheduleBreakdown(raw) {
  raw = String(raw || '').trim();
  if (!raw) return '';
  try {
    var groups = JSON.parse(raw);
    if (!Array.isArray(groups)) return raw;
    var ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return groups.map(function(g) {
      var days = (g.days || []).map(function(d){ return String(d).substring(0, 3); });
      var idx = days.map(function(d){ return ORDER.indexOf(d); });
      var consecutive = days.length >= 3 && idx.every(function(v, i){ return v >= 0 && (i === 0 || v === idx[i - 1] + 1); });
      var label = consecutive ? days[0] + '–' + days[days.length - 1] : days.join(', ');
      return label + ': ' + g.hoursPerDay + 'h';
    }).join(' · ');
  } catch (e) { return raw; }
}

function getRequestUpdateHistory(requestId) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!requestId) return { success: true, data: [] };
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // The connection(s) that came from this request
    var connSheet = _connGetSheet(ss);
    var cd = connSheet.getDataRange().getValues();
    var ch = _connHMap(cd[0]);
    var vaByConn = {}, connIds = {};
    for (var i = 1; i < cd.length; i++) {
      if (String(cd[i][ch['RequestID']] || '').trim() !== requestId) continue;
      var st = String(cd[i][ch['ConnectionStatus']] || '').trim();
      if (st === 'Cancelled' || st === 'Declined') continue;
      var cid = String(cd[i][ch['ConnectionID']] || '').trim(); if (!cid) continue;
      connIds[cid] = true; vaByConn[cid] = String(cd[i][ch['VAName']] || '');
    }
    if (!Object.keys(connIds).length) return { success: true, data: [] };

    var logSheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!logSheet || logSheet.getLastRow() < 2) return { success: true, data: [] };
    var ld = logSheet.getDataRange().getValues();
    var lh = {}; ld[0].forEach(function(c, k){ if (c) lh[String(c).trim()] = k; });
    var byConn = {};
    for (var r = 1; r < ld.length; r++) {
      var cn = String(ld[r][lh['ConnectionID']] || '').trim();
      if (!connIds[cn]) continue;
      (byConn[cn] = byConn[cn] || []).push(_hoursLogMapRow(ld, r, lh));
    }

    var out = [];
    Object.keys(byConn).forEach(function(cn) {
      var rows = byConn[cn].sort(function(a, b){ return new Date(a.createdAt || 0) - new Date(b.createdAt || 0); });
      var prevNight, prevBreaks, prevReqTime = '';
      rows.forEach(function(x) {
        if (x.applyStatus !== 'Applied') return; // Pending / Cancelled changes haven't taken effect
        var reqTime = x.requiredClientTime ? (x.requiredClientTime + ' (client time)' + (x.requiredPHTime ? ' · ' + x.requiredPHTime + ' (PH)' : '')) : '';
        var isStart = (x.changeType === 'Initial Assignment' || x.changeType === 'Migration');
        if (!isStart && x.changeType !== 'Project Hours Entry') {
          var c = [];
          if (x.prevHours !== '' && x.newHours !== '' && String(x.prevHours) !== String(x.newHours)) c.push({ label: 'Hours per week', from: x.prevHours + 'h', to: x.newHours + 'h' });
          if (x.newScheduleType && x.prevScheduleType !== x.newScheduleType) c.push({ label: 'Schedule type', from: x.prevScheduleType || '', to: x.newScheduleType });
          if (x.newHoursType && x.prevHoursType !== x.newHoursType) c.push({ label: 'Hours type', from: x.prevHoursType || '', to: x.newHoursType });
          if (x.newConnectionType && x.prevConnectionType !== x.newConnectionType) c.push({ label: 'Connection type', from: x.prevConnectionType || '', to: x.newConnectionType });
          var prevSched = _fmtScheduleBreakdown(x.prevScheduleBreakdown) || x.prevScheduleDays;
          var newSched  = _fmtScheduleBreakdown(x.newScheduleBreakdown)  || x.newScheduleDays;
          if (newSched && prevSched !== newSched) c.push({ label: 'Schedule', from: prevSched || '', to: newSched });
          if (x.changeType !== 'Limited Period' && reqTime && reqTime !== prevReqTime) c.push({ label: 'Required working time', from: prevReqTime, to: reqTime });
          if (x.changeType !== 'Limited Period' && (prevNight === undefined ? x.nightDiffApplicable : x.nightDiffApplicable !== prevNight)) {
            c.push({ label: 'Night differential', from: prevNight === undefined ? '' : (prevNight ? 'Applies' : 'Does not apply'), to: x.nightDiffApplicable ? 'Applies' : 'Does not apply' });
          }
          if (x.changeType !== 'Limited Period' && prevBreaks !== undefined && x.breaksIncluded !== prevBreaks) {
            c.push({ label: 'Breaks included in total hours', from: prevBreaks ? 'Yes' : 'No', to: x.breaksIncluded ? 'Yes' : 'No' });
          }
          if (x.changeType === 'Limited Period' && x.limitHours) {
            c.push({ label: 'Limited period', from: '', to: x.limitHours + 'h per week' + (x.limitFrom ? ' from ' + x.limitFrom.substring(0, 10) : '') + (x.limitTo ? ' to ' + x.limitTo.substring(0, 10) : '') });
          }
          out.push({
            logId: x.logId, connectionId: cn, vaName: vaByConn[cn] || '', changeType: x.changeType,
            effectiveDate: x.effectiveDate, loggedAt: x.createdAt, loggedBy: x.loggedBy, appliedBy: x.appliedBy,
            notes: x.notes, changes: c
          });
        }
        // the initial schedule and every schedule-changing entry becomes the baseline for the next
        // comparison; additional-hours entries and Limited Period rows don't carry the schedule flags
        if (x.changeType !== 'Project Hours Entry' && x.changeType !== 'Limited Period') { prevNight = x.nightDiffApplicable; prevBreaks = x.breaksIncluded; if (reqTime) prevReqTime = reqTime; }
      });
    });
    out.sort(function(a, b){ return new Date(b.loggedAt || 0) - new Date(a.loggedAt || 0); });
    return { success: true, data: out };
  } catch (e) {
    return { success: false, error: 'getRequestUpdateHistory: ' + e.message };
  }
}


// Administrator-only: shows which timezones are in play and how a date typed as "Oct 15" would be stored and
// displayed in the sheet under each method — the quickest way to see whether the script and spreadsheet
// timezones disagree (Project Settings → Time zone, and File → Settings → Time zone).
function getDateStorageDiagnostics() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };
    if (user.role !== CONFIG.ROLES.ADMINISTRATOR) return { success: false, error: 'Only Administrators can run this.' };
    var scriptTz = Session.getScriptTimeZone();
    var sheetTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    var show = function(d) { return Utilities.formatDate(d, sheetTz, 'MMM d, yyyy'); };
    return {
      success: true, scriptTz: scriptTz, sheetTz: sheetTz, match: scriptTz === sheetTz,
      typed: 'Oct 15, 2026',
      previously: show(new Date(2026, 9, 15, 12, 0, 0)),   // noon in the script's timezone — the old method
      plainDateString: show(new Date('2026-10-15')),        // new Date('YYYY-MM-DD') — midnight UTC
      now: show(_safeParseDateNoon('2026-10-15'))           // noon UTC — what is saved now
    };
  } catch (e) { return { success: false, error: 'getDateStorageDiagnostics: ' + e.message }; }
}