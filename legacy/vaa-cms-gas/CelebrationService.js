// ─────────────────────────────────────────
// CelebrationService.gs — Birthdays & Anniversaries module
// Computes upcoming VA birthdays (from VirtualAssistants.Birthday) and
// VA↔Client work anniversaries (from VAConnections, using ActualStartDate
// or AssignedAt as the start date) within a rolling 30-day window, resolves
// the right recipients for each, merges the chosen email template, and
// sends via MailApp as the logged-in CS user once they confirm the preview.
// ─────────────────────────────────────────

var CELEBRATION_WINDOW_DAYS = 30;

// ── Helpers ────────────────────────────────────────────────────────────

function _celGetSheet(ss) {
  return _ensureSheet(ss, CONFIG.SHEETS.CELEBRATION_LOGS, CONFIG.SCHEMA.CelebrationLogs);
}

function _celHMap(headerRow) {
  var h = {};
  for (var i = 0; i < headerRow.length; i++) {
    if (headerRow[i]) h[String(headerRow[i])] = i;
  }
  return h;
}

// Next occurrence of a recurring month/day from `baseDate`, on/after `today`.
// Returns {date, daysUntil, years} or null if baseDate is invalid.
function _nextOccurrence(baseDateVal, today) {
  if (!baseDateVal) return null;
  var base = baseDateVal instanceof Date ? baseDateVal : new Date(baseDateVal);
  if (isNaN(base.getTime())) return null;

  var thisYear = today.getFullYear();
  var next = new Date(thisYear, base.getMonth(), base.getDate());
  next.setHours(0,0,0,0);
  var todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (next < todayMidnight) {
    next = new Date(thisYear + 1, base.getMonth(), base.getDate());
  }
  var daysUntil = Math.round((next - todayMidnight) / 86400000);
  var years = next.getFullYear() - base.getFullYear();
  return { date: next, daysUntil: daysUntil, years: years, occasionYear: next.getFullYear() };
}

// ── Birthdays ────────────────────────────────────────────────────────────
// Lists VAs whose next birthday falls within the rolling window, along with
// their active (Started) client connections and whether a notify/follow-up
// email has already been logged for this year's occurrence.
function getUpcomingBirthdays(filters) {
  try {
    filters = filters || {};
    var windowDays = filters.windowDays || CELEBRATION_WINDOW_DAYS;
    var today = new Date();

    var vaRes = getVAs({});
    if (!vaRes.success) return vaRes;

    var cliRes = getClients({});
    var clientsById = {};
    if (cliRes.success) cliRes.data.forEach(function(c){ clientsById[c.clientId] = c; });

    var custRes = getCustomers({});
    var custById = {};
    if (custRes && custRes.success) {
      custRes.data.forEach(function(c){ custById[c.customerId] = c; });
    }

    // Read VAConnections directly from the sheet — bypasses the service layer
    // to avoid any mapping or status-comparison mismatch that was causing all
    // VAs to appear with "No active clients" despite having active connections.
    var connsByVAId = {};
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
      if (connSheet) {
        var connData = connSheet.getDataRange().getValues();
        var coh = {};
        connData[0].forEach(function(col, idx){ if (col) coh[String(col)] = idx; });
        for (var ci = 1; ci < connData.length; ci++) {
          var connRow = connData[ci];
          if (!connRow[coh['ConnectionID']]) continue;
          var connStatus = String(connRow[coh['ConnectionStatus']]||'').trim();
          if (connStatus !== 'Started') continue;
          var connVaId = String(connRow[coh['VAID']]||'').trim();
          if (!connVaId) continue;
          if (!connsByVAId[connVaId]) connsByVAId[connVaId] = [];
          connsByVAId[connVaId].push({
            connectionId: String(connRow[coh['ConnectionID']]||''),
            clientId:     String(connRow[coh['ClientID']]||''),
            customerId:   String(connRow[coh['CustomerID']]||''),
            vaId:         connVaId
          });
        }
      }
    } catch (connErr) {
      Logger.log('getUpcomingBirthdays: VAConnections read error: ' + connErr.message);
    }

    // Birthday log index — key is "vaId|clientId|occasionYear" so each
    // VA-Client row has its own independent send/follow-up status. The
    // legacy key "vaId|year" (used when there was one row per VA) is kept
    // as a fallback so existing logs are not lost after the upgrade.
    var logsByKey = _loadCelebrationLogIndexPerClient('Birthday');

    var rows = [];
    var vaById = {};
    vaRes.data.forEach(function(va){ vaById[va.vaId] = va; });

    // Open Concern lookup, by VA — used to show a warning icon beside a
    // VA's name if they currently have an unresolved concern raised
    // during an Account Meeting.
    var vaIdsWithOpenConcern = {};
    try {
      var concernsRes = getAllOpenMeetingConcerns();
      if (concernsRes && concernsRes.success) {
        concernsRes.data.forEach(function(c) { if (c.vaId) vaIdsWithOpenConcern[c.vaId] = true; });
      }
    } catch (concernEx) { Logger.log('getUpcomingBirthdays open concerns: ' + concernEx.message); }

    // Unpaid-customer lookup — used to show a warning beside the account
    // name if that customer's most recently uploaded payment status is
    // Unpaid.
    var unpaidCustomerIds = {};
    try {
      var latestStatusByCustomer = _cpGetLatestStatusByCustomer();
      Object.keys(latestStatusByCustomer).forEach(function(cid) {
        if (latestStatusByCustomer[cid] === CLIENT_PAYMENT_STATUS.UNPAID) unpaidCustomerIds[cid] = true;
      });
    } catch (payEx) { Logger.log('getUpcomingBirthdays unpaid customers: ' + payEx.message); }

    vaRes.data.forEach(function(va) {
      if (!va.birthday) return;
      var occ = _nextOccurrence(va.birthday, today);
      if (!occ || occ.daysUntil > windowDays) return;

      var activeConns = connsByVAId[va.vaId] || [];

      // One row per VA-Client connection. If the VA has no active clients,
      // still emit one row (with empty client fields) so the birthday is
      // visible and the CS can follow up directly with the VA.
      var connectionsToShow = activeConns.length ? activeConns : [null];

      // Resolve focal email per client: honour IsFocal flags, fall back to primary
      connectionsToShow.forEach(function(conn) {
        var clientId   = conn ? conn.clientId : '';
        var customerId = conn ? conn.customerId : '';
        var client     = clientId ? clientsById[clientId] : null;
        var cust       = customerId ? custById[customerId] : null;

        // Focal person = whichever contact is flagged IsFocal; fall back to Primary
        var focalEmail = '', focalName = '';
        if (client) {
          var primFocal = String(client.primaryIsFocal||'').toLowerCase() === 'true' || client.primaryIsFocal === true;
          var secFocal  = String(client.secondaryIsFocal||'').toLowerCase() === 'true' || client.secondaryIsFocal === true;
          if (secFocal && client.secondaryEmail) {
            focalEmail = client.secondaryEmail;
            focalName  = client.secondaryContact || '';
          } else if (client.primaryEmail) {
            focalEmail = client.primaryEmail;
            focalName  = client.primaryContact || '';
          }
        }
        var focalEmails = focalEmail ? [focalEmail] : [];

        var csAssigned = cust ? (cust.assignedSpecialist || '') : '';

        var logKey    = va.vaId + '|' + clientId + '|' + occ.occasionYear;
        var legacyKey = va.vaId + '|' + occ.occasionYear;
        var log = logsByKey[logKey] || logsByKey[legacyKey] || {};
        var notifStatus = log.followup ? 'followup' : (log.notify ? 'notified' : 'pending');

        var q = filters.search ? filters.search.toLowerCase() : '';
        if (q) {
          var hay = (va.vaName + ' ' + (client ? (client.companyName + ' ' + (client.accountName||'')) : '') + ' ' + csAssigned).toLowerCase();
          if (hay.indexOf(q) === -1) return;
        }

        rows.push({
          vaId:          va.vaId,
          vaName:        va.vaName,
          department:    va.department,
          birthday:      va.birthday,
          nextOccurrence:occ.date.toISOString(),
          occasionYear:  occ.occasionYear,
          daysUntil:     occ.daysUntil,
          clientId:      clientId,
          customerId:    customerId,
          clientName:    client ? (client.accountName || client.companyName) : '',
          companyName:   client ? client.companyName : '',
          focalEmail:    focalEmail,
          focalName:     focalName,
          focalEmails:   focalEmails,
          csAssigned:    csAssigned,
          hasOpenConcern: !!vaIdsWithOpenConcern[va.vaId],
          customerUnpaid: !!(customerId && unpaidCustomerIds[customerId]),
          notifStatus:   notifStatus,
          notifiedAt:    log.notify    ? log.notify.sentAt    : '',
          followUpSentAt:log.followup  ? log.followup.sentAt  : ''
        });
      });
    });

    rows.sort(function(a,b){ return a.daysUntil - b.daysUntil; });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getUpcomingBirthdays: ' + e.message };
  }
}

// Per-client celebration log index — keys: "vaId|clientId|year" (new) and
// "vaId|year" (legacy, kept for backwards compatibility with existing logs).
function _loadCelebrationLogIndexPerClient(occasionType) {
  var index = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _celGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return index;
    var h = _celHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[h['OccasionType']]) !== occasionType) continue;
      var vaId  = String(row[h['VAID']] || '');
      var cliId = String(row[h['ClientID']] || '');
      var year  = String(row[h['OccasionYear']] || '');
      var emailType = String(row[h['EmailType']] || '').toLowerCase();
      var entry = { sentAt: _sdET(row[h['SentAt']]), sentBy: String(row[h['SentBy']]||'') };
      // New per-client key
      var key1 = vaId + '|' + cliId + '|' + year;
      if (!index[key1]) index[key1] = {};
      index[key1][emailType] = entry;
      // Legacy VA-only key (read-only fallback — not written to)
      var key2 = vaId + '|' + year;
      if (!index[key2]) index[key2] = {};
      index[key2][emailType] = entry;
    }
  } catch (e) {
    Logger.log('_loadCelebrationLogIndexPerClient: ' + e.message);
  }
  return index;
}

// ── Anniversaries ────────────────────────────────────────────────────────
// One row per active (Started) VA↔Client connection whose next work
// anniversary (based on ActualStartDate, falling back to AssignedAt) is
// within the window. Each connection is its own row since the anniversary
// is connection-specific (a VA can have a different start date per client).
function getUpcomingAnniversaries(filters) {
  try {
    filters = filters || {};
    var windowDays = filters.windowDays || CELEBRATION_WINDOW_DAYS;
    var today = new Date();

    var connRes = getVAConnections({});
    if (!connRes.success) return connRes;
    var activeConns = connRes.data.filter(function(c) { return c.connectionStatus === CONFIG.VA_CONNECTION_STATUS.STARTED; });

    var cliRes = getClients({});
    var clientsById = {};
    if (cliRes.success) cliRes.data.forEach(function(c){ clientsById[c.clientId] = c; });

    var logsByKey = _loadCelebrationLogIndex('Anniversary');

    var custRes2 = getCustomers({});
    var custById2 = {};
    if (custRes2 && custRes2.success) {
      custRes2.data.forEach(function(c){ custById2[c.customerId] = c; });
    }

    var rows = [];
    var vaIdsWithOpenConcernAnn = {};
    try {
      var concernsResAnn = getAllOpenMeetingConcerns();
      if (concernsResAnn && concernsResAnn.success) {
        concernsResAnn.data.forEach(function(c) { if (c.vaId) vaIdsWithOpenConcernAnn[c.vaId] = true; });
      }
    } catch (concernExAnn) { Logger.log('getUpcomingAnniversaries open concerns: ' + concernExAnn.message); }
    var unpaidCustomerIdsAnn = {};
    try {
      var latestStatusByCustomerAnn = _cpGetLatestStatusByCustomer();
      Object.keys(latestStatusByCustomerAnn).forEach(function(cid) {
        if (latestStatusByCustomerAnn[cid] === CLIENT_PAYMENT_STATUS.UNPAID) unpaidCustomerIdsAnn[cid] = true;
      });
    } catch (payExAnn) { Logger.log('getUpcomingAnniversaries unpaid customers: ' + payExAnn.message); }

    activeConns.forEach(function(conn) {
      var startVal = conn.actualStartDate || conn.assignedAt;
      if (!startVal) return;
      var occ = _nextOccurrence(startVal, today);
      if (!occ || occ.daysUntil > windowDays || occ.years < 1) return;

      var client = clientsById[conn.clientId];
      if (filters.search) {
        var q = filters.search.toLowerCase();
        var hay = (conn.vaName + ' ' + (client ? (client.companyName + ' ' + client.accountName) : '')).toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }

      var logKey = conn.connectionId + '|' + occ.occasionYear;
      var log = logsByKey[logKey] || {};

      // CS Specialist from the account's linked customer
      var cust2 = client ? custById2[client.customerId] : null;
      var csAssigned2 = cust2 ? (cust2.assignedSpecialist || '') : '';
      var notifStatus2 = log.followup ? 'followup' : (log.notify ? 'notified' : 'pending');

      rows.push({
        connectionId:  conn.connectionId,
        vaId:          conn.vaId,
        vaName:        conn.vaName,
        clientId:      conn.clientId,
        customerId:    conn.customerId,
        accountName:   client ? (client.accountName || client.companyName) : conn.clientId,
        companyName:   client ? client.companyName : '',
        startDate:     startVal,
        nextOccurrence:occ.date.toISOString(),
        occasionYear:  occ.occasionYear,
        years:         occ.years,
        daysUntil:     occ.daysUntil,
        csAssigned:    csAssigned2,
        hasOpenConcern: !!vaIdsWithOpenConcernAnn[conn.vaId],
        customerUnpaid: !!(conn.customerId && unpaidCustomerIdsAnn[conn.customerId]),
        notifStatus:   notifStatus2,
        notifiedAt:    log.notify    ? log.notify.sentAt   : '',
        followUpSentAt:log.followup  ? log.followup.sentAt : ''
      });
    });

    rows.sort(function(a,b){ return a.daysUntil - b.daysUntil; });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getUpcomingAnniversaries: ' + e.message };
  }
}

// Builds { "vaId|year": { notify: {...}, followup: {...} } } (birthdays) or
// { "connectionId|year": {...} } (anniversaries) from CelebrationLogs, so the
// list views can show "already notified" without a second round trip per row.
function _loadCelebrationLogIndex(occasionType) {
  var index = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _celGetSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return index;
    var h = _celHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[h['OccasionType']]) !== occasionType) continue;
      var key = (occasionType === 'Birthday' ? String(row[h['VAID']]) : String(row[h['ConnectionID']])) + '|' + String(row[h['OccasionYear']]);
      if (!index[key]) index[key] = {};
      var emailType = String(row[h['EmailType']] || '').toLowerCase(); // 'notify' or 'followup'
      index[key][emailType] = { sentAt: _sdET(row[h['SentAt']]), sentBy: String(row[h['SentBy']]||'') };
    }
  } catch (e) {
    Logger.log('_loadCelebrationLogIndex: ' + e.message);
  }
  return index;
}

// ── Recipient resolution ──────────────────────────────────────────────

// All active (Started) clients' email addresses for a VA — both Primary and
// Secondary contact emails where present, deduplicated. Used for the
// Birthday BCC list. The VA's own email is intentionally never included.
function _getActiveClientEmailsForVA(vaId) {
  var connRes = getVAConnections({});
  var activeConns = (connRes.success ? connRes.data : []).filter(function(c) {
    return c.vaId === vaId && c.connectionStatus === CONFIG.VA_CONNECTION_STATUS.STARTED;
  });
  var clientIds = activeConns.map(function(c){ return c.clientId; });
  var cliRes = getClients({});
  var clients = (cliRes.success ? cliRes.data : []).filter(function(c){ return clientIds.indexOf(c.clientId) !== -1; });

  var emails = [];
  clients.forEach(function(c) {
    [c.primaryEmail, c.secondaryEmail].forEach(function(e) {
      if (e && emails.indexOf(e) === -1) emails.push(e);
    });
  });
  return { emails: emails, clients: clients };
}

// The single client tied to one VAConnection, for the Anniversary email —
// goes to that one account only, not the VA's whole client list.
function _getClientEmailsForConnection(connectionId) {
  var connRes = getVAConnectionById ? getVAConnectionById(connectionId) : null;
  var conn = (connRes && connRes.success) ? connRes.data : null;
  if (!conn) {
    // Fallback: scan the full list if a by-id lookup isn't available
    var allRes = getVAConnections({});
    conn = (allRes.success ? allRes.data : []).find(function(c){ return c.connectionId === connectionId; });
  }
  if (!conn) return { emails: [], client: null };
  var cliRes = getClientById(conn.clientId);
  var client = (cliRes && cliRes.success) ? cliRes.data : null;
  if (!client) return { emails: [], client: null };
  var emails = [];
  [client.primaryEmail, client.secondaryEmail].forEach(function(e) {
    if (e && emails.indexOf(e) === -1) emails.push(e);
  });
  return { emails: emails, client: client, connection: conn };
}

// ── Preview building (template + merge, no send) ──────────────────────

function getBirthdayEmailPreview(vaId, clientId, emailKind) {
  try {
    var vaRes = getVAById(vaId);
    if (!vaRes.success) return vaRes;
    var va = vaRes.data;

    var category = (emailKind === 'followup') ? CONFIG.EMAIL_TEMPLATE_CATEGORY.BIRTHDAY_FOLLOWUP : CONFIG.EMAIL_TEMPLATE_CATEGORY.BIRTHDAY_NOTIFY;
    var tplRes = getDefaultTemplateForCategory(category);
    var tpl = tplRes.success ? tplRes.data : null;

    // Resolve the specific client for this row — preview is per-client now,
    // not a BCC-all-clients blast. clientId may be empty if the VA has no
    // active clients; in that case we still build a template-only preview.
    var client = null;
    if (clientId) {
      var cliRes2 = getClientById(clientId);
      if (cliRes2 && cliRes2.success) client = cliRes2.data;
    }
    var toEmails = [];
    if (client) {
      [client.primaryEmail, client.secondaryEmail].forEach(function(e){
        if (e && toEmails.indexOf(e) === -1) toEmails.push(e);
      });
    }

    var gender = va.gender || '';
    var heShe  = gender === 'Male' ? 'he'  : gender === 'Female' ? 'she'  : '{{heShe}}';
    var himHer = gender === 'Male' ? 'him' : gender === 'Female' ? 'her'  : '{{himHer}}';
    var hisHer = gender === 'Male' ? 'his' : gender === 'Female' ? 'her'  : '{{hisHer}}';
    var vars = {
      vaName:      va.vaName,
      vaBirthday:  va.birthday ? _formatLongDate(va.birthday) : '',
      birthday:    va.birthday ? _formatLongDate(va.birthday) : '', // alias — some templates use the shorter name
      clientName:  client ? (client.primaryContact || client.accountName || client.companyName) : '',
      accountName: client ? (client.accountName || client.companyName) : '',
      years: '',
      heShe: heShe, himHer: himHer, hisHer: hisHer
    };

    var imageTag = (tpl && tpl.imageUrl) ? '<img src="' + tpl.imageUrl + '" alt="" style="display:block;max-width:100%;margin:16px auto;" />' : '';

    return {
      success: true,
      data: {
        templateId: tpl ? tpl.templateId : '',
        isHtml:     tpl ? !!tpl.isHtml : false,
        subject:    tpl ? _mergeTemplate(tpl.subject, vars) : ("It's " + va.vaName + "'s Birthday!"),
        body:       tpl ? _mergeTemplate(tpl.body.replace(/\{\{\s*imageUrl\s*\}\}/g, imageTag), vars) : '',
        imageUrl:   tpl ? (tpl.imageUrl || '') : '',
        to:         toEmails,
        clientName: vars.accountName
      }
    };
  } catch (e) {
    return { success: false, error: 'getBirthdayEmailPreview: ' + e.message };
  }
}

function getAnniversaryEmailPreview(connectionId, emailKind) {
  try {
    var recipientInfo = _getClientEmailsForConnection(connectionId);
    if (!recipientInfo.client) return { success: false, error: 'Account not found for this connection.' };
    var conn = recipientInfo.connection;

    var startVal = conn.actualStartDate || conn.assignedAt;
    var occ = _nextOccurrence(startVal, new Date());

    var category = (emailKind === 'followup') ? CONFIG.EMAIL_TEMPLATE_CATEGORY.ANNIVERSARY_FOLLOWUP : CONFIG.EMAIL_TEMPLATE_CATEGORY.ANNIVERSARY_NOTIFY;
    var tplRes = getDefaultTemplateForCategory(category);
    var tpl = tplRes.success ? tplRes.data : null;

    var client = recipientInfo.client;
    var conn   = recipientInfo.connection;

    // Resolve VA gender for pronoun placeholders
    var vaData = {};
    try { var vaRes2 = getVAById(conn.vaId); if (vaRes2 && vaRes2.success) vaData = vaRes2.data; } catch(e2){}
    var gender2 = vaData.gender || '';
    var heShe2  = gender2 === 'Male' ? 'he'  : gender2 === 'Female' ? 'she'  : '{{heShe}}';
    var himHer2 = gender2 === 'Male' ? 'him' : gender2 === 'Female' ? 'her'  : '{{himHer}}';
    var hisHer2 = gender2 === 'Male' ? 'his' : gender2 === 'Female' ? 'her'  : '{{hisHer}}';

    var vars = {
      vaName: conn.vaName,
      vaBirthday: '',
      birthday: '', // alias — not applicable to anniversaries, kept empty rather than left unresolved
      clientName: client.primaryContact || client.accountName || client.companyName,
      accountName: client.accountName || client.companyName,
      years: occ ? occ.years : '',
      heShe: heShe2, himHer: himHer2, hisHer: hisHer2
    };

    var imageTag2 = (tpl && tpl.imageUrl) ? '<img src="' + tpl.imageUrl + '" alt="" style="display:block;max-width:100%;margin:16px auto;" />' : '';

    return {
      success: true,
      data: {
        templateId: tpl ? tpl.templateId : '',
        isHtml:  tpl ? !!tpl.isHtml : false,
        subject: tpl ? _mergeTemplate(tpl.subject, vars) : ('Celebrating ' + vars.years + ' Year(s) with ' + conn.vaName + '!'),
        body:    tpl ? _mergeTemplate(tpl.body.replace(/\{\{\s*imageUrl\s*\}\}/g, imageTag2), vars) : '',
        imageUrl: tpl ? (tpl.imageUrl || '') : '',
        to: recipientInfo.emails,
        accountName: vars.accountName
      }
    };
  } catch (e) {
    return { success: false, error: 'getAnniversaryEmailPreview: ' + e.message };
  }
}

// ── Sending ──────────────────────────────────────────────────────────
// Both send functions take the (possibly CS-edited) subject/body straight
// from the preview screen — nothing is re-merged server-side at send time,
// so what the CS sees in the editable box is exactly what goes out.

function sendBirthdayEmail(vaId, clientId, occasionYear, emailKind, subject, body, toOverride, isHtml) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var toList = toOverride && toOverride.length ? toOverride : [];
    if (!toList.length) return { success: false, error: 'No email address for this client.' };

    var mailOpts = { to: toList.join(','), subject: subject };
    if (isHtml) { mailOpts.htmlBody = body; } else { mailOpts.body = body; }
    MailApp.sendEmail(mailOpts);

    // Log with per-client key so each VA-Client row tracks independently.
    _logCelebrationEmail({
      occasionType: 'Birthday', vaId: vaId, clientId: clientId || '', connectionId: '',
      occasionYear: occasionYear, emailType: emailKind === 'followup' ? 'followup' : 'notify',
      subject: subject, body: body, recipients: toList.join(', ')
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: 'sendBirthdayEmail: ' + e.message };
  }
}

function sendAnniversaryEmail(connectionId, occasionYear, emailKind, subject, body, toOverride, isHtml) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var recipientInfo = _getClientEmailsForConnection(connectionId);
    var toList = (toOverride && toOverride.length) ? toOverride : recipientInfo.emails;
    if (!toList.length) return { success: false, error: 'This account has no contact email on file.' };

    var mailOpts2 = { to: toList.join(','), subject: subject };
    if (isHtml) { mailOpts2.htmlBody = body; } else { mailOpts2.body = body; }
    MailApp.sendEmail(mailOpts2);

    var conn = recipientInfo.connection;
    _logCelebrationEmail({
      occasionType: 'Anniversary', vaId: conn ? conn.vaId : '', clientId: recipientInfo.client.clientId, connectionId: connectionId,
      occasionYear: occasionYear, emailType: emailKind === 'followup' ? 'followup' : 'notify',
      subject: subject, body: body, recipients: toList.join(', ')
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: 'sendAnniversaryEmail: ' + e.message };
  }
}

function _logCelebrationEmail(opts) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = _celGetSheet(ss);
  var now = new Date();
  var id = generateID('CEL');
  var user = Session.getActiveUser().getEmail();
  sheet.appendRow([
    id, opts.occasionType, opts.vaId || '', opts.clientId || '', opts.connectionId || '',
    opts.occasionYear, opts.emailType, opts.templateId || '',
    opts.subject, opts.body, opts.recipients,
    now, user
  ]);
}