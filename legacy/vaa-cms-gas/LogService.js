// ─────────────────────────────────────────
// LogService.gs — Shared activity logging
// ─────────────────────────────────────────

// One-time migration — moves every existing VARequest-type row out of the
// generic ActivityLogs sheet and into the new, dedicated
// RequestActivityLogs sheet. Naturally idempotent: once no VARequest rows
// remain in ActivityLogs, later calls simply find nothing left to move,
// so it's safe to call on every initializeSystem() run without
// duplicating anything.
function migrateRequestLogsToOwnSheet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var oldSheet = ss.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
    if (!oldSheet) return { success: true, migrated: 0 };
    var data = oldSheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, migrated: 0 };

    var h = {};
    data[0].forEach(function(c, i) { if (c) h[String(c).trim()] = i; });
    if (h['EntityType'] === undefined) return { success: true, migrated: 0 };

    var rowsToMove = [];
    var rowNumsToDelete = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['EntityType']]||'') !== 'VARequest') continue;
      rowsToMove.push(data[i]);
      rowNumsToDelete.push(i + 1);
    }
    if (!rowsToMove.length) return { success: true, migrated: 0 };

    var newSheet = _ensureSheet(ss, CONFIG.SHEETS.REQUEST_ACTIVITY_LOGS, CONFIG.SCHEMA.RequestActivityLogs);
    // Append in the same column order the old sheet actually had — not
    // assumed to already match CONFIG.SCHEMA.ActivityLogs's order, in
    // case that sheet's header ever drifted historically. Re-maps each
    // row into the new sheet's own header order explicitly, rather than
    // copying positionally, so this is safe even if the two ever differ.
    var newHeaderRow = newSheet.getRange(1, 1, 1, newSheet.getLastColumn()).getValues()[0];
    var newH = {}; newHeaderRow.forEach(function(c, i) { if (c) newH[String(c).trim()] = i; });
    var width = newHeaderRow.length;

    var remapped = rowsToMove.map(function(oldRow) {
      var newRow = new Array(width).fill('');
      Object.keys(h).forEach(function(colName) {
        if (newH[colName] !== undefined) newRow[newH[colName]] = oldRow[h[colName]];
      });
      return newRow;
    });
    newSheet.getRange(newSheet.getLastRow() + 1, 1, remapped.length, width).setValues(remapped);

    // Delete from the old sheet in descending row-number order, so
    // removing one row doesn't shift the row numbers of the others still
    // queued for deletion.
    rowNumsToDelete.sort(function(a, b) { return b - a; });
    rowNumsToDelete.forEach(function(rn) { oldSheet.deleteRow(rn); });

    return { success: true, migrated: rowsToMove.length };
  } catch (e) {
    Logger.log('migrateRequestLogsToOwnSheet error: ' + e.message);
    return { success: false, error: 'migrateRequestLogsToOwnSheet: ' + e.message };
  }
}

// Classifies a Customer or Client/Account status transition into one of
// the 6 explicit actions requested, rather than every call site logging
// a generic "UPDATE" regardless of what actually happened. Shared across
// every place a status change gets written to ActivityLogs, so this
// stays consistent everywhere rather than each site classifying it
// slightly differently (or not at all).
function _classifyStatusChangeAction(oldStatus, newStatus) {
  var TERMINAL = ['Terminated', 'Cancelled'];
  if (oldStatus === newStatus) return 'UPDATE';
  if (oldStatus === 'Pending' && newStatus === 'Active') return 'ACTIVATED';
  if (TERMINAL.indexOf(oldStatus) !== -1 && newStatus === 'Active') return 'REACTIVATED';
  if (oldStatus === 'Paused' && newStatus === 'Active') return 'RESUMED';
  if (newStatus === 'Paused') return 'PAUSED';
  if (newStatus === 'Cancelled') return 'CANCELLED';
  if (newStatus === 'Terminated') return 'TERMINATED';
  return 'UPDATE';
}

function _writeLog(entityType, entityId, action, fieldChanged, oldValue, newValue, user, effectiveDate, notes) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // Service Request activity gets its own sheet, separate from every
    // other entity type's ActivityLogs — routed here, at the single
    // shared write point, so no caller anywhere else needs to know this
    // split exists. getLogs() below merges the two back together
    // transparently for reading.
    var sheet = (String(entityType) === 'VARequest')
      ? _ensureSheet(ss, CONFIG.SHEETS.REQUEST_ACTIVITY_LOGS, CONFIG.SCHEMA.RequestActivityLogs)
      : ss.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
    if (!sheet) return;
    _ensureActivityLogEffectiveDateHeader(sheet);

    var now = new Date();
    var effVal = now; // default: no explicit backdate → EffectiveDate matches Timestamp, never left blank
    if (effectiveDate) {
      var parsedEff = new Date(effectiveDate);
      if (!isNaN(parsedEff.getTime())) effVal = parsedEff;
    }

    // Built by looking up each column's actual position in the header row
    // rather than assuming a fixed array order. appendRow writes strictly
    // by position, so if this sheet's header row ever drifted out of sync
    // with CONFIG.SCHEMA.ActivityLogs's order for any historical reason,
    // a fixed-position array would silently write values into the wrong
    // columns — which is the most likely explanation for Timestamp
    // appearing empty despite always being set here.
    var lastCol = sheet.getLastColumn();
    var headerRow = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var h = {};
    headerRow.forEach(function(col, i) { if (col) h[String(col).trim()] = i; });

    var width = Math.max(lastCol, 12); // schema has 12 columns; never write a shorter row than what's already there
    var row = new Array(width).fill('');
    function set(col, val) { if (h[col] !== undefined) row[h[col]] = val; }
    set('LogID',          generateID('LOG'));
    set('EntityType',     String(entityType    || ''));
    set('EntityID',       String(entityId      || ''));
    set('Action',         String(action        || ''));
    set('FieldChanged',   String(fieldChanged  || ''));
    set('OldValue',       String(oldValue      || '').substring(0, 500));
    set('NewValue',       String(newValue      || '').substring(0, 500));
    set('ChangedBy',      user ? String(user.name  || user.email || '') : 'System');
    set('ChangedByEmail', user ? String(user.email || '') : '');
    set('Timestamp',      now); // always when this was actually recorded, never backdated
    set('Notes',          String(notes || ''));
    set('EffectiveDate',  effVal); // when the change actually took effect — defaults to now if not explicitly backdated

    sheet.appendRow(row);
  } catch (e) {
    Logger.log('_writeLog error: ' + e.message);
  }
}

// On any deployment that existed before EffectiveDate was added to the
// schema, the sheet's header row never got that 12th column labeled —
// appendRow has still been writing the value into that column position all
// along (appendRow writes by position, not by header name), it just had no
// name for getLogs to find it by. This adds the missing header once, cheap
// enough to check on every write (a single row read, and only writes
// anything if it's actually missing).
function _ensureActivityLogEffectiveDateHeader(sheet) {
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  var headerRow = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var hasEffectiveDate = headerRow.some(function(c) { return String(c||'').trim() === 'EffectiveDate'; });
  if (hasEffectiveDate) return;
  // EffectiveDate is always the 12th column per CONFIG.SCHEMA.ActivityLogs.
  // Using that fixed position rather than lastCol+1 matters here: if any
  // writes already happened since the schema added this column, appendRow
  // would have already been writing values into column 12 despite there
  // being no header for it yet — meaning lastCol may already report 12,
  // and lastCol+1 would put the new header one column past the data it's
  // actually meant to label.
  sheet.getRange(1, 12).setValue('EffectiveDate');
}

function _logChanges(entityType, entityId, oldObj, newObj, user) {
  var tracked = [
    'customerName', 'companyName', 'accountName',
    'primaryContact', 'primaryRole', 'primaryEmail',
    'secondaryContact', 'secondaryRole', 'secondaryEmail',
    'accountManagers', 'invoiceContactName', 'invoiceContactRole', 'invoiceContactEmail',
    'category', 'type', 'countryRegion', 'status', 'isReturning', 'notes',
    'sellerOnboardingLink', 'contractId'
  ];
  for (var i = 0; i < tracked.length; i++) {
    var field  = tracked[i];
    var oldVal = String(oldObj && oldObj[field] != null ? oldObj[field] : '');
    var newVal = String(newObj && newObj[field] != null ? newObj[field] : '');
    if (oldVal !== newVal) {
      _writeLog(entityType, entityId, 'UPDATE', field, oldVal, newVal, user);
    }
  }
}

// ── Status-change log readers ───────────────────────────────────────────
// ActivityLogs (via _writeLog above) has been recording every status change
// since this system was first built — long before some entities' own
// StatusHistory JSON column existed (that was added later; see
// CustomerService.gs). That means ActivityLogs is often the ONLY record of
// an entity's older transitions (e.g. a customer that went Active back in
// 2022), while StatusHistory only has whatever happened after that column
// was added. Any module that needs a complete "when did this status change"
// answer — not just the audit page — should read BOTH and merge, which is
// exactly what getCustomerActivationEvents() below does for Customers.

// Bulk reader: one full ActivityLogs scan, returns entityId → [{oldValue,
// newValue, timestamp, changedBy, changedByEmail}] for a given entityType +
// fieldChanged. Used by callers that need to check MANY entities at once
// (e.g. the Audit page scanning every customer) — one sheet read instead of
// one per entity.
// `entityType` can be a single string or an array of acceptable values.
// This matters for Accounts specifically: current code always writes
// EntityType='Client' (see ClientService.gs/_writeLog calls), but older
// ActivityLogs rows — from before that convention was standardized — were
// written with EntityType='Account' (e.g. "LOG_TERAC000001  Account
// CLT_3D0593966C57  UPDATE  Status  Active  Terminated  ...  Aug 31 2022").
// Reading only 'Client' would silently miss that older history, so callers
// for Accounts pass ['Client','Account'] to get both.
function _getStatusChangeLogsByEntityType(entityType, fieldChanged) {
  var out = {};
  var acceptedTypes = Array.isArray(entityType) ? entityType : [entityType];
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
    if (!sheet) return out;
    var data = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (acceptedTypes.indexOf(String(row[h['EntityType']] || '')) === -1) continue;
      if (String(row[h['FieldChanged']] || '') !== fieldChanged) continue;
      var eid = String(row[h['EntityID']] || ''); if (!eid) continue;
      var ts  = h['EffectiveDate'] !== undefined && row[h['EffectiveDate']] ? row[h['EffectiveDate']] : row[h['Timestamp']];
      if (!out[eid]) out[eid] = [];
      out[eid].push({
        action:         String(row[h['Action']]         || ''),
        oldValue:       String(row[h['OldValue']]       || ''),
        newValue:       String(row[h['NewValue']]       || ''),
        timestamp:      (ts instanceof Date) ? ts.toISOString() : String(ts || ''),
        changedBy:      String(row[h['ChangedBy']]      || ''),
        changedByEmail: String(row[h['ChangedByEmail']] || '')
      });
    }
  } catch (e) {
    Logger.log('_getStatusChangeLogsByEntityType: ' + e.message);
  }
  return out;
}

// Single-entity version — same filter, just for one EntityID. Used when only
// one record needs checking (e.g. opening one customer's timeline) so a
// full bulk index isn't worth building.
function _getStatusChangeLogsForEntity(entityType, entityId, fieldChanged) {
  var all = _getStatusChangeLogsByEntityType(entityType, fieldChanged);
  return all[String(entityId)] || [];
}

// Public, reusable: merges Customer StatusHistory (JSON column) with
// ActivityLogs' Status-field entries into one deduplicated, chronological
// list of activation-relevant events for a single customer. Any module —
// not just the Audit page — that needs to know "when did this customer
// become Active / Paused / Terminated" should call this rather than reading
// StatusHistory alone, since that column can be missing exactly the events
// that predate it.
function getCustomerActivationEvents(customerId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!sheet) return { success: false, error: 'Customers sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']] || '').trim() !== String(customerId).trim()) continue;
      var historyRaw = h['StatusHistory'] !== undefined ? data[i][h['StatusHistory']] : '';
      var statusLogs = _getStatusChangeLogsForEntity('Customer', customerId, 'Status');
      var events = _mergeStatusEvents(historyRaw, statusLogs);
      return { success: true, events: events };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: 'getCustomerActivationEvents: ' + e.message };
  }
}

// Shared merge/dedupe logic — used by getCustomerActivationEvents() above
// and directly by AuditService.gs (which already has the row data loaded
// and shouldn't re-read the Customers sheet just to call the function above).
// Dedup rule: a StatusHistory entry and an ActivityLogs entry are treated as
// the SAME event if they land on the same to-status within 24 hours of each
// other (ActivityLogs has a precise timestamp; StatusHistory dates can be
// date-only) — StatusHistory's version wins since it also carries a reason.
function _mergeStatusEvents(historyRaw, statusLogs) {
  var history = [];
  if (historyRaw) {
    try { history = JSON.parse(historyRaw); if (!Array.isArray(history)) history = []; }
    catch (e) { history = []; }
  }
  var fromHistory = history.map(function(ev) {
    return { from: ev.from, to: ev.to, date: ev.date, reason: ev.reason || '', by: ev.by || '', manual: !!ev.manual, source: 'history' };
  });
  var fromLogs = (statusLogs || []).map(function(lg) {
    return { from: lg.oldValue, to: lg.newValue, date: lg.timestamp, reason: '', by: lg.changedByEmail || lg.changedBy || '', manual: lg.action === 'AUDIT_BACKFILL', source: 'log' };
  });
  var merged = [];
  fromLogs.forEach(function(logEv) {
    var dup = fromHistory.some(function(histEv) {
      if (histEv.to !== logEv.to) return false;
      var diffMs = Math.abs(new Date(histEv.date) - new Date(logEv.date));
      return diffMs <= 24 * 60 * 60 * 1000;
    });
    if (!dup) merged.push(logEv);
  });
  merged = merged.concat(fromHistory);
  merged.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
  return merged;
}

function getLogs(filters) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var rows = [];

    // Reads one sheet's worth of log rows into the shared `rows` array —
    // used for both ActivityLogs and RequestActivityLogs below, since
    // they're structurally identical.
    function readLogSheet(sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;
      var data = sheet.getDataRange().getValues();
      if (data.length < 2) return;
      var h = {};
      data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (!row[h['LogID']]) continue;
        var tsRaw = row[h['Timestamp']];
        var tsStr = (tsRaw instanceof Date) ? tsRaw.toISOString() : String(tsRaw || '');
        var effRaw = h['EffectiveDate'] !== undefined ? row[h['EffectiveDate']] : '';
        var effStr = (effRaw instanceof Date) ? effRaw.toISOString() : String(effRaw || '');
        rows.push({
          logId:          String(row[h['LogID']]          || ''),
          entityType:     String(row[h['EntityType']]     || ''),
          entityId:       String(row[h['EntityID']]       || ''),
          action:         String(row[h['Action']]         || ''),
          fieldChanged:   String(row[h['FieldChanged']]   || ''),
          oldValue:       String(row[h['OldValue']]       || ''),
          newValue:       String(row[h['NewValue']]       || ''),
          changedBy:      String(row[h['ChangedBy']]      || ''),
          changedByEmail: String(row[h['ChangedByEmail']] || ''),
          timestamp:      tsStr,
          notes:          String(row[h['Notes']]          || ''),
          effectiveDate:  effStr
        });
      }
    }
    // Service Request activity now lives in its own sheet (see
    // _writeLog's routing) — merged back in here so this stays invisible
    // to every existing caller, who all still just call getLogs() and get
    // everything relevant, exactly as before the split.
    readLogSheet(CONFIG.SHEETS.ACTIVITY_LOGS);
    readLogSheet(CONFIG.SHEETS.REQUEST_ACTIVITY_LOGS);
    if (!rows.length) return { success: true, data: [], total: 0 };

    filters = filters || {};

    // Sort by effective date (the actual date something happened) rather
    // than timestamp (when it was recorded) — these can differ for
    // backdated entries. Falls back to timestamp for any row with no
    // effective date set.
    rows.sort(function (a, b) {
      return new Date(b.effectiveDate || b.timestamp || 0) - new Date(a.effectiveDate || a.timestamp || 0);
    });

    if (filters.entityType) {
      var entityTypeList = Array.isArray(filters.entityType) ? filters.entityType : [filters.entityType];
      rows = rows.filter(function (r) { return entityTypeList.indexOf(r.entityType) !== -1; });
    }
    if (filters.entityId) {
      rows = rows.filter(function (r) { return r.entityId === filters.entityId; });
    }
    if (filters.action) {
      rows = rows.filter(function (r) { return r.action === filters.action; });
    }
    if (filters.search) {
      var q = filters.search.toLowerCase();
      rows = rows.filter(function (r) {
        return [r.entityId, r.changedBy, r.fieldChanged, r.oldValue, r.newValue]
          .some(function (v) { return String(v || '').toLowerCase().includes(q); });
      });
    }

    // General log browsing (no specific entity requested) defaults to the
    // last 7 days rather than an arbitrary row-count cap — a busy system
    // could easily produce more than 500 rows in a week, which would
    // silently cut off recent activity rather than showing everything
    // that actually happened recently. Entity-specific requests (e.g. a
    // customer's own status timeline) still get their full history
    // regardless of date — that's not "browsing," it's "everything this
    // record ever did," which shouldn't be arbitrarily time-boxed.
    if (!filters.entityId && !filters.sinceDays && !filters.limit && !filters.allTime) {
      filters.sinceDays = 7;
    }
    if (filters.sinceDays) {
      var cutoff = new Date(Date.now() - filters.sinceDays * 24 * 60 * 60 * 1000);
      rows = rows.filter(function(r) { return new Date(r.timestamp || 0) >= cutoff; });
    }
    var total = rows.length;

    var pageSize = filters.limit || 5000; // safety cap far above what a 7-day window should ever realistically produce
    var page     = filters.page  || 1;
    var paged    = rows.slice((page - 1) * pageSize, page * pageSize);

    return { success: true, data: paged, total: total, page: page, pageSize: pageSize };
  } catch (e) {
    return { success: false, error: 'getLogs: ' + e.message };
  }
}