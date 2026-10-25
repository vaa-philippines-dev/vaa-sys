// ══════════════════════════════════════════════════════════════════════
// Page Load Monitoring — captures how long each module actually takes to
// load, per the request: user name, email, module, load time in seconds,
// flagged when that exceeds 90 seconds.
// ══════════════════════════════════════════════════════════════════════

function _pllGetSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.PAGE_LOAD_LOGS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.PAGE_LOAD_LOGS);
    var headers = CONFIG.SCHEMA.PageLoadLogs;
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    _migrateSheetColumns(ss, CONFIG.SHEETS.PAGE_LOAD_LOGS, CONFIG.SCHEMA.PageLoadLogs);
  }
  return sheet;
}

// Called by the frontend once a page/module finishes loading — see the
// MutationObserver in scripts-core.html's navigate(), which detects when
// a page's own loading spinner is removed and calls this with the
// elapsed time. Never blocks or reports failure back to the page itself
// — a logging call failing should never be visible to the person using
// the app, so errors are swallowed here rather than surfaced.
function logPageLoadTime(moduleName, loadTimeSeconds) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: 'Could not identify user.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _pllGetSheet(ss);
    var h = {}; sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    var seconds = parseFloat(loadTimeSeconds) || 0;
    var row = new Array(Object.keys(h).length).fill('');
    row[h['LogID']]           = generateID('PLL');
    row[h['UserName']]        = user.name || user.email;
    row[h['UserEmail']]       = user.email;
    row[h['Module']]          = String(moduleName || '');
    row[h['LoadTimeSeconds']] = seconds;
    row[h['IsFlagged']]       = seconds > 90;
    row[h['CreatedAt']]       = new Date();
    sheet.appendRow(row);

    return { success: true };
  } catch (e) {
    Logger.log('logPageLoadTime error: ' + e.message);
    return { success: false, error: 'logPageLoadTime: ' + e.message };
  }
}

// For a future reporting view, if wanted — every logged load, most
// recent first, with flagged ones easy to filter on the frontend.
function getPageLoadLogs(filters) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can view this.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.PAGE_LOAD_LOGS);
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['LogID']]) continue;
      rows.push({
        logId:           String(data[i][h['LogID']]||''),
        userName:        String(data[i][h['UserName']]||''),
        userEmail:       String(data[i][h['UserEmail']]||''),
        module:          String(data[i][h['Module']]||''),
        loadTimeSeconds: parseFloat(data[i][h['LoadTimeSeconds']])||0,
        isFlagged:       _toBool(data[i][h['IsFlagged']]),
        createdAt:       data[i][h['CreatedAt']] instanceof Date ? data[i][h['CreatedAt']].toISOString() : String(data[i][h['CreatedAt']]||'')
      });
    }
    rows.sort(function(a,b){ return new Date(b.createdAt) - new Date(a.createdAt); });
    if (filters && filters.flaggedOnly) rows = rows.filter(function(r){ return r.isFlagged; });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getPageLoadLogs: ' + e.message };
  }
}