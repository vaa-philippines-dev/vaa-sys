// ─────────────────────────────────────────
// ClientService.gs — Client CRUD
// ─────────────────────────────────────────

// Serialize Date → ISO string; pass other values through as strings
function _sdC(val) {
  if (val instanceof Date) return val.toISOString();
  if (val === null || val === undefined) return '';
  return String(val);
}

function _buildHeaderMap(headers) {
  var h = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) h[String(headers[i])] = i;
  }
  return h;
}

function getClients(filters) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data  = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };

    var h = _buildHeaderMap(data[0]);
    if (h['ClientID'] === undefined) {
      return { success: false, error: 'Clients sheet headers missing. Run initializeSystem().' };
    }

    // An account's "Assigned CS" is ALWAYS the customer's own assigned
    // specialist — there is no per-account override (Clients has no such
    // column at all). This was previously missing entirely from the
    // response, meaning the Assigned CS column had nothing real to show.
    // Built once here as a lookup rather than re-reading Customers per row.
    var specByCustomerId = {};
    try {
      var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheet) {
        var custData = custSheet.getDataRange().getValues();
        var ch = {}; custData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
        for (var ci = 1; ci < custData.length; ci++) {
          var cid = String(custData[ci][ch['CustomerID']]||''); if (!cid) continue;
          specByCustomerId[cid] = String(custData[ci][ch['AssignedSpecialist']]||'');
        }
      }
    } catch (joinErr) { Logger.log('getClients specialist join: ' + joinErr.message); }

    filters = filters || {};
    var rows = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[h['ClientID']]) continue;

      var rec = _mapClientRow(row, h);
      rec.assignedSpecialist = specByCustomerId[rec.customerId] || '';

      if (filters.status     && rec.status     !== filters.status)     continue;
      if (filters.category   && rec.category   !== filters.category)   continue;
      if (filters.type       && rec.type       !== filters.type)       continue;
      if (filters.customerId && rec.customerId !== filters.customerId) continue;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (![rec.companyName, rec.accountName, rec.primaryContact, rec.clientId]
              .some(function (v) { return (v || '').toLowerCase().includes(q); })) continue;
      }
      rows.push(rec);
    }

    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getClients: ' + e.message };
  }
}

// Reactivating a customer is a customer+account action, not customer-only —
// this sets every one of the customer's non-Active accounts to Pending too,
// matching the customer's own reactivation (see custDoReactivate in
// scripts-core.html). Like the customer side, this doesn't jump to Active
// directly — _activateCustomerAndAccount (VAConnectionService.gs) is what
// actually promotes Pending to Active, once a new VA connection on this
// customer really starts.
function cascadeReactivateAccountsForCustomer(customerId, statusDate, reason, clientIds) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!sheet) return { success: true, updated: 0 };
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var now = new Date();
    var updated = 0;
    var clientIdSet = (clientIds && clientIds.length) ? clientIds.reduce(function(s,id){ s[id]=true; return s; }, {}) : null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]||'').trim() !== String(customerId).trim()) continue;
      var clientId = String(data[i][h['ClientID']]||'');
      if (clientIdSet && !clientIdSet[clientId]) continue; // not in the selected subset
      var oldStatus = String(data[i][h['Status']]||'');
      if (oldStatus === 'Active' || oldStatus === 'Pending') continue; // already there, or already active
      var rowNum = i + 1;
      sheet.getRange(rowNum, h['Status']+1).setValue('Pending');
      if (h['StatusDate'] !== undefined) sheet.getRange(rowNum, h['StatusDate']+1).setValue(statusDate ? new Date(statusDate) : now);
      sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(perm.user.email);
      var effDate = statusDate ? new Date(statusDate) : now;
      _writeLog('Account', clientId, _classifyStatusChangeAction(oldStatus, 'Pending'), 'Status', oldStatus, 'Pending', perm.user, effDate);
      if (reason) _writeLog('Account', clientId, 'UPDATE', 'ReactivationReason', '', reason, perm.user, effDate);
      updated++;
    }
    return { success: true, updated: updated };
  } catch (e) {
    return { success: false, error: 'cascadeReactivateAccountsForCustomer: ' + e.message };
  }
}

function getClientsByCustomer(customerId) {
  return getClients({ customerId: customerId });
}

function getClientById(clientId) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data  = sheet.getDataRange().getValues();
    var h     = _buildHeaderMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]) === clientId) {
        var rec = _mapClientRow(data[i], h); // customerName is already populated here from the cached column
        // assignedSpecialist always needs to reflect the customer's
        // CURRENT specialist (unlike the name, that can change far more
        // often than a rename, so it's not worth caching the same way —
        // this one small lookup stays live).
        if (rec.customerId) {
          try {
            var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
            if (custSheet) {
              var custData = custSheet.getDataRange().getValues();
              var ch = _buildHeaderMap(custData[0]);
              for (var j = 1; j < custData.length; j++) {
                if (String(custData[j][ch['CustomerID']]) === rec.customerId) {
                  rec.assignedSpecialist = String(custData[j][ch['AssignedSpecialist']] || '');
                  // Fallback only — if the cache hasn't been backfilled yet
                  // (run backfillClientCustomerNames() once to fix this).
                  if (!rec.customerName) rec.customerName = String(custData[j][ch['CustomerName']] || '');
                  break;
                }
              }
            }
          } catch (ce) { Logger.log('assignedSpecialist resolve: ' + ce.message); }
        }
        return { success: true, data: rec };
      }
    }
    return { success: false, error: 'Client not found.' };
  } catch (e) {
    return { success: false, error: 'getClientById: ' + e.message };
  }
}

function createClient(payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var errors = _validateClient(payload);
    if (errors.length) return { success: false, errors: errors };

    var isReturning = payload.isReturning === true ||
                      _checkWasTerminated(payload.customerId, payload.companyName);

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    _ensureClientsCustomerNameHeader(sheet);
    var hRow  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var h     = _buildHeaderMap(hRow);
    var now   = new Date();
    var id    = generateID('CLT');
    var managers = Array.isArray(payload.accountManagers)
      ? payload.accountManagers.join(', ')
      : String(payload.accountManagers || '');

    // Bug fix (2026-06-30): the form's "Entry Date" field (id f_createdAt,
    // "defaults to today") was being sent as payload.createdAt but silently
    // ignored here — CreatedAt was always hardcoded to `now`, the same
    // late-entry bug already fixed for Customers and VARequests.
    var createdAtVal = now;
    if (payload.createdAt) {
      var parsedCreatedAt = _parseDateInput(payload.createdAt);
      if (!isNaN(parsedCreatedAt.getTime())) createdAtVal = parsedCreatedAt;
    }

    // Cache the parent customer's current name on this row — see the
    // CustomerName column comment in Code.gs for why.
    var custNameForCache = '';
    try {
      var custSheetForCache = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (custSheetForCache) {
        var custDataForCache = custSheetForCache.getDataRange().getValues();
        var cch = _buildHeaderMap(custDataForCache[0]);
        for (var cci = 1; cci < custDataForCache.length; cci++) {
          if (String(custDataForCache[cci][cch['CustomerID']]||'') === payload.customerId) {
            custNameForCache = String(custDataForCache[cci][cch['CustomerName']]||'');
            break;
          }
        }
      }
    } catch (cacheErr) { Logger.log('createClient CustomerName cache lookup: ' + cacheErr.message); }

    var colMap = {
      'ClientID':            id,
      'CustomerID':          payload.customerId,
      'CustomerName':        custNameForCache,
      'CompanyName':         payload.companyName.trim(),
      'AccountName':         payload.accountName          || '',
      'PrimaryContact':      payload.primaryContact       || '',
      'PrimaryRole':         payload.primaryRole          || '',
      'PrimaryEmail':        payload.primaryEmail         || '',
      'PrimaryIsFocal':           payload.primaryIsFocal       === true,
      'PrimaryLinkedToCustomer':  payload.primaryLinkedToCustomer === true,
      'SecondaryContact':    payload.secondaryContact     || '',
      'SecondaryRole':       payload.secondaryRole        || '',
      'SecondaryEmail':      payload.secondaryEmail       || '',
      'SecondaryIsFocal':    payload.secondaryIsFocal     === true,
      'AccountManagers':     managers,
      'Category':            payload.category             || 'Seller',
      'Type':                payload.type                 || 'Silver',
      'CountryRegion':       payload.countryRegion        || '',
      'InvoiceContactName':  payload.invoiceContactName   || '',
      'InvoiceContactRole':  payload.invoiceContactRole   || '',
      'InvoiceContactEmail': payload.invoiceContactEmail  || '',
      'Status':              payload.status               || CONFIG.STATUS.ACTIVE,
      'StatusDate':          payload.statusDate            || '',
      'TerminationReason':   payload.terminationReason     || '',
      'IsReturning':         isReturning,
      'Notes':               payload.notes                || '',
      'SellerOnboardingLink':payload.sellerOnboardingLink || '',
      'ContractID':          payload.contractId           || '',
      'CreatedAt':           createdAtVal,
      'CreatedBy':           perm.user.email,
      'UpdatedAt':           now,
      'UpdatedBy':           perm.user.email
    };

    // Build row in the exact column order of the sheet
    var rowData = hRow.map(function (colName) {
      if (!colName) return '';
      return colMap.hasOwnProperty(colName) ? colMap[colName] : '';
    });

    sheet.appendRow(rowData);
    _writeLog('Account', id, 'CREATE', '', '',
      JSON.stringify({ accountName: payload.accountName || payload.companyName }), perm.user, createdAtVal);
    return { success: true, id: id, isReturning: isReturning };
  } catch (e) {
    return { success: false, error: 'createClient: ' + e.message };
  }
}

// Cascades a client's Primary/Secondary Contact rename to every existing
// VARequest under that client, per the request — PrimaryAccount and
// SecondaryAccount on VARequests are snapshots taken at request-creation
// time, not a live join to Clients, so they'd otherwise stay stale.
function _cascadeContactNamesToVARequests(clientId, oldPrimary, newPrimary, oldSecondary, newSecondary) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    if (h['ClientID'] === undefined) return;
    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]||'') !== clientId) continue;
      if (h['PrimaryAccount'] !== undefined && oldPrimary && oldPrimary !== newPrimary) {
        if (String(data[i][h['PrimaryAccount']]||'') === oldPrimary) {
          sheet.getRange(i+1, h['PrimaryAccount']+1).setValue(newPrimary);
          updated++;
        }
      }
      if (h['SecondaryAccount'] !== undefined && oldSecondary && oldSecondary !== newSecondary) {
        if (String(data[i][h['SecondaryAccount']]||'') === oldSecondary) {
          sheet.getRange(i+1, h['SecondaryAccount']+1).setValue(newSecondary);
          updated++;
        }
      }
    }
    if (updated) Logger.log('_cascadeContactNamesToVARequests: updated ' + updated + ' field(s) across VARequests for client ' + clientId);
  } catch (e) {
    Logger.log('_cascadeContactNamesToVARequests error: ' + e.message);
  }
}

function updateClient(clientId, payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    // A Pause/Terminate/Cancelled status change has its own dedicated
    // review workflow now (applies immediately, flags for CS Manager
    // review, Confirm/Cancel) — this older, generic approval gate would
    // otherwise block that new workflow before it even gets a chance to
    // run. Still applies to every other kind of edit exactly as before.
    var isStatusOnlyChange = payload && payload.status && (payload.status === 'Paused' || payload.status === 'Terminated' || payload.status === 'Cancelled') && !payload.companyName;
    if (perm.user.permissions.requiresApproval && !isStatusOnlyChange) {
      return { success: false, error: 'Your edits require manager approval.' };
    }

    // A status-only partial update (used by the dedicated Pause/Terminate
    // buttons, and by the Customer cascade-to-accounts flow) never
    // includes companyName/customerId, which _validateClient requires —
    // without this, every such call would fail validation outright, even
    // though it never intended to touch those fields. Pre-fill them from
    // the existing record before validating; nothing else about the
    // payload changes, so every other field update below still behaves
    // exactly as before.
    if (!payload.companyName || !payload.customerId) {
      var ssForPrefill = SpreadsheetApp.getActiveSpreadsheet();
      var sheetForPrefill = ssForPrefill.getSheetByName(CONFIG.SHEETS.CLIENTS);
      var dataForPrefill = sheetForPrefill.getDataRange().getValues();
      var hForPrefill = _buildHeaderMap(dataForPrefill[0]);
      for (var pfi = 1; pfi < dataForPrefill.length; pfi++) {
        if (String(dataForPrefill[pfi][hForPrefill['ClientID']]) !== clientId) continue;
        if (!payload.companyName) payload.companyName = String(dataForPrefill[pfi][hForPrefill['CompanyName']]||'');
        if (!payload.customerId) payload.customerId = String(dataForPrefill[pfi][hForPrefill['CustomerID']]||'');
        break;
      }
    }

    var errors = _validateClient(payload);
    if (errors.length) return { success: false, errors: errors };

    var newStatusCheckAcct = payload.status;
    if (newStatusCheckAcct && (newStatusCheckAcct === 'Terminated' || newStatusCheckAcct === 'Cancelled') && payload.statusDate) {
      var checkDateAcct = _parseDateInput(payload.statusDate);
      if (!isNaN(checkDateAcct.getTime()) && checkDateAcct > new Date()) {
        return { success: false, errors: ['Termination date cannot be in the future.'] };
      }
    }
    if (newStatusCheckAcct && (newStatusCheckAcct === 'Terminated' || newStatusCheckAcct === 'Cancelled') && _hasActiveVAConnections(clientId, null)) {
      return { success: false, errors: ['This account still has active VA connections. Please terminate those VA connections first.'] };
    }
    // The status change now applies immediately for anyone — capture
    // whether this needs to be flagged for CS Manager review afterward,
    // rather than blocking it here. Mirrors the exact same rewrite just
    // applied to updateCustomer, extended to cover Paused too.
    var needsPendingReviewAcct = newStatusCheckAcct && (newStatusCheckAcct === 'Terminated' || newStatusCheckAcct === 'Cancelled' || newStatusCheckAcct === 'Paused') && perm.user.role !== 'CS Manager';

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data  = sheet.getDataRange().getValues();
    var h     = _buildHeaderMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]) !== clientId) continue;

      var rowNum     = i + 1;
      var oldRec     = _mapClientRow(data[i], h);
      var managers   = Array.isArray(payload.accountManagers)
        ? payload.accountManagers.join(', ')
        : String(payload.accountManagers || '');
      var isReturning = data[i][h['IsReturning']] === true || payload.isReturning === true;

      var updates = {
        'CompanyName':         payload.companyName.trim(),
        'AccountName':         payload.accountName          !== undefined ? payload.accountName          : oldRec.accountName,
        'PrimaryContact':      payload.primaryContact       !== undefined ? payload.primaryContact       : oldRec.primaryContact,
        'PrimaryRole':         payload.primaryRole          !== undefined ? payload.primaryRole          : oldRec.primaryRole,
        'PrimaryEmail':        payload.primaryEmail         !== undefined ? payload.primaryEmail         : oldRec.primaryEmail,
        'PrimaryIsFocal':           payload.primaryIsFocal          !== undefined ? payload.primaryIsFocal          === true : oldRec.primaryIsFocal,
        'PrimaryLinkedToCustomer':  payload.primaryLinkedToCustomer !== undefined ? payload.primaryLinkedToCustomer === true : oldRec.primaryLinkedToCustomer,
        'SecondaryContact':    payload.secondaryContact     !== undefined ? payload.secondaryContact     : oldRec.secondaryContact,
        'SecondaryRole':       payload.secondaryRole        !== undefined ? payload.secondaryRole        : oldRec.secondaryRole,
        'SecondaryEmail':      payload.secondaryEmail       !== undefined ? payload.secondaryEmail       : oldRec.secondaryEmail,
        'SecondaryIsFocal':    payload.secondaryIsFocal     !== undefined ? payload.secondaryIsFocal     === true : oldRec.secondaryIsFocal,
        'AccountManagers':     Array.isArray(payload.accountManagers) || payload.accountManagers !== undefined ? managers : oldRec.accountManagers,
        'Category':            payload.category             !== undefined ? payload.category             : oldRec.category,
        'Type':                payload.type                 !== undefined ? payload.type                 : oldRec.type,
        'CountryRegion':       payload.countryRegion        !== undefined ? payload.countryRegion        : oldRec.countryRegion,
        'InvoiceContactName':  payload.invoiceContactName   !== undefined ? payload.invoiceContactName   : oldRec.invoiceContactName,
        'InvoiceContactRole':  payload.invoiceContactRole   !== undefined ? payload.invoiceContactRole   : oldRec.invoiceContactRole,
        'InvoiceContactEmail': payload.invoiceContactEmail  !== undefined ? payload.invoiceContactEmail  : oldRec.invoiceContactEmail,
        'Status':              payload.status               !== undefined ? payload.status               : oldRec.status,
        'StatusDate':          payload.statusDate            !== undefined ? payload.statusDate           : oldRec.statusDate,
        'TerminationReason':   payload.terminationReason     !== undefined ? payload.terminationReason    : oldRec.terminationReason,
        'IsReturning':         isReturning,
        'Notes':               payload.notes                !== undefined ? payload.notes                : oldRec.notes,
        'SellerOnboardingLink':payload.sellerOnboardingLink !== undefined ? payload.sellerOnboardingLink : oldRec.sellerOnboardingLink,
        'ContractID':          payload.contractId            !== undefined ? payload.contractId           : oldRec.contractId,
        'UpdatedAt':           new Date(),
        'UpdatedBy':           perm.user.email
      };

      var colNames = Object.keys(updates);
      for (var c = 0; c < colNames.length; c++) {
        var colName = colNames[c];
        if (h[colName] !== undefined) {
          sheet.getRange(rowNum, h[colName] + 1).setValue(updates[colName]);
        }
      }

      _logChanges('Client', clientId, oldRec, payload, perm.user);

      // Cascade the contact name change to VARequests' own cached
      // PrimaryAccount/SecondaryAccount columns, per the request — these
      // are snapshots taken at request-creation time, not a live join,
      // so they'd otherwise stay stale after a contact rename here.
      try {
        var newPrimary = payload.primaryContact || '';
        var newSecondary = payload.secondaryContact || '';
        if (oldRec.primaryContact !== newPrimary || oldRec.secondaryContact !== newSecondary) {
          _cascadeContactNamesToVARequests(clientId, oldRec.primaryContact, newPrimary, oldRec.secondaryContact, newSecondary);
        }
      } catch (contactCascadeEx) { Logger.log('updateClient contact cascade: ' + contactCascadeEx.message); }

      var oldStatusAcct = String(data[i][h['Status']]||'');
      if (needsPendingReviewAcct) {
        var nowReviewAcct = new Date();
        var effectiveDateReviewAcct = payload.statusDate ? _parseDateInput(payload.statusDate) : nowReviewAcct;
        if (h['TerminationRequestedBy'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedBy']+1).setValue(perm.user.email);
        if (h['TerminationRequestedAt'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedAt']+1).setValue(nowReviewAcct);
        if (h['TerminationRequestedDate'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedDate']+1).setValue(effectiveDateReviewAcct);
        if (h['TerminationRequestReason'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestReason']+1).setValue(payload.statusReason || '');
        if (h['PendingReviewAction'] !== undefined) sheet.getRange(rowNum, h['PendingReviewAction']+1).setValue(newStatusCheckAcct);
        if (h['StatusBeforePendingReview'] !== undefined) sheet.getRange(rowNum, h['StatusBeforePendingReview']+1).setValue(oldStatusAcct);
      }

      var lastActiveInfo = { isLastActiveAccount: false };
      if (newStatusCheckAcct === 'Paused' || newStatusCheckAcct === 'Terminated' || newStatusCheckAcct === 'Cancelled') {
        var custIdForCheck = String(data[i][h['CustomerID']]||'');
        if (custIdForCheck) {
          var anyOtherActive = false;
          for (var oai = 1; oai < data.length; oai++) {
            if (oai === i) continue;
            if (String(data[oai][h['CustomerID']]||'') !== custIdForCheck) continue;
            if (String(data[oai][h['Status']]||'') === 'Active') { anyOtherActive = true; break; }
          }
          if (!anyOtherActive) lastActiveInfo = { isLastActiveAccount: true, customerId: custIdForCheck };
        }
      }

      return { success: true, pendingReview: needsPendingReviewAcct, isLastActiveAccount: lastActiveInfo.isLastActiveAccount, customerId: lastActiveInfo.customerId };
    }
    return { success: false, error: 'Client not found.' };
  } catch (e) {
    return { success: false, error: 'updateClient: ' + e.message };
  }
}

function deleteClient(clientId) {
  try {
    var perm = checkPermission('delete');
    if (!perm.allowed) return { success: false, error: 'You do not have permission to delete.' };
    // Same hard rule as deleteCustomer — CS Specialists get full access to
    // Customers & Accounts, but never a delete path, regardless of the
    // Roles sheet's configurable CanDelete flag.
    if (perm.user.role === CONFIG.ROLES.CS_SPECIALIST) {
      return { success: false, error: 'CS Specialists cannot delete records.' };
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data  = sheet.getDataRange().getValues();
    var h     = _buildHeaderMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]) !== clientId) continue;
      _writeLog('Account', clientId, 'DELETE', '',
        String(data[i][h['CompanyName']] || ''), '', perm.user);
      sheet.deleteRow(i + 1);
      return { success: true };
    }
    return { success: false, error: 'Client not found.' };
  } catch (e) {
    return { success: false, error: 'deleteClient: ' + e.message };
  }
}

// Map a data row to a plain serializable object — all Dates converted to strings
function _mapClientRow(row, h) {
  function get(col) {
    if (h[col] === undefined) return '';
    var val = row[h[col]];
    if (val === null || val === undefined) return '';
    if (val instanceof Date) return val.toISOString();
    return val;
  }
  return {
    // .trim() matters here for the same reason as CustomerService.gs's
    // getCustomers(): Router.gs's getEnrichedClients() joins these IDs
    // against trimmed CustomerID/ClientID values from the VAConnections
    // sheet. Untrimmed values here would silently zero out every match.
    clientId:            String(get('ClientID')            || '').trim(),
    customerId:          String(get('CustomerID')          || '').trim(),
    customerName:        String(get('CustomerName')        || ''),
    companyName:         String(get('CompanyName')         || ''),
    accountName:         String(get('AccountName')         || ''),
    primaryContact:      String(get('PrimaryContact')      || ''),
    primaryRole:         String(get('PrimaryRole')         || ''),
    primaryEmail:        String(get('PrimaryEmail')        || ''),
    primaryIsFocal:           get('PrimaryIsFocal')            === true,
    primaryLinkedToCustomer:  get('PrimaryLinkedToCustomer')   === true,
    secondaryContact:    String(get('SecondaryContact')    || ''),
    secondaryRole:       String(get('SecondaryRole')       || ''),
    secondaryEmail:      String(get('SecondaryEmail')      || ''),
    secondaryIsFocal:    get('SecondaryIsFocal') === true,
    accountManagers:     String(get('AccountManagers')     || ''),
    category:            String(get('Category')            || ''),
    type:                String(get('Type')                || ''),
    countryRegion:       String(get('CountryRegion')       || ''),
    invoiceContactName:  String(get('InvoiceContactName')  || ''),
    invoiceContactRole:  String(get('InvoiceContactRole')  || ''),
    invoiceContactEmail: String(get('InvoiceContactEmail') || ''),
    status:              String(get('Status')              || ''),
    statusDate:          get('StatusDate'),
    terminationReason:   get('TerminationReason'),
    isReturning:         get('IsReturning') === true,
    notes:               String(get('Notes')               || ''),
    sellerOnboardingLink:String(get('SellerOnboardingLink')|| ''),
    contractId:          String(get('ContractID')          || ''),
    createdAt:           String(get('CreatedAt')           || ''),
    createdBy:           String(get('CreatedBy')           || ''),
    updatedAt:           String(get('UpdatedAt')           || ''),
    updatedBy:           String(get('UpdatedBy')           || '')
  };
}

function _validateClient(payload) {
  var errors = [];
  if (!payload || !payload.companyName || !payload.companyName.trim()) {
    errors.push('Company Name is required.');
  }
  if (!payload || !payload.customerId) {
    errors.push('Customer is required.');
  }
  if (payload && payload.invoiceContactEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.invoiceContactEmail)) {
    errors.push('Invoice Contact Email is not valid.');
  }
  if (payload && payload.primaryEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.primaryEmail)) {
    errors.push('Primary Contact Email is not valid.');
  }
  if (payload && payload.secondaryEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.secondaryEmail)) {
    errors.push('Secondary Contact Email is not valid.');
  }
  return errors;
}

function _checkWasTerminated(customerId, companyName) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data  = sheet.getDataRange().getValues();
    var h     = _buildHeaderMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (h['CustomerID']  !== undefined &&
          String(row[h['CustomerID']])  === customerId  &&
          String(row[h['CompanyName']]) === companyName &&
          String(row[h['Status']])      === CONFIG.STATUS.TERMINATED) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

// ── Quick status update with date logging ─────────────────────────
// Called from the Account status-change modal.
// status: 'Active' | 'Inactive' | 'Terminated' | 'Cancelled'
// CS Manager (or Administrator) acting on a pending account termination
// request — mirrors approveCustomerTermination exactly. Terminate
// proceeds as requested; Pause is a lesser action than what was
// requested; Reject leaves the account as-is.
function approveClientTermination(clientId, action) {
  try {
    var perm = checkPermission('edit');
    var isAllowedRole = perm.user && (perm.user.role === 'CS Manager' || perm.user.role === 'Administrator');
    if (!isAllowedRole) return { success: false, error: 'Only CS Manager or Administrator can review a pending status change.' };
    if (['Confirm', 'Cancel'].indexOf(action) === -1) return { success: false, error: 'Invalid action: ' + action };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data = sheet.getDataRange().getValues();
    var h = _buildHeaderMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]) !== clientId) continue;
      var rowNum = i + 1;
      var requestedBy = h['TerminationRequestedBy'] !== undefined ? String(data[i][h['TerminationRequestedBy']]||'') : '';
      if (!requestedBy) return { success: false, error: 'This account has no status change pending review.' };

      var currentStatus = String(data[i][h['Status']]||'');
      var priorStatus = h['StatusBeforePendingReview'] !== undefined ? String(data[i][h['StatusBeforePendingReview']]||'') : '';
      var requestReason = h['TerminationRequestReason'] !== undefined ? String(data[i][h['TerminationRequestReason']]||'') : '';

      if (action === 'Cancel' && priorStatus) {
        var updRes = updateClientStatus(clientId, priorStatus, 'Reverted by ' + perm.user.email, null);
        if (!updRes.success) return updRes;
      }
      // Clear the pending-review fields either way — confirmed or
      // cancelled, it's resolved now, not still sitting open.
      // (updateClientStatus does not clear these itself, since a
      // status-only update should not silently touch unrelated fields
      // it wasn't asked about.)
      if (h['TerminationRequestedBy'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedBy']+1).setValue('');
      if (h['TerminationRequestedAt'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedAt']+1).setValue('');
      if (h['TerminationRequestedDate'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestedDate']+1).setValue('');
      if (h['TerminationRequestReason'] !== undefined) sheet.getRange(rowNum, h['TerminationRequestReason']+1).setValue('');
      if (h['PendingReviewAction'] !== undefined) sheet.getRange(rowNum, h['PendingReviewAction']+1).setValue('');
      if (h['StatusBeforePendingReview'] !== undefined) sheet.getRange(rowNum, h['StatusBeforePendingReview']+1).setValue('');
      return { success: true, action: action };
    }
    return { success: false, error: 'Account not found.' };
  } catch (e) {
    return { success: false, error: 'approveClientTermination: ' + e.message };
  }
}

// Every account with a termination request still awaiting approval.
function getPendingClientTerminationApprovals() {
  try {
    var perm = checkPermission('view');
    var isAllowedRole = perm.user && (perm.user.role === 'CS Manager' || perm.user.role === 'Administrator');
    if (!isAllowedRole) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data = sheet.getDataRange().getValues();
    var h = _buildHeaderMap(data[0]);

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var requestedBy = h['TerminationRequestedBy'] !== undefined ? String(data[i][h['TerminationRequestedBy']]||'') : '';
      if (!requestedBy) continue;
      rows.push({
        clientId: String(data[i][h['ClientID']]||''),
        companyName: String(data[i][h['CompanyName']]||''),
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
    return { success: false, error: 'getPendingClientTerminationApprovals: ' + e.message };
  }
}

function updateClientStatus(clientId, status, reason, statusDate) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var validStatuses = ['Active', 'Inactive', 'Terminated', 'Cancelled', 'Paused'];
    if (validStatuses.indexOf(status) === -1) {
      return { success: false, error: 'Invalid status: ' + status };
    }
    if ((status === 'Terminated' || status === 'Cancelled') && statusDate) {
      var checkDate = new Date(statusDate);
      if (!isNaN(checkDate.getTime()) && checkDate > new Date()) {
        return { success: false, error: 'Termination date cannot be in the future.' };
      }
    }
    if ((status === 'Terminated' || status === 'Cancelled') && _hasActiveVAConnections(clientId, null)) {
      return { success: false, error: 'This account still has active VA connections. Please terminate those VA connections first.' };
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data  = sheet.getDataRange().getValues();
    var h     = _buildHeaderMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]) !== clientId) continue;

      var rowNum    = i + 1;
      var oldStatus = String(data[i][h['Status']] || '');
      var now       = new Date();
      var dateToLog = statusDate ? new Date(statusDate) : now;

      // Determine isReturning: if reactivating a terminated/cancelled account
      var wasTerminated = oldStatus === 'Terminated' || oldStatus === 'Cancelled';
      var isNowActive   = status === 'Active';
      var isReturning   = (data[i][h['IsReturning']] === true) || (wasTerminated && isNowActive);

      sheet.getRange(rowNum, h['Status']      + 1).setValue(status);
      if (h['StatusDate']         !== undefined) sheet.getRange(rowNum, h['StatusDate']         + 1).setValue(dateToLog);
      if (h['TerminationReason']  !== undefined) sheet.getRange(rowNum, h['TerminationReason']  + 1).setValue(reason || '');
      if (h['IsReturning']        !== undefined) sheet.getRange(rowNum, h['IsReturning']        + 1).setValue(isReturning);
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(now);
      sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);

      _writeLog('Account', clientId, _classifyStatusChangeAction(oldStatus, status), 'Status', oldStatus, status, perm.user, dateToLog);
      _writeLog('Account', clientId, 'UPDATE', 'StatusDate', '', dateToLog.toISOString ? dateToLog.toISOString() : String(dateToLog), perm.user, dateToLog);
      if (reason) _writeLog('Account', clientId, 'UPDATE', 'TerminationReason', '', reason, perm.user, dateToLog);

      // Cascade: if all clients of this customer are now closed, auto-terminate customer
      var custId = String(data[i][h['CustomerID']] || '');
      var terminationDateForCust = (status === 'Terminated' || status === 'Cancelled') ? dateToLog : null;
      if (custId) _checkAndCascadeCustomerStatus(custId, perm.user, terminationDateForCust);

      return { success: true, isReturning: isReturning, oldStatus: oldStatus, newStatus: status, customerId: custId };
    }
    return { success: false, error: 'Account not found.' };
  } catch (e) {
    return { success: false, error: 'updateClientStatus: ' + e.message };
  }
}

// ── Extended status update — also applies category and type changes
function updateClientStatusFull(clientId, status, reason, statusDate, category, type) {
  try {
    // First do the standard status update
    var res = updateClientStatus(clientId, status, reason, statusDate);
    if (!res || !res.success) return res;

    // Then apply category and/or type if provided
    if (!category && !type) return res;
    var perm = checkPermission('edit');
    if (!perm.allowed) return res; // status already saved — just skip cat/type

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var data  = sheet.getDataRange().getValues();
    var h     = {};
    data[0].forEach(function (col, i) { if (col) h[String(col)] = i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]) !== clientId) continue;
      var rowNum = i + 1;
      if (category && h['Category'] !== undefined) {
        var oldCat = String(data[i][h['Category']] || '');
        if (oldCat !== category) {
          sheet.getRange(rowNum, h['Category'] + 1).setValue(category);
          _writeLog('Account', clientId, 'UPDATE', 'category', oldCat, category, perm.user);
        }
      }
      if (type && h['Type'] !== undefined) {
        var oldType = String(data[i][h['Type']] || '');
        if (oldType !== type) {
          sheet.getRange(rowNum, h['Type'] + 1).setValue(type);
          _writeLog('Account', clientId, 'UPDATE', 'type', oldType, type, perm.user);
        }
      }
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);
      break;
    }
    return res;
  } catch (e) {
    return { success: false, error: 'updateClientStatusFull: ' + e.message };
  }
}

// ── Add a name to a Client's AccountManagers list, if it isn't there already
// Called from VARequestService.gs (createVARequest/updateVARequest) when a
// Service Request names an Account Manager who isn't yet on the account's
// record — the ticket references a real person, so that person should
// actually be tracked on the account going forward, not just on this one
// ticket. Case-insensitive/whitespace-insensitive match so "Jane Doe" and
// "jane doe " aren't treated as two different people.
function _addAccountManagerIfNew(clientId, managerName, user, managerEmail) {
  try {
    managerName = String(managerName || '').trim();
    if (!clientId || !managerName) return;

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var h    = _buildHeaderMap(data[0]);
    if (h['AccountManagers'] === undefined) return;
    // Self-heal the parallel emails column if this deployment predates it.
    if (h['AccountManagerEmails'] === undefined) {
      var lastCol = sheet.getLastColumn();
      sheet.getRange(1, lastCol + 1).setValue('AccountManagerEmails');
      h['AccountManagerEmails'] = lastCol; // 0-indexed, matches h's convention
    }

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]) !== String(clientId)) continue;
      var existingRaw = String(data[i][h['AccountManagers']] || '');
      var existingList = existingRaw ? existingRaw.split(',').map(function(m){ return m.trim(); }).filter(Boolean) : [];
      var existingEmailRaw = String(data[i][h['AccountManagerEmails']] || '');
      var existingEmailList = existingRaw ? existingEmailRaw.split(',').map(function(m){ return m.trim(); }) : [];
      // Pad the email list to match the name list's length, in case emails
      // weren't tracked yet for some existing names (added before this
      // feature existed) — keeps the two lists positionally aligned.
      while (existingEmailList.length < existingList.length) existingEmailList.push('');

      var alreadyOnList = existingList.some(function(m){ return m.toLowerCase() === managerName.toLowerCase(); });
      if (alreadyOnList) return; // nothing to do

      existingList.push(managerName);
      existingEmailList.push(String(managerEmail || '').trim());
      var newRaw = existingList.join(', ');
      var newEmailRaw = existingEmailList.join(', ');
      var rowNum = i + 1;
      sheet.getRange(rowNum, h['AccountManagers'] + 1).setValue(newRaw);
      sheet.getRange(rowNum, h['AccountManagerEmails'] + 1).setValue(newEmailRaw);
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(new Date());
      if (user && user.email) sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(user.email);
      _writeLog('Account', clientId, 'UPDATE', 'accountManagers', existingRaw, newRaw, user || { email: 'system' });
      return;
    }
  } catch (e) {
    Logger.log('_addAccountManagerIfNew: ' + e.message); // non-fatal — the request itself already saved successfully
  }
}
// One-time backfill — populates the cached CustomerName on every EXISTING
// Client row. Only needed once after deploying this column; createClient
// and _cascadeCustomerNameToClients keep it correct for everything going
// forward. Safe to re-run any time (it only touches rows that are
// actually out of sync).
function backfillClientCustomerNames() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can run this.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!cliSheet) return { success: false, error: 'Clients sheet not found.' };
    _ensureClientsCustomerNameHeader(cliSheet);

    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var custData = custSheet.getDataRange().getValues();
    var ch = {}; custData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
    var nameByCustomerId = {};
    for (var ci = 1; ci < custData.length; ci++) {
      var cid = String(custData[ci][ch['CustomerID']]||''); if (!cid) continue;
      nameByCustomerId[cid] = String(custData[ci][ch['CustomerName']]||'');
    }

    var cliData = cliSheet.getDataRange().getValues();
    var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
    var updated = 0, skipped = 0;
    for (var i = 1; i < cliData.length; i++) {
      if (!cliData[i][clh['ClientID']]) continue;
      var custId = String(cliData[i][clh['CustomerID']]||'');
      var correctName = nameByCustomerId[custId] || '';
      var currentCached = String(cliData[i][clh['CustomerName']]||'');
      if (currentCached === correctName) { skipped++; continue; }
      cliSheet.getRange(i+1, clh['CustomerName']+1).setValue(correctName);
      updated++;
    }
    return { success: true, updated: updated, alreadyInSync: skipped };
  } catch (e) {
    return { success: false, error: 'backfillClientCustomerNames: ' + e.message };
  }
}

function _ensureClientsCustomerNameHeader(sheet) {
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  var headerRow = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var has = headerRow.some(function(c) { return String(c||'').trim() === 'CustomerName'; });
  if (has) return;
  sheet.getRange(1, lastCol + 1).setValue('CustomerName');
}

// ── Welcome Email ────────────────────────────────────────────────────
// Sent by a CS Manager upon Account creation, choosing from the
// "Customer Onboarding" module's email templates. Follows the same
// "CS can edit before sending" pattern as the Celebration emails —
// subject/body are passed in exactly as shown in the preview/compose
// step, not re-merged server-side, so what's reviewed is what's sent.
function getWelcomeEmailPreview(clientId, templateId) {
  try {
    var clientRes = getClientById(clientId);
    if (!clientRes.success) return { success: false, error: clientRes.error };
    var rec = clientRes.data;

    var tplRes = templateId ? getEmailTemplateById(templateId) : { success: false };
    var tpl = tplRes.success ? tplRes.data : null;

    var vars = {
      clientName:  rec.primaryContact || '',
      accountName: rec.accountName || rec.companyName || '',
      imageUrl:    tpl ? (tpl.imageUrl || '') : ''
    };
    var toList = [rec.primaryEmail, rec.secondaryEmail].filter(Boolean);

    return {
      success: true,
      data: {
        templateId: tpl ? tpl.templateId : '',
        isHtml:  tpl ? !!tpl.isHtml : false,
        subject: tpl ? _mergeTemplate(tpl.subject, vars) : ('Welcome, ' + vars.clientName + '!'),
        body:    tpl ? _mergeTemplate(tpl.body, vars) : '',
        to: toList,
        clientName: vars.clientName,
        accountName: vars.accountName
      }
    };
  } catch (e) {
    return { success: false, error: 'getWelcomeEmailPreview: ' + e.message };
  }
}

function sendWelcomeEmail(clientId, subject, body, toOverride, isHtml, templateName) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var toList = toOverride && toOverride.length ? toOverride : [];
    if (!toList.length) return { success: false, error: 'No email address on file for this account.' };

    var mailOpts = { to: toList.join(','), subject: subject };
    if (isHtml) { mailOpts.htmlBody = body; } else { mailOpts.body = body; }
    MailApp.sendEmail(mailOpts);

    // Logged as an Account-entity event so it shows up in the Customer
    // Profile's Account History timeline (see getCustomerAccountHistory
    // in CustomerService.gs, which recognizes this action type).
    _writeLog('Account', clientId, 'WELCOME_EMAIL_SENT', '', '',
      JSON.stringify({ templateName: templateName || '', to: toList.join(', ') }), perm.user);

    return { success: true };
  } catch (e) {
    return { success: false, error: 'sendWelcomeEmail: ' + e.message };
  }
}

// ── Account Milestone ────────────────────────────────────────────────
// A simplified, high-level lifecycle view for a single Account — shown
// on the Account full-page view's rightmost column. Unlike the Customer
// Profile's Account History (which tracks every account under a
// customer, with full detail), this is intentionally a general summary:
// Onboarding, general VA connection status (not each individual VA),
// and Offboarding if it's happened. Reuses the same period-partitioning
// approach as getCustomerAccountHistory for the "general VA connection"
// summarization, scoped to just this one account.
function getAccountMilestones(clientId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var clientRes = getClientById(clientId);
    if (!clientRes.success) return { success: false, error: clientRes.error };
    var cl = clientRes.data;

    var milestones = [];

    // Onboarding
    milestones.push({ type: 'Onboarding', label: 'Account Created', date: cl.createdAt, status: 'completed', detail: cl.accountName || cl.companyName });

    // Welcome Email, if sent — a genuine onboarding milestone worth
    // surfacing here specifically (not every log event, just this one).
    var acctLogsRes = getLogs({ entityId: clientId, entityType: ['Client','Account'], allTime: true, limit: 2000 });
    var acctLogs = (acctLogsRes && acctLogsRes.success) ? acctLogsRes.data : [];
    var welcomeSent = acctLogs.find(function(l){ return l.action === 'WELCOME_EMAIL_SENT'; });
    if (welcomeSent) {
      milestones.push({ type: 'Onboarding', label: 'Welcome Email Sent', date: welcomeSent.timestamp, status: 'completed', detail: '' });
    }

    // General VA connection status — not each individual VA, just
    // "connected with first VA" and, if the account has since had a VA
    // start again after a gap, "reconnected." Reuses the same
    // first-start / period logic as the Customer Profile's history.
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var starts = [];
    var hasActiveNow = false;
    if (connSheet) {
      var connData = connSheet.getDataRange().getValues();
      var coh = {}; connData[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });
      for (var vi = 1; vi < connData.length; vi++) {
        if (String(connData[vi][coh['ClientID']]||'') !== clientId) continue;
        var vStart = coh['ActualStartDate']!==undefined ? _sd(connData[vi][coh['ActualStartDate']]) : '';
        var vStatus = String(connData[vi][coh['ConnectionStatus']]||'');
        if (vStart) starts.push(vStart);
        if (vStatus === CONFIG.VA_CONNECTION_STATUS.STARTED) hasActiveNow = true;
      }
    }
    starts.sort();
    if (starts.length) {
      milestones.push({ type: 'VA Connection', label: 'Connected with First VA', date: starts[0], status: 'completed', detail: '' });
      if (starts.length > 1) {
        milestones.push({ type: 'VA Connection', label: hasActiveNow ? 'Currently Connected with a VA' : 'Most Recent VA Connection', date: starts[starts.length-1], status: hasActiveNow ? 'current' : 'completed', detail: '' });
      }
    } else {
      milestones.push({ type: 'VA Connection', label: 'Awaiting First VA Connection', date: '', status: 'pending', detail: '' });
    }

    // Offboarding — only shown if it's actually happened
    if (cl.status === 'Terminated' || cl.status === 'Cancelled') {
      milestones.push({ type: 'Offboarding', label: cl.status === 'Cancelled' ? 'Account Cancelled' : 'Account Terminated', date: cl.statusDate || cl.updatedAt, status: 'completed', detail: cl.terminationReason || '' });
    } else {
      milestones.push({ type: 'Offboarding', label: 'Offboarding', date: '', status: 'pending', detail: '' });
    }

    milestones.sort(function(a,b) {
      // Pending items (no date) sort to the end, in the order pushed above
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });

    return { success: true, data: milestones };
  } catch (e) {
    return { success: false, error: 'getAccountMilestones: ' + e.message };
  }
}

// ── Secondary Contact update ─────────────────────────────────────────
// A dedicated, narrow function for CS Specialist/CS Manager to update
// just the Secondary Contact fields — deliberately bypasses the general
// "RequiresApproval" restriction on updateClient (which blocks CS
// Specialist from any edit at all), since this specific field is
// something they need to be able to keep current day-to-day without
// waiting on manager approval for every change.
function updateSecondaryContact(clientId, payload) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: 'Not signed in.' };
    var allowedRoles = [CONFIG.ROLES.CS_SPECIALIST, CONFIG.ROLES.CS_MANAGER, CONFIG.ROLES.ADMINISTRATOR];
    if (allowedRoles.indexOf(user.role) === -1) {
      return { success: false, error: 'Only CS Specialists, CS Managers, or Administrators can update the secondary contact.' };
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!sheet) return { success: false, error: 'Clients sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h    = _buildHeaderMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]) !== String(clientId)) continue;
      var rowNum = i + 1;
      var oldName = h['SecondaryContact'] !== undefined ? String(data[i][h['SecondaryContact']]||'') : '';

      if (h['SecondaryContact'] !== undefined) sheet.getRange(rowNum, h['SecondaryContact']+1).setValue((payload.secondaryContact||'').trim());
      if (h['SecondaryRole']    !== undefined) sheet.getRange(rowNum, h['SecondaryRole']+1).setValue((payload.secondaryRole||'').trim());
      if (h['SecondaryEmail']   !== undefined) sheet.getRange(rowNum, h['SecondaryEmail']+1).setValue((payload.secondaryEmail||'').trim());
      if (h['SecondaryIsFocal'] !== undefined) sheet.getRange(rowNum, h['SecondaryIsFocal']+1).setValue(!!payload.secondaryIsFocal);
      if (h['UpdatedAt'] !== undefined) sheet.getRange(rowNum, h['UpdatedAt']+1).setValue(new Date());
      if (h['UpdatedBy'] !== undefined) sheet.getRange(rowNum, h['UpdatedBy']+1).setValue(user.email);

      _writeLog('Account', clientId, 'UPDATE', 'secondaryContact', oldName, (payload.secondaryContact||'').trim(), user);
      return { success: true };
    }
    return { success: false, error: 'Account not found.' };
  } catch (e) {
    return { success: false, error: 'updateSecondaryContact: ' + e.message };
  }
}