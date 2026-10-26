// ─────────────────────────────────────────
// CustomerService.gs — Customer CRUD
// ─────────────────────────────────────────

// Convert any Date to ISO string; pass strings/nulls through unchanged
function _sd(val) {
  if (val instanceof Date) return val.toISOString();
  if (val === null || val === undefined) return '';
  return String(val);
}

// Bug fix (2026-06-24): Sheets cells written with a JS boolean (e.g.
// setValue(false)) can read back through getValues() as the literal STRING
// "FALSE" rather than the boolean `false`, depending on the cell's checkbox
// validation state. Plain `!!val` treats any non-empty string — including
// "FALSE" — as truthy, so NoPaymentYet was silently evaluating to `true` on
// every read regardless of what was actually saved. That suppressed the
// "Idle since paid" calculation (which requires noPaymentYet to be false)
// even when a real PaymentDate had been entered. This helper normalizes
// both real booleans and their string forms correctly.
function _toBool(val) {
  if (typeof val === 'boolean') return val;
  if (val === null || val === undefined || val === '') return false;
  var s = String(val).trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES';
}

function getCustomers(filters) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };

    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    if (h['CustomerID'] === undefined) {
      return { success: false, error: 'Customers sheet headers missing. Run initializeSystem().' };
    }

    filters = filters || {};
    var rows = [];

    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!r[h['CustomerID']]) continue;

      var rec = {
        // .trim() matters here: Router.gs's getEnrichedCustomers() joins this
        // customerId against CustomerID values read from the VAConnections
        // sheet, which ARE trimmed there. Any stray whitespace on this side
        // (very easy to pick up from copy/paste into Sheets) would silently
        // break every match and leave "Active VAs" blank for every row.
        customerId:         String(r[h['CustomerID']]          || '').trim(),
        customerName:       String(r[h['CustomerName']]        || ''),
        assignedSpecialist: String(h['AssignedSpecialist'] !== undefined ? (r[h['AssignedSpecialist']] || '') : ''),
        status:             String(r[h['Status']]              || ''),
        notes:              String(r[h['Notes']]               || ''),
        createdAt:          _sd(r[h['CreatedAt']]),
        createdBy:          String(r[h['CreatedBy']]           || ''),
        updatedAt:          _sd(r[h['UpdatedAt']]),
        updatedBy:          String(r[h['UpdatedBy']]           || ''),
        statusDate:         h['StatusDate'] !== undefined ? _sd(r[h['StatusDate']]) : '',
        terminationCount:    h['TerminationCount']    !== undefined ? Number(r[h['TerminationCount']]    || 0) : 0,
        reactivationCount:   h['ReactivationCount']   !== undefined ? Number(r[h['ReactivationCount']]   || 0) : 0,
        lastTerminatedDate:  h['LastTerminatedDate']  !== undefined ? _sd(r[h['LastTerminatedDate']])        : '',
        lastReactivatedDate: h['LastReactivatedDate'] !== undefined ? _sd(r[h['LastReactivatedDate']])       : '',
        lastStatusReason:    h['LastStatusReason']    !== undefined ? String(r[h['LastStatusReason']] || '') : '',
        statusHistory:       h['StatusHistory']       !== undefined ? String(r[h['StatusHistory']]    || '') : '',
        paymentDate:         h['PaymentDate']  !== undefined ? _sd(r[h['PaymentDate']])        : '',
        noPaymentYet:        h['NoPaymentYet'] !== undefined ? _toBool(r[h['NoPaymentYet']])  : false
      };

      if (filters.status && rec.status !== filters.status) continue;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (!rec.customerName.toLowerCase().includes(q) &&
            !rec.customerId.toLowerCase().includes(q)) continue;
      }
      rows.push(rec);
    }

    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getCustomers: ' + e.message };
  }
}

function getCustomerById(customerId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]).trim() !== String(customerId).trim()) continue;
      var r = data[i];
      var customer = {
        customerId:         String(r[h['CustomerID']]          || '').trim(),
        customerName:       String(r[h['CustomerName']]        || ''),
        assignedSpecialist: String(h['AssignedSpecialist'] !== undefined ? (r[h['AssignedSpecialist']] || '') : ''),
        status:             String(r[h['Status']]              || ''),
        notes:              String(r[h['Notes']]               || ''),
        createdAt:          _sd(r[h['CreatedAt']]),
        createdBy:          String(r[h['CreatedBy']]           || ''),
        updatedAt:          _sd(r[h['UpdatedAt']]),
        updatedBy:          String(r[h['UpdatedBy']]           || ''),
        statusDate:         h['StatusDate'] !== undefined ? _sd(r[h['StatusDate']]) : '',
        terminationCount:    h['TerminationCount']    !== undefined ? Number(r[h['TerminationCount']]    || 0) : 0,
        reactivationCount:   h['ReactivationCount']   !== undefined ? Number(r[h['ReactivationCount']]   || 0) : 0,
        lastTerminatedDate:  h['LastTerminatedDate']  !== undefined ? _sd(r[h['LastTerminatedDate']])        : '',
        lastReactivatedDate: h['LastReactivatedDate'] !== undefined ? _sd(r[h['LastReactivatedDate']])       : '',
        lastStatusReason:    h['LastStatusReason']    !== undefined ? String(r[h['LastStatusReason']] || '') : '',
        statusHistory:       h['StatusHistory']       !== undefined ? String(r[h['StatusHistory']]    || '') : '',
        paymentDate:         h['PaymentDate']  !== undefined ? _sd(r[h['PaymentDate']])        : '',
        noPaymentYet:        h['NoPaymentYet'] !== undefined ? _toBool(r[h['NoPaymentYet']])  : false
      };
      var clientsResult = getClientsByCustomer(customerId);
      customer.clients = (clientsResult && clientsResult.success) ? clientsResult.data : [];
      var idle = _computeCustomerIdleDays(customerId, customer.createdAt, customer.paymentDate, customer.noPaymentYet);
      customer.idleDaysSinceAdded = idle.idleDaysSinceAdded;
      customer.idleDaysSincePaid  = idle.idleDaysSincePaid;
      customer.firstVAConnectedAt = idle.firstVAConnectedAt;
      return { success: true, data: customer };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: 'getCustomerById: ' + e.message };
  }
}

// ── Idle Days metric ────────────────────────────────────────────────
// "Idle" = the gap between a customer being added (or paying) and the
// moment they're actually connected to their first Virtual Assistant.
// "Connected to first VA" = the earliest VAConnections row for this
// customer whose ConnectionStatus has reached Accepted or Started — an
// assignment that was only ever Pending/Declined/Cancelled doesn't count.
// Returns nulls (not 0) when there's no qualifying connection yet, or when
// PaymentDate is blank (customer flagged NoPaymentYet), so the frontend can
// render "—" instead of a misleading zero.
function _computeCustomerIdleDays(customerId, createdAtIso, paymentDateIso, noPaymentYet) {
  var result = { idleDaysSinceAdded: null, idleDaysSincePaid: null, firstVAConnectedAt: '' };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!connSheet) return result;
    var data = connSheet.getDataRange().getValues();
    if (data.length < 2) return result;
    var h = {}; data[0].forEach(function(c,i){ if (c) h[String(c)] = i; });
    if (h['CustomerID'] === undefined || h['ConnectionStatus'] === undefined) return result;

    var QUALIFYING = [CONFIG.VA_CONNECTION_STATUS.ACCEPTED, CONFIG.VA_CONNECTION_STATUS.STARTED];
    var earliest = null;
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[h['CustomerID']] || '') !== customerId) continue;
      if (QUALIFYING.indexOf(String(row[h['ConnectionStatus']] || '')) === -1) continue;
      // Prefer ActualStartDate (Started) or AssignedAt as the connection moment;
      // fall back across whichever date columns exist on this row.
      var dateVal = (h['ActualStartDate'] !== undefined && row[h['ActualStartDate']]) ? row[h['ActualStartDate']]
                  : (h['AssignedAt']       !== undefined && row[h['AssignedAt']])       ? row[h['AssignedAt']]
                  : null;
      var d = dateVal instanceof Date ? dateVal : (dateVal ? new Date(dateVal) : null);
      if (!d || isNaN(d.getTime())) continue;
      if (!earliest || d < earliest) earliest = d;
    }
    if (!earliest) return result; // no qualifying connection yet — customer is still idle

    result.firstVAConnectedAt = earliest.toISOString();

    if (createdAtIso) {
      var created = new Date(createdAtIso);
      if (!isNaN(created.getTime())) {
        result.idleDaysSinceAdded = Math.max(0, Math.round((earliest - created) / 86400000));
      }
    }
    if (!noPaymentYet && paymentDateIso) {
      var paid = new Date(paymentDateIso);
      if (!isNaN(paid.getTime())) {
        result.idleDaysSincePaid = Math.max(0, Math.round((earliest - paid) / 86400000));
      }
    }
    return result;
  } catch (e) {
    Logger.log('_computeCustomerIdleDays: ' + e.message);
    return result;
  }
}

function createCustomer(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!payload || !payload.customerName || !payload.customerName.trim()) {
      return { success: false, errors: ['Customer Name is required.'] };
    }
    // A customer can exist unpaid (added but not yet paid, cancellable anytime) —
    // but that must be an explicit, deliberate flag rather than a silently empty
    // date, so either a PaymentDate or the NoPaymentYet checkbox is required.
    var noPaymentYet = !!payload.noPaymentYet;
    if (!noPaymentYet && !payload.paymentDate) {
      return { success: false, errors: ['Payment Date is required, or check "No payment yet" for unpaid customers.'] };
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var now   = new Date();
    var id    = generateID('CUST');

    // Bug fix (2026-06-24): payload.createdAt (the "Date — defaults to today,
    // change for late entries" field on the Add Customer form) was being sent
    // by the frontend but silently ignored here — CreatedAt was always
    // hardcoded to `now`. That meant late entries couldn't actually backdate
    // when the customer was added, which in turn broke the Idle Time report
    // (idleDaysSinceAdded was computed against today instead of the real
    // add date, understating — often to 0 — how long the customer was idle).
    var createdAtVal = now;
    if (payload.createdAt) {
      var parsedCreatedAt = _parseDateInput(payload.createdAt);
      if (!isNaN(parsedCreatedAt.getTime())) createdAtVal = parsedCreatedAt;
    }

    // Write using header-map so column order never matters
    var hRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var hMap = {};
    hRow.forEach(function (col, i) { if (col) hMap[String(col)] = i; });
    var rowData = hRow.map(function () { return ''; });
    var colMap = {
      'CustomerID':          id,
      'CustomerName':        payload.customerName.trim(),
      'AssignedSpecialist':  payload.assignedSpecialist || '',
      'CreatedAt':           createdAtVal,
      'CreatedBy':           perm.user.email,
      'UpdatedAt':           now,
      'UpdatedBy':           perm.user.email,
      'Notes':               payload.notes  || '',
      'Status':              payload.status || CONFIG.STATUS.PENDING,
      'StatusDate':          createdAtVal,
      'PaymentDate':         noPaymentYet ? '' : payload.paymentDate,
      'NoPaymentYet':        noPaymentYet
    };
    Object.keys(colMap).forEach(function (col) {
      if (hMap[col] !== undefined) rowData[hMap[col]] = colMap[col];
    });
    sheet.appendRow(rowData);

    _writeLog('Customer', id, 'CREATE', '', '',
      JSON.stringify({ customerName: payload.customerName }), perm.user, createdAtVal);
    return { success: true, id: id };
  } catch (e) {
    return { success: false, error: 'createCustomer: ' + e.message };
  }
}

// ── Shared status-change tracking: increments termination/reactivation
// counters, records the last date of each event, and appends a structured
// entry to StatusHistory (JSON array) so the full chronological record of
// every termination and reactivation survives across multiple cycles.
// Called any time a Customer's Status actually changes (generic edit form
// AND the dedicated Reactivate/Terminate actions), so tracking can never
// be bypassed regardless of which UI path was used.
// Appends a formatted date onto an existing comma-separated log cell rather
// than overwriting it, so a column tracks every occurrence of an event
// (e.g. every termination date across multiple termination/reactivation
// cycles) instead of only the most recent one.
function _appendDateToLog(sheet, rowNum, colIdx, eventDate) {
  var cell = sheet.getRange(rowNum, colIdx + 1);
  var existing = String(cell.getValue() || '').trim();
  var formatted = Utilities.formatDate(eventDate, Session.getScriptTimeZone() || 'UTC', 'yyyy-MM-dd');
  var updated = existing ? (existing + ', ' + formatted) : formatted;
  cell.setValue(updated);
}

function _applyCustomerStatusChange(sheet, h, rowNum, oldStatus, newStatus, statusDate, reason, user) {
  if (oldStatus === newStatus) return; // no real change — nothing to track

  var TERMINAL_STATUSES = ['Terminated', 'Cancelled'];
  var wasTerminal = TERMINAL_STATUSES.indexOf(oldStatus) !== -1;
  var isTerminal  = TERMINAL_STATUSES.indexOf(newStatus) !== -1;
  var isReactivation = wasTerminal && newStatus === 'Active';
  var isTermination   = !wasTerminal && isTerminal;
  // Also count Terminated <-> Cancelled switches as a new termination event,
  // and re-terminating after a reactivation, as a fresh termination.
  var isRetermination = wasTerminal && isTerminal && oldStatus !== newStatus;

  var now = new Date();
  var eventDate = statusDate ? new Date(statusDate) : now;
  if (isNaN(eventDate.getTime())) eventDate = now;

  if ((isTermination || isRetermination) && eventDate > now) {
    throw new Error('Termination date cannot be in the future.');
  }

  if (h['StatusDate'] !== undefined) sheet.getRange(rowNum, h['StatusDate'] + 1).setValue(eventDate);

  // NOTE: despite the column names (kept for backward compatibility with any
  // existing sheet data), these now hold an APPEND-ONLY, comma-separated log
  // of every date the event occurred — not just the most recent one. This is
  // so a customer terminated/reactivated multiple times shows the full date
  // history directly in the spreadsheet, not just the latest cycle.
  if (isTermination || isRetermination) {
    if (h['TerminationCount'] !== undefined) {
      var curTermCount = Number(sheet.getRange(rowNum, h['TerminationCount'] + 1).getValue() || 0);
      sheet.getRange(rowNum, h['TerminationCount'] + 1).setValue(curTermCount + 1);
    }
    if (h['LastTerminatedDate'] !== undefined) {
      _appendDateToLog(sheet, rowNum, h['LastTerminatedDate'], eventDate);
    }
  }

  if (isReactivation) {
    if (h['ReactivationCount'] !== undefined) {
      var curReactCount = Number(sheet.getRange(rowNum, h['ReactivationCount'] + 1).getValue() || 0);
      sheet.getRange(rowNum, h['ReactivationCount'] + 1).setValue(curReactCount + 1);
    }
    if (h['LastReactivatedDate'] !== undefined) {
      _appendDateToLog(sheet, rowNum, h['LastReactivatedDate'], eventDate);
    }
  }

  if (h['LastStatusReason'] !== undefined && reason) {
    sheet.getRange(rowNum, h['LastStatusReason'] + 1).setValue(String(reason));
  }

  // Append to StatusHistory (JSON array), capped at the most recent 50 entries
  // to keep the cell well within Sheets' per-cell size limits.
  if (h['StatusHistory'] !== undefined) {
    var historyRaw = sheet.getRange(rowNum, h['StatusHistory'] + 1).getValue();
    var history = [];
    if (historyRaw) {
      try { history = JSON.parse(historyRaw); if (!Array.isArray(history)) history = []; }
      catch (parseErr) { history = []; }
    }
    history.push({
      from: oldStatus, to: newStatus,
      date: eventDate.toISOString(),
      reason: reason || '',
      by: user ? user.email : ''
    });
    if (history.length > 50) history = history.slice(history.length - 50);
    sheet.getRange(rowNum, h['StatusHistory'] + 1).setValue(JSON.stringify(history));
  }

  _writeLog('Customer', sheet.getRange(rowNum, h['CustomerID'] + 1).getValue(),
    _classifyStatusChangeAction(oldStatus, newStatus), 'Status', oldStatus, newStatus, user, eventDate);
}

// Self-healing migration: if the Customers sheet pre-dates the
// TerminationCount/ReactivationCount/StatusHistory columns (added after this
// sheet was first created), append any missing columns automatically so
// status-change tracking never silently no-ops because a column is missing.
function _ensureCustomerSheetColumns(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
  if (!sheet) return;
  var schemaCols = CONFIG.SCHEMA.Customers;
  var lastCol = sheet.getLastColumn();
  var currentCols = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  schemaCols.forEach(function (col) {
    if (currentCols.indexOf(col) === -1) {
      var newColIdx = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColIdx).setValue(col);
      sheet.getRange(1, newColIdx).setBackground('#1e293b').setFontColor('#fff').setFontWeight('bold');
      currentCols.push(col);
    }
  });
}

// Keeps the cached CustomerName on every one of this customer's Client
// (Account) rows in sync whenever the customer is renamed. This is the
// write-side of the denormalization added to Clients — see the
// CustomerName column comment in Code.gs for the read-side rationale.
// Cascades a customer rename to ClientPayments' own cached CustomerName,
// per the request — unlike ConnectionBillingDetail's cached name (an
// explicitly-documented, intentional historical snapshot), this one
// isn't a point-in-time record; it's the customer's own current payment
// history, so it should always reflect their current name.
function _cascadeCustomerNameToClientPayments(customerId, newName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('ClientPayments');
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    if (h['CustomerName'] === undefined || h['CustomerID'] === undefined) return;
    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]||'') !== customerId) continue;
      if (String(data[i][h['CustomerName']]||'') === newName) continue; // already in sync
      sheet.getRange(i+1, h['CustomerName']+1).setValue(newName);
      updated++;
    }
    if (updated) Logger.log('_cascadeCustomerNameToClientPayments: updated ' + updated + ' payment record(s) for customer ' + customerId);
  } catch (e) {
    Logger.log('_cascadeCustomerNameToClientPayments error: ' + e.message);
  }
}

function _cascadeCustomerNameToBillingGridDetail(oldName, newName) {
  try {
    if (!oldName || oldName === newName) return;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.ACCT_CONN_BILLING_DETAIL);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    if (h['CustomerName'] === undefined) return;
    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerName']]||'') !== oldName) continue;
      sheet.getRange(i+1, h['CustomerName']+1).setValue(newName);
      updated++;
    }
    if (updated) Logger.log('_cascadeCustomerNameToBillingGridDetail: updated ' + updated + ' row(s)');
  } catch (e) {
    Logger.log('_cascadeCustomerNameToBillingGridDetail error: ' + e.message);
  }
}

function _cascadeCustomerNameToClientsCachedField(customerId, newName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    if (h['CustomerName'] === undefined) return; // older deployment, column not migrated yet — nothing to cascade into
    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]||'') !== customerId) continue;
      var oldCachedName = String(data[i][h['CustomerName']]||'');
      if (oldCachedName === newName) continue; // already in sync
      sheet.getRange(i+1, h['CustomerName']+1).setValue(newName);
      updated++;
    }
    if (updated) Logger.log('_cascadeCustomerNameToClients: updated ' + updated + ' account(s) for customer ' + customerId);
  } catch (e) {
    Logger.log('_cascadeCustomerNameToClients error: ' + e.message);
  }
}

function updateCustomer(customerId, payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    // A Pause/Terminate/Cancelled status change has its own dedicated
    // review workflow now — see updateClient for the identical reasoning.
    var isStatusOnlyChangeCust = payload && payload.status && (payload.status === 'Paused' || payload.status === 'Terminated' || payload.status === 'Cancelled') && !payload.customerName;
    if (perm.user.permissions.requiresApproval && !isStatusOnlyChangeCust) {
      return { success: false, error: 'Your edits require approval. Contact a CS Manager.' };
    }
    if (!payload.customerName || (!payload.noPaymentYet && !payload.paymentDate)) {
      var ssForPrefillCust = SpreadsheetApp.getActiveSpreadsheet();
      var sheetForPrefillCust = ssForPrefillCust.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      var dataForPrefillCust = sheetForPrefillCust.getDataRange().getValues();
      var hForPrefillCust = {};
      dataForPrefillCust[0].forEach(function (col, i) { if (col) hForPrefillCust[String(col)] = i; });
      for (var pfci = 1; pfci < dataForPrefillCust.length; pfci++) {
        if (String(dataForPrefillCust[pfci][hForPrefillCust['CustomerID']]) !== customerId) continue;
        if (!payload.customerName) payload.customerName = String(dataForPrefillCust[pfci][hForPrefillCust['CustomerName']]||'');
        if (!payload.paymentDate && hForPrefillCust['PaymentDate'] !== undefined) payload.paymentDate = String(dataForPrefillCust[pfci][hForPrefillCust['PaymentDate']]||'');
        if (payload.noPaymentYet === undefined && hForPrefillCust['NoPaymentYet'] !== undefined) payload.noPaymentYet = _toBool(dataForPrefillCust[pfci][hForPrefillCust['NoPaymentYet']]);
        break;
      }
    }
    if (!payload || !payload.customerName || !payload.customerName.trim()) {
      return { success: false, errors: ['Customer Name is required.'] };
    }
    var noPaymentYet = !!payload.noPaymentYet;
    if (!isStatusOnlyChangeCust && !noPaymentYet && !payload.paymentDate) {
      return { success: false, errors: ['Payment Date is required, or check "No payment yet" for unpaid customers.'] };
    }
    var newStatusCheck = payload.status || CONFIG.STATUS.ACTIVE;
    if ((newStatusCheck === 'Terminated' || newStatusCheck === 'Cancelled') && payload.statusDate) {
      var checkDate = _parseDateInput(payload.statusDate);
      if (!isNaN(checkDate.getTime()) && checkDate > new Date()) {
        return { success: false, errors: ['Termination date cannot be in the future.'] };
      }
    }
    if ((newStatusCheck === 'Terminated' || newStatusCheck === 'Cancelled') && _hasActiveVAConnections(null, customerId)) {
      return { success: false, errors: ['This customer still has active VA connections. Please terminate those VA connections first.'] };
    }
    // The status change now applies immediately for anyone — capture
    // whether this needs to be flagged for CS Manager review afterward
    // (once the actual Status write happens further down), rather than
    // blocking it here. Extended to cover Paused too, per the request —
    // previously this only ever applied to Terminated/Cancelled.
    var needsPendingReview = (newStatusCheck === 'Terminated' || newStatusCheck === 'Cancelled' || newStatusCheck === 'Paused') && perm.user.role !== 'CS Manager';

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    _ensureCustomerSheetColumns(ss); // self-healing — guarantees tracking columns exist
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]) !== customerId) continue;
      var rowNum = i + 1;
      var old = {
        customerName: String(data[i][h['CustomerName']] || ''),
        status:       String(data[i][h['Status']]       || ''),
        notes:        String(data[i][h['Notes']]        || ''),
        assignedSpecialist: h['AssignedSpecialist'] !== undefined ? String(data[i][h['AssignedSpecialist']] || '') : '',
        paymentDate:  h['PaymentDate']  !== undefined ? String(data[i][h['PaymentDate']]  || '') : '',
        noPaymentYet: h['NoPaymentYet'] !== undefined ? _toBool(data[i][h['NoPaymentYet']])    : false
      };
      sheet.getRange(rowNum, h['CustomerName'] + 1).setValue(payload.customerName.trim());
      sheet.getRange(rowNum, h['Notes']        + 1).setValue(payload.notes !== undefined ? payload.notes : old.notes);
      sheet.getRange(rowNum, h['Status']       + 1).setValue(payload.status !== undefined ? payload.status : old.status);
      if (h['AssignedSpecialist'] !== undefined) {
        sheet.getRange(rowNum, h['AssignedSpecialist'] + 1).setValue(payload.assignedSpecialist !== undefined ? payload.assignedSpecialist : old.assignedSpecialist);
      }
      if (h['PaymentDate'] !== undefined) {
        sheet.getRange(rowNum, h['PaymentDate'] + 1).setValue(noPaymentYet ? '' : payload.paymentDate);
      }
      if (h['NoPaymentYet'] !== undefined) {
        sheet.getRange(rowNum, h['NoPaymentYet'] + 1).setValue(noPaymentYet);
      }
      var newStatus = payload.status || CONFIG.STATUS.ACTIVE;
      var oldStatus = String(data[i][h['Status']] || '');
      // Tracks termination/reactivation counters + history — same helper used by the
      // dedicated Reactivate/Terminate actions, so tracking applies no matter which UI path is used.
      _applyCustomerStatusChange(sheet, h, rowNum, oldStatus, newStatus, null, payload.statusReason || '', perm.user);
      sheet.getRange(rowNum, h['UpdatedAt']    + 1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy']    + 1).setValue(perm.user.email);
      _logChanges('Customer', customerId, old, payload, perm.user);

      // If the customer name changed, cascade to linked clients
      if (old.customerName !== payload.customerName.trim()) {
        _cascadeCustomerNameToClientsCachedField(customerId, payload.customerName.trim());
        _cascadeCustomerNameToClients(customerId, payload.customerName.trim(), perm.user);
        // Per the request — keep VAConnections.CustomerName in step too.
        try { _cascadeCustomerNameToConnections(customerId, payload.customerName.trim()); } catch (cnEx) { Logger.log('connection CustomerName cascade: ' + cnEx.message); }
        _cascadeCustomerNameToClientPayments(customerId, payload.customerName.trim());
        _cascadeCustomerNameToBillingGridDetail(old.customerName, payload.customerName.trim());
      }

      // Cascade to this customer's accounts — Paused only touches
      // currently-Active accounts; Terminated/Cancelled touches every
      // account not already in a terminal state. This was previously
      // only implemented in updateCustomerStatusFull, a different code
      // path the dedicated buttons never actually call, so accounts were
      // silently never actually cascaded despite the confirmation modal
      // explicitly telling the user they would be.
      if (newStatus === 'Paused' || newStatus === 'Terminated' || newStatus === 'Cancelled') {
        try {
          var cliSheetCascade = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
          if (cliSheetCascade) {
            var cliDataCascade = cliSheetCascade.getDataRange().getValues();
            var clhCascade = {}; cliDataCascade[0].forEach(function(c,i){ if(c) clhCascade[String(c)]=i; });
            for (var ciCascade = 1; ciCascade < cliDataCascade.length; ciCascade++) {
              if (String(cliDataCascade[ciCascade][clhCascade['CustomerID']]||'') !== customerId) continue;
              var acctStatusCascade = String(cliDataCascade[ciCascade][clhCascade['Status']]||'');
              var shouldCascade = newStatus === 'Paused'
                ? acctStatusCascade === 'Active'
                : (acctStatusCascade !== 'Terminated' && acctStatusCascade !== 'Cancelled');
              if (!shouldCascade) continue;
              var cascadedClientId = String(cliDataCascade[ciCascade][clhCascade['ClientID']]||'');
              updateClientStatus(cascadedClientId, newStatus, payload.statusReason || '', payload.statusDate);
              // Record this account's own pending-review tracking too, so
              // cancelling the customer's review can also revert every
              // account that got cascaded because of it — updateClientStatus
              // itself doesn't know about this newer tracking, so it's set
              // directly here instead.
              if (needsPendingReview) {
                try {
                  var cliSheetForTrack = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
                  var cliDataForTrack = cliSheetForTrack.getDataRange().getValues();
                  var clhForTrack = {}; cliDataForTrack[0].forEach(function(c,i){ if(c) clhForTrack[String(c)]=i; });
                  for (var tci = 1; tci < cliDataForTrack.length; tci++) {
                    if (String(cliDataForTrack[tci][clhForTrack['ClientID']]||'') !== cascadedClientId) continue;
                    var trackRowNum = tci + 1;
                    if (clhForTrack['TerminationRequestedBy'] !== undefined) cliSheetForTrack.getRange(trackRowNum, clhForTrack['TerminationRequestedBy']+1).setValue(perm.user.email);
                    if (clhForTrack['PendingReviewAction'] !== undefined) cliSheetForTrack.getRange(trackRowNum, clhForTrack['PendingReviewAction']+1).setValue(newStatus);
                    if (clhForTrack['StatusBeforePendingReview'] !== undefined) cliSheetForTrack.getRange(trackRowNum, clhForTrack['StatusBeforePendingReview']+1).setValue(acctStatusCascade);
                    break;
                  }
                } catch (trackEx) { Logger.log('updateCustomer cascaded-account tracking: ' + trackEx.message); }
              }
            }
          }
        } catch (cascadeExCust) { Logger.log('updateCustomer account cascade: ' + cascadeExCust.message); }
      }

      if (needsPendingReview) {
        var nowReview = new Date();
        var effectiveDateReview = payload.statusDate ? _parseDateInput(payload.statusDate) : nowReview;
        if (h['TerminationRequestedBy'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedBy']+1).setValue(perm.user.email);
        if (h['TerminationRequestedAt'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedAt']+1).setValue(nowReview);
        if (h['TerminationRequestedDate'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedDate']+1).setValue(effectiveDateReview);
        if (h['TerminationRequestReason'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestReason']+1).setValue(payload.statusReason || '');
        if (h['PendingReviewAction'] !== undefined) sheet.getRange(rowNum, h['PendingReviewAction']+1).setValue(newStatus);
        if (h['StatusBeforePendingReview'] !== undefined) sheet.getRange(rowNum, h['StatusBeforePendingReview']+1).setValue(old.status);
        _writeLog('Customer', customerId, newStatus === 'Paused' ? 'PAUSE_PENDING_REVIEW' : 'TERMINATION_PENDING_REVIEW', old.status, newStatus, payload.statusReason || '', perm.user, effectiveDateReview);
      }

      return { success: true, pendingReview: needsPendingReview };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: 'updateCustomer: ' + e.message };
  }
}

// ── Dedicated status-change endpoint for the Reactivate / Terminate modal.
// Distinct from updateCustomer() (the generic edit form) so the action can be
// surfaced as a focused one-click flow, while still funneling through the
// same _applyCustomerStatusChange tracking helper.
function updateCustomerStatusFull(customerId, status, reason, statusDate) {
  try {
    var perm = checkPermission('edit');
    // CS Specialist is explicitly allowed here regardless of their
    // generic canEdit permission — that flag gates many other actions
    // too, so broadening it globally would grant more than just this.
    var isCsSpecialist = perm.user && perm.user.role === 'CS Specialist';
    if (!perm.allowed && !isCsSpecialist) return { success: false, error: 'Permission denied.' };

    var validStatuses = ['Pending', 'Active', 'Paused', 'Inactive', 'Terminated', 'Cancelled'];
    if (validStatuses.indexOf(status) === -1) {
      return { success: false, error: 'Invalid status: ' + status };
    }
    if ((status === 'Terminated' || status === 'Cancelled') && statusDate) {
      var checkDate = new Date(statusDate);
      if (!isNaN(checkDate.getTime()) && checkDate > new Date()) {
        return { success: false, error: 'Termination date cannot be in the future.' };
      }
    }
    if ((status === 'Terminated' || status === 'Cancelled') && _hasActiveVAConnections(null, customerId)) {
      return { success: false, error: 'This customer still has active VA connections. Please terminate those VA connections first.' };
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    _ensureCustomerSheetColumns(ss); // self-healing — guarantees tracking columns exist
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]) !== customerId) continue;
      var rowNum = i + 1;
      var oldStatus = String(data[i][h['Status']] || '');

      // A termination only requests it unless the acting user is CS
      // Manager themselves — CS Manager still needs to actually approve
      // it (now true for Administrator too, not just CS Specialist).
      // Status is never touched here; only the pending-request fields
      // are, so the customer stays exactly as it was until CS Manager
      // acts on it.
      if ((status === 'Terminated' || status === 'Cancelled') && perm.user.role !== 'CS Manager') {
        var now = new Date();
        var termDate = statusDate ? new Date(statusDate) : now;
        if (h['TerminationRequestedBy'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedBy']+1).setValue(perm.user.email);
        if (h['TerminationRequestedAt'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedAt']+1).setValue(now);
        if (h['TerminationRequestedDate'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedDate']+1).setValue(termDate);
        if (h['TerminationRequestReason'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestReason']+1).setValue(reason || '');
        sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(now);
        sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(perm.user.email);
        _writeLog('Customer', customerId, 'TERMINATION_REQUESTED', '', '', reason || '', perm.user, termDate);
        return { success: true, requiresApproval: true, customerId: customerId };
      }

      sheet.getRange(rowNum, h['Status'] + 1).setValue(status);
      _applyCustomerStatusChange(sheet, h, rowNum, oldStatus, status, statusDate, reason, perm.user);
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);

      // Cascade to this customer's accounts, per the request — Paused
      // only touches currently-Active accounts; Terminated/Cancelled
      // touches every account not already in a terminal state. The
      // active-connections check above already confirmed none of them
      // can still be blocking a termination by this point.
      if (status === 'Paused' || status === 'Terminated' || status === 'Cancelled') {
        try {
          var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
          if (cliSheet) {
            var cliData = cliSheet.getDataRange().getValues();
            var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
            for (var ci = 1; ci < cliData.length; ci++) {
              if (String(cliData[ci][clh['CustomerID']]||'') !== customerId) continue;
              var acctStatus = String(cliData[ci][clh['Status']]||'');
              var shouldCascade = status === 'Paused'
                ? acctStatus === 'Active'
                : (acctStatus !== 'Terminated' && acctStatus !== 'Cancelled');
              if (!shouldCascade) continue;
              updateClientStatus(String(cliData[ci][clh['ClientID']]||''), status, reason, statusDate);
            }
          }
        } catch (cascadeEx) { Logger.log('updateCustomerStatusFull account cascade: ' + cascadeEx.message); }
      }

      var wasTerminal = oldStatus === 'Terminated' || oldStatus === 'Cancelled';
      var isReactivation = wasTerminal && status === 'Pending';

      return { success: true, oldStatus: oldStatus, newStatus: status, isReactivation: isReactivation };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: 'updateCustomerStatusFull: ' + e.message };
  }
}

// CS Manager (or Administrator) acting on a pending termination request —
// approve actually executes the termination (through the same shared
// _applyCustomerStatusChange every other status change goes through);
// reject just clears the pending-request fields, leaving Status
// untouched, as though the request had never been made.
function approveCustomerTermination(customerId, action) {
  try {
    var perm = checkPermission('edit');
    var isAllowedRole = perm.user && (perm.user.role === 'CS Manager' || perm.user.role === 'Administrator');
    if (!isAllowedRole) return { success: false, error: 'Only CS Manager or Administrator can review a pending status change.' };
    if (['Confirm', 'Cancel'].indexOf(action) === -1) return { success: false, error: 'Invalid action: ' + action };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    _ensureCustomerSheetColumns(ss);
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]) !== customerId) continue;
      var rowNum = i + 1;
      var requestedBy = h['TerminationRequestedBy'] !== undefined ? String(data[i][h['TerminationRequestedBy']]||'') : '';
      if (!requestedBy) return { success: false, error: 'This customer has no status change pending review.' };

      var currentStatus = String(data[i][h['Status']]||'');
      var priorStatus = h['StatusBeforePendingReview'] !== undefined ? String(data[i][h['StatusBeforePendingReview']]||'') : '';
      var requestReason = h['TerminationRequestReason'] !== undefined ? String(data[i][h['TerminationRequestReason']]||'') : '';

      if (action === 'Cancel' && priorStatus) {
        sheet.getRange(rowNum, h['Status'] + 1).setValue(priorStatus);
        _applyCustomerStatusChange(sheet, h, rowNum, currentStatus, priorStatus, null, 'Reverted by ' + perm.user.email, perm.user);
        _writeLog('Customer', customerId, 'PENDING_REVIEW_CANCELLED', requestedBy, perm.user.email, requestReason, perm.user);

        // Also revert every account that got cascaded because of this
        // customer's change, per the request.
        try {
          var cliSheetRevert = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
          if (cliSheetRevert) {
            var cliDataRevert = cliSheetRevert.getDataRange().getValues();
            var clhRevert = {}; cliDataRevert[0].forEach(function(c,i){ if(c) clhRevert[String(c)]=i; });
            for (var cri = 1; cri < cliDataRevert.length; cri++) {
              if (String(cliDataRevert[cri][clhRevert['CustomerID']]||'') !== customerId) continue;
              var acctPriorStatus = clhRevert['StatusBeforePendingReview'] !== undefined ? String(cliDataRevert[cri][clhRevert['StatusBeforePendingReview']]||'') : '';
              if (!acctPriorStatus) continue; // this account wasn't part of the cascade
              var acctRowNum = cri + 1;
              cliSheetRevert.getRange(acctRowNum, clhRevert['Status']+1).setValue(acctPriorStatus);
              if (clhRevert['TerminationRequestedBy'] !== undefined) cliSheetRevert.getRange(acctRowNum, clhRevert['TerminationRequestedBy']+1).setValue('');
              if (clhRevert['TerminationRequestedAt'] !== undefined) cliSheetRevert.getRange(acctRowNum, clhRevert['TerminationRequestedAt']+1).setValue('');
              if (clhRevert['TerminationRequestedDate'] !== undefined) cliSheetRevert.getRange(acctRowNum, clhRevert['TerminationRequestedDate']+1).setValue('');
              if (clhRevert['TerminationRequestReason'] !== undefined) cliSheetRevert.getRange(acctRowNum, clhRevert['TerminationRequestReason']+1).setValue('');
              if (clhRevert['PendingReviewAction'] !== undefined) cliSheetRevert.getRange(acctRowNum, clhRevert['PendingReviewAction']+1).setValue('');
              if (clhRevert['StatusBeforePendingReview'] !== undefined) cliSheetRevert.getRange(acctRowNum, clhRevert['StatusBeforePendingReview']+1).setValue('');
            }
          }
        } catch (revertEx) { Logger.log('approveCustomerTermination cascaded-account revert: ' + revertEx.message); }
      } else {
        _writeLog('Customer', customerId, 'PENDING_REVIEW_CONFIRMED', requestedBy, perm.user.email, requestReason, perm.user);
      }

      // Clear the pending request either way — approved or rejected, it's
      // resolved now, not still sitting open.
      if (h['TerminationRequestedBy'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedBy']+1).setValue('');
      if (h['TerminationRequestedAt'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedAt']+1).setValue('');
      if (h['TerminationRequestedDate'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedDate']+1).setValue('');
      if (h['TerminationRequestReason'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestReason']+1).setValue('');
      if (h['PendingReviewAction'] !== undefined) sheet.getRange(rowNum, h['PendingReviewAction']+1).setValue('');
      if (h['StatusBeforePendingReview'] !== undefined) sheet.getRange(rowNum, h['StatusBeforePendingReview']+1).setValue('');
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);

      return { success: true, action: action };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: 'approveCustomerTermination: ' + e.message };
  }
}

// Every customer with a termination request still awaiting CS Manager /
// Administrator action — powers the new Approvals page.
function getPendingCustomerTerminationApprovals() {
  try {
    var perm = checkPermission('view');
    var isAllowedRole = perm.user && (perm.user.role === 'CS Manager' || perm.user.role === 'Administrator');
    if (!isAllowedRole) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var requestedBy = h['TerminationRequestedBy'] !== undefined ? String(data[i][h['TerminationRequestedBy']]||'') : '';
      if (!requestedBy) continue;
      rows.push({
        customerId: String(data[i][h['CustomerID']]||''),
        customerName: String(data[i][h['CustomerName']]||''),
        requestedBy: requestedBy,
        requestedAt: h['TerminationRequestedAt'] !== undefined ? _sd(data[i][h['TerminationRequestedAt']]) : '',
        requestedDate: h['TerminationRequestedDate'] !== undefined ? _sd(data[i][h['TerminationRequestedDate']]) : '',
        reason: h['TerminationRequestReason'] !== undefined ? String(data[i][h['TerminationRequestReason']]||'') : '',
        pendingReviewAction: h['PendingReviewAction'] !== undefined ? String(data[i][h['PendingReviewAction']]||'') : ''
      });
    }
    rows.sort(function(a,b){ return new Date(a.requestedAt||0) - new Date(b.requestedAt||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getPendingCustomerTerminationApprovals: ' + e.message };
  }
}

function deleteCustomer(customerId, confirmText) {
  try {
    var permCheck = checkModulePermission('Customers', 'd');
    if (!permCheck.allowed) return { success: false, error: 'You do not have permission to delete Customers — this is configured on the Permissions page.' };
    if (confirmText !== 'DELETE') {
      return { success: false, error: 'Type DELETE to confirm — nothing was deleted.' };
    }
    var perm = { user: permCheck.user };

    var clientsResult = getClientsByCustomer(customerId);
    if (clientsResult && clientsResult.success && clientsResult.data.length > 0) {
      return { success: false, error: 'Cannot delete: Customer has ' +
        clientsResult.data.length + ' client(s). Remove clients first.' };
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]) !== customerId) continue;
      _writeLog('Customer', customerId, 'DELETE', '',
        String(data[i][h['CustomerName']] || ''), '', perm.user);
      sheet.deleteRow(i + 1);
      return { success: true };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: 'deleteCustomer: ' + e.message };
  }
}

// ── Cascade customer name to linked clients ───────────────────────
// Called from updateCustomer when customerName changes.
// Any client under this customer that has PrimaryLinkedToCustomer = true
// will have their CompanyName updated to match the new customer name.
function _cascadeCustomerNameToClients(customerId, newName, user) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!sheet) return;
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    if (h['CustomerID'] === undefined) return;

    // If PrimaryLinkedToCustomer column exists, only cascade to those rows.
    // Otherwise cascade to all clients of this customer (legacy fallback).
    var hasFlagCol = h['PrimaryLinkedToCustomer'] !== undefined;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[h['ClientID']]) continue;
      if (String(row[h['CustomerID']]) !== customerId) continue;
      if (hasFlagCol && row[h['PrimaryLinkedToCustomer']] !== true) continue;

      var rowNum     = i + 1;
      var oldCompany = String(row[h['CompanyName']] || '');
      if (oldCompany === newName) continue; // already in sync

      sheet.getRange(rowNum, h['CompanyName'] + 1).setValue(newName);
      sheet.getRange(rowNum, h['UpdatedAt']   + 1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy']   + 1).setValue(user ? user.email : 'System');

      _writeLog('Account', String(row[h['ClientID']]), 'UPDATE',
        'companyName', oldCompany, newName + ' (cascaded from Customer rename)', user);
    }
  } catch (e) {
    Logger.log('_cascadeCustomerNameToClients error: ' + e.message);
  }
}

// ── Cascade all-terminated check ───────────────────────────────────
// Called after any client status change. If ALL clients of a customer
// are Terminated, Cancelled, or Paused — auto-terminate the customer.
function _checkAndCascadeCustomerStatus(customerId, user, terminationDate) {
  try {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!cliSheet) return;
    var cliData  = cliSheet.getDataRange().getValues();
    var ch = {};
    cliData[0].forEach(function (col, i) { if (col) ch[String(col)] = i; });

    var totalClients   = 0;
    var hasActiveClient = false;
    var hasPausedClient = false;
    var allTerminated   = true;

    for (var i = 1; i < cliData.length; i++) {
      var row = cliData[i];
      if (!row[ch['ClientID']]) continue;
      if (String(row[ch['CustomerID']]) !== customerId) continue;
      totalClients++;
      var clientStatus = String(row[ch['Status']] || '');
      if (clientStatus === 'Active') hasActiveClient = true;
      if (clientStatus === CONFIG.STATUS.PAUSED) hasPausedClient = true;
      if (clientStatus !== 'Terminated') allTerminated = false;
    }

    if (totalClients === 0) return; // no clients yet — don't auto-terminate

    // Per the request — matches the same expected rule already
    // documented in the Audit module's own Customer/Account status
    // consistency checker: Active if any account is Active; Paused if
    // none are Active but at least one is Paused; Terminated only once
    // every account genuinely is (not merely Paused/Cancelled).
    var expectedCustStatus = null;
    if (hasActiveClient) expectedCustStatus = 'Active';
    else if (hasPausedClient) expectedCustStatus = CONFIG.STATUS.PAUSED;
    else if (allTerminated) expectedCustStatus = 'Terminated';
    // Any other mix (e.g. only Cancelled/blank) — no clear expectation,
    // leave the customer's status as-is rather than guess.

    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!custSheet) return;
    var custData  = custSheet.getDataRange().getValues();
    var custH = {};
    custData[0].forEach(function (col, i) { if (col) custH[String(col)] = i; });

    for (var j = 1; j < custData.length; j++) {
      if (String(custData[j][custH['CustomerID']]) !== customerId) continue;
      var currentStatus = String(custData[j][custH['Status']] || '');

      var nowCasc = new Date();
      if (expectedCustStatus && currentStatus !== expectedCustStatus) {
        custSheet.getRange(j + 1, custH['Status']    + 1).setValue(expectedCustStatus);
        if (custH['StatusDate'] !== undefined) custSheet.getRange(j + 1, custH['StatusDate'] + 1).setValue(expectedCustStatus === 'Terminated' ? (terminationDate || nowCasc) : nowCasc);
        custSheet.getRange(j + 1, custH['UpdatedAt'] + 1).setValue(nowCasc);
        custSheet.getRange(j + 1, custH['UpdatedBy'] + 1).setValue(user ? user.email : 'System');
        _writeLog('Customer', customerId, _classifyStatusChangeAction(currentStatus, expectedCustStatus), 'Status',
          currentStatus, expectedCustStatus, user, expectedCustStatus === 'Terminated' ? (terminationDate || nowCasc) : nowCasc);
        _writeLog('Customer', customerId, 'UPDATE', 'StatusDate',
          '', _sdCust(expectedCustStatus === 'Terminated' ? (terminationDate || nowCasc) : nowCasc), user, expectedCustStatus === 'Terminated' ? (terminationDate || nowCasc) : nowCasc);
      }
      break;
    }
  } catch (e) {
    Logger.log('_checkAndCascadeCustomerStatus error: ' + e.message);
  }
}

function _sdCust(val) {
  if (val instanceof Date) return val.toISOString();
  if (!val) return '';
  return String(val);
}

// ── Assign a customer to a specialist/manager (called from CS Specialists page)
function assignCustomerToSpecialist(customerId, specialistEmail) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });
    if (h['AssignedSpecialist'] === undefined) {
      return { success: false, error: 'AssignedSpecialist column missing. Run initializeSystem().' };
    }
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]) !== customerId) continue;
      var oldVal = String(data[i][h['AssignedSpecialist']] || '');
      sheet.getRange(i + 1, h['AssignedSpecialist'] + 1).setValue(specialistEmail);
      sheet.getRange(i + 1, h['UpdatedAt'] + 1).setValue(new Date());
      sheet.getRange(i + 1, h['UpdatedBy'] + 1).setValue(perm.user.email);
      _writeLog('Customer', customerId, 'UPDATE', 'assignedSpecialist', oldVal, specialistEmail, perm.user);
      return { success: true };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: 'assignCustomerToSpecialist: ' + e.message };
  }
}

// ── Transfer a customer from one specialist to another (with log entry)
function transferCustomerToSpecialist(customerId, toEmail, fromSpecName, toSpecName, notes) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var data  = sheet.getDataRange().getValues();
    var h = {};
    data[0].forEach(function(col, i){ if (col) h[String(col)] = i; });

    if (h['AssignedSpecialist'] === undefined) {
      return { success: false, error: 'AssignedSpecialist column missing. Run initializeSystem().' };
    }

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]) !== customerId) continue;
      var oldVal = String(data[i][h['AssignedSpecialist']] || '');
      var now    = new Date();

      sheet.getRange(i+1, h['AssignedSpecialist']+1).setValue(toEmail);
      sheet.getRange(i+1, h['UpdatedAt']+1).setValue(now);
      sheet.getRange(i+1, h['UpdatedBy']+1).setValue(perm.user.email);

      // Log the transfer with context
      var logNote = 'Transferred from ' + (fromSpecName||oldVal) + ' to ' + (toSpecName||toEmail) +
                    (notes ? '. Note: ' + notes : '') +
                    '. By: ' + perm.user.email;
      _writeLog('Customer', customerId, 'TRANSFER', 'AssignedSpecialist', oldVal, toEmail, perm.user);
      _writeLog('Customer', customerId, 'NOTE',     'TransferNote',        '',     logNote, perm.user);

      return { success: true };
    }
    return { success: false, error: 'Customer not found.' };
  } catch(e) {
    return { success: false, error: 'transferCustomerToSpecialist: ' + e.message };
  }
}

// ── Full customer profile: customer + accounts + open SR/IQ counts + specialist history
function getCustomerFullProfile(customerId) {
  try {
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var cSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!cSheet) return { success:false, error:'Customers sheet missing.' };
    var cData  = cSheet.getDataRange().getValues();
    var ch = {}; cData[0].forEach(function(col,i){ if(col) ch[String(col)]=i; });

    var customer = null;
    for (var i=1;i<cData.length;i++) {
      if (String(cData[i][ch['CustomerID']]) !== customerId) continue;
      customer = {
        customerId:         String(cData[i][ch['CustomerID']]||''),
        customerName:       String(cData[i][ch['CustomerName']]||''),
        assignedSpecialist: String(ch['AssignedSpecialist']!==undefined?(cData[i][ch['AssignedSpecialist']]||''):''),
        status:             String(cData[i][ch['Status']]||''),
        notes:              String(cData[i][ch['Notes']]||''),
        createdAt:          _sd(cData[i][ch['CreatedAt']]),
        createdBy:          String(cData[i][ch['CreatedBy']]||''),
        updatedAt:          _sd(cData[i][ch['UpdatedAt']]),
        statusDate:         ch['StatusDate']!==undefined?_sd(cData[i][ch['StatusDate']]):'',
        paymentDate:        ch['PaymentDate']  !==undefined?_sd(cData[i][ch['PaymentDate']]):'',
        noPaymentYet:       ch['NoPaymentYet'] !==undefined?_toBool(cData[i][ch['NoPaymentYet']]):false
      };
      break;
    }
    if (!customer) return { success:false, error:'Customer not found.' };

    var idle = _computeCustomerIdleDays(customerId, customer.createdAt, customer.paymentDate, customer.noPaymentYet);
    customer.idleDaysSinceAdded = idle.idleDaysSinceAdded;
    customer.idleDaysSincePaid  = idle.idleDaysSincePaid;
    customer.firstVAConnectedAt = idle.firstVAConnectedAt;

    // ── Accounts
    var clientRes = getClientsByCustomer(customerId);
    customer.clients = (clientRes && clientRes.success) ? clientRes.data : [];

    // ── Open SR count per clientId
    var openSRByClient = {}, openSRTotal = 0;
    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (reqSheet) {
      var rData = reqSheet.getDataRange().getValues();
      var rh={}; rData[0].forEach(function(c,i){ if(c) rh[String(c)]=i; });
      var openSt = [CONFIG.VA_REQUEST_STATUS.OPEN, CONFIG.VA_REQUEST_STATUS.IN_PROGRESS];
      for (var r=1;r<rData.length;r++) {
        if (String(rData[r][rh['CustomerID']]||'') !== customerId) continue;
        if (openSt.indexOf(String(rData[r][rh['Status']]||'')) < 0) continue;
        var rcli = String(rData[r][rh['ClientID']]||'').trim();
        openSRByClient[rcli] = (openSRByClient[rcli]||0)+1;
        openSRTotal++;
      }
    }

    // ── Open Inquiry count per clientId
    var openIQByClient = {}, openIQTotal = 0;
    var iqSheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
    if (iqSheet) {
      var iqData = iqSheet.getDataRange().getValues();
      var iqh={}; iqData[0].forEach(function(c,i){ if(c) iqh[String(c)]=i; });
      var openIQSt = [CONFIG.INQUIRY_STATUS.OPEN, CONFIG.INQUIRY_STATUS.IN_PROGRESS];
      for (var q=1;q<iqData.length;q++) {
        if (String(iqData[q][iqh['CustomerID']]||'') !== customerId) continue;
        if (openIQSt.indexOf(String(iqData[q][iqh['Status']]||'')) < 0) continue;
        var qcli = String(iqData[q][iqh['ClientID']]||'').trim();
        openIQByClient[qcli] = (openIQByClient[qcli]||0)+1;
        openIQTotal++;
      }
    }

    // Attach counts to each account
    customer.clients.forEach(function(cl) {
      cl.openSR = openSRByClient[cl.clientId] || 0;
      cl.openIQ = openIQByClient[cl.clientId] || 0;
    });
    customer.openSRTotal  = openSRTotal;
    customer.openIQTotal  = openIQTotal;

    // ── Active VA connections per account — needed to show each account's
    // active VAs as sub-rows, and a Total Active VA Connections count.
    // Department/Service come from the associated request, not the
    // connection itself — VAConnections has no such column directly.
    var deptByRequestId = {};
    if (reqSheet) {
      var reqDataForDept = reqSheet.getDataRange().getValues();
      var rhForDept = {}; reqDataForDept[0].forEach(function(c,i){ if(c) rhForDept[String(c)]=i; });
      for (var rdi = 1; rdi < reqDataForDept.length; rdi++) {
        var rdiId = String(reqDataForDept[rdi][rhForDept['RequestID']]||''); if (!rdiId) continue;
        deptByRequestId[rdiId] = {
          department: String(reqDataForDept[rdi][rhForDept['Department']]||''),
          service:    rhForDept['Service']!==undefined ? String(reqDataForDept[rdi][rhForDept['Service']]||'') : ''
        };
      }
    }
    var activeVAsByClient = {};
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (connSheet) {
      var connData = connSheet.getDataRange().getValues();
      var coh = {}; connData[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });
      for (var cvi = 1; cvi < connData.length; cvi++) {
        var cvClientId = String(connData[cvi][coh['ClientID']]||'').trim(); if (!cvClientId) continue;
        var cvStatus = String(connData[cvi][coh['ConnectionStatus']]||'');
        if (cvStatus !== CONFIG.VA_CONNECTION_STATUS.STARTED) continue; // only genuinely active connections count
        var cvReqId = String(connData[cvi][coh['RequestID']]||'');
        var cvDeptInfo = deptByRequestId[cvReqId] || { department:'', service:'' };
        if (!activeVAsByClient[cvClientId]) activeVAsByClient[cvClientId] = [];
        activeVAsByClient[cvClientId].push({
          connectionId: String(connData[cvi][coh['ConnectionID']]||''),
          vaId:         String(connData[cvi][coh['VAID']]||''),
          vaName:       String(connData[cvi][coh['VAName']]||''),
          department:   cvDeptInfo.department,
          service:      cvDeptInfo.service,
          hours:        coh['Hours']!==undefined ? connData[cvi][coh['Hours']] : '',
          hoursType:    coh['HoursType']!==undefined ? String(connData[cvi][coh['HoursType']]||'') : '',
          actualStartDate: coh['ActualStartDate']!==undefined ? _sd(connData[cvi][coh['ActualStartDate']]) : ''
        });
      }
    }
    customer.clients.forEach(function(cl) {
      cl.activeVAs = activeVAsByClient[cl.clientId] || [];
      cl.activeVACount = cl.activeVAs.length;
    });

    // ── Specialist assignment history from activity logs
    var specHistory = [];
    var logSheet = ss.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
    if (logSheet) {
      var lgData = logSheet.getDataRange().getValues();
      var lgh={}; lgData[0].forEach(function(c,i){ if(c) lgh[String(c)]=i; });
      for (var l=1;l<lgData.length;l++) {
        if (String(lgData[l][lgh['EntityID']]||'') !== customerId) continue;
        var action = String(lgData[l][lgh['Action']]||'');
        var field  = String(lgData[l][lgh['FieldChanged']]||'').toLowerCase();
        if (action !== 'TRANSFER' && (action !== 'UPDATE' || field !== 'assignedspecialist')) continue;
        specHistory.push({
          action:   action,
          oldValue: String(lgData[l][lgh['OldValue']]||''),
          newValue: String(lgData[l][lgh['NewValue']]||''),
          by:       String(lgData[l][lgh['UserName']] ||lgData[l][lgh['UserEmail']]||''),
          date:     _sd(lgData[l][lgh['Timestamp']])
        });
      }
      specHistory.reverse(); // newest first
    }
    customer.specHistory = specHistory;

    return { success:true, data:customer };
  } catch(e) {
    return { success:false, error:'getCustomerFullProfile: '+e.message };
  }
}

// ── Curated Account History + VA Connection History for the Customer
// Profile's History tab. Unlike the generic per-entity activity log
// (getLogs), this combines events across the Customer itself, every one
// of its Accounts, and every VA Connection under any of those Accounts
// into one unified timeline of the specific event types that actually
// matter for understanding this customer's lifecycle — not a raw log dump.
function getCustomerAccountHistory(customerId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // All Clients (Accounts) under this customer
    var clientRes = getClientsByCustomer(customerId);
    var clients = (clientRes && clientRes.success) ? clientRes.data : [];
    var clientIds = clients.map(function(c){ return c.clientId; });
    var clientById = {}; clients.forEach(function(c){ clientById[c.clientId] = c; });

    // Customer name (for the "Create Customer" row)
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var custName = '';
    if (custSheet) {
      var custData = custSheet.getDataRange().getValues();
      var ch = {}; custData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
      for (var ci = 1; ci < custData.length; ci++) {
        if (String(custData[ci][ch['CustomerID']]||'') === customerId) { custName = String(custData[ci][ch['CustomerName']]||''); break; }
      }
    }

    var events = [];

    // ── Customer-level CREATE + status changes
    var custLogsRes = getLogs({ entityId: customerId, entityType: 'Customer' });
    var custLogs = (custLogsRes && custLogsRes.success) ? custLogsRes.data : [];
    custLogs.forEach(function(log) {
      if (log.action === 'CREATE') {
        events.push({ type: 'Create Customer', col1: custName, col2: '-', col3: '-', status: 'Pending', date: log.timestamp, by: log.changedBy });
      } else if (log.fieldChanged === 'Status' || log.fieldChanged === 'status') {
        var newSt = String(log.newValue||'');
        var label = (newSt === 'Paused') ? 'Paused Customer'
                  : (newSt === 'Terminated' || newSt === 'Cancelled') ? 'Terminated Customer'
                  : (newSt === 'Active' && (String(log.oldValue||'')==='Terminated' || String(log.oldValue||'')==='Cancelled' || String(log.oldValue||'')==='Paused')) ? 'Reactivated Customer'
                  : (newSt === 'Pending') ? 'Reactivated Customer'
                  : null;
        if (label) events.push({ type: label, col1: custName, col2: '', col3: '', status: newSt, date: log.effectiveDate || log.timestamp, by: log.changedBy });
      }
    });

    // ── Account-level CREATE + status changes, per client — also collect
    // each account's pause/termination dates, needed below to partition
    // that account's VA connections into periods.
    var acctPauseTermDates = {}; // clientId -> sorted array of dates
    clients.forEach(function(cl) {
      acctPauseTermDates[cl.clientId] = [];
      var cliLogsRes = getLogs({ entityId: cl.clientId, entityType: ['Client', 'Account'] });
      var cliLogs = (cliLogsRes && cliLogsRes.success) ? cliLogsRes.data : [];
      cliLogs.forEach(function(log) {
        if (log.action === 'CREATE') {
          events.push({ type: 'Create Account', col1: cl.accountName || cl.companyName, col2: cl.primaryContact || '-', col3: cl.secondaryContact || '-', status: 'Pending', date: log.timestamp, by: log.changedBy });
        } else if (log.action === 'WELCOME_EMAIL_SENT') {
          var emailDetails = {};
          try { emailDetails = JSON.parse(log.newValue || '{}'); } catch (parseEx) {}
          events.push({ type: 'Welcome Email Sent', col1: cl.accountName || cl.companyName, col2: emailDetails.templateName || '', col3: emailDetails.to || '', status: '', date: log.timestamp, by: log.changedBy });
        } else if (log.fieldChanged === 'Status' || log.fieldChanged === 'status') {
          var newSt2 = String(log.newValue||'');
          var label2 = (newSt2 === 'Paused') ? 'Paused Account'
                     : (newSt2 === 'Terminated' || newSt2 === 'Cancelled') ? 'Terminated Account'
                     : (newSt2 === 'Active' && (String(log.oldValue||'')==='Terminated' || String(log.oldValue||'')==='Cancelled' || String(log.oldValue||'')==='Paused')) ? 'Reactivated Account'
                     : (newSt2 === 'Pending') ? 'Reactivated Account'
                     : null;
          var evDate = log.effectiveDate || log.timestamp;
          if (label2) {
            events.push({ type: label2, col1: cl.accountName || cl.companyName, col2: '', col3: '', status: newSt2, date: evDate, by: log.changedBy });
            if (newSt2 === 'Paused' || newSt2 === 'Terminated' || newSt2 === 'Cancelled') acctPauseTermDates[cl.clientId].push(evDate);
          }
        }
      });
      acctPauseTermDates[cl.clientId].sort(function(a,b){ return new Date(a||0) - new Date(b||0); });
    });

    // ── VA Connections — read directly from VAConnections rather than
    // logs, since these are structured fields. Grouped per account, then
    // summarized as First/Last VA Connected per period (not one event per
    // connection — too noisy for accounts with many VAs over time), where
    // a "period" is bounded by that account's own pause/termination dates.
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var vaConnRows = [];
    var connsByClient = {};
    if (connSheet && clientIds.length) {
      var connData = connSheet.getDataRange().getValues();
      var coh = {}; connData[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });
      var deptByRequestId2 = {};
      var reqSheet2 = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
      if (reqSheet2) {
        var reqData2 = reqSheet2.getDataRange().getValues();
        var rh2 = {}; reqData2[0].forEach(function(c,i){ if(c) rh2[String(c)]=i; });
        for (var rj = 1; rj < reqData2.length; rj++) {
          var rjId = String(reqData2[rj][rh2['RequestID']]||''); if (!rjId) continue;
          deptByRequestId2[rjId] = {
            department: String(reqData2[rj][rh2['Department']]||''),
            service: rh2['Service']!==undefined ? String(reqData2[rj][rh2['Service']]||'') : ''
          };
        }
      }
      for (var vi = 1; vi < connData.length; vi++) {
        var vClientId = String(connData[vi][coh['ClientID']]||''); if (clientIds.indexOf(vClientId) === -1) continue;
        // No filtering on RequestID at all — a connection with a missing/
        // blank RequestID still belongs on this account and still counts.
        var vAcctName = clientById[vClientId] ? (clientById[vClientId].accountName || clientById[vClientId].companyName) : vClientId;
        var vReqId = String(connData[vi][coh['RequestID']]||'');
        var vDeptInfo = deptByRequestId2[vReqId] || { department:'', service:'' };
        var vVaName = String(connData[vi][coh['VAName']]||'');
        var vStart = coh['ActualStartDate']!==undefined ? _sd(connData[vi][coh['ActualStartDate']]) : '';
        var vEnd   = coh['TerminationDate']!==undefined ? _sd(connData[vi][coh['TerminationDate']]) : '';
        var vStatus = String(connData[vi][coh['ConnectionStatus']]||'');
        var vAssignedAt = coh['AssignedAt']!==undefined ? _sd(connData[vi][coh['AssignedAt']]) : '';
        var vConnId = String(connData[vi][coh['ConnectionID']]||'');

        if (vEnd) {
          events.push({ type: 'VA Terminated', col1: vAcctName, col2: [vDeptInfo.department, vVaName].filter(Boolean).join(', '), col3: '', status: 'Terminated', date: vEnd, by: '' });
        }
        if (vStart) {
          if (!connsByClient[vClientId]) connsByClient[vClientId] = [];
          connsByClient[vClientId].push({ vaName: vVaName, department: vDeptInfo.department, start: vStart, acctName: vAcctName });
        }

        // Full VA Connection History table row — every connection appears
        // here individually regardless of the account-history summarizing
        // above; this table is the detailed record, not the summary.
        vaConnRows.push({
          requestId: vReqId,
          connectionId: vConnId,
          department: vDeptInfo.department,
          service: vDeptInfo.service,
          vaName: vVaName,
          status: vStatus,
          dateStarted: vStart || vAssignedAt,
          dateEnded: vEnd
        });
      }
    }

    // Partition each account's connections into periods bounded by its own
    // pause/termination dates, then summarize each period as First (and
    // Last, if more than one) VA Connected.
    Object.keys(connsByClient).forEach(function(clientId) {
      var conns = connsByClient[clientId].slice().sort(function(a,b){ return new Date(a.start||0) - new Date(b.start||0); });
      var boundaries = acctPauseTermDates[clientId] || [];
      var periods = [];
      var bi = 0;
      var current = [];
      conns.forEach(function(c) {
        while (bi < boundaries.length && new Date(c.start) >= new Date(boundaries[bi])) {
          if (current.length) periods.push(current);
          current = [];
          bi++;
        }
        current.push(c);
      });
      if (current.length) periods.push(current);

      periods.forEach(function(period) {
        var first = period[0], last = period[period.length-1];
        events.push({ type: 'First VA Connected', col1: first.acctName, col2: [first.department, first.vaName].filter(Boolean).join(', '), col3: '', status: 'Active', date: first.start, by: '' });
        if (period.length > 1) {
          events.push({ type: 'Last VA Connected', col1: last.acctName, col2: [last.department, last.vaName].filter(Boolean).join(', '), col3: '', status: 'Active', date: last.start, by: '' });
        }
      });
    });

    // Account History: oldest first, latest last — a normal top-to-bottom
    // chronological read.
    events.sort(function(a,b){ return new Date(a.date||0) - new Date(b.date||0); });
    // VA Connection History table: still sorted by start date, latest first
    // — this is the detailed lookup table, a different sort convention
    // than the Account History timeline above.
    vaConnRows.sort(function(a,b){ return new Date(b.dateStarted||0) - new Date(a.dateStarted||0); });

    return { success: true, accountHistory: events, vaConnectionHistory: vaConnRows };
  } catch (e) {
    return { success: false, error: 'getCustomerAccountHistory: ' + e.message };
  }
}

// ─────────────────────────────────────────
// Customer Idle Time Report — all customers at once
// ─────────────────────────────────────────
// Same "idle days" definition as _computeCustomerIdleDays, but scans the
// VAConnections sheet once and buckets by CustomerID instead of re-scanning
// per customer, so this stays fast as both sheets grow.
function getCustomerIdleTimeReport(filters) {
  try {
    filters = filters || {};
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!custSheet) return { success:false, error:'Customers sheet missing.' };
    var cData = custSheet.getDataRange().getValues();
    var ch = {}; cData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });

    // ── Earliest qualifying (Accepted/Started) VA connection per customer
    var firstConnByCustomer = {};
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (connSheet) {
      var coData = connSheet.getDataRange().getValues();
      var coh = {}; coData[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });
      var QUALIFYING = [CONFIG.VA_CONNECTION_STATUS.ACCEPTED, CONFIG.VA_CONNECTION_STATUS.STARTED];
      if (coh['CustomerID'] !== undefined && coh['ConnectionStatus'] !== undefined) {
        for (var ci=1; ci<coData.length; ci++) {
          var custIdRef = String(coData[ci][coh['CustomerID']]||''); if (!custIdRef) continue;
          if (QUALIFYING.indexOf(String(coData[ci][coh['ConnectionStatus']]||'')) === -1) continue;
          var dv = (coh['ActualStartDate']!==undefined && coData[ci][coh['ActualStartDate']]) ? coData[ci][coh['ActualStartDate']]
                 : (coh['AssignedAt']      !==undefined && coData[ci][coh['AssignedAt']])      ? coData[ci][coh['AssignedAt']]
                 : null;
          var dd = dv instanceof Date ? dv : (dv ? new Date(dv) : null);
          if (!dd || isNaN(dd.getTime())) continue;
          if (!firstConnByCustomer[custIdRef] || dd < firstConnByCustomer[custIdRef]) firstConnByCustomer[custIdRef] = dd;
        }
      }
    }

    var rows = [];
    for (var i=1; i<cData.length; i++) {
      var custId = String(cData[i][ch['CustomerID']]||''); if (!custId) continue;
      var custName    = String(cData[i][ch['CustomerName']]||'');
      var status      = String(cData[i][ch['Status']]||'');
      var createdAtD  = cData[i][ch['CreatedAt']] instanceof Date ? cData[i][ch['CreatedAt']] : null;
      var noPaymentYet= ch['NoPaymentYet'] !== undefined ? _toBool(cData[i][ch['NoPaymentYet']]) : false;
      var paymentD    = (!noPaymentYet && ch['PaymentDate'] !== undefined && cData[i][ch['PaymentDate']])
                          ? (cData[i][ch['PaymentDate']] instanceof Date ? cData[i][ch['PaymentDate']] : new Date(cData[i][ch['PaymentDate']]))
                          : null;
      if (paymentD && isNaN(paymentD.getTime())) paymentD = null;

      if (filters.status && status !== filters.status) continue;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (custName.toLowerCase().indexOf(q) === -1 && custId.toLowerCase().indexOf(q) === -1) continue;
      }

      var firstConn = firstConnByCustomer[custId] || null;
      var idleDaysSinceAdded = (firstConn && createdAtD) ? Math.max(0, Math.round((firstConn - createdAtD) / 86400000)) : null;
      var idleDaysSincePaid  = (firstConn && paymentD)   ? Math.max(0, Math.round((firstConn - paymentD)   / 86400000)) : null;
      // Still-idle customers (no qualifying VA connection yet) — days counted up to today instead of null,
      // so the report can surface "currently idle for N days" rather than hiding them entirely.
      var stillIdleDaysSinceAdded = (!firstConn && createdAtD) ? Math.max(0, Math.round((new Date() - createdAtD) / 86400000)) : null;
      var stillIdleDaysSincePaid  = (!firstConn && paymentD)   ? Math.max(0, Math.round((new Date() - paymentD)   / 86400000)) : null;

      rows.push({
        customerId: custId,
        customerName: custName,
        status: status,
        createdAt: createdAtD ? createdAtD.toISOString() : '',
        paymentDate: paymentD ? paymentD.toISOString() : '',
        noPaymentYet: noPaymentYet,
        firstVAConnectedAt: firstConn ? firstConn.toISOString() : '',
        isConnected: !!firstConn,
        idleDaysSinceAdded: idleDaysSinceAdded,
        idleDaysSincePaid: idleDaysSincePaid,
        stillIdleDaysSinceAdded: stillIdleDaysSinceAdded,
        stillIdleDaysSincePaid: stillIdleDaysSincePaid
      });
    }

    rows.sort(function(a,b){ return new Date(b.createdAt||0) - new Date(a.createdAt||0); });

    // ── Summary averages (only over customers that DO have a qualifying connection)
    var connectedRows = rows.filter(function(r){ return r.isConnected; });
    function avg(arr, key) {
      var vals = arr.map(function(r){ return r[key]; }).filter(function(v){ return v !== null && v !== undefined; });
      if (!vals.length) return null;
      return Math.round((vals.reduce(function(a,b){return a+b;},0) / vals.length) * 10) / 10;
    }
    var summary = {
      totalCustomers: rows.length,
      connectedCustomers: connectedRows.length,
      stillIdleCustomers: rows.length - connectedRows.length,
      avgIdleDaysSinceAdded: avg(connectedRows, 'idleDaysSinceAdded'),
      avgIdleDaysSincePaid:  avg(connectedRows, 'idleDaysSincePaid')
    };

    return { success:true, data: rows, summary: summary };
  } catch (e) {
    return { success:false, error:'getCustomerIdleTimeReport: ' + e.message };
  }
}

// ── Customer/Account Notes ───────────────────────────────────────────
// A single, unified sheet with a NoteType discriminator, per the
// request — rather than two separate sheets, since viewing an Account's
// notes needs both its own notes and its parent Customer's notes
// together in one combined, clearly-labeled list.
function _canGetSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMER_ACCOUNT_NOTES);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.CUSTOMER_ACCOUNT_NOTES);
    sheet.appendRow(CONFIG.SCHEMA.CustomerAccountNotes);
    sheet.getRange(1,1,1,CONFIG.SCHEMA.CustomerAccountNotes.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function addCustomerAccountNote(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var noteType = (payload.noteType === 'Account') ? 'Account' : 'Customer';
    if (!payload.customerId) return { success: false, error: 'Customer ID is required.' };
    if (noteType === 'Account' && !payload.clientId) return { success: false, error: 'Client ID is required for an Account note.' };
    var noteText = (payload.noteText||'').trim();
    if (!noteText) return { success: false, error: 'Note text is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _canGetSheet(ss);
    var noteId = generateID('CAN');
    var now = new Date();
    sheet.appendRow([noteId, noteType, payload.customerId, noteType === 'Account' ? payload.clientId : '', noteText, now, perm.user.email]);
    _writeLog('CustomerAccountNote', noteId, 'CREATE', 'NoteText', '', noteText.substring(0,120), perm.user);

    return { success: true, noteId: noteId };
  } catch (e) {
    return { success: false, error: 'addCustomerAccountNote: ' + e.message };
  }
}

// Only this customer's own notes — used on the Customer modal/profile,
// per the request (a customer view doesn't show any of its accounts'
// own notes, only its own).
function getCustomerNotes(customerId) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!customerId) return { success: false, error: 'Customer ID is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _canGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]||'') !== customerId) continue;
      if (String(data[i][h['NoteType']]||'') !== 'Customer') continue;
      rows.push({
        noteId: String(data[i][h['NoteID']]||''),
        noteType: 'Customer',
        noteText: String(data[i][h['NoteText']]||''),
        createdAt: data[i][h['CreatedAt']] ? new Date(data[i][h['CreatedAt']]).toISOString() : '',
        createdBy: String(data[i][h['CreatedBy']]||'')
      });
    }
    rows.sort(function(a,b){ return new Date(b.createdAt||0) - new Date(a.createdAt||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getCustomerNotes: ' + e.message };
  }
}

// An account's own notes combined with its parent customer's notes, per
// the request — each row tagged with noteType so the frontend can
// clearly distinguish which is which, sorted most-recent-first across
// both together rather than as two separate lists.
function getAccountNotesWithCustomer(clientId) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!clientId) return { success: false, error: 'Client ID is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var customerId = '';
    if (cliSheet) {
      var cd = cliSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
      for (var ci = 1; ci < cd.length; ci++) {
        if (String(cd[ci][ch['ClientID']]||'') !== clientId) continue;
        customerId = String(cd[ci][ch['CustomerID']]||'');
        break;
      }
    }

    var sheet = _canGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var rType = String(data[i][h['NoteType']]||'');
      var isThisAccount = rType === 'Account' && String(data[i][h['ClientID']]||'') === clientId;
      var isParentCustomer = rType === 'Customer' && customerId && String(data[i][h['CustomerID']]||'') === customerId;
      if (!isThisAccount && !isParentCustomer) continue;
      rows.push({
        noteId: String(data[i][h['NoteID']]||''),
        noteType: rType,
        noteText: String(data[i][h['NoteText']]||''),
        createdAt: data[i][h['CreatedAt']] ? new Date(data[i][h['CreatedAt']]).toISOString() : '',
        createdBy: String(data[i][h['CreatedBy']]||'')
      });
    }
    rows.sort(function(a,b){ return new Date(b.createdAt||0) - new Date(a.createdAt||0); });
    return { success: true, data: rows, customerId: customerId };
  } catch (e) {
    return { success: false, error: 'getAccountNotesWithCustomer: ' + e.message };
  }
}