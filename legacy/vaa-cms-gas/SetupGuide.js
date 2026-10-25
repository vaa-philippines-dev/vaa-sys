// ─────────────────────────────────────────
// SetupGuide.gs — Diagnostics & setup helper
//
// IF YOU SEE RAW CODE IN THE BROWSER:
// ─────────────────────────────────────────
// That means GAS found duplicate function names across .gs files.
// The most common cause is a default 'Code.gs' file that still
// has old code in it.
//
// TO FIX:
//  1. In the Apps Script editor, look for 'Code.gs'
//  2. Select ALL content in Code.gs and DELETE it (leave the file empty)
//     OR right-click the file and choose Remove
//  3. Make sure NO other .gs file defines these functions:
//     doGet, include, getInitialData, generateID, initializeSystem
//  4. Save all files
//  5. Deploy > Manage Deployments > click the pencil icon on your
//     deployment > Version: "New version" > Deploy
//  6. Reload the app URL
// ─────────────────────────────────────────

// Run this function from the Apps Script editor to check for issues.
// View > Logs to see the output.
function runDiagnostics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('=== CMS Diagnostics ===');
  Logger.log('Spreadsheet: ' + ss.getName() + ' (' + ss.getId() + ')');
  Logger.log('User: ' + Session.getActiveUser().getEmail());

  // Check all expected sheets
  var expectedSheets = Object.values(CONFIG.SHEETS);
  var missing = [];
  expectedSheets.forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      missing.push(sheetName);
      Logger.log('MISSING sheet: ' + sheetName);
    } else {
      var rowCount = Math.max(0, sheet.getLastRow() - 1);
      Logger.log('OK: ' + sheetName + ' (' + rowCount + ' data rows)');
    }
  });

  if (missing.length > 0) {
    Logger.log('');
    Logger.log('ACTION REQUIRED: Run initializeSystem() to create missing sheets.');
  } else {
    Logger.log('');
    Logger.log('All sheets present. If the app still fails, check for duplicate functions.');
  }

  // Check settings seeding
  var settingsSheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  if (settingsSheet) {
    var settingsCount = Math.max(0, settingsSheet.getLastRow() - 1);
    Logger.log('Settings rows: ' + settingsCount + (settingsCount === 0 ? ' — run initializeSystem() to seed' : ''));
  }

  // Check users
  var usersSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  if (usersSheet) {
    var usersCount = Math.max(0, usersSheet.getLastRow() - 1);
    Logger.log('Users: ' + usersCount);
  }

  Logger.log('=== End Diagnostics ===');
  return 'Diagnostics complete. Open View > Logs to see results.';
}