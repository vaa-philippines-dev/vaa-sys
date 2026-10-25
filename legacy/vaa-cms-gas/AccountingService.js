// ═══════════════════════════════════════════════════════════════════════
// ACCOUNTING MODULE — Phase 1: Core Ledger
// ═══════════════════════════════════════════════════════════════════════
// Per the planning doc's phasing (§9): Clients, Departments, Enrollment,
// VAs, Billing Cycles, Payments — manual invoice entry, no automation
// yet. "Clients" and "VAs" are reconciled to this app's existing
// Customers and VAConnections tables rather than duplicated (see the
// schema comments in Code.gs). Genuinely new here: Client-Department
// Enrollment, Deposits, Billing Cycles, Payments.
//
// Every write path is gated through checkModulePermission('Accounting', ...)
// — the comprehensive permissions system — rather than the older, generic
// checkPermission('edit') pattern, since this is a new module built after
// that system existed.
//
// Honest scope note: this is Phase 1 only. No automated billing
// generation (§4.2-4.3), no Hours Reconciliation, ND records, or
// Training Bond ledger tables yet, no attendance import — those are
// Phases 2-5 of the plan and are real, separate follow-up work.

function _acctEnrollSheet(ss) { var s = _ensureSheet(ss, CONFIG.SHEETS.ACCT_ENROLLMENT, CONFIG.SCHEMA.ClientDeptEnrollment); _migrateSheetColumns(ss, CONFIG.SHEETS.ACCT_ENROLLMENT, CONFIG.SCHEMA.ClientDeptEnrollment); return s; }
function _acctDepositSheet(ss) { var s = _ensureSheet(ss, CONFIG.SHEETS.ACCT_DEPOSITS, CONFIG.SCHEMA.Deposits); _migrateSheetColumns(ss, CONFIG.SHEETS.ACCT_DEPOSITS, CONFIG.SCHEMA.Deposits); return s; }
function _acctBillingSheet(ss) { var s = _ensureSheet(ss, CONFIG.SHEETS.ACCT_BILLING_CYCLES, CONFIG.SCHEMA.BillingCycles); _migrateSheetColumns(ss, CONFIG.SHEETS.ACCT_BILLING_CYCLES, CONFIG.SCHEMA.BillingCycles); return s; }
function _acctPaymentSheet(ss) { var s = _ensureSheet(ss, CONFIG.SHEETS.ACCT_PAYMENTS, CONFIG.SCHEMA.Payments); _migrateSheetColumns(ss, CONFIG.SHEETS.ACCT_PAYMENTS, CONFIG.SCHEMA.Payments); return s; }

function _acctPermGuard(action) {
  var perm = checkModulePermission('Billing & Payments', action);
  if (!perm.allowed) return { allowed: false, error: 'You don\'t have permission for this in Accounting.' };
  return perm;
}

// ── Client-Department Enrollment (§2.3, §4.1) ───────────────────────

// The formula from §7 of the plan: a One-Time Fee is only owed if this
// customer+department pair has never been enrolled before.
function checkOneTimeFeeDue(clientId) {
  try {
    var ss = getAccountingSpreadsheet();
    var sheet = _acctEnrollSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]||'') === clientId) {
        return { success: true, feeDue: false, existingEnrollment: _mapEnrollmentRow(data[i], h) };
      }
    }
    return { success: true, feeDue: true, existingEnrollment: null };
  } catch (e) {
    return { success: false, error: 'checkOneTimeFeeDue: ' + e.message };
  }
}
function _mapEnrollmentRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    enrollmentId: String(get('EnrollmentID')||''),
    clientId: String(get('ClientID')||''),
    customerId: String(get('CustomerID')||''),
    department: String(get('Department')||''),
    dateFirstActivated: get('DateFirstActivated'),
    oneTimeFeeCharged: get('OneTimeFeeCharged') === true,
    oneTimeFeeAmount: get('OneTimeFeeAmount') || 0,
    waivedOrDiscounted: get('WaivedOrDiscounted') === true,
    waiverReason: String(get('WaiverReason')||''),
    billingDate: get('BillingDate'),
    paymentDate: get('PaymentDate'),
    createdAt: get('CreatedAt'), createdBy: String(get('CreatedBy')||'')
  };
}

// Creates the enrollment row (first-ever activation of this account) and
// records whether the One-Time Fee was charged, waived, or discounted.
// Adapted per the request — one row per ClientID (Account), ever, not
// per Customer+Department pair.
function createEnrollment(payload) {
  try {
    var perm = _acctPermGuard('c'); if (!perm.allowed) return perm;
    if (!payload || !payload.clientId) {
      return { success: false, error: 'clientId is required.' };
    }
    var existing = checkOneTimeFeeDue(payload.clientId);
    if (existing.success && !existing.feeDue) {
      return { success: false, error: 'This account is already enrolled — no new One-Time Fee applies.' };
    }

    // Derived from the account's own record — kept on this row for
    // reporting/joining, but no longer part of the identity (ClientID
    // alone is, per the request). Department isn't a field the account
    // itself has (an account can have Service Requests across multiple
    // departments), so this is left blank here — best-effort reporting
    // context only, not required for the core logic.
    var clientRes = getClients({});
    var clientRec = (clientRes.success ? clientRes.data : []).find(function(c){ return c.clientId === payload.clientId; });
    if (!clientRec) return { success: false, error: 'Account not found.' };
    var customerId = clientRec.customerId || '';
    var department = payload.department || '';

    // OTF and Deposit are now independently waivable — falls back to the
    // old shared waivedOrDiscounted/waiverReason fields if the caller
    // doesn't specify these separately, for backward compatibility.
    var otfWaived = payload.otfWaived !== undefined ? !!payload.otfWaived : !!payload.waivedOrDiscounted;
    var otfWaiverReason = payload.otfWaiverReason !== undefined ? payload.otfWaiverReason : payload.waiverReason;
    var depositWaived = payload.depositWaived !== undefined ? !!payload.depositWaived : !!payload.waivedOrDiscounted;
    var depositWaiverReason = payload.depositWaiverReason !== undefined ? payload.depositWaiverReason : payload.waiverReason;

    if (otfWaived && !String(otfWaiverReason||'').trim()) {
      return { success: false, error: 'A reason is required when waiving or discounting the One-Time Fee.' };
    }
    if (depositWaived && !String(depositWaiverReason||'').trim()) {
      return { success: false, error: 'A reason is required when waiving or discounting the Deposit.' };
    }

    // Both the One-Time Fee and its paired Deposit default to $250 —
    // charged together the first time an account is enrolled.
    var oneTimeFeeAmount = (payload.oneTimeFeeAmount !== undefined && payload.oneTimeFeeAmount !== '') ? Number(payload.oneTimeFeeAmount) : 250;
    var depositAmount = (payload.depositAmount !== undefined && payload.depositAmount !== '') ? Number(payload.depositAmount) : 250;

    var ss = getAccountingSpreadsheet();
    var sheet = _acctEnrollSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var now = new Date();
    var id = generateID('ENR');
    var dateActivated = payload.dateFirstActivated ? _parseDateInput(payload.dateFirstActivated) : now;
    // Billing date and payment date are normally the same for both the
    // OTF and Deposit — shared here by default, per the request, though
    // each can still be overridden independently if the caller provides
    // otfBillingDate/depositBillingDate etc. specifically.
    var billingDate = payload.billingDate ? _parseDateInput(payload.billingDate) : dateActivated;
    var paymentDate = payload.paymentDate ? _parseDateInput(payload.paymentDate) : '';
    var row = data[0].map(function(){ return ''; });
    var cm = {
      'EnrollmentID': id,
      'ClientID': payload.clientId,
      'CustomerID': customerId,
      'Department': department,
      'DateFirstActivated': dateActivated,
      'OneTimeFeeCharged': !otfWaived,
      'OneTimeFeeAmount': oneTimeFeeAmount,
      'WaivedOrDiscounted': otfWaived,
      'WaiverReason': otfWaived ? otfWaiverReason : '',
      'BillingDate': payload.otfBillingDate ? _parseDateInput(payload.otfBillingDate) : billingDate,
      'PaymentDate': payload.otfPaymentDate ? _parseDateInput(payload.otfPaymentDate) : paymentDate,
      'CreatedAt': now, 'CreatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    _writeLog('Accounting', id, 'ENROLLMENT_CREATED', 'Account', '', payload.clientId, perm.user);

    // Auto-create the paired deposit for this same account — its own
    // independent waiver decision/reason now, not necessarily the same
    // as the OTF's.
    var depositRes = _acctCreateDepositInternal({
      clientId: payload.clientId, customerId: customerId, department: department,
      depositFee: depositAmount,
      paymentDate: payload.depositPaymentDate || paymentDate || billingDate,
      waivedOrDiscounted: depositWaived, reason: depositWaived ? depositWaiverReason : '',
      billingDate: payload.depositBillingDate ? _parseDateInput(payload.depositBillingDate) : billingDate
    }, perm.user);

    try { CacheService.getScriptCache().remove('acctFeesOverview'); }
    catch (cacheEx) { Logger.log('createEnrollment cache invalidation: ' + cacheEx.message); }

    return { success: true, id: id, depositId: depositRes.id || '' };
  } catch (e) {
    return { success: false, error: 'createEnrollment: ' + e.message };
  }
}

// Creates one enrollment (+ paired deposit) per department in a single
// call — lets one form submission cover multiple departments for the
// same customer at once, per the request. Each department is still
// validated independently (duplicate check, waiver reason requirements)
// via createEnrollment itself; one department failing doesn't block the
// others from succeeding.
function createEnrollmentsBulk(entries) {
  try {
    if (!entries || !entries.length) return { success: false, error: 'At least one account is required.' };
    var results = [];
    var successCount = 0;
    entries.forEach(function(entry) {
      var res = createEnrollment(entry);
      results.push({ clientId: entry.clientId, success: res.success, error: res.error || '', id: res.id || '' });
      if (res.success) successCount++;
    });
    return { success: successCount > 0, created: successCount, total: entries.length, results: results };
  } catch (e) {
    return { success: false, error: 'createEnrollmentsBulk: ' + e.message };
  }
}


function getEnrollmentForClient(clientId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = getAccountingSpreadsheet();
    var sheet = _acctEnrollSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]||'') !== clientId) continue;
      return { success: true, data: _mapEnrollmentRow(data[i], h) };
    }
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: 'getEnrollmentForClient: ' + e.message };
  }
}

// ── Deposits (§2.5) ──────────────────────────────────────────────────

function _mapDepositRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    depositId: String(get('DepositID')||''),
    clientId: String(get('ClientID')||''),
    customerId: String(get('CustomerID')||''),
    department: String(get('Department')||''),
    depositFee: get('DepositFee') || 0,
    paymentDate: get('PaymentDate'),
    amountApplied: get('AmountApplied') || 0,
    consumedDate: get('ConsumedDate'),
    applicationReason: String(get('ApplicationReason')||''),
    remainingBalance: get('RemainingBalance') || 0,
    status: String(get('Status')||''),
    reason: String(get('Reason')||''),
    billingDate: get('BillingDate'),
    createdAt: get('CreatedAt'), createdBy: String(get('CreatedBy')||''),
    updatedAt: get('UpdatedAt'), updatedBy: String(get('UpdatedBy')||'')
  };
}

// Shared internal writer — used both by the public createDeposit (a
// standalone deposit, e.g. collected outside of a new enrollment) and by
// createEnrollment (auto-creating the paired deposit for a new account).
// Kept separate from createDeposit itself so createEnrollment doesn't
// need to re-check permission a second time or duplicate this logic.
function _acctCreateDepositInternal(payload, user) {
  var ss = getAccountingSpreadsheet();
  var sheet = _acctDepositSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _hMapGeneric(data[0]);
  var now = new Date();
  var id = generateID('DEP');
  var amt = Number(payload.depositFee !== undefined ? payload.depositFee : payload.amountCollected);
  var isWaived = !!payload.waivedOrDiscounted;
  var paymentDateVal = payload.paymentDate || payload.dateCollected;
  var row = data[0].map(function(){ return ''; });
  var cm = {
    'DepositID': id, 'ClientID': payload.clientId, 'CustomerID': payload.customerId || '', 'Department': payload.department || '',
    'DepositFee': amt,
    'PaymentDate': paymentDateVal ? _parseDateInput(paymentDateVal) : now,
    'AmountApplied': 0, 'ConsumedDate': '', 'ApplicationReason': '',
    'RemainingBalance': isWaived ? 0 : amt, // waived/discounted deposits start with nothing outstanding
    'Status': isWaived ? 'Waived' : 'Active', // distinct from Refunded — never charged in the first place, not collected then given back
    'Reason': payload.reason || '',
    'BillingDate': payload.billingDate ? _parseDateInput(payload.billingDate) : (paymentDateVal ? _parseDateInput(paymentDateVal) : now),
    'CreatedAt': now, 'CreatedBy': user.email,
    'UpdatedAt': now, 'UpdatedBy': user.email
  };
  Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
  sheet.appendRow(row);
  _writeLog('Accounting', id, 'DEPOSIT_COLLECTED', 'Account', '', payload.clientId || '', user);
  return { success: true, id: id };
}

function createDeposit(payload) {
  try {
    var perm = _acctPermGuard('c'); if (!perm.allowed) return perm;
    if (!payload || !payload.clientId || !(payload.depositFee || payload.amountCollected)) {
      return { success: false, error: 'clientId and depositFee are required.' };
    }
    var res = _acctCreateDepositInternal(payload, perm.user);
    if (res.success) {
      try { CacheService.getScriptCache().remove('acctFeesOverview'); }
      catch (cacheEx) { Logger.log('createDeposit cache invalidation: ' + cacheEx.message); }
    }
    return res;
  } catch (e) {
    return { success: false, error: 'createDeposit: ' + e.message };
  }
}

// Applies (draws down) part or all of a deposit — either against an
// outstanding balance mid-relationship, or as final funding on exit
// (§4.12). RemainingBalance is always recomputed here, never entered
// manually, so it can't drift out of sync with what's actually applied.
// Status moves to Consumed (applied against billing) or Refunded (paid
// back on exit) once nothing remains outstanding.
function applyDeposit(depositId, amount, reason) {
  try {
    var perm = _acctPermGuard('u'); if (!perm.allowed) return perm;
    var amt = Number(amount);
    if (!amt || amt <= 0) return { success: false, error: 'A valid amount to apply is required.' };
    if (['Outstanding balance', 'Final funding on exit'].indexOf(reason) === -1) {
      return { success: false, error: 'Reason must be "Outstanding balance" or "Final funding on exit".' };
    }

    var ss = getAccountingSpreadsheet();
    var sheet = _acctDepositSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['DepositID']]) !== depositId) continue;
      var remaining = Number(data[i][h['RemainingBalance']]) || 0;
      if (amt > remaining) return { success: false, error: 'Cannot apply more than the remaining balance ($' + remaining.toFixed(2) + ').' };
      var newApplied = (Number(data[i][h['AmountApplied']]) || 0) + amt;
      var newRemaining = remaining - amt;
      var rowNum = i + 1;
      var now = new Date();
      sheet.getRange(rowNum, h['AmountApplied']+1).setValue(newApplied);
      sheet.getRange(rowNum, h['ConsumedDate']+1).setValue(now);
      sheet.getRange(rowNum, h['ApplicationReason']+1).setValue(reason);
      sheet.getRange(rowNum, h['RemainingBalance']+1).setValue(newRemaining);
      if (newRemaining <= 0 && h['Status'] !== undefined) {
        sheet.getRange(rowNum, h['Status']+1).setValue(reason === 'Final funding on exit' ? 'Refunded' : 'Consumed');
      }
      sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(perm.user.email);
      _writeLog('Accounting', depositId, 'DEPOSIT_APPLIED', reason, String(remaining), String(newRemaining), perm.user);
      try { CacheService.getScriptCache().remove('acctFeesOverview'); }
      catch (cacheEx) { Logger.log('applyDeposit cache invalidation: ' + cacheEx.message); }
      return { success: true, remainingBalance: newRemaining };
    }
    return { success: false, error: 'Deposit not found.' };
  } catch (e) {
    return { success: false, error: 'applyDeposit: ' + e.message };
  }
}

function getDepositForClient(clientId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = getAccountingSpreadsheet();
    var sheet = _acctDepositSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]||'') !== clientId) continue;
      rows.push(_mapDepositRow(data[i], h));
    }
    rows.sort(function(a,b){ return new Date(b.paymentDate||0) - new Date(a.paymentDate||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getDepositForClient: ' + e.message };
  }
}

// ── Fees & Deposits Overview ─────────────────────────────────────────
// One row per (customer, department) pair — every customer/account that
// has a One-Time Fee and/or Deposit on file, whether charged, waived, or
// discounted, with both charges' own billing/payment dates side by side.
function getFeesAndDepositsOverview() {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;

    var cache = CacheService.getScriptCache();
    var cacheKey = 'acctFeesOverview';
    try {
      var cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (cacheReadEx) { Logger.log('getFeesAndDepositsOverview cache read: ' + cacheReadEx.message); }

    var result = _computeFeesAndDepositsOverview();
    if (result.success) {
      try { cache.put(cacheKey, JSON.stringify(result), 300); } // 5 minutes
      catch (cacheWriteEx) { Logger.log('getFeesAndDepositsOverview cache write: ' + cacheWriteEx.message); }
    }
    return result;
  } catch (e) {
    return { success: false, error: 'getFeesAndDepositsOverview: ' + (e.message || String(e)) };
  }
}

function _computeFeesAndDepositsOverview() {
  try {
    var ss = getAccountingSpreadsheet();

    var custRes = getCustomers({});
    var custNameById = {};
    if (custRes.success) custRes.data.forEach(function(c){ custNameById[c.customerId] = c.customerName; });

    var clientRes = getClients({});
    var clientById = {};
    if (clientRes.success) clientRes.data.forEach(function(c){ clientById[c.clientId] = c; });

    var enrollSheet = _acctEnrollSheet(ss);
    var enrollData = enrollSheet.getDataRange().getValues();
    var eh = _hMapGeneric(enrollData[0]);

    var depositSheet = _acctDepositSheet(ss);
    var depositData = depositSheet.getDataRange().getValues();
    var dh = _hMapGeneric(depositData[0]);
    // Index deposits by clientId — one deposit per account in the
    // normal auto-created flow, but if more than one somehow exists,
    // the most recently created one wins.
    var depositByClient = {};
    for (var di = 1; di < depositData.length; di++) {
      var dClientId = String(depositData[di][dh['ClientID']]||'');
      if (!dClientId) continue;
      var existingCreatedAt = depositByClient[dClientId] ? new Date(depositByClient[dClientId].createdAt||0) : null;
      var thisCreatedAt = new Date(depositData[di][dh['CreatedAt']]||0);
      if (!depositByClient[dClientId] || thisCreatedAt >= existingCreatedAt) {
        depositByClient[dClientId] = _mapDepositRow(depositData[di], dh);
      }
    }

    var rows = [];
    for (var ei = 1; ei < enrollData.length; ei++) {
      var enrollment = _mapEnrollmentRow(enrollData[ei], eh);
      if (!enrollment.clientId) continue;
      var deposit = depositByClient[enrollment.clientId] || null;
      var clientRec = clientById[enrollment.clientId];
      rows.push({
        clientId: enrollment.clientId,
        accountName: clientRec ? (clientRec.accountName || clientRec.companyName) : enrollment.clientId,
        customerId: enrollment.customerId,
        customerName: custNameById[enrollment.customerId] || enrollment.customerId,
        department: enrollment.department,
        oneTimeFeeAmount: enrollment.oneTimeFeeAmount,
        oneTimeFeeCharged: enrollment.oneTimeFeeCharged,
        oneTimeFeeWaived: enrollment.waivedOrDiscounted,
        oneTimeFeeReason: enrollment.waiverReason,
        oneTimeFeeBillingDate: enrollment.billingDate,
        oneTimeFeePaymentDate: enrollment.paymentDate,
        depositAmount: deposit ? deposit.depositFee : '',
        depositStatus: deposit ? deposit.status : '',
        depositReason: deposit ? deposit.reason : '',
        depositBillingDate: deposit ? deposit.billingDate : '',
        depositPaymentDate: deposit ? deposit.paymentDate : ''
      });
    }
    rows.sort(function(a,b){ return String(a.customerName).localeCompare(String(b.customerName)) || String(a.accountName).localeCompare(String(b.accountName)); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getFeesAndDepositsOverview: ' + (e.message || String(e)) };
  }
}

// ── VA Connections tab (§ new request) — list + payment history modal ─

// Full list of Started VA connections with billing-relevant fields —
// sortable/filterable/searchable entirely client-side once fetched, same
// as every other list in this app.
function getAccountingVAConnectionsList() {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var ch = _connHMap(connData[0]);

    var custRes = getCustomers({});
    var custById = {};
    if (custRes.success) custRes.data.forEach(function(c){ custById[c.customerId] = c; });

    var reqSheet = _wfGetReqSheet(ss);
    var reqData = reqSheet.getDataRange().getValues();
    var rh = _reqHMap(reqData[0]);
    var deptByRequestId = {};
    for (var ri = 1; ri < reqData.length; ri++) {
      deptByRequestId[String(reqData[ri][rh['RequestID']]||'')] = String(reqData[ri][rh['Department']]||'');
    }

    var rows = [];
    for (var i = 1; i < connData.length; i++) {
      if (String(connData[i][ch['ConnectionStatus']]||'') !== 'Started') continue;
      var connectionId = String(connData[i][ch['ConnectionID']]||''); if (!connectionId) continue;
      var customerId = String(connData[i][ch['CustomerID']]||'');
      var customer = custById[customerId] || {};
      var requestId = ch['RequestID'] !== undefined ? String(connData[i][ch['RequestID']]||'') : '';

      rows.push({
        connectionId: connectionId,
        customerId: customerId, customerName: customer.customerName || customerId,
        vaId: String(connData[i][ch['VAID']]||''), vaName: String(connData[i][ch['VAName']]||''),
        department: deptByRequestId[requestId] || '',
        billingType: customer.billingType || 'Prepaid',
        rate: Number(connData[i][ch['Rate']]) || 0,
        startDate: connData[i][ch['ActualStartDate']] ? String(connData[i][ch['ActualStartDate']]) : '',
        wrLink: ch['WRLink'] !== undefined ? String(connData[i][ch['WRLink']]||'') : ''
      });
    }
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getAccountingVAConnectionsList: ' + (e.message || String(e)) };
  }
}

// Combined payment-history view for one connection — billing cycles and
// payments are tracked per-customer (not per-connection), so this shows
// that customer's full billing history alongside this specific
// connection's own compensation summary (rate/ND changes, bond).
function getConnectionPaymentHistory(connectionId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var ch = _connHMap(connData[0]);
    var customerId = '', vaName = '';
    for (var i = 1; i < connData.length; i++) {
      if (String(connData[i][ch['ConnectionID']]) !== connectionId) continue;
      customerId = String(connData[i][ch['CustomerID']]||'');
      vaName = String(connData[i][ch['VAName']]||'');
      break;
    }
    if (!customerId) return { success: false, error: 'Connection not found.' };

    var billingRes = getBillingCyclesForCustomer(customerId);
    var compRes = getVAConnectionCompensationProfile(connectionId);

    // Payments joined per billing cycle, so the modal can show a flat,
    // chronological list rather than requiring a second lookup per row.
    var paymentSheet = _acctPaymentSheet(ss);
    var paymentData = paymentSheet.getDataRange().getValues();
    var ph = _hMapGeneric(paymentData[0]);
    var paymentsByBillingId = {};
    for (var pi = 1; pi < paymentData.length; pi++) {
      var bid = String(paymentData[pi][ph['BillingID']]||''); if (!bid) continue;
      if (!paymentsByBillingId[bid]) paymentsByBillingId[bid] = [];
      paymentsByBillingId[bid].push(_mapPaymentRow(paymentData[pi], ph));
    }

    return {
      success: true,
      data: {
        connectionId: connectionId, vaName: vaName, customerId: customerId,
        billingHistory: billingRes.success ? billingRes.data : [],
        paymentsByBillingId: paymentsByBillingId,
        compensation: compRes.success ? compRes.data : null
      }
    };
  } catch (e) {
    return { success: false, error: 'getConnectionPaymentHistory: ' + (e.message || String(e)) };
  }
}

// ── Billing Cycles / Invoices (§2.9) — Phase 1: manual entry only ─────

function _mapBillingRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    billingId: String(get('BillingID')||''),
    customerId: String(get('CustomerID')||''),
    billingMonth: String(get('BillingMonth')||''),   // 'YYYY-MM'
    serviceMonth: String(get('ServiceMonth')||''),   // 'YYYY-MM' — deliberately separate, never inferred from BillingMonth
    oneTimeFeeCharged: get('OneTimeFeeCharged') || 0,
    servicePaymentAmount: get('ServicePaymentAmount') || 0,
    ndAmount: get('NDAmount') || 0,
    rateAdjustmentAmount: get('RateAdjustmentAmount') || 0,
    priorMonthAdjustment: get('PriorMonthAdjustment') || 0,
    totalBilled: get('TotalBilled') || 0,
    dateIssued: get('DateIssued'),
    expectedPaymentDate: get('ExpectedPaymentDate'),
    status: String(get('Status')||''),
    createdAt: get('CreatedAt'), createdBy: String(get('CreatedBy')||''),
    updatedAt: get('UpdatedAt'), updatedBy: String(get('UpdatedBy')||'')
  };
}

// Phase 1: manual invoice entry — the person creating this enters each
// component themselves. Automated generation (pulling live rates, ND
// config, pending reconciliation adjustments) is Phase 2 per the plan.
function createBillingCycle(payload) {
  try {
    var perm = _acctPermGuard('c'); if (!perm.allowed) return perm;
    if (!payload || !payload.customerId || !payload.billingMonth || !payload.serviceMonth) {
      return { success: false, error: 'customerId, billingMonth, and serviceMonth are required.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctBillingSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);

    // One BillingCycle per customer per BillingMonth — creating a second
    // one for the same pair would fragment what should be a single invoice.
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]) === payload.customerId && String(data[i][h['BillingMonth']]) === payload.billingMonth) {
        return { success: false, error: 'A billing cycle for this customer and month already exists (' + String(data[i][h['BillingID']]) + ').' };
      }
    }

    var oneTimeFee = Number(payload.oneTimeFeeCharged) || 0;
    var servicePayment = Number(payload.servicePaymentAmount) || 0;
    var nd = Number(payload.ndAmount) || 0;
    var rateAdj = Number(payload.rateAdjustmentAmount) || 0;
    var priorAdj = Number(payload.priorMonthAdjustment) || 0;
    var total = oneTimeFee + servicePayment + nd + rateAdj + priorAdj;

    var now = new Date();
    var id = generateID('BILL');
    var expectedPayment = payload.expectedPaymentDate ? _parseDateInput(payload.expectedPaymentDate) : _acctDefaultExpectedPaymentDate(payload.billingMonth);
    var row = data[0].map(function(){ return ''; });
    var cm = {
      'BillingID': id, 'CustomerID': payload.customerId,
      'BillingMonth': payload.billingMonth, 'ServiceMonth': payload.serviceMonth,
      'OneTimeFeeCharged': oneTimeFee, 'ServicePaymentAmount': servicePayment,
      'NDAmount': nd, 'RateAdjustmentAmount': rateAdj, 'PriorMonthAdjustment': priorAdj,
      'TotalBilled': total,
      'DateIssued': now, 'ExpectedPaymentDate': expectedPayment,
      'Status': 'Issued',
      'CreatedAt': now, 'CreatedBy': perm.user.email,
      'UpdatedAt': now, 'UpdatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    _writeLog('Accounting', id, 'BILLING_CYCLE_CREATED', 'TotalBilled', '', String(total), perm.user);
    return { success: true, id: id, totalBilled: total };
  } catch (e) {
    return { success: false, error: 'createBillingCycle: ' + e.message };
  }
}
// Defaults to the 10th of the billing month, per §4.2 of the plan.
function _acctDefaultExpectedPaymentDate(billingMonthStr) {
  var parts = String(billingMonthStr).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, 10);
}

function getBillingCyclesForCustomer(customerId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctBillingSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]||'') !== customerId) continue;
      rows.push(_mapBillingRow(data[i], h));
    }
    rows.sort(function(a,b){ return String(b.billingMonth).localeCompare(String(a.billingMonth)); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getBillingCyclesForCustomer: ' + e.message };
  }
}

// ── Payments (§2.10, §4.4) ───────────────────────────────────────────

function _mapPaymentRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    paymentId: String(get('PaymentID')||''),
    customerId: String(get('CustomerID')||''),
    billingId: String(get('BillingID')||''),
    amountPaid: get('AmountPaid') || 0,
    datePaid: get('DatePaid'),
    paymentStatus: String(get('PaymentStatus')||''),
    outstandingAfterPayment: get('OutstandingAfterPayment') || 0,
    notes: String(get('Notes')||''),
    createdAt: get('CreatedAt'), createdBy: String(get('CreatedBy')||'')
  };
}

// Always references an existing BillingID — never auto-creates one (§3's
// integrity rule). Computes OutstandingAfterPayment and PaymentStatus
// itself, comparing DatePaid to the invoice's ExpectedPaymentDate — late
// or partial payments only ever update this Payments table, never move
// hours or amounts into a different billing month (§4.4).
function recordPayment(payload) {
  try {
    var perm = _acctPermGuard('c'); if (!perm.allowed) return perm;
    if (!payload || !payload.billingId || !payload.amountPaid) {
      return { success: false, error: 'billingId and amountPaid are required.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var billingSheet = _acctBillingSheet(ss);
    var billingData = billingSheet.getDataRange().getValues();
    var bh = _hMapGeneric(billingData[0]);
    var billingRow = null, billingRowNum = -1;
    for (var bi = 1; bi < billingData.length; bi++) {
      if (String(billingData[bi][bh['BillingID']]) !== payload.billingId) continue;
      billingRow = billingData[bi]; billingRowNum = bi + 1; break;
    }
    if (!billingRow) return { success: false, error: 'BillingID not found — a payment can only be recorded against an existing invoice.' };

    var totalBilled = Number(billingRow[bh['TotalBilled']]) || 0;
    var expectedPaymentDate = billingRow[bh['ExpectedPaymentDate']];
    var customerId = String(billingRow[bh['CustomerID']]||'');

    // Sum all prior payments against this BillingID to know what's
    // already been paid, so a partial-then-full sequence computes
    // correctly rather than only looking at this one payment in isolation.
    var paymentSheet = _acctPaymentSheet(ss);
    var paymentData = paymentSheet.getDataRange().getValues();
    var ph = _hMapGeneric(paymentData[0]);
    var alreadyPaid = 0;
    for (var pi = 1; pi < paymentData.length; pi++) {
      if (String(paymentData[pi][ph['BillingID']]) !== payload.billingId) continue;
      alreadyPaid += Number(paymentData[pi][ph['AmountPaid']]) || 0;
    }

    var thisPayment = Number(payload.amountPaid);
    var totalPaidNow = alreadyPaid + thisPayment;
    var outstanding = totalBilled - totalPaidNow;
    var datePaid = payload.datePaid ? _parseDateInput(payload.datePaid) : new Date();
    var isLate = expectedPaymentDate && datePaid > new Date(expectedPaymentDate);
    var status = outstanding <= 0 ? (isLate ? 'Late' : 'Full') : (isLate ? 'Late' : 'Partial');

    var now = new Date();
    var id = generateID('PMT');
    var row = paymentData[0].map(function(){ return ''; });
    var cm = {
      'PaymentID': id, 'CustomerID': customerId, 'BillingID': payload.billingId,
      'AmountPaid': thisPayment, 'DatePaid': datePaid,
      'PaymentStatus': status, 'OutstandingAfterPayment': Math.max(0, outstanding),
      'Notes': payload.notes || '',
      'CreatedAt': now, 'CreatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (ph[col] !== undefined) row[ph[col]] = cm[col]; });
    paymentSheet.appendRow(row);

    // Reflect the outcome on the invoice's own Status too, so the billing
    // list doesn't require joining through Payments just to show it.
    var newBillingStatus = outstanding <= 0 ? 'Paid' : 'PartiallyPaid';
    if (bh['Status'] !== undefined) billingSheet.getRange(billingRowNum, bh['Status']+1).setValue(newBillingStatus);
    if (bh['UpdatedAt'] !== undefined) billingSheet.getRange(billingRowNum, bh['UpdatedAt']+1).setValue(now);
    if (bh['UpdatedBy'] !== undefined) billingSheet.getRange(billingRowNum, bh['UpdatedBy']+1).setValue(perm.user.email);

    _writeLog('Accounting', payload.billingId, 'PAYMENT_RECORDED', 'AmountPaid', '', String(thisPayment), perm.user);
    return { success: true, id: id, paymentStatus: status, outstandingAfterPayment: Math.max(0, outstanding) };
  } catch (e) {
    return { success: false, error: 'recordPayment: ' + e.message };
  }
}

function getPaymentsForBilling(billingId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctPaymentSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['BillingID']]||'') !== billingId) continue;
      rows.push(_mapPaymentRow(data[i], h));
    }
    rows.sort(function(a,b){ return new Date(a.datePaid||0) - new Date(b.datePaid||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getPaymentsForBilling: ' + e.message };
  }
}

// Suggests the oldest unpaid/partially-paid invoice for a customer, per
// §4.4 — the Payment Entry screen defaults to this rather than making
// the user hunt for which invoice a payment applies to.
function getOldestUnpaidBilling(customerId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var res = getBillingCyclesForCustomer(customerId);
    if (!res.success) return res;
    var unpaid = res.data.filter(function(b){ return b.status === 'Issued' || b.status === 'PartiallyPaid' || b.status === 'Overdue'; });
    unpaid.sort(function(a,b){ return String(a.billingMonth).localeCompare(String(b.billingMonth)); });
    return { success: true, data: unpaid.length ? unpaid[0] : null };
  } catch (e) {
    return { success: false, error: 'getOldestUnpaidBilling: ' + e.message };
  }
}

// ── Client Billing Dashboard (§5.1) — combined view ─────────────────

function getClientBillingDashboard(customerId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var billingRes = getBillingCyclesForCustomer(customerId);
    if (!billingRes.success) return billingRes;

    // Per the per-Account rebuild — deposits/enrollments are now tracked
    // one per account, not one per customer. Aggregated here across
    // every account under this customer, to keep this dashboard's own
    // downstream shape (arrays) the same as before.
    var clientsRes = getClients({ customerId: customerId });
    var clientIds = clientsRes.success ? clientsRes.data.map(function(c){ return c.clientId; }) : [];
    var depositsAgg = [];
    var enrollmentsAgg = [];
    clientIds.forEach(function(cid) {
      var dRes = getDepositForClient(cid);
      if (dRes.success && dRes.data) depositsAgg = depositsAgg.concat(dRes.data);
      var eRes = getEnrollmentForClient(cid);
      if (eRes.success && eRes.data) enrollmentsAgg.push(eRes.data);
    });
    var depositRes = { success: true, data: depositsAgg };
    var enrollRes = { success: true, data: enrollmentsAgg };

    var billing = billingRes.data;
    var latestBilling = billing.length ? billing[0] : null;

    var totalOutstanding = 0;
    try {
      var paymentSheet = _acctPaymentSheet(ss);
      var paymentData = paymentSheet.getDataRange().getValues();
      var ph = _hMapGeneric(paymentData[0]);
      var paidByBillingId = {};
      for (var pi = 1; pi < paymentData.length; pi++) {
        var bid = String(paymentData[pi][ph['BillingID']]||''); if (!bid) continue;
        paidByBillingId[bid] = (paidByBillingId[bid] || 0) + (Number(paymentData[pi][ph['AmountPaid']]) || 0);
      }
      totalOutstanding = billing.reduce(function(sum, b) {
        if (b.status === 'Paid') return sum;
        var paidSoFar = paidByBillingId[b.billingId] || 0;
        return sum + Math.max(0, b.totalBilled - paidSoFar);
      }, 0);
    } catch (payEx) {
      Logger.log('getClientBillingDashboard payment computation: ' + payEx.message);
      // Fall back to a simpler estimate rather than letting this one
      // computation fail the entire dashboard.
      totalOutstanding = billing.reduce(function(sum, b) { return b.status === 'Paid' ? sum : sum + (b.totalBilled||0); }, 0);
    }
    var depositBalance = depositRes.data.reduce(function(sum, d){ return sum + (Number(d.remainingBalance)||0); }, 0);

    return {
      success: true,
      data: {
        customerId: customerId,
        billingHistory: billing,
        latestBilling: latestBilling,
        totalOutstanding: totalOutstanding,
        deposits: depositRes.data,
        depositBalance: depositBalance,
        enrollments: enrollRes.data
      }
    };
  } catch (e) {
    return { success: false, error: 'getClientBillingDashboard: ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 2 — Automated Billing Generation (§4.2, §4.3)
// ═══════════════════════════════════════════════════════════════════════
// Pulls live rates (via Calculations.gs, which reads effective-as-of-date
// compensation history, not just the current live rate), ND config, and
// mid-month start proration automatically. Still requires a manual
// actualHours input per VA for Postpaid billing and ND qualifying hours
// — there's no attendance-import source yet (Phase 5) to derive those
// from automatically. Always returns a preview; nothing is saved to
// BillingCycles until previewOnly is explicitly false.

// Public, permission-gated wrapper — the private helper above has no
// guard of its own (it's meant for internal use by other backend
// functions that already checked permission themselves), so the
// frontend must go through this instead of calling that directly.
function getActiveConnectionsForCustomer(customerId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var conns = _acctActiveConnectionsForCustomer(customerId);
    return { success: true, data: conns.map(function(c){ return { connectionId: c.connectionId, vaName: c.vaName }; }) };
  } catch (e) {
    return { success: false, error: 'getActiveConnectionsForCustomer: ' + e.message };
  }
}

// Finds every Started VA connection currently billing under a customer.
function _acctActiveConnectionsForCustomer(customerId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _connGetSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _connHMap(data[0]);
  var currentUser = getCurrentUser();
  var includeRate = currentUser && !currentUser.error && _canSeeVARate(currentUser.role);
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['CustomerID']]||'') !== customerId) continue;
    if (String(data[i][h['ConnectionStatus']]||'') !== 'Started') continue;
    results.push(_mapConnRow(data[i], h, includeRate));
  }
  return results;
}

// Generates (or previews) one customer's Billing Cycle for a month,
// summing Service Payment + ND + Rate Adjustment + prorated first-month
// amounts across every active VA connection, plus any One-Time Fee due
// this month. hoursInput = { [connectionId]: { actualHours, ndQualifyingHours } }
// — required per-connection for Postpaid/ND, since there's no attendance
// source yet to derive these automatically.
function generateBillingCycle(customerId, billingMonth, hoursInput, previewOnly) {
  try {
    var perm = _acctPermGuard(previewOnly ? 'r' : 'c'); if (!perm.allowed) return perm;
    hoursInput = hoursInput || {};

    var custRes = getCustomers({ customerId: customerId });
    var customer = (custRes.success && custRes.data.length) ? custRes.data[0] : null;
    if (!customer) return { success: false, error: 'Customer not found.' };
    var billingType = customer.billingType || 'Prepaid';

    // ServiceMonth is deliberately computed separately, never inferred
    // from BillingMonth by the caller — Prepaid bills the month AHEAD,
    // Postpaid bills the month just completed.
    var billingDate = _acctMonthToDate(billingMonth);
    var serviceDate = new Date(billingDate);
    serviceDate.setMonth(serviceDate.getMonth() + (billingType === 'Prepaid' ? 1 : -1));
    var serviceMonth = serviceDate.getFullYear() + '-' + String(serviceDate.getMonth()+1).padStart(2,'0');

    var connections = _acctActiveConnectionsForCustomer(customerId);
    var lineItems = [];
    var totalServicePayment = 0, totalND = 0, totalRateAdj = 0, oneTimeFeeTotal = 0;
    var errors = [];

    connections.forEach(function(conn) {
      var connHours = hoursInput[conn.connectionId] || {};
      // Fall back to real attendance data (Phase 5) when no explicit
      // override was given — an explicit hoursInput entry always wins,
      // this only fills the gap that used to always require manual entry.
      if (connHours.actualHours === undefined || connHours.ndQualifyingHours === undefined) {
        try {
          var attRes = getActualHoursFromAttendance(conn.connectionId, serviceMonth);
          if (attRes.success && attRes.recordCount > 0) {
            if (connHours.actualHours === undefined) connHours.actualHours = attRes.actualHours;
            if (connHours.ndQualifyingHours === undefined) connHours.ndQualifyingHours = attRes.ndQualifyingHours;
          }
        } catch (attEx) { Logger.log('generateBillingCycle attendance fallback: ' + attEx.message); }
      }
      var item = { connectionId: conn.connectionId, vaName: conn.vaName };

      // Mid-month start proration (§4.3) — only applies to this VA's
      // very first billing cycle, when its actual start falls inside the
      // service month being billed.
      var startDate = conn.actualStartDate ? new Date(conn.actualStartDate) : null;
      var isFirstCycleThisMonth = startDate && (startDate.getFullYear()+'-'+String(startDate.getMonth()+1).padStart(2,'0')) === serviceMonth;

      if (isFirstCycleThisMonth) {
        var prorateRes = calcProratedFirstMonth(conn.connectionId, startDate, billingType);
        if (!prorateRes.success) { errors.push(conn.vaName + ': ' + prorateRes.error); return; }
        if (prorateRes.rollToNextMonth) {
          item.servicePayment = 0;
          item.note = prorateRes.note;
        } else {
          item.servicePayment = prorateRes.amount;
          item.note = 'Prorated first month (' + prorateRes.remainingDays + ' days)';
        }
      } else {
        var spRes = calcServicePayment(conn.connectionId, serviceMonth, billingType, connHours.actualHours);
        if (!spRes.success) { errors.push(conn.vaName + ': ' + spRes.error); return; }
        item.servicePayment = spRes.amount;
        item.hoursUsed = spRes.hoursUsed;
        item.basis = spRes.basis;
      }

      var ndRes = calcNightDifferential(conn.connectionId, serviceMonth, connHours.ndQualifyingHours);
      item.ndAmount = ndRes.success ? ndRes.amount : 0;
      if (!ndRes.success) errors.push(conn.vaName + ' (ND): ' + ndRes.error);

      totalServicePayment += item.servicePayment || 0;
      totalND += item.ndAmount || 0;
      lineItems.push(item);
    });

    // One-Time Fee — check every account (ClientID) this customer's
    // active connections touch, per the per-Account model. Flagged as
    // "pending" for Accounting to review rather than auto-charged, since
    // the fee amount itself is a deliberate decision (via New
    // Enrollment), not something this automated pass should invent on
    // its own.
    var pendingOneTimeFees = [];
    var clientsChecked = {};
    var acctNameByClientId = {};
    try {
      var acctLookupRes = getClients({ customerId: customerId });
      if (acctLookupRes.success) acctLookupRes.data.forEach(function(a){ acctNameByClientId[a.clientId] = a.accountName || a.companyName || a.clientId; });
    } catch (acctLookupEx) { Logger.log('generateBillingCycle account name lookup: ' + acctLookupEx.message); }
    connections.forEach(function(conn) {
      var cid = conn.clientId; if (!cid || clientsChecked[cid]) return;
      clientsChecked[cid] = true;
      var feeCheck = checkOneTimeFeeDue(cid);
      if (feeCheck.success && feeCheck.feeDue) pendingOneTimeFees.push(acctNameByClientId[cid] || cid);
    });

    var totalBilled = oneTimeFeeTotal + totalServicePayment + totalND + totalRateAdj;

    // Hours Reconciliation (§4.5) — any Confirmed (reviewed, not yet
    // Applied) entry from the prior month auto-populates as
    // PriorMonthAdjustment here. Never touches an already-Applied entry
    // or an already-issued invoice — only ever posts forward.
    var reconRefs = _acctGetConfirmedReconciliationsForNextBilling(customerId, billingMonth);
    var priorMonthAdjustment = reconRefs.reduce(function(sum, ref){ return sum + (Number(ref.recon.differenceValue)||0); }, 0);
    totalBilled += priorMonthAdjustment;

    var result = {
      success: true,
      preview: true,
      customerId: customerId, billingMonth: billingMonth, serviceMonth: serviceMonth,
      billingType: billingType,
      lineItems: lineItems,
      oneTimeFeeCharged: oneTimeFeeTotal,
      servicePaymentAmount: Math.round(totalServicePayment * 100) / 100,
      ndAmount: Math.round(totalND * 100) / 100,
      rateAdjustmentAmount: totalRateAdj,
      priorMonthAdjustment: Math.round(priorMonthAdjustment * 100) / 100,
      reconciliationCount: reconRefs.length,
      totalBilled: Math.round(totalBilled * 100) / 100,
      pendingOneTimeFees: pendingOneTimeFees,
      errors: errors
    };

    if (previewOnly) return result;

    // Commit — reuse the existing manual-entry path (createBillingCycle)
    // so both routes end up producing an identical BillingCycles row and
    // share the same duplicate-month guard.
    var createRes = createBillingCycle({
      customerId: customerId, billingMonth: billingMonth, serviceMonth: serviceMonth,
      oneTimeFeeCharged: result.oneTimeFeeCharged,
      servicePaymentAmount: result.servicePaymentAmount,
      ndAmount: result.ndAmount,
      rateAdjustmentAmount: result.rateAdjustmentAmount,
      priorMonthAdjustment: result.priorMonthAdjustment
    });
    if (!createRes.success) return createRes;
    result.preview = false;
    result.billingId = createRes.id;
    if (reconRefs.length) _acctMarkReconciliationsApplied(reconRefs, createRes.id, perm.user);
    return result;
  } catch (e) {
    return { success: false, error: 'generateBillingCycle: ' + e.message };
  }
}

// Lists every active (billable) customer for the bulk-generation screen
// — active connections, no billing cycle yet for the given month.
function getCustomersNeedingBillingForMonth(billingMonth) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var custRes = getCustomers({ status: 'Active' });
    if (!custRes.success) return custRes;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var billSheet = _acctBillingSheet(ss);
    var billData = billSheet.getDataRange().getValues();
    var bh = _hMapGeneric(billData[0]);
    var alreadyBilled = {};
    for (var i = 1; i < billData.length; i++) {
      if (String(billData[i][bh['BillingMonth']]) !== billingMonth) continue;
      alreadyBilled[String(billData[i][bh['CustomerID']])] = true;
    }

    var needing = custRes.data.filter(function(c) {
      if (alreadyBilled[c.customerId]) return false;
      return _acctActiveConnectionsForCustomer(c.customerId).length > 0;
    });
    return { success: true, data: needing };
  } catch (e) {
    return { success: false, error: 'getCustomersNeedingBillingForMonth: ' + e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3 — Hours Reconciliation (§2.11, §4.5, §5.4)
// ═══════════════════════════════════════════════════════════════════════
// Compares projected vs actual hours per VA connection per month, and
// queues the signed difference for the NEXT billing cycle — never
// retroactively edits an already-issued invoice (§3's integrity rule).
// Status flow: Pending (computed) → Confirmed (Accounting reviewed, per
// §5.4's Reconciliation Review screen) → Applied (linked to the next
// month's actual BillingID once that invoice is generated).

function _acctReconSheet(ss) { var s = _ensureSheet(ss, CONFIG.SHEETS.ACCT_RECONCILIATION, CONFIG.SCHEMA.HoursReconciliation); _migrateSheetColumns(ss, CONFIG.SHEETS.ACCT_RECONCILIATION, CONFIG.SCHEMA.HoursReconciliation); return s; }

function _mapReconRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    reconId: String(get('ReconID')||''),
    connectionId: String(get('ConnectionID')||''),
    customerId: String(get('CustomerID')||''),
    billingMonth: String(get('BillingMonth')||''),
    projectedHours: get('ProjectedHours') || 0,
    actualHours: get('ActualHours') || 0,
    differenceHours: get('DifferenceHours') || 0,
    differenceValue: get('DifferenceValue') || 0,
    status: String(get('Status')||''),
    appliedToBillingId: String(get('AppliedToBillingID')||''),
    confirmedBy: String(get('ConfirmedBy')||''), confirmedAt: get('ConfirmedAt'),
    createdAt: get('CreatedAt'), createdBy: String(get('CreatedBy')||'')
  };
}

// Computes and stores the reconciliation entry for one VA connection for
// a given month — uses the same calcHoursAdjustment from Calculations.gs
// that any other screen would, so this number can never drift from what
// the calculation engine itself would produce.
function createReconciliationEntry(connectionId, billingMonth, actualHours) {
  try {
    var perm = _acctPermGuard('c'); if (!perm.allowed) return perm;
    if (!connectionId || !billingMonth || actualHours === undefined || actualHours === null) {
      return { success: false, error: 'connectionId, billingMonth, and actualHours are required.' };
    }

    var connRes = getVAConnectionById(connectionId);
    if (!connRes.success) return { success: false, error: connRes.error };

    var adjRes = calcHoursAdjustment(connectionId, billingMonth, actualHours);
    if (!adjRes.success) return { success: false, error: adjRes.error };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctReconSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);

    // One reconciliation entry per connection per month — re-running
    // this for the same pair updates the existing Pending row rather
    // than creating a duplicate (but never touches one already Applied,
    // since that would mean editing something already posted to an
    // issued invoice).
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId || String(data[i][h['BillingMonth']]) !== billingMonth) continue;
      if (String(data[i][h['Status']]) === 'Applied') {
        return { success: false, error: 'This reconciliation has already been applied to an invoice and can\'t be changed.' };
      }
      var rowNum = i + 1;
      sheet.getRange(rowNum, h['ActualHours']+1).setValue(adjRes.actualHours);
      sheet.getRange(rowNum, h['DifferenceHours']+1).setValue(adjRes.differenceHours);
      sheet.getRange(rowNum, h['DifferenceValue']+1).setValue(adjRes.differenceValue);
      sheet.getRange(rowNum, h['Status']+1).setValue('Pending');
      return { success: true, id: String(data[i][h['ReconID']]), differenceHours: adjRes.differenceHours, differenceValue: adjRes.differenceValue };
    }

    var now = new Date();
    var id = generateID('RECON');
    var row = data[0].map(function(){ return ''; });
    var cm = {
      'ReconID': id, 'ConnectionID': connectionId, 'CustomerID': connRes.data.customerId,
      'BillingMonth': billingMonth,
      'ProjectedHours': adjRes.projectedHours, 'ActualHours': adjRes.actualHours,
      'DifferenceHours': adjRes.differenceHours, 'DifferenceValue': adjRes.differenceValue,
      'Status': 'Pending', 'AppliedToBillingID': '',
      'CreatedAt': now, 'CreatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    _writeLog('Accounting', id, 'RECONCILIATION_CREATED', 'DifferenceValue', '', String(adjRes.differenceValue), perm.user);
    return { success: true, id: id, differenceHours: adjRes.differenceHours, differenceValue: adjRes.differenceValue };
  } catch (e) {
    return { success: false, error: 'createReconciliationEntry: ' + e.message };
  }
}

// Lists every reconciliation entry for a month — the data behind §5.4's
// Reconciliation Review screen. Optionally filtered by status.
function getReconciliationsForMonth(billingMonth, statusFilter) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctReconSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);

    var connNameById = {};
    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var ch = _connHMap(connData[0]);
    for (var ci = 1; ci < connData.length; ci++) {
      connNameById[String(connData[ci][ch['ConnectionID']]||'')] = String(connData[ci][ch['VAName']]||'');
    }

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['BillingMonth']]||'') !== billingMonth) continue;
      if (statusFilter && String(data[i][h['Status']]||'') !== statusFilter) continue;
      var mapped = _mapReconRow(data[i], h);
      mapped.vaName = connNameById[mapped.connectionId] || mapped.connectionId;
      rows.push(mapped);
    }
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getReconciliationsForMonth: ' + e.message };
  }
}

// Accounting's explicit review/approval step (§5.4) — moves Pending →
// Confirmed. Only Confirmed entries get auto-pulled into the next
// month's billing generation; a Pending one sitting unreviewed is never
// silently applied.
function confirmReconciliation(reconId) {
  try {
    var perm = _acctPermGuard('u'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctReconSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ReconID']]) !== reconId) continue;
      if (String(data[i][h['Status']]) !== 'Pending') {
        return { success: false, error: 'Only a Pending reconciliation can be confirmed (this one is ' + String(data[i][h['Status']]) + ').' };
      }
      var rowNum = i + 1;
      var now = new Date();
      sheet.getRange(rowNum, h['Status']+1).setValue('Confirmed');
      sheet.getRange(rowNum, h['ConfirmedBy']+1).setValue(perm.user.email);
      sheet.getRange(rowNum, h['ConfirmedAt']+1).setValue(now);
      _writeLog('Accounting', reconId, 'RECONCILIATION_CONFIRMED', '', 'Pending', 'Confirmed', perm.user);
      return { success: true };
    }
    return { success: false, error: 'Reconciliation entry not found.' };
  } catch (e) {
    return { success: false, error: 'confirmReconciliation: ' + e.message };
  }
}

// Finds every Confirmed (not yet Applied) reconciliation for a customer
// whose BillingMonth is the month immediately before the one being
// generated — this is what generateBillingCycle (Phase 2) calls to
// auto-populate PriorMonthAdjustment, per §4.5's "auto-populate into the
// next month's Billing Cycle row when that row is generated."
function _acctGetConfirmedReconciliationsForNextBilling(customerId, newBillingMonth) {
  var priorDate = _acctMonthToDate(newBillingMonth);
  priorDate.setMonth(priorDate.getMonth() - 1);
  var priorMonth = priorDate.getFullYear() + '-' + String(priorDate.getMonth()+1).padStart(2,'0');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _acctReconSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _hMapGeneric(data[0]);
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][h['CustomerID']]||'') !== customerId) continue;
    if (String(data[i][h['BillingMonth']]||'') !== priorMonth) continue;
    if (String(data[i][h['Status']]||'') !== 'Confirmed') continue;
    results.push({ rowNum: i + 1, recon: _mapReconRow(data[i], h) });
  }
  return results;
}

// Marks a set of reconciliation entries as Applied, linking them to the
// BillingID that actually absorbed their adjustment — called by
// generateBillingCycle right after a new invoice is created.
function _acctMarkReconciliationsApplied(reconRowRefs, billingId, user) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _acctReconSheet(ss);
  var data = sheet.getDataRange().getValues();
  var h = _hMapGeneric(data[0]);
  reconRowRefs.forEach(function(ref) {
    sheet.getRange(ref.rowNum, h['Status']+1).setValue('Applied');
    sheet.getRange(ref.rowNum, h['AppliedToBillingID']+1).setValue(billingId);
  });
  if (reconRowRefs.length) {
    _writeLog('Accounting', billingId, 'RECONCILIATION_APPLIED', '', '', reconRowRefs.length + ' entr' + (reconRowRefs.length===1?'y':'ies'), user);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4 — Training Bond Lifecycle (§2.8, §4.8)
// ═══════════════════════════════════════════════════════════════════════
// Monthly accrual ledger feeding the bond's own single lifecycle record
// (VABonds, in VACompensationService.gs — status, amount, dates). This
// file adds the month-by-month detail and the "due for decision" prompt
// once a bond reaches its 6-month ExpectedEndDate. Per §3's integrity
// rule, RunningTotal must stop accruing once the bond's FinalStatus
// (Released/Forfeited) is set — enforced here, not left to the caller.

function _acctBondLedgerSheet(ss) { var s = _ensureSheet(ss, CONFIG.SHEETS.ACCT_BOND_LEDGER, CONFIG.SCHEMA.TrainingBondLedger); _migrateSheetColumns(ss, CONFIG.SHEETS.ACCT_BOND_LEDGER, CONFIG.SCHEMA.TrainingBondLedger); return s; }

function _mapBondLedgerRow(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  return {
    ledgerId: String(get('LedgerID')||''),
    connectionId: String(get('ConnectionID')||''),
    month: String(get('Month')||''),
    hoursWorked: get('HoursWorked') || 0,
    deductionRate: get('DeductionRate') || 0,
    amountDeducted: get('AmountDeducted') || 0,
    runningTotal: get('RunningTotal') || 0,
    createdAt: get('CreatedAt'), createdBy: String(get('CreatedBy')||'')
  };
}

// Accrues one month's Training Bond deduction for a connection — refuses
// outright if the bond has already been Released/Forfeited/set to No
// Bond, or if this month was already accrued (re-running for the same
// month updates that entry instead of double-counting it).
function accrueTrainingBond(connectionId, month, hoursWorked) {
  try {
    var perm = _acctPermGuard('c'); if (!perm.allowed) return perm;
    if (!connectionId || !month || hoursWorked === undefined || hoursWorked === null) {
      return { success: false, error: 'connectionId, month, and hoursWorked are required.' };
    }

    var bondRes = getBondForConnection(connectionId);
    if (!bondRes.success) return { success: false, error: bondRes.error };
    if (!bondRes.data || bondRes.data.status === 'No Bond') {
      return { success: false, error: 'This connection has no active Training Bond to accrue against.' };
    }
    if (bondRes.data.status === 'Released' || bondRes.data.status === 'Forfeited') {
      return { success: false, error: 'This bond is already ' + bondRes.data.status + ' — accrual has stopped, per policy, once a final decision is made.' };
    }

    var accrualRes = calcTrainingBondAccrual(connectionId, hoursWorked);
    if (!accrualRes.success) return { success: false, error: accrualRes.error };
    if (!accrualRes.applicable) return { success: false, error: 'No active bond found for this connection.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctBondLedgerSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);

    // Running total = whatever the ledger's own last entry BEFORE this
    // month already accumulated, plus this month's deduction — never
    // recomputed from VABonds itself, so the ledger stays the actual
    // source of truth for how the total got there. Sorted by month
    // rather than insertion order, since entries could be added out of
    // sequence.
    var existingRowNum = -1;
    var entriesForConn = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]) !== connectionId) continue;
      if (String(data[i][h['Month']]) === month) { existingRowNum = i + 1; continue; }
      entriesForConn.push({ month: String(data[i][h['Month']]), runningTotal: Number(data[i][h['RunningTotal']])||0 });
    }
    entriesForConn.sort(function(a,b){ return a.month.localeCompare(b.month); });
    var priorEntries = entriesForConn.filter(function(e){ return e.month < month; });
    var priorTotal = priorEntries.length ? priorEntries[priorEntries.length-1].runningTotal : 0;

    var newTotal = Math.round((priorTotal + accrualRes.amount) * 100) / 100;
    var now = new Date();

    if (existingRowNum > 0) {
      sheet.getRange(existingRowNum, h['HoursWorked']+1).setValue(Number(hoursWorked));
      sheet.getRange(existingRowNum, h['AmountDeducted']+1).setValue(accrualRes.amount);
      sheet.getRange(existingRowNum, h['RunningTotal']+1).setValue(newTotal);
      return { success: true, runningTotal: newTotal };
    }

    var id = generateID('BONDLED');
    var row = data[0].map(function(){ return ''; });
    var cm = {
      'LedgerID': id, 'ConnectionID': connectionId, 'Month': month,
      'HoursWorked': Number(hoursWorked), 'DeductionRate': accrualRes.deductionRate,
      'AmountDeducted': accrualRes.amount, 'RunningTotal': newTotal,
      'CreatedAt': now, 'CreatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    _writeLog('Accounting', id, 'BOND_ACCRUED', 'RunningTotal', String(priorTotal), String(newTotal), perm.user);
    return { success: true, id: id, runningTotal: newTotal };
  } catch (e) {
    return { success: false, error: 'accrueTrainingBond: ' + e.message };
  }
}

function getTrainingBondLedger(connectionId) {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _acctBondLedgerSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      rows.push(_mapBondLedgerRow(data[i], h));
    }
    rows.sort(function(a,b){ return a.month.localeCompare(b.month); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getTrainingBondLedger: ' + e.message };
  }
}

// Finds every bond that's reached its 6-month ExpectedEndDate but hasn't
// had a Release/Forfeit decision made yet — the §4.8 "prompt an
// accounting action" moment, surfaced as a list rather than a literal
// pop-up, since Accounting reviews these on their own schedule.
function getBondsDueForDecision() {
  try {
    var perm = _acctPermGuard('r'); if (!perm.allowed) return perm;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss, CONFIG.SHEETS.VA_BONDS, CONFIG.SCHEMA.VABonds);
    var data = sheet.getDataRange().getValues();
    var h = _hMapGeneric(data[0]);
    var now = new Date();

    var connSheet = _connGetSheet(ss);
    var connData = connSheet.getDataRange().getValues();
    var ch = _connHMap(connData[0]);
    var vaNameById = {};
    for (var ci = 1; ci < connData.length; ci++) {
      vaNameById[String(connData[ci][ch['ConnectionID']]||'')] = String(connData[ci][ch['VAName']]||'');
    }

    var due = [];
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][h['Status']]||'');
      if (status !== 'Pending') continue;
      var expectedEnd = data[i][h['ExpectedEndDate']];
      if (!expectedEnd || new Date(expectedEnd) > now) continue;
      var connectionId = String(data[i][h['ConnectionID']]||'');
      due.push({
        connectionId: connectionId,
        vaName: vaNameById[connectionId] || connectionId,
        expectedEndDate: expectedEnd,
        amount: data[i][h['Amount']] || 0
      });
    }
    return { success: true, data: due };
  } catch (e) {
    return { success: false, error: 'getBondsDueForDecision: ' + e.message };
  }
}

// Records the Release/Forfeit decision — updates the bond's own
// lifecycle record (VABonds via upsertBond, in VACompensationService.gs)
// and, once this is set, accrueTrainingBond above refuses any further
// accrual against this connection.
function decideTrainingBond(connectionId, decision, reason) {
  try {
    var perm = _acctPermGuard('u'); if (!perm.allowed) return perm;
    if (['Released', 'Forfeited'].indexOf(decision) === -1) {
      return { success: false, error: 'Decision must be Released or Forfeited.' };
    }
    if (decision === 'Forfeited' && !String(reason||'').trim()) {
      return { success: false, error: 'A reason is required when forfeiting a bond.' };
    }

    var ledgerRes = getTrainingBondLedger(connectionId);
    var runningTotal = (ledgerRes.success && ledgerRes.data.length) ? ledgerRes.data[ledgerRes.data.length-1].runningTotal : 0;

    var upsertRes = upsertBond({
      connectionId: connectionId,
      status: decision,
      releaseDate: decision === 'Released' ? new Date().toISOString() : '',
      notes: decision === 'Forfeited' ? reason : ('Released — total paid out: $' + runningTotal)
    });
    if (!upsertRes.success) return upsertRes;

    _writeLog('Accounting', connectionId, 'BOND_' + decision.toUpperCase(), '', '', 'Total: $' + runningTotal, perm.user);
    return { success: true, decision: decision, runningTotal: runningTotal };
  } catch (e) {
    return { success: false, error: 'decideTrainingBond: ' + e.message };
  }
}