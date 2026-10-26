// ─────────────────────────────────────────
// SheetSetup.gs — DB init & safe migration
// ─────────────────────────────────────────

function initializeSystem() {
  var stepStart = Date.now();
  function logStep(label) {
    var now = Date.now();
    Logger.log('[initializeSystem] ' + label + ' — ' + (now - stepStart) + 'ms since previous step');
    stepStart = now;
  }
  try {
    Logger.log('[initializeSystem] Starting…');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    CONFIG.SPREADSHEET_ID = ss.getId();
    logStep('Got active spreadsheet');

    _ensureAllSheets(ss);
    logStep('_ensureAllSheets complete (creates any missing sheet + header row, and migrates missing columns on existing ones, in a single pass)');

    _seedSettings(ss);
    logStep('_seedSettings complete');

    _seedRoles(ss);
    logStep('_seedRoles complete');

    _ensureAdditionalRoles(ss);
    logStep('_ensureAdditionalRoles complete');

    _seedAdminUser(ss);
    logStep('_seedAdminUser complete');

    _seedMeetingTypes(ss);
    logStep('_seedMeetingTypes complete');

    _seedEmailTemplates(ss);
    logStep('_seedEmailTemplates complete');

    _backfillEmailTemplateModule(ss);
    logStep('_backfillEmailTemplateModule complete');

    migrateRequestLogsToOwnSheet();
    logStep('migrateRequestLogsToOwnSheet complete');

    Logger.log('[initializeSystem] All steps complete.');
    return { success: true, message: 'System initialized successfully.' };
  } catch (e) {
    Logger.log('[initializeSystem] FAILED: ' + e.message);
    return { success: false, error: e.message };
  }
}

// Combines what used to be two separate full passes over every schema
// key (_ensureAllSheets, then _migrateAllSheets) into one — each table
// was being looked up via getSheetByName twice per initializeSystem()
// run, which meaningfully adds up once the schema has grown to this many
// tables, and is a likely contributor to "Service Spreadsheets timed
// out" errors during initialization.
function _ensureAllSheets(ss) {
  var schemaKeys = Object.keys(CONFIG.SCHEMA);
  for (var k = 0; k < schemaKeys.length; k++) {
    var sheetName = schemaKeys[k];
    var headers   = CONFIG.SCHEMA[sheetName];
    var sheet     = ss.getSheetByName(sheetName);
    var isNew = !sheet;
    if (!sheet) sheet = ss.insertSheet(sheetName);
    if (!sheet.getRange(1, 1).getValue()) {
      Logger.log('[_ensureAllSheets] ' + (isNew ? 'Creating' : 'Writing headers for existing empty') + ' sheet: ' + sheetName + ' (' + headers.length + ' columns)');
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      _applyHeaderStyle(sheet, 1, headers.length);
      sheet.setFrozenRows(1);
    } else {
      // Migrate this same sheet's columns right here, while it's already
      // open — folded in from the old, separate _migrateAllSheets pass.
      _migrateSheetColumnsForOpenSheet(sheet, headers);
    }
  }
}

// Targeted initialization for just the Accounting module's tabs —
// creates ClientDeptEnrollment, Deposits, BillingCycles, and Payments if
// they don't exist yet, and self-heals columns on any that already do.
// Exposed via a frontend button (see scripts-accounting.html) so this
// doesn't require Apps Script editor access the way the full
// initializeSystem() does — the module's own backend functions would
// eventually create these lazily on first use anyway, but this makes
// them appear proactively, visible in the spreadsheet right away.
function initializeAccountingModule() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can initialize the Accounting module.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tables = [
      { sheetName: CONFIG.SHEETS.ACCT_ENROLLMENT,     schema: CONFIG.SCHEMA.ClientDeptEnrollment },
      { sheetName: CONFIG.SHEETS.ACCT_DEPOSITS,       schema: CONFIG.SCHEMA.Deposits },
      { sheetName: CONFIG.SHEETS.ACCT_BILLING_CYCLES, schema: CONFIG.SCHEMA.BillingCycles },
      { sheetName: CONFIG.SHEETS.ACCT_PAYMENTS,       schema: CONFIG.SCHEMA.Payments },
      { sheetName: CONFIG.SHEETS.ACCT_RECONCILIATION, schema: CONFIG.SCHEMA.HoursReconciliation },
      { sheetName: CONFIG.SHEETS.ACCT_BOND_LEDGER,    schema: CONFIG.SCHEMA.TrainingBondLedger },
      { sheetName: CONFIG.SHEETS.IMPORT_BATCHES,      schema: CONFIG.SCHEMA.ImportBatches },
      { sheetName: CONFIG.SHEETS.ACCT_CONN_BILLING_DETAIL, schema: CONFIG.SCHEMA.ConnectionBillingDetail },
      // AttendanceRecords already existed before this session extended it
      // with new columns (NightDiffQualifyingHours, Source, ImportBatchID)
      // — needs the same self-healing migration as every other
      // already-live sheet touched this session, not just a fresh create.
      { sheetName: CONFIG.SHEETS.ATTENDANCE_RECORDS,  schema: CONFIG.SCHEMA.AttendanceRecords }
    ];
    var created = [], migrated = [];
    tables.forEach(function(t) {
      var existed = !!ss.getSheetByName(t.sheetName);
      var sheet = _ensureSheet(ss, t.sheetName, t.schema);
      if (!existed) { created.push(t.sheetName); }
      else {
        var before = sheet.getLastColumn();
        _migrateSheetColumns(ss, t.sheetName, t.schema);
        if (sheet.getLastColumn() > before) migrated.push(t.sheetName);
      }
    });
    _writeLog('System', 'ACCOUNTING_INIT', 'MODULE_INITIALIZED', '', '', created.join(', ') || '(already existed)', perm.user);
    return { success: true, created: created, migrated: migrated };
  } catch (e) {
    return { success: false, error: 'initializeAccountingModule: ' + e.message };
  }
}

// ── Standalone helper for individual sheet init (used by service files)
function _ensureSheet(ss, sheetName, schemaColumns) {
  try {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    if (schemaColumns && !sheet.getRange(1, 1).getValue()) {
      sheet.getRange(1, 1, 1, schemaColumns.length).setValues([schemaColumns]);
      _applyHeaderStyle(sheet, 1, schemaColumns.length);
      sheet.setFrozenRows(1);
    }
    return sheet;
  } catch(e) {
    Logger.log('_ensureSheet ' + sheetName + ': ' + e.message);
    return ss.getSheetByName(sheetName);
  }
}

// Adds any columns from expectedCols that the sheet's actual header row is
// missing — the self-healing half of _migrateAllSheets, extracted so a
// critical write function (e.g. createInquiry) can call this for just its
// own sheet inline, rather than only ever running as part of a full
// initializeSystem() pass someone has to remember to trigger. Safe to
// call on every write — a no-op once the columns already match.
function _migrateSheetColumns(ss, sheetName, expectedCols) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || !expectedCols) return;
  _migrateSheetColumnsForOpenSheet(sheet, expectedCols);
}

// Same logic as _migrateSheetColumns, but for a caller that already has
// the sheet object open — avoids a redundant getSheetByName lookup.
// Extracted specifically for _ensureAllSheets, which already looks up
// every sheet once per initializeSystem() pass; the old, separate
// _migrateAllSheets pass used to look each one up again independently.
function _migrateSheetColumnsForOpenSheet(sheet, expectedCols) {
  if (!sheet || !expectedCols) return;
  var lastCol = sheet.getLastColumn();
  var currentCols = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var missing = [];
  for (var c = 0; c < expectedCols.length; c++) {
    if (currentCols.indexOf(expectedCols[c]) === -1) missing.push(expectedCols[c]);
  }
  if (!missing.length) return;
  // One batched write for every missing column, instead of separate
  // setValue/setBackground/setFontColor/setFontWeight calls per column —
  // each of those was its own API round-trip, and a sheet missing many
  // columns at once (common after a schema grows a lot in one session)
  // could mean dozens of sequential calls on every single read.
  var startCol = lastCol + 1;
  sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
  _applyHeaderStyle(sheet, startCol, startCol + missing.length - 1);
  Logger.log('Migration: added [' + missing.join(', ') + '] to "' + sheet.getName() + '"');
}

function _applyHeaderStyle(sheet, fromCol, toCol) {
  if (toCol === undefined) toCol = fromCol;
  var colCount = toCol - fromCol + 1;
  if (colCount < 1) return;
  sheet.getRange(1, fromCol, 1, colCount)
    .setBackground('#1e293b')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
}

function _seedSettings(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  var data  = sheet.getDataRange().getValues();

  // Get existing setting IDs and category+value combos to avoid re-seeding
  var existingKeys = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) existingKeys[String(data[i][1]) + '||' + String(data[i][2])] = true;
  }

  var now = new Date();
  var defaults = [
    // Categories
    ['SET001', 'Category',     'Seller',            'Seller',            1, true, now, now],
    ['SET002', 'Category',     'Big Seller',         'Big Seller',        2, true, now, now],
    ['SET003', 'Category',     'Agency',             'Agency',            3, true, now, now],
    ['SET004', 'Category',     'Consultancy',        'Consultancy',       4, true, now, now],
    ['SET005', 'Category',     'Aggregator',         'Aggregator',        5, true, now, now],
    // Types
    ['SET006', 'Type',         'Silver',             'Silver',            1, true, now, now],
    ['SET007', 'Type',         'Gold',               'Gold',              2, true, now, now],
    ['SET008', 'Type',         'Platinum',           'Platinum',          3, true, now, now],
    // Country/Region
    ['SET009', 'CountryRegion','Israel',             'Israel',            1, true, now, now],
    ['SET010', 'CountryRegion','United Kingdom',     'United Kingdom',    2, true, now, now],
    ['SET011', 'CountryRegion','USA - New Jersey',   'USA - New Jersey',  3, true, now, now],
    // Departments
    ['SET012', 'Department',   'Customer Success',   'Customer Success',  1, true, now, now],
    ['SET013', 'Department',   'Operations',         'Operations',        2, true, now, now],
    ['SET014', 'Department',   'Finance',            'Finance',           3, true, now, now],
    // Services (with parent department in column 9)
    ['SET015', 'Service', 'Account Management', 'Account Management', 1, true, now, now, 'Customer Success'],
    ['SET016', 'Service', 'Virtual Assistant',  'Virtual Assistant',  2, true, now, now, 'Operations'],
    ['SET017', 'Service', 'Consulting',         'Consulting',         3, true, now, now, 'Customer Success'],
    // Schedule Types
    ['SET018', 'ScheduleType', 'Fixed',              'Fixed',             1, true, now, now],
    ['SET019', 'ScheduleType', 'Flexible',           'Flexible',          2, true, now, now],
    ['SET020', 'ScheduleType', 'Project-based',      'Project-based',     3, true, now, now],
    ['SET021', 'ScheduleType', 'Weekly Fixed',       'Weekly Fixed',      4, true, now, now],
    ['SET022', 'ScheduleType', 'Weekly Flexible',    'Weekly Flexible',   5, true, now, now],
    // Request Types
    ['SET023', 'RequestType',  'New',                'New',               1, true, now, now],
    ['SET024', 'RequestType',  'Additional',         'Additional',        2, true, now, now],
    ['SET025', 'RequestType',  'Replacement',        'Replacement',       3, true, now, now],
    ['SET026', 'RequestType',  'Reliever',           'Reliever',          4, true, now, now],
    // Hours/Schedule Change — distinct from "Additional" (which means a NEW
    // VA being added). This is for an EXISTING, already-active VA: either
    // more hours for a project-based VA, or a change to their schedule/
    // hours arrangement. Not a concern/inquiry ticket, not a new assignment.
    ['SET023B', 'RequestType', 'Hours/Schedule Change', 'Hours/Schedule Change', 5, true, now, now],
    ['SET027', 'TerminationReason', 'Client request',       'Client request',          1, true, now, now],
    ['SET028', 'TerminationReason', 'Budget constraints',   'Budget constraints',      2, true, now, now],
    ['SET029', 'TerminationReason', 'Service dissatisfaction', 'Service dissatisfaction', 3, true, now, now],
    ['SET030', 'TerminationReason', 'Business closure',     'Business closure',        4, true, now, now],
    ['SET031', 'TerminationReason', 'Switched to competitor','Switched to competitor',  5, true, now, now],
    ['SET032', 'TerminationReason', 'Contract ended',       'Contract ended',          6, true, now, now],
    ['SET033', 'TerminationReason', 'Non-payment',              'Non-payment',                7, true, now, now],
    // ── Inquiry Types
    ['SET034', 'InquiryType', 'VA-Related Concern',         'VA-Related Concern',         1, true, now, now],
    ['SET035', 'InquiryType', 'Payment / Account Concern',  'Payment / Account Concern',  2, true, now, now],
    ['SET036', 'InquiryType', 'General Inquiry',            'General Inquiry',            3, true, now, now],
    ['SET042', 'InquiryType', 'Termination',                'Termination',                4, true, now, now],
    // ── Inquiry Lost Reasons
    ['SET037', 'InquiryLostReason', 'Issue could not be resolved', 'Issue could not be resolved', 1, true, now, now],
    ['SET038', 'InquiryLostReason', 'Client withdrew inquiry',     'Client withdrew inquiry',     2, true, now, now],
    ['SET039', 'InquiryLostReason', 'Duplicate inquiry',           'Duplicate inquiry',           3, true, now, now],
    ['SET040', 'InquiryLostReason', 'No response from client',     'No response from client',     4, true, now, now],
    ['SET041', 'InquiryLostReason', 'Out of scope',                'Out of scope',                5, true, now, now],
    ['SET043', 'VARequestLostReason', 'Client went with another provider', 'Client went with another provider', 1, true, now, now],
    ['SET044', 'VARequestLostReason', 'Client no longer needs the service', 'Client no longer needs the service', 2, true, now, now],
    ['SET045', 'VARequestLostReason', 'Budget constraints',               'Budget constraints',               3, true, now, now],
    ['SET046', 'VARequestLostReason', 'No response from client',          'No response from client',          4, true, now, now],
    ['SET047', 'VARequestLostReason', 'Duplicate request',                'Duplicate request',                5, true, now, now],
    ['SET048', 'VARequestLostReason', 'Other',                            'Other',                            6, true, now, now]
  ];

  var toAdd = defaults.filter(function (row) {
    return !existingKeys[row[1] + '||' + row[2]];
  });
  if (toAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 8).setValues(toAdd);
  }
}

function _seedMeetingTypes(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.MEETING_TYPES);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();

  var now = new Date();
  // TypeID, Label, ShortName, OffsetValue, OffsetUnit, OffsetDays(precomputed calendar days,
  // used only as a display fallback — actual scheduling uses OffsetValue+OffsetUnit).
  // Onboarding has a null OffsetValue deliberately — it's excluded from
  // automatic cadence generation (generateMeetingsForConnection skips any
  // type with a null offset as "ad-hoc"), since this is a retroactive
  // confirmation made when a VA actually starts (via "Mark Started"), not
  // a future check-in to schedule ahead of time.
  var defaults = [
    ['MTY000', 'Onboarding Meeting', 'OB', null, '', 0, true, 0],
    ['MTY001', 'Week 2 Check-in',  'W2', 2, 'week',  14,  true, 1],
    ['MTY002', 'Month 1 Review',   'M1', 1, 'month', 30,  true, 2],
    ['MTY003', 'Month 2 Review',   'M2', 2, 'month', 60,  true, 3],
    ['MTY004', 'Month 3 Review',   'M3', 3, 'month', 90,  true, 4],
    ['MTY005', 'Month 6 Review',   'M6', 6, 'month', 180, true, 5],
    ['MTY006', 'Year 1 Review',    'Y1', 1, 'year',  365, true, 6]
  ];

  // Check per-type by ShortName rather than skipping entirely if the
  // sheet already has any rows — otherwise a type added here later (like
  // Onboarding just now) would silently never get seeded on a live sheet
  // that was already initialized before this addition existed.
  var existingShortNames = {};
  for (var i = 1; i < data.length; i++) { existingShortNames[String(data[i][2]||'')] = true; }

  defaults.forEach(function(row) {
    if (existingShortNames[row[2]]) return; // already exists — don't duplicate
    sheet.appendRow([row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], now, 'system', now, 'system']);
  });
}

// These three roles are referenced throughout the app's nav-permission
// checks (NAV_ROLE_DEFAULT in scripts-core.html) and are selectable in the
// Add/Edit User form, but never had an actual Roles-sheet row — meaning
// anyone assigned one of these roles silently fell back to generic
// _defaultPermissions() instead of permissions tailored to what they
// actually do. _seedRoles only ever fires once, on a completely empty
// sheet, so this runs separately and adds only whatever's missing —
// safe to re-run on an already-seeded deployment.
function _ensureAdditionalRoles(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.ROLES);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  var existingNames = {};
  for (var i = 1; i < data.length; i++) { existingNames[String(data[i][1]||'')] = true; }
  var now = new Date();
  // [id, name, canDelete, canEdit, requiresApproval, canManageSettings, canAssignVA, canViewReports, createdAt]
  var toAdd = [
    ['ROL005', 'HR Specialist',        false, true,  false, false, true,  true, now],
    ['ROL006', 'HR Manager',           false, true,  false, false, true,  true, now],
    ['ROL007', 'Service Manager',      false, true,  false, false, true,  true, now],
    ['ROL008', 'Accounting',           false, true,  false, false, false, true, now],
    ['ROL009', 'Recruitment Specialist', false, true,  false, false, false, true, now],
    ['ROL010', 'Training Manager',     false, true,  false, false, false, true, now],
    ['ROL011', 'Executive',            false, true,  false, false, false, true, now],
    ['ROL012', 'Executive Support',    false, true,  false, false, false, true, now]
  ].filter(function(r) { return !existingNames[r[1]]; });
  toAdd.forEach(function(row) { sheet.appendRow(row); });

  // Correction, not just addition — a Service Manager row that already
  // existed (e.g. created before this role was allowed to assign VAs, or
  // just never migrated) would otherwise keep whatever stale CanAssignVA
  // value it already had forever, since the "add if missing" logic above
  // only touches completely absent rows.
  var hRow = data[0];
  var roleNameCol = hRow.indexOf('RoleName');
  var canAssignVACol = hRow.indexOf('CanAssignVA');
  if (roleNameCol !== -1 && canAssignVACol !== -1) {
    for (var ri = 1; ri < data.length; ri++) {
      if (String(data[ri][roleNameCol]||'') === 'Service Manager' && data[ri][canAssignVACol] !== true) {
        sheet.getRange(ri+1, canAssignVACol+1).setValue(true);
      }
    }
  }
}

function _seedRoles(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.ROLES);
  var data  = sheet.getDataRange().getValues();
  if (data.length > 1 && data[1][0]) return;
  var now = new Date();
  var roles = [
    ['ROL001', 'Administrator', true,  true,  false, true,  true,  true,  now],
    ['ROL002', 'CS Manager',    true,  true,  false, false, true,  true,  now],
    ['ROL003', 'CS Specialist', false, true,  true,  false, false, true,  now],
    ['ROL004', 'Manager',       false, false, false, false, true,  true,  now]
  ];
  sheet.getRange(2, 1, roles.length, 9).setValues(roles);
}

function _seedAdminUser(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  var data  = sheet.getDataRange().getValues();
  if (data.length > 1 && data[1][0]) return;
  var email = Session.getActiveUser().getEmail();
  var now   = new Date();
  sheet.getRange(2, 1, 1, 7).setValues([['USR001', email, 'System Admin', 'Administrator', true, now, now]]);
}

// One default template per Birthday/Anniversary × Notify/Follow-up category —
// these are starting points only; CS can edit before every send, and admins
// can add more via the Email Templates module (Settings → Email Templates).
// Placeholders: {{vaName}}, {{clientName}}, {{accountName}}, {{years}}
function _seedEmailTemplates(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.EMAIL_TEMPLATES);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  if (data.length > 1) return; // already seeded — don't duplicate on re-run

  var now = new Date();
  var C = CONFIG.EMAIL_TEMPLATE_CATEGORY;
  var M = 'Celebrations';
  var defaults = [
    ['EMT001', M, C.BIRTHDAY_NOTIFY, 'Default Birthday Notice',
      "It's {{vaName}}'s Birthday! 🎉",
      "Hi there,\n\nJust a friendly note that {{vaName}}'s birthday is coming up soon! We wanted to give you the chance to send a quick birthday greeting if you'd like.\n\nWarm regards,\nYour CS Team"],
    ['EMT002', M, C.BIRTHDAY_FOLLOWUP, 'Default Birthday Follow-up',
      "Following up — {{vaName}}'s Birthday",
      "Hi again,\n\nJust circling back in case you'd still like to send {{vaName}} a birthday message — it would mean a lot!\n\nWarm regards,\nYour CS Team"],
    ['EMT003', M, C.ANNIVERSARY_NOTIFY, 'Default Work Anniversary Notice',
      "Celebrating {{years}} Year(s) with {{vaName}}!",
      "Hi {{clientName}},\n\nWe wanted to let you know that it's coming up on {{years}} year(s) since {{vaName}} started working with {{accountName}}! We're grateful for the partnership and wanted to give you the opportunity to celebrate the milestone if you'd like.\n\nWarm regards,\nYour CS Team"],
    ['EMT004', M, C.ANNIVERSARY_FOLLOWUP, 'Default Work Anniversary Follow-up',
      "Following up — {{vaName}}'s Work Anniversary",
      "Hi {{clientName}},\n\nJust following up on {{vaName}}'s upcoming {{years}}-year anniversary with {{accountName}} — let us know if you'd like to mark the occasion!\n\nWarm regards,\nYour CS Team"],
    // Welcome Email templates — chosen by the CS Manager when sending a
    // Welcome Email upon Account creation. Module is 'Customer Onboarding'
    // for all three; Category is left blank since that field is
    // specifically for celebration sub-types, which don't apply here.
    ['EMT005', 'Customer Onboarding', '', 'Welcome Email — Standard',
      "Welcome to {{accountName}}, {{clientName}}!",
      "Hi {{clientName}},\n\nWelcome aboard! We're excited to have {{accountName}} with us. Your dedicated CS Specialist will be reaching out shortly to get things started.\n\nIf you have any questions in the meantime, don't hesitate to reach out.\n\nWarm regards,\nYour CS Team"],
    ['EMT006', 'Customer Onboarding', '', 'Welcome Email — Detailed Onboarding',
      "Getting Started with {{accountName}}",
      "Hi {{clientName}},\n\nWelcome to the team! Here's what to expect next:\n1. Your CS Specialist will reach out within 24 hours.\n2. We'll confirm your schedule and requirements.\n3. Your VA will be introduced once assigned.\n\nWe're looking forward to a great partnership.\n\nWarm regards,\nYour CS Team"],
    ['EMT007', 'Customer Onboarding', '', 'Welcome Email — Brief',
      "Welcome, {{clientName}}!",
      "Hi {{clientName}},\n\nThanks for choosing us. We'll be in touch shortly with next steps.\n\nWarm regards,\nYour CS Team"]
  ];
  defaults.forEach(function(row) {
    sheet.appendRow([row[0], row[1], row[2], row[3], row[4], row[5], '', true, true, true, now, 'system', now, 'system']);
  });
}

function _backfillEmailTemplateModule(ss) {
  try {
    var sheet = ss.getSheetByName(CONFIG.SHEETS.EMAIL_TEMPLATES);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    if (h['Module'] === undefined || h['Category'] === undefined) return;
    for (var i = 1; i < data.length; i++) {
      var existingModule = String(data[i][h['Module']]||'');
      var existingCategory = String(data[i][h['Category']]||'');
      if (!existingModule && existingCategory) {
        sheet.getRange(i+1, h['Module']+1).setValue('Celebrations');
      }
    }
  } catch (e) {
    Logger.log('_backfillEmailTemplateModule error: ' + e.message);
  }
}

function generateID(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
}