// ─────────────────────────────────────────
// MeetingService.gs — Account Check-in Meetings
// ─────────────────────────────────────────
// Redesigned 2026-06-24: meetings are now scheduled at the ACCOUNT level,
// not per VA Connection. One meeting per (ClientID, MeetingTypeID),
// generated once — from the account's FIRST VA connection to reach
// Started — and never regenerated when later VAs join the same account.
// Each meeting can have feedback (Concern or Good Feedback) logged per VA
// that's active on the account, via MeetingConcerns.
//
// Two sheets:
//   MeetingTypes — admin-configurable cadence (e.g. "1 Month Review", offset 30 days)
//   Meetings     — one scheduled instance per Account × active MeetingType

function _mtSheet(ss) {
  var s = (ss || SpreadsheetApp.getActiveSpreadsheet()).getSheetByName(CONFIG.SHEETS.MEETING_TYPES);
  if (!s) return null;
  return s;
}
function _mtgSheet(ss) {
  var activeSS = ss || SpreadsheetApp.getActiveSpreadsheet();
  var s = activeSS.getSheetByName(CONFIG.SHEETS.MEETINGS);
  if (!s) return null;
  // Self-healing migration: append any schema column missing from an
  // existing sheet (e.g. LinkedMeetingIDs added after this sheet existed).
  var schemaCols = CONFIG.SCHEMA.Meetings;
  var lastCol = s.getLastColumn();
  var currentCols = lastCol > 0 ? s.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  schemaCols.forEach(function (col) {
    if (currentCols.indexOf(col) === -1) {
      var newColIdx = s.getLastColumn() + 1;
      s.getRange(1, newColIdx).setValue(col);
      s.getRange(1, newColIdx).setBackground('#1e293b').setFontColor('#fff').setFontWeight('bold');
      currentCols.push(col);
    }
  });
  return s;
}
function _mHMap(headerRow) {
  var h = {};
  headerRow.forEach(function (col, i) { if (col) h[String(col)] = i; });
  return h;
}

// Add a calendar offset (day/week/month/year) to a base date, then push forward
// to the next business day if the result lands on a weekend. This is the standard
// convention for recurring check-ins: the cadence is calendar-based, but a meeting
// never gets scheduled on a Saturday/Sunday.
function _addOffsetSkippingWeekends(baseDate, value, unit) {
  var d = new Date(baseDate.getTime());
  value = Number(value) || 0;
  switch (String(unit || 'day').toLowerCase()) {
    case 'day':   d.setDate(d.getDate() + value); break;
    case 'week':  d.setDate(d.getDate() + value * 7); break;
    case 'month': d.setMonth(d.getMonth() + value); break;
    case 'year':  d.setFullYear(d.getFullYear() + value); break;
    default:      d.setDate(d.getDate() + value); break;
  }
  // If it lands on Sat (6) or Sun (0), roll forward to Monday
  var dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  return d;
}

// Calendar-days equivalent, for display/legacy purposes only (not used for scheduling math)
function _offsetToApproxDays(value, unit) {
  value = Number(value) || 0;
  switch (String(unit || 'day').toLowerCase()) {
    case 'day':   return value;
    case 'week':  return value * 7;
    case 'month': return Math.round(value * 30.4);
    case 'year':  return Math.round(value * 365.25);
    default:      return value;
  }
}

// ════════════════════════════════════════
// MEETING TYPES (admin/manager configuration)
// ════════════════════════════════════════
function getMeetingTypes() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtSheet(ss);
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _mHMap(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['TypeID']]) continue;
      rows.push(_mapMeetingType(data[i], h));
    }
    rows.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getMeetingTypes: ' + e.message };
  }
}

function _mapMeetingType(row, h) {
  function get(col) { return h[col] !== undefined ? row[h[col]] : ''; }
  // Preserve a genuinely blank OffsetValue as null (no offset configured / ad-hoc type)
  // rather than coercing it to 0, since 0 is itself a meaningful offset ("meet on start day").
  var rawOffsetVal = get('OffsetValue');
  var offsetValueParsed = (rawOffsetVal === '' || rawOffsetVal === null || rawOffsetVal === undefined)
    ? null
    : Number(rawOffsetVal);
  return {
    typeId:      String(get('TypeID') || ''),
    label:       String(get('Label') || ''),
    shortName:   String(get('ShortName') || ''),
    offsetValue: offsetValueParsed,
    offsetUnit:  String(get('OffsetUnit') || 'day'),
    offsetDays:  Number(get('OffsetDays') || 0), // legacy/display fallback
    isActive:    get('IsActive') === true || get('IsActive') === 'true',
    sortOrder:   Number(get('SortOrder') || 0)
  };
}

function saveMeetingType(payload) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators and Managers can manage meeting types.' };
    if (!payload || !payload.label || !String(payload.label).trim()) {
      return { success: false, error: 'Label is required.' };
    }
    var validUnits = ['day', 'week', 'month', 'year'];
    var unit = String(payload.offsetUnit || 'day').toLowerCase();
    if (validUnits.indexOf(unit) === -1) {
      return { success: false, error: 'Offset unit must be day, week, month, or year.' };
    }
    var offsetValueNum = (payload.offsetValue === undefined || payload.offsetValue === null || payload.offsetValue === '')
      ? null // meetings with no offset are allowed (e.g. ad-hoc / on-demand types)
      : Number(payload.offsetValue);
    if (offsetValueNum !== null && (isNaN(offsetValueNum) || offsetValueNum < 0)) {
      return { success: false, error: 'Offset value must be a non-negative number, or left blank for no offset.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtSheet(ss);
    if (!sheet) return { success: false, error: 'MeetingTypes sheet not found. Run initializeSystem().' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    var now = new Date();
    var approxDays = offsetValueNum !== null ? _offsetToApproxDays(offsetValueNum, unit) : '';
    var shortName = payload.shortName ? String(payload.shortName).trim().toUpperCase() : '';

    if (payload.typeId) {
      // Update existing
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][h['TypeID']]) !== payload.typeId) continue;
        var rowNum = i + 1;
        sheet.getRange(rowNum, h['Label'] + 1).setValue(String(payload.label).trim());
        if (h['ShortName'] !== undefined)   sheet.getRange(rowNum, h['ShortName'] + 1).setValue(shortName);
        if (h['OffsetValue'] !== undefined) sheet.getRange(rowNum, h['OffsetValue'] + 1).setValue(offsetValueNum === null ? '' : offsetValueNum);
        if (h['OffsetUnit'] !== undefined)  sheet.getRange(rowNum, h['OffsetUnit'] + 1).setValue(unit);
        if (h['OffsetDays'] !== undefined)  sheet.getRange(rowNum, h['OffsetDays'] + 1).setValue(approxDays);
        if (payload.isActive !== undefined) sheet.getRange(rowNum, h['IsActive'] + 1).setValue(!!payload.isActive);
        if (payload.sortOrder !== undefined) sheet.getRange(rowNum, h['SortOrder'] + 1).setValue(Number(payload.sortOrder));
        sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(now);
        sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);
        return { success: true, typeId: payload.typeId };
      }
      return { success: false, error: 'Meeting type not found.' };
    }

    // Create new
    var id = generateID('MTY');
    var nextSort = data.length; // simple incrementing order
    var row = data[0].map(function () { return ''; });
    var cm = {
      'TypeID': id, 'Label': String(payload.label).trim(), 'ShortName': shortName,
      'OffsetValue': offsetValueNum === null ? '' : offsetValueNum,
      'OffsetUnit': unit,
      'OffsetDays': approxDays,
      'IsActive': payload.isActive !== undefined ? !!payload.isActive : true,
      'SortOrder': payload.sortOrder !== undefined ? Number(payload.sortOrder) : nextSort,
      'CreatedAt': now, 'CreatedBy': perm.user.email,
      'UpdatedAt': now, 'UpdatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function (col) { if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    return { success: true, typeId: id };
  } catch (e) {
    return { success: false, error: 'saveMeetingType: ' + e.message };
  }
}

function deleteMeetingType(typeId) {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators and Managers can manage meeting types.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtSheet(ss);
    if (!sheet) return { success: false, error: 'MeetingTypes sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['TypeID']]) !== typeId) continue;
      // Soft-delete: deactivate rather than remove, so historical Meetings rows still resolve
      sheet.getRange(i + 1, h['IsActive'] + 1).setValue(false);
      sheet.getRange(i + 1, h['UpdatedAt'] + 1).setValue(new Date());
      sheet.getRange(i + 1, h['UpdatedBy'] + 1).setValue(perm.user.email);
      return { success: true };
    }
    return { success: false, error: 'Meeting type not found.' };
  } catch (e) {
    return { success: false, error: 'deleteMeetingType: ' + e.message };
  }
}

// ════════════════════════════════════════
// MEETINGS — auto-generation from a VA connection's ActualStartDate
// ════════════════════════════════════════

// Called from VAConnectionService whenever ActualStartDate is set/changed on a connection.
// Generates one Meetings row per active MeetingType, skipping any that already exist
// for this connection + type (idempotent — safe to call multiple times).
// Generates the account's standard meeting schedule, anchored to the start
// date of whichever VA connection triggered it. Only ever runs ONCE per
// account: if `clientId` already has any meetings on file, this is a no-op
// (returns success with created:0) — a second, third, etc. VA starting on
// the same account does not get its own schedule or reset the existing one.
// `activeConnectionIds` is a snapshot of every VA connection active on the
// account at generation time, stored on each meeting so the per-VA
// feedback log always knows which VAs that meeting concerns.
// ── Connection-level meeting generation (new model) ────────────────────
// Generates one full meeting cadence per VA Connection, anchored to that
// connection's actual start date. Each meeting row records:
//   - AnchorConnectionID: the specific connection this meeting belongs to
//   - ClientID / CustomerID: kept for account-level grouping in the UI
//   - VAName: snapshotted at generation time (for display without a join)
//
// Guard: if this connection already has any meeting rows, returns early —
// re-generation only happens via resetAndRegenerateMeetings().
function generateMeetingsForConnection(connectionId, clientId, customerId, vaName, requestId, startDate) {
  try {
    if (!connectionId || !startDate) return { success: false, error: 'connectionId and startDate are required.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    _ensureSheet(ss, CONFIG.SHEETS.MEETING_TYPES, CONFIG.SCHEMA.MeetingTypes);
    _ensureSheet(ss, CONFIG.SHEETS.MEETINGS, CONFIG.SCHEMA.Meetings);
    _migrateSheetColumns(ss, CONFIG.SHEETS.MEETINGS, CONFIG.SCHEMA.Meetings);

    var sheet = _mtgSheet(ss);
    var data  = sheet.getDataRange().getValues();
    var h     = _mHMap(data[0]);

    // Per the report — this used to be all-or-nothing: if any meeting
    // existed for this account, the whole function skipped, never
    // adding a cadence that was genuinely missing (e.g. Y2). Now checks
    // which specific cadences (by MeetingTypeID) already exist for this
    // account, and only generates the ones that are actually absent —
    // existing records are never touched or duplicated.
    var existingTypeIds = {};
    if (h['ClientID'] !== undefined && h['MeetingTypeID'] !== undefined) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][h['ClientID']] || '') !== clientId) continue;
        existingTypeIds[String(data[i][h['MeetingTypeID']] || '')] = true;
      }
    }

    var typesRes = getMeetingTypes();
    var activeTypes = (typesRes.success ? typesRes.data : []).filter(function(t) { return t.isActive; });
    if (!activeTypes.length) return { success: true, created: 0 };

    var baseDate = new Date(startDate);
    var now      = new Date();
    var created  = 0;

    // Process in actual cadence order (by offset), not whatever order
    // getMeetingTypes() happened to return — otherwise "the earliest one
    // is Upcoming, the rest are Pending" below could pick the wrong one.
    var orderedTypes = activeTypes.filter(function(t) { return t.offsetValue !== null && !isNaN(t.offsetValue); })
      .filter(function(t) { return !existingTypeIds[t.typeId]; })
      .sort(function(a,b) { return a.offsetValue - b.offsetValue; });

    // Per the request — this used to generate every missing cadence at
    // once. Now generates only the single next one due (the lowest
    // offset still missing) — the rest are added progressively, one at
    // a time, only once the prior cadence is actually marked Completed
    // (see the new trigger in updateMeeting).
    var nextType = orderedTypes[0];
    if (nextType) {
      var schedDate = _addOffsetSkippingWeekends(baseDate, nextType.offsetValue, nextType.offsetUnit);
      var id  = generateID('MTG');
      var row = data[0].map(function(){ return ''; });
      var cm  = {
        'MeetingID':            id,
        'ClientID':             clientId       || '',
        'CustomerID':           customerId     || '',
        'AnchorConnectionID':   connectionId,
        'ActiveVAConnectionIDs':connectionId,   // snapshot: this connection only
        'MeetingTypeID':        nextType.typeId,
        'MeetingTypeLabel':     nextType.label,
        'ScheduledDate':        schedDate,
        'OriginalScheduledDate':schedDate,
        // The single cadence generated here is always the next one
        // due, so it's always the account's own "what's next" —
        // Upcoming, never Pending, regardless of whether this is a
        // brand-new schedule or a later one appended after a prior
        // cadence completed.
        'Status':               'Upcoming',
        'Notes':                '',
        'RiskFlag':             false,
        'RiskReason':           '',
        'AssignedTo':           vaName || '',   // surface VA name in AssignedTo for UI access
        'CreatedAt':            now,
        'CreatedBy':            'system',
        'UpdatedAt':            now,
        'UpdatedBy':            'system'
      };
      Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
      sheet.appendRow(row);
      created++;
    }

    return { success: true, created: created };
  } catch (e) {
    return { success: false, error: 'generateMeetingsForConnection: ' + e.message };
  }
}

// Legacy account-level wrapper — kept so existing call sites in VAConnectionService
// (triggered when a connection reaches Started) still work. Delegates to the
// new per-connection function for each active connection on the account.
function generateMeetingsForAccount(clientId, customerId, anchorConnectionId, requestId, startDate, activeConnectionIds) {
  try {
    if (!clientId || !startDate || !anchorConnectionId) return { success: false, error: 'clientId, anchorConnectionId and startDate are required.' };

    // Only generate for the anchor connection — the caller passes the one that
    // just reached Started. Other connections on this account will have already
    // had their own cadence generated when THEY reached Started.
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var vaName = '';
    if (connSheet) {
      var cd = connSheet.getDataRange().getValues();
      var vh = _mHMap(cd[0]);
      for (var ci = 1; ci < cd.length; ci++) {
        if (String(cd[ci][vh['ConnectionID']] || '') === anchorConnectionId) {
          vaName = String(cd[ci][vh['VAName']] || '');
          break;
        }
      }
    }

    return generateMeetingsForConnection(anchorConnectionId, clientId, customerId, vaName, requestId, startDate);
  } catch (e) {
    return { success: false, error: 'generateMeetingsForAccount: ' + e.message };
  }
}

// Keeps each meeting's ActiveVAConnectionIDs snapshot current as VAs join or
// leave the account after the schedule was first generated — called whenever
// a connection on this account changes Started/Terminated status. Only
// touches meetings that are still Upcoming/Rescheduled (a meeting that
// already happened keeps the VA list as it was AT THAT TIME, which is the
// historically accurate record of who the conversation was actually about).
function _syncActiveVAsOnUpcomingMeetings(clientId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    var h = _mHMap(data[0]);
    if (h['ClientID'] === undefined || h['ActiveVAConnectionIDs'] === undefined) return;

    var connRes = getVAConnections({});
    var activeIds = (connRes.success ? connRes.data : [])
      .filter(function (c) { return c.clientId === clientId && c.connectionStatus === CONFIG.VA_CONNECTION_STATUS.STARTED; })
      .map(function (c) { return c.connectionId; });
    var activeIdsStr = activeIds.join(',');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']] || '') !== clientId) continue;
      var status = String(data[i][h['Status']] || '');
      if (status !== 'Upcoming' && status !== 'Rescheduled') continue;
      sheet.getRange(i + 1, h['ActiveVAConnectionIDs'] + 1).setValue(activeIdsStr);
    }
  } catch (e) {
    Logger.log('_syncActiveVAsOnUpcomingMeetings: ' + e.message);
  }
}

// One-time admin action: generate the standard meeting schedule for every
// Account that has at least one currently-Started VA connection but no
// meetings yet (predates this module, or was created before meeting
// auto-generation existed). Anchors each account's schedule to whichever
// of its Started connections has the EARLIEST ActualStartDate.
function backfillMeetingsForActiveConnections() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators and Managers can run this.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!connSheet) return { success: false, error: 'VAConnections sheet not found.' };

    var data = connSheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, accountsProcessed: 0, meetingsCreated: 0 };
    var h = _buildHeaderMap(data[0]);

    var startedStatus = (CONFIG.VA_CONNECTION_STATUS && CONFIG.VA_CONNECTION_STATUS.STARTED) || 'Started';

    // Group Started connections by ClientID, tracking the earliest start date per account.
    var byClient = {}; // clientId -> { earliest: {date, connectionId, customerId, requestId}, activeIds: [] }
    for (var i = 1; i < data.length; i++) {
      var connId = String(data[i][h['ConnectionID']] || '');
      if (!connId) continue;
      if (String(data[i][h['ConnectionStatus']] || '') !== startedStatus) continue;
      var startDate = data[i][h['ActualStartDate']];
      if (!startDate) continue;
      var clientId = String(data[i][h['ClientID']] || '');
      if (!clientId) continue;

      if (!byClient[clientId]) byClient[clientId] = { earliest: null, activeIds: [] };
      byClient[clientId].activeIds.push(connId);
      var d = startDate instanceof Date ? startDate : new Date(startDate);
      if (!byClient[clientId].earliest || d < byClient[clientId].earliest.date) {
        byClient[clientId].earliest = {
          date: d, connectionId: connId,
          customerId: String(data[i][h['CustomerID']] || ''),
          requestId:  String(data[i][h['RequestID']]  || '')
        };
      }
    }

    var processed = 0, totalCreated = 0, errors = [];
    Object.keys(byClient).forEach(function (clientId) {
      var info = byClient[clientId];
      processed++;
      try {
        var res = generateMeetingsForAccount(
          clientId, info.earliest.customerId, info.earliest.connectionId,
          info.earliest.requestId, info.earliest.date, info.activeIds
        );
        if (res && res.success) totalCreated += (res.created || 0);
        else if (res && res.error) errors.push(clientId + ': ' + res.error);
      } catch (innerErr) {
        errors.push(clientId + ': ' + innerErr.message);
      }
    });

    return {
      success: true,
      accountsProcessed: processed,
      meetingsCreated: totalCreated,
      errors: errors
    };
  } catch (e) {
    return { success: false, error: 'backfillMeetingsForActiveConnections: ' + e.message };
  }
}

function getMeetings(filters) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _mHMap(data[0]);
    filters = filters || {};
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['MeetingID']]) continue;
      var rec = _mapMeeting(data[i], h);
      if (filters.customerId && rec.customerId !== filters.customerId) continue;
      if (filters.clientId   && rec.clientId   !== filters.clientId)   continue;
      if (filters.status     && rec.status     !== filters.status)     continue;
      rows.push(rec);
    }
    rows.sort(function (a, b) { return new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0); });
    _enrichMeetingRows(ss, rows);
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getMeetings: ' + e.message };
  }
}

// Per the request — all flagged (at-risk) meetings, reusing getMeetings'
// own enrichment (customer/client names) rather than duplicating it.
// sinceDate, when passed, restricts to meetings scheduled on/after that
// date — used by the Dashboard's "past 14 days" view.
function getFlaggedMeetings(filters) {
  try {
    var allRes = getMeetings({});
    if (!allRes.success) return allRes;
    var rows = allRes.data.filter(function(r) { return r.riskFlag; });
    filters = filters || {};
    if (filters.sinceDate) {
      var sinceMs = new Date(filters.sinceDate).getTime();
      rows = rows.filter(function(r) { return new Date(r.scheduledDate||0).getTime() >= sinceMs; });
    }
    rows.sort(function(a, b) { return new Date(b.scheduledDate||0) - new Date(a.scheduledDate||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getFlaggedMeetings: ' + e.message };
  }
}

// Records a CS Manager's intervention in response to a flagged meeting's
// own concern (RiskReason), per the request.
function addMeetingIntervention(meetingId, interventionNotes) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (perm.user.role !== 'CS Manager' && perm.user.role !== 'Administrator') {
      return { success: false, error: 'Only a CS Manager or Administrator can add an intervention.' };
    }
    if (!interventionNotes || !interventionNotes.trim()) {
      return { success: false, error: 'Intervention notes are required.' };
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: false, error: 'Meetings sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['MeetingID']]||'') !== meetingId) continue;
      if (!_toBool(data[i][h['RiskFlag']])) return { success: false, error: 'This meeting is not flagged.' };
      if (h['InterventionNotes'] !== undefined) sheet.getRange(i+1, h['InterventionNotes']+1).setValue(interventionNotes.trim());
      if (h['InterventionBy'] !== undefined) sheet.getRange(i+1, h['InterventionBy']+1).setValue(perm.user.email);
      if (h['InterventionAt'] !== undefined) sheet.getRange(i+1, h['InterventionAt']+1).setValue(new Date());
      return { success: true };
    }
    return { success: false, error: 'Meeting not found.' };
  } catch (e) {
    return { success: false, error: 'addMeetingIntervention: ' + e.message };
  }
}

// Join customerName / accountName onto a list of mapped meeting rows in a single pass
function _enrichMeetingRows(ss, rows) {
  if (!rows.length) return;
  try {
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var custMap = {};
    if (custSheet) {
      var custData = custSheet.getDataRange().getValues();
      var ch = _buildHeaderMap(custData[0]);
      for (var i = 1; i < custData.length; i++) {
        var cid = String(custData[i][ch['CustomerID']] || '');
        if (cid) custMap[cid] = String(custData[i][ch['CustomerName']] || '');
      }
    }
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var cliMap = {};
    if (cliSheet) {
      var cliData = cliSheet.getDataRange().getValues();
      var lh = _buildHeaderMap(cliData[0]);
      for (var j = 1; j < cliData.length; j++) {
        var clid = String(cliData[j][lh['ClientID']] || '');
        if (clid) cliMap[clid] = {
          name:       String(cliData[j][lh['CompanyName']] || ''),
          status:     String(cliData[j][lh['Status']]      || ''),
          customerId: String(cliData[j][lh['CustomerID']]  || '')
        };
      }
    }
    // CS Specialist from Customers sheet (keyed by customerId)
    var csMap = {};
    if (custSheet) {
      // Re-read custData for CS specialist field
      var custDataFull = custSheet.getDataRange().getValues();
      var chFull = _buildHeaderMap(custDataFull[0]);
      for (var ci2 = 1; ci2 < custDataFull.length; ci2++) {
        var cid2 = String(custDataFull[ci2][chFull['CustomerID']] || '');
        if (cid2) csMap[cid2] = String(custDataFull[ci2][chFull['AssignedSpecialist']] || '');
      }
    }
    // VA connection data: keyed by ConnectionID for direct lookups,
    // and by ClientID for fallback when AnchorConnectionID is empty.
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var connNameMap = {}, connStartMap = {};
    var connsByClient = {}; // clientId -> [{ connectionId, vaName, startDate }]
    if (connSheet) {
      var connData = connSheet.getDataRange().getValues();
      var vh = _buildHeaderMap(connData[0]);
      for (var k = 1; k < connData.length; k++) {
        var connId = String(connData[k][vh['ConnectionID']] || '');
        if (!connId) continue;
        var vName  = String(connData[k][vh['VAName']] || '');
        var vStart = _sd(connData[k][vh['ActualStartDate']]);
        var vStatus= String(connData[k][vh['ConnectionStatus']] || '');
        var vClientId = String(connData[k][vh['ClientID']] || '');
        connNameMap[connId]  = vName;
        connStartMap[connId] = vStart;
        // Index started connections by client for the fallback
        if (vStatus === CONFIG.VA_CONNECTION_STATUS.STARTED && vClientId) {
          if (!connsByClient[vClientId]) connsByClient[vClientId] = [];
          connsByClient[vClientId].push({ connectionId: connId, vaName: vName, startDate: vStart });
        }
      }
    }
    rows.forEach(function (r) {
      r.customerName      = custMap[r.customerId] || '';
      var cliInfo         = cliMap[r.clientId] || {};
      r.accountName       = cliInfo.name   || '';
      r.accountStatus     = cliInfo.status || '';
      r.csAssigned        = csMap[r.customerId] || '';
      r.vaName            = r.assignedTo || connNameMap[r.anchorConnectionId] || '';
      r.anchorVAStartDate = connStartMap[r.anchorConnectionId] || '';
      r.activeVAs = (r.activeVAConnectionIds || []).map(function (connId) {
        return { connectionId: connId, vaName: connNameMap[connId] || connId };
      });
      r.clientConnections = connsByClient[r.clientId] || [];
    });
  } catch (e) {
    Logger.log('_enrichMeetingRows: ' + e.message);
  }
}

function getMeetingById(meetingId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: false, error: 'Meetings sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['MeetingID']]) !== meetingId) continue;
      var rec = _mapMeeting(data[i], h);
      _enrichMeetingRows(ss, [rec]);
      return { success: true, data: rec };
    }
    return { success: false, error: 'Meeting not found.' };
  } catch (e) {
    return { success: false, error: 'getMeetingById: ' + e.message };
  }
}

function _mapMeeting(row, h) {
  function get(col) {
    if (h[col] === undefined) return '';
    var v = row[h[col]];
    if (v instanceof Date) return v.toISOString();
    return v == null ? '' : v;
  }
  return {
    meetingId:             String(get('MeetingID') || ''),
    clientId:              String(get('ClientID') || ''),
    customerId:            String(get('CustomerID') || ''),
    anchorConnectionId:    String(get('AnchorConnectionID') || ''),
    activeVAConnectionIds: String(get('ActiveVAConnectionIDs') || '').split(',').map(function(s){return s.trim();}).filter(Boolean),
    meetingTypeId:         String(get('MeetingTypeID') || ''),
    meetingTypeLabel:      String(get('MeetingTypeLabel') || ''),
    scheduledDate:         get('ScheduledDate'),
    originalScheduledDate: get('OriginalScheduledDate'),
    status:                String(get('Status') || 'No Data'),
    notes:                 String(get('Notes') || ''),
    riskFlag:              _toBool(get('RiskFlag')),
    riskReason:            String(get('RiskReason') || ''),
    interventionNotes:     String(get('InterventionNotes') || ''),
    interventionBy:        String(get('InterventionBy') || ''),
    interventionAt:        get('InterventionAt'),
    assignedTo:            String(get('AssignedTo') || ''),
    scheduleEmailSentAt:   get('ScheduleEmailSentAt'),
    scheduleEmailSentBy:   String(get('ScheduleEmailSentBy') || ''),
    createdAt:             get('CreatedAt'),
    updatedAt:             get('UpdatedAt')
  };
}

// Reschedule — keeps OriginalScheduledDate intact for audit, updates ScheduledDate
function rescheduleMeeting(meetingId, newDate, reason) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!newDate) return { success: false, error: 'New date is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: false, error: 'Meetings sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['MeetingID']]) !== meetingId) continue;
      var rowNum = i + 1;
      var parsed = new Date(newDate);
      if (isNaN(parsed.getTime())) return { success: false, error: 'Invalid date.' };

      sheet.getRange(rowNum, h['ScheduledDate'] + 1).setValue(parsed);
      sheet.getRange(rowNum, h['Status'] + 1).setValue('Rescheduled');
      var existingNotes = String(data[i][h['Notes']] || '');
      var noteAdd = '[Rescheduled to ' + parsed.toDateString() + (reason ? ' — ' + reason : '') + ']';
      sheet.getRange(rowNum, h['Notes'] + 1).setValue(existingNotes ? existingNotes + '\n' + noteAdd : noteAdd);
      sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(new Date());
      sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);
      _writeLog('Meeting', meetingId, 'RESCHEDULE', 'ScheduledDate', '', parsed.toISOString(), perm.user);
      return { success: true };
    }
    return { success: false, error: 'Meeting not found.' };
  } catch (e) {
    return { success: false, error: 'rescheduleMeeting: ' + e.message };
  }
}

// Retired 2026-06-24: linkMeetingsTogether / unlinkMeetingFromGroup existed
// to merge multiple VAs' separate per-connection meetings into one session.
// At the account level there's only ever one meeting per account per type,
// so there's nothing left to combine — removed along with the "Combine with
// Other VA Meetings" UI action.

// Log meeting notes / mark complete / flag risk — single combined update endpoint
// Per the request — the progressive trigger: called whenever a meeting
// is marked Completed. If it was this account's own most-recent cadence
// so far (nothing with a later offset already exists), the next missing
// cadence is generated now, using the original anchor connection's own
// start date as the base — the same date the whole schedule is offset
// from, so a later cadence lands on the correct calendar date.
function _mtgGenerateNextCadenceIfDue(ss, completedRow, h) {
  try {
    var clientId = h['ClientID'] !== undefined ? String(completedRow[h['ClientID']]||'') : '';
    var completedTypeId = h['MeetingTypeID'] !== undefined ? String(completedRow[h['MeetingTypeID']]||'') : '';
    var anchorConnId = h['AnchorConnectionID'] !== undefined ? String(completedRow[h['AnchorConnectionID']]||'') : '';
    if (!clientId || !completedTypeId || !anchorConnId) return;

    var typesRes = getMeetingTypes();
    var activeTypes = (typesRes.success ? typesRes.data : []).filter(function(t) { return t.isActive && t.offsetValue !== null && !isNaN(t.offsetValue); });
    if (!activeTypes.length) return;
    var sortOrderById = {}; activeTypes.forEach(function(t){ sortOrderById[t.typeId] = t.offsetValue; });
    var completedOffset = sortOrderById[completedTypeId];
    if (completedOffset === undefined) return; // not a known offset-based cadence — nothing to advance

    // Only advance if this really was the latest cadence for the
    // account — if a later one already exists (e.g. this Completed
    // event is for an out-of-order/backfilled meeting), don't generate
    // anything on top of it.
    var mtgSheet = _mtgSheet(ss);
    var mtgData = mtgSheet.getDataRange().getValues();
    var mh = _mHMap(mtgData[0]);
    for (var i = 1; i < mtgData.length; i++) {
      if (String(mtgData[i][mh['ClientID']]||'') !== clientId) continue;
      var otherTypeId = String(mtgData[i][mh['MeetingTypeID']]||'');
      var otherOffset = sortOrderById[otherTypeId];
      if (otherOffset === undefined) continue;
      if (otherOffset > completedOffset) return; // a later cadence already exists — nothing to do
    }

    // Look up the anchor connection's own original start date — the
    // fixed point the whole schedule's offsets are calculated from.
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!connSheet) return;
    var connData = connSheet.getDataRange().getValues();
    var ch = {}; connData[0].forEach(function(c,idx){ if(c) ch[String(c)]=idx; });
    for (var ci = 1; ci < connData.length; ci++) {
      if (String(connData[ci][ch['ConnectionID']]||'') !== anchorConnId) continue;
      var startRaw = connData[ci][ch['ActualStartDate']] || connData[ci][ch['AssignedAt']];
      if (!startRaw) return;
      var startDate = startRaw instanceof Date ? startRaw : new Date(startRaw);
      if (isNaN(startDate.getTime())) return;
      var customerId = String(connData[ci][ch['CustomerID']]||'');
      var vaName     = String(connData[ci][ch['VAName']]||'');
      var requestId  = String(connData[ci][ch['RequestID']]||'');
      generateMeetingsForConnection(anchorConnId, clientId, customerId, vaName, requestId, startDate);
      return;
    }
  } catch (e) {
    Logger.log('_mtgGenerateNextCadenceIfDue: ' + e.message);
  }
}

function updateMeeting(meetingId, payload) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: false, error: 'Meetings sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['MeetingID']]) !== meetingId) continue;
      _applyMeetingUpdateToRow(sheet, h, i + 1, payload, perm.user);
      if (payload.riskFlag) {
        _writeLog('Meeting', meetingId, 'RISK_FLAGGED', '', '', String(payload.riskReason || ''), perm.user);
      }
      if (payload.status === 'Completed') {
        _mtgSupersedeEarlierRescheduled(ss, sheet, data, h, i, meetingId);
        _mtgGenerateNextCadenceIfDue(ss, data[i], h);
      }
      return { success: true };
    }
    return { success: false, error: 'Meeting not found.' };
  } catch (e) {
    return { success: false, error: 'updateMeeting: ' + e.message };
  }
}

// Per the request — when a meeting is marked Completed, any earlier
// cadence for the same account (e.g. W2 before M1, by MeetingTypes'
// SortOrder) that's still sitting in Rescheduled status gets marked
// Superseded, since the later cadence already happening makes it moot.
// Only ever touches a meeting currently in Rescheduled status.
function _mtgSupersedeEarlierRescheduled(ss, sheet, data, h, completedRowIdx, completedMeetingId) {
  try {
    var anchorConnId = String(data[completedRowIdx][h['AnchorConnectionID']] || '');
    var completedTypeId = String(data[completedRowIdx][h['MeetingTypeID']] || '');
    if (!anchorConnId || !completedTypeId) return;

    var typeSheet = ss.getSheetByName(CONFIG.SHEETS.MEETING_TYPES);
    if (!typeSheet) return;
    var typeData = typeSheet.getDataRange().getValues();
    var typeH = {}; typeData[0].forEach(function(c,idx){ if(c) typeH[String(c)]=idx; });
    var sortOrderByTypeId = {};
    for (var ti = 1; ti < typeData.length; ti++) {
      var tId = String(typeData[ti][typeH['TypeID']]||''); if (!tId) continue;
      sortOrderByTypeId[tId] = Number(typeData[ti][typeH['SortOrder']]||0);
    }
    var completedSortOrder = sortOrderByTypeId[completedTypeId];
    if (completedSortOrder === undefined) return;

    for (var mi = 1; mi < data.length; mi++) {
      if (mi === completedRowIdx) continue;
      if (String(data[mi][h['AnchorConnectionID']]||'') !== anchorConnId) continue;
      if (String(data[mi][h['Status']]||'') !== 'Rescheduled') continue;
      var otherTypeId = String(data[mi][h['MeetingTypeID']]||'');
      var otherSortOrder = sortOrderByTypeId[otherTypeId];
      if (otherSortOrder === undefined || otherSortOrder >= completedSortOrder) continue;
      sheet.getRange(mi + 1, h['Status'] + 1).setValue('Superseded');
      sheet.getRange(mi + 1, h['UpdatedAt'] + 1).setValue(new Date());
      _writeLog('Meeting', String(data[mi][h['MeetingID']]||''), 'SUPERSEDED', 'Status', 'Rescheduled', 'Superseded', getCurrentUser(),
        null, 'Superseded by ' + completedMeetingId + ' (' + completedTypeId + ') being conducted.');
    }
  } catch (e) {
    Logger.log('_mtgSupersedeEarlierRescheduled: ' + e.message);
  }
}

// Shared row-level writer used by updateMeeting.
function _applyMeetingUpdateToRow(sheet, h, rowNum, payload, user) {
  if (payload.notes !== undefined && h['Notes'] !== undefined) {
    sheet.getRange(rowNum, h['Notes'] + 1).setValue(String(payload.notes || ''));
  }
  if (payload.status !== undefined && h['Status'] !== undefined) {
    sheet.getRange(rowNum, h['Status'] + 1).setValue(String(payload.status || 'Upcoming'));
  }
  if (payload.scheduledDate !== undefined && h['ScheduledDate'] !== undefined) {
    var parsedSchedDate = _parseDateInput(payload.scheduledDate);
    if (!isNaN(parsedSchedDate.getTime())) sheet.getRange(rowNum, h['ScheduledDate'] + 1).setValue(parsedSchedDate);
  }
  if (payload.riskFlag !== undefined && h['RiskFlag'] !== undefined) {
    sheet.getRange(rowNum, h['RiskFlag'] + 1).setValue(!!payload.riskFlag);
  }
  if (payload.riskReason !== undefined && h['RiskReason'] !== undefined) {
    sheet.getRange(rowNum, h['RiskReason'] + 1).setValue(String(payload.riskReason || ''));
  }
  if (payload.assignedTo !== undefined && h['AssignedTo'] !== undefined) {
    sheet.getRange(rowNum, h['AssignedTo'] + 1).setValue(String(payload.assignedTo || ''));
  }
  sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(new Date());
  sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(user ? user.email : '');
}

// ════════════════════════════════════════
// MEETING FEEDBACK — per-VA Concern or Good Feedback, logged per meeting
// (formerly "Meeting Concerns" — extended to also capture positive feedback,
// since the new account-level meeting modal asks the CS to check Concern OR
// Good Feedback for each active VA, revealing a textbox either way)
// ════════════════════════════════════════
function _mcSheet(ss) {
  var activeSS = ss || SpreadsheetApp.getActiveSpreadsheet();
  var s = activeSS.getSheetByName(CONFIG.SHEETS.MEETING_CONCERNS);
  var schemaCols = CONFIG.SCHEMA.MeetingConcerns;
  if (!s) {
    s = activeSS.insertSheet(CONFIG.SHEETS.MEETING_CONCERNS);
    s.getRange(1, 1, 1, schemaCols.length).setValues([schemaCols]);
    s.getRange(1, 1, 1, schemaCols.length).setBackground('#1e293b').setFontColor('#fff').setFontWeight('bold');
    s.setFrozenRows(1);
    return s;
  }
  // Self-healing migration: append any schema column missing from an existing sheet
  var lastCol = s.getLastColumn();
  var currentCols = lastCol > 0 ? s.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  schemaCols.forEach(function (col) {
    if (currentCols.indexOf(col) === -1) {
      var newColIdx = s.getLastColumn() + 1;
      s.getRange(1, newColIdx).setValue(col);
      s.getRange(1, newColIdx).setBackground('#1e293b').setFontColor('#fff').setFontWeight('bold');
      currentCols.push(col);
    }
  });
  return s;
}

function _mapMeetingConcern(row, h) {
  function get(col) {
    if (h[col] === undefined) return '';
    var v = row[h[col]];
    if (v instanceof Date) return v.toISOString();
    return v == null ? '' : v;
  }
  return {
    concernId:    String(get('ConcernID') || ''),
    meetingId:    String(get('MeetingID') || ''),
    connectionId: String(get('ConnectionID') || ''),
    vaName:       String(get('VAName') || ''),
    feedbackType: String(get('FeedbackType') || CONFIG.MEETING_FEEDBACK_TYPE.CONCERN),
    details:      String(get('Details') || ''),
    status:       String(get('Status') || 'Open'),
    resolution:   String(get('Resolution') || ''),
    raisedBy:     String(get('RaisedBy') || ''),
    raisedAt:     get('RaisedAt'),
    resolvedBy:   String(get('ResolvedBy') || ''),
    resolvedAt:   get('ResolvedAt')
  };
}

// Every open (unresolved) Concern across ALL meetings — for the
// dashboard's Critical section (Administrator/CS Manager), showing which
// specific VA connections have been flagged at risk. Only Concerns count
// here, not Good Feedback — that's not a risk signal.
function getAllOpenMeetingConcerns() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mcSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _mHMap(data[0]);

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['ConcernID']]) continue;
      var mapped = _mapMeetingConcern(data[i], h);
      if (mapped.feedbackType !== CONFIG.MEETING_FEEDBACK_TYPE.CONCERN) continue;
      if (mapped.status !== 'Open') continue;
      rows.push(mapped);
    }
    if (!rows.length) return { success: true, data: [] };

    // Enrich with meeting date/type and customer/account — Concerns
    // themselves only carry connectionId/vaName, so this joins through
    // the meeting each one was raised on.
    var mtgSheet = _mtgSheet(ss);
    var mtgData = mtgSheet.getDataRange().getValues();
    var mtgH = _mHMap(mtgData[0]);
    var meetingById = {};
    for (var mi = 1; mi < mtgData.length; mi++) {
      var mid = String(mtgData[mi][mtgH['MeetingID']]||''); if (!mid) continue;
      meetingById[mid] = {
        meetingTypeLabel: String(mtgData[mi][mtgH['MeetingTypeLabel']]||''),
        scheduledDate:  mtgData[mi][mtgH['ScheduledDate']],
        clientId:       String(mtgData[mi][mtgH['ClientID']]||''),
        customerId:     String(mtgData[mi][mtgH['CustomerID']]||'')
      };
    }
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var cliLookup = {}, custLookup = {};
    if (cliSheet) {
      var cd = cliSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c,i){ if(c) ch[String(c).trim()]=i; });
      for (var ci = 1; ci < cd.length; ci++) {
        if (cd[ci][ch['ClientID']]) cliLookup[String(cd[ci][ch['ClientID']])] = { company: String(cd[ci][ch['CompanyName']]||''), account: String(cd[ci][ch['AccountName']]||'') };
      }
    }
    if (custSheet) {
      var kd = custSheet.getDataRange().getValues();
      var kh = {}; kd[0].forEach(function(c,i){ if(c) kh[String(c).trim()]=i; });
      for (var ki = 1; ki < kd.length; ki++) {
        if (kd[ki][kh['CustomerID']]) custLookup[String(kd[ki][kh['CustomerID']])] = String(kd[ki][kh['CustomerName']]||'');
      }
    }

    // Concerns only carry connectionId/vaName, not vaId directly — needed
    // by callers (e.g. Birthdays & Anniversaries' open-concern warning
    // icon) that key off vaId specifically. Joined via VAConnections.
    var vaIdByConnId = {};
    try {
      var connSheetForVaId = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
      if (connSheetForVaId) {
        var connDataForVaId = connSheetForVaId.getDataRange().getValues();
        var connHForVaId = {}; connDataForVaId[0].forEach(function(c,ix){ if(c) connHForVaId[String(c).trim()]=ix; });
        for (var vci = 1; vci < connDataForVaId.length; vci++) {
          var vcConnId = String(connDataForVaId[vci][connHForVaId['ConnectionID']]||''); if (!vcConnId) continue;
          vaIdByConnId[vcConnId] = String(connDataForVaId[vci][connHForVaId['VAID']]||'');
        }
      }
    } catch (vaIdEx) { Logger.log('getAllOpenMeetingConcerns vaId lookup: ' + vaIdEx.message); }

    rows.forEach(function(r) {
      var mtg = meetingById[r.meetingId] || {};
      r.meetingTypeLabel = mtg.meetingTypeLabel || '';
      r.meetingScheduledDate = mtg.scheduledDate instanceof Date ? mtg.scheduledDate.toISOString() : String(mtg.scheduledDate||'');
      var cli = cliLookup[mtg.clientId] || {};
      r.accountName  = cli.account || cli.company || '';
      r.customerName = custLookup[mtg.customerId] || '';
      r.vaId = vaIdByConnId[r.connectionId] || '';
    });

    rows.sort(function (a, b) { return new Date(b.raisedAt || 0) - new Date(a.raisedAt || 0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getAllOpenMeetingConcerns: ' + e.message };
  }
}

// Returns all concerns for a given meeting, most recent first
function getMeetingConcerns(meetingId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mcSheet(ss);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = _mHMap(data[0]);
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][h['ConcernID']]) continue;
      if (String(data[i][h['MeetingID']]) !== meetingId) continue;
      rows.push(_mapMeetingConcern(data[i], h));
    }
    rows.sort(function (a, b) { return new Date(b.raisedAt || 0) - new Date(a.raisedAt || 0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getMeetingConcerns: ' + e.message };
  }
}

// Log feedback (Concern or Good Feedback) about a specific active VA on this
// meeting. Both types are captured identically — the distinction only
// affects whether it goes through the Open/Resolved workflow afterward
// (Concerns do; Good Feedback is just a permanent log entry).
// Kept the original function name as an alias so nothing else needs to
// change its call site if it's referenced elsewhere by the old name.
function logMeetingFeedback(meetingId, connectionId, vaName, feedbackType, details) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!details || !String(details).trim()) {
      return { success: false, error: 'Please describe the feedback.' };
    }
    var validTypes = [CONFIG.MEETING_FEEDBACK_TYPE.CONCERN, CONFIG.MEETING_FEEDBACK_TYPE.GOOD, CONFIG.MEETING_FEEDBACK_TYPE.NEUTRAL];
    var type = validTypes.indexOf(feedbackType) !== -1 ? feedbackType : CONFIG.MEETING_FEEDBACK_TYPE.CONCERN;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mcSheet(ss);
    var hRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var h = _mHMap(hRow);
    var now = new Date();
    var id = generateID('MCN');

    var row = hRow.map(function () { return ''; });
    var cm = {
      'ConcernID': id, 'MeetingID': meetingId, 'ConnectionID': connectionId || '',
      'VAName': vaName || '', 'FeedbackType': type, 'Details': String(details).trim(),
      // Good Feedback and Neutral have no resolution workflow — mark them
      // 'Logged' so they never show up in an "Open" count alongside real
      // Concerns.
      'Status': type !== CONFIG.MEETING_FEEDBACK_TYPE.CONCERN ? 'Logged' : 'Open',
      'Resolution': '',
      'RaisedBy': perm.user.email, 'RaisedAt': now,
      'ResolvedBy': '', 'ResolvedAt': ''
    };
    Object.keys(cm).forEach(function (col) { if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);

    _writeLog('Meeting', meetingId, type === CONFIG.MEETING_FEEDBACK_TYPE.GOOD ? 'GOOD_FEEDBACK_LOGGED' : 'CONCERN_RAISED', '', '', String(details).trim(), perm.user);

    // Auto-create Concern tickets for both the client and the VA, per the
    // request — right away, not waiting for someone to manually file one.
    // This function doesn't otherwise have the meeting's ClientID/CustomerID
    // (only MeetingID/ConnectionID/VAName were passed in), so those are
    // looked up here specifically for building the two tickets.
    if (type === CONFIG.MEETING_FEEDBACK_TYPE.CONCERN) {
      try {
        var mtgSheetForTicket = _mtgSheet(ss);
        var mtgDataForTicket = mtgSheetForTicket.getDataRange().getValues();
        var mtgHForTicket = _mHMap(mtgDataForTicket[0]);
        var mtgClientId = '', mtgCustomerId = '';
        for (var mfi = 1; mfi < mtgDataForTicket.length; mfi++) {
          if (String(mtgDataForTicket[mfi][mtgHForTicket['MeetingID']]) !== meetingId) continue;
          mtgClientId = String(mtgDataForTicket[mfi][mtgHForTicket['ClientID']]||'');
          mtgCustomerId = String(mtgDataForTicket[mfi][mtgHForTicket['CustomerID']]||'');
          break;
        }
        var acctNameForTicket = '';
        if (mtgClientId) {
          var cliSheetForTicket = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
          if (cliSheetForTicket) {
            var cliDataForTicket = cliSheetForTicket.getDataRange().getValues();
            var cliHForTicket = {}; cliDataForTicket[0].forEach(function(c,i){ if(c) cliHForTicket[String(c)]=i; });
            for (var cfi = 1; cfi < cliDataForTicket.length; cfi++) {
              if (String(cliDataForTicket[cfi][cliHForTicket['ClientID']]||'') !== mtgClientId) continue;
              acctNameForTicket = String(cliDataForTicket[cfi][cliHForTicket['CompanyName']]||'') + (cliDataForTicket[cfi][cliHForTicket['AccountName']] ? ' — ' + String(cliDataForTicket[cfi][cliHForTicket['AccountName']]) : '');
              break;
            }
          }
        }
        var detailsTrimmed = String(details).trim();

        createInquiry({
          subject: 'Account Meeting Concern — ' + (acctNameForTicket || mtgClientId) + (vaName ? ' (' + vaName + ')' : ''),
          inquiryType: 'Account Meeting Concern',
          priority: 'High',
          customerId: mtgCustomerId,
          clientId: mtgClientId,
          relatedConnectionId: connectionId || '',
          relatedVAId: connectionId || '',
          relatedVAName: vaName || '',
          status: CONFIG.INQUIRY_STATUS.OPEN,
          firstMessage: detailsTrimmed
        });
      } catch (ticketEx) { Logger.log('logMeetingFeedback auto-ticket creation: ' + ticketEx.message); }
    }

    return { success: true, concernId: id };
  } catch (e) {
    return { success: false, error: 'logMeetingFeedback: ' + e.message };
  }
}
// Backward-compatible alias — older call sites passing (meetingId, connectionId, vaName, details)
// without a feedbackType still work and default to Concern.
function raiseMeetingConcern(meetingId, connectionId, vaName, details) {
  return logMeetingFeedback(meetingId, connectionId, vaName, CONFIG.MEETING_FEEDBACK_TYPE.CONCERN, details);
}

// Resolve a concern, logging the corrections/resolution that were provided.
function resolveMeetingConcern(concernId, resolution) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!resolution || !String(resolution).trim()) {
      return { success: false, error: 'Please describe the correction/resolution provided.' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mcSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConcernID']]) !== concernId) continue;
      var rowNum = i + 1;
      sheet.getRange(rowNum, h['Status'] + 1).setValue('Resolved');
      sheet.getRange(rowNum, h['Resolution'] + 1).setValue(String(resolution).trim());
      sheet.getRange(rowNum, h['ResolvedBy'] + 1).setValue(perm.user.email);
      sheet.getRange(rowNum, h['ResolvedAt'] + 1).setValue(new Date());
      _writeLog('Meeting', String(data[i][h['MeetingID']] || ''), 'CONCERN_RESOLVED', '', '', String(resolution).trim(), perm.user);
      return { success: true };
    }
    return { success: false, error: 'Concern not found.' };
  } catch (e) {
    return { success: false, error: 'resolveMeetingConcern: ' + e.message };
  }
}

// Remove a concern that was raised in error.
function deleteMeetingConcern(concernId) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mcSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConcernID']]) !== concernId) continue;
      var meetingIdForLog = String(data[i][h['MeetingID']] || '');
      sheet.deleteRow(i + 1);
      _writeLog('Meeting', meetingIdForLog, 'CONCERN_REMOVED', '', concernId, '', perm.user);
      return { success: true };
    }
    return { success: false, error: 'Concern not found.' };
  } catch (e) {
    return { success: false, error: 'deleteMeetingConcern: ' + e.message };
  }
}

// ── One-time meeting schedule reset and regeneration ──────────────────
// Deletes ALL existing meeting rows and rebuilds from scratch — one full
// cadence per Started VA Connection, anchored to that connection's own
// ActualStartDate. This is a destructive, admin-only operation — any
// manually-rescheduled dates, meeting notes, concern flags, and
// "Completed" records are permanently lost. The confirmation UI on the
// frontend must make this very clear.
//
// Logic per VA Connection:
//   1. Skip anything on a Terminated/Cancelled account, or not currently
//      Started (Pending, Paused, etc. don't get a meeting cadence).
//   2. Anchor on that connection's own ActualStartDate; fall back to
//      AssignedAt if the actual-start field was never populated.
//   3. Call generateMeetingsForConnection() with that anchor date — every
//      VA Connection on an account gets its own independent cadence, not
//      a single shared one based on whichever VA started earliest.
//
// Returns: { success, deleted, generated, skipped, errors[] }
function resetAndRegenerateMeetings(onlyMissing) {
  try {
    var perm = checkPermission('admin');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can reset the meeting schedule.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var deleted = 0;

    if (!onlyMissing) {
      // Step 1 (full reset only): delete all existing meeting rows. Sheets
      // refuses to delete every remaining row below the header/frozen rows
      // ("not possible to delete all non-frozen rows") — deleteRows(
      // firstDataRow, lastRow - firstDataRow + 1) does exactly that
      // whenever the sheet has no extra blank rows beyond its data
      // (lastRow == the sheet's actual row count). Always leave the very
      // last row physically in place — clear its contents instead of
      // deleting it — so there's always at least one non-frozen row
      // remaining no matter how many rows there were.
      //
      // Skipped entirely in onlyMissing mode — nothing gets deleted, so
      // any connection that already has a meeting keeps everything about
      // it exactly as-is (manually rescheduled dates, notes, concerns).
      // generateMeetingsForConnection's own "already scheduled" guard
      // below then naturally only generates for connections with zero
      // meetings, since it checks the sheet's current (untouched) state.
      var mtgSheet    = _mtgSheet(ss);
      var lastRow     = mtgSheet.getLastRow();
      var frozenRows  = mtgSheet.getFrozenRows();
      // Always keep at least the header row (row 1); frozenRows may be > 1.
      var firstDataRow = Math.max(2, frozenRows + 1);
      if (lastRow >= firstDataRow) {
        deleted = lastRow - firstDataRow + 1;
        if (lastRow > firstDataRow) {
          // More than one row to clear — delete everything except the very
          // last one, then clear that last one's contents separately.
          mtgSheet.deleteRows(firstDataRow, lastRow - firstDataRow);
        }
        var lastCol = mtgSheet.getLastColumn();
        if (lastCol > 0) mtgSheet.getRange(firstDataRow, 1, 1, lastCol).clearContent();
      }
    }

    // Step 2: Load all data needed — clients, connections (with VA names).
    var cliSheet  = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!cliSheet || !connSheet) {
      return { success: false, error: 'Clients or VAConnections sheet not found.' };
    }

    var cliData  = cliSheet.getDataRange().getValues();
    var connData = connSheet.getDataRange().getValues();
    var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
    var coh = {}; connData[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });

    // Build a fast client status lookup so we can skip Terminated/Cancelled accounts.
    var clientStatusMap = {};
    for (var li = 1; li < cliData.length; li++) {
      var cId = String(cliData[li][clh['ClientID']]||'');
      if (cId) clientStatusMap[cId] = {
        status:     String(cliData[li][clh['Status']]||''),
        customerId: String(cliData[li][clh['CustomerID']]||'')
      };
    }

    // Step 3: For each Started VA connection on a non-terminated account,
    // generate a full meeting cadence anchored to that connection's start date.
    // This is the core change: we now generate per-connection, not per-account.
    var skipStatuses = ['Terminated', 'Cancelled'];
    var generated = 0, skipped = 0;
    var errors = [];

    for (var ci = 1; ci < connData.length; ci++) {
      var connId   = String(connData[ci][coh['ConnectionID']]||''); if (!connId) continue;
      var connSt   = String(connData[ci][coh['ConnectionStatus']]||'');
      var clientId = String(connData[ci][coh['ClientID']]||'');
      var clientInfo = clientStatusMap[clientId];

      // Skip connections on terminated/cancelled accounts, or connections
      // that aren't Started (Pending, Paused, etc. don't get a meeting cadence).
      if (!clientInfo || skipStatuses.indexOf(clientInfo.status) !== -1) { skipped++; continue; }
      if (connSt !== CONFIG.VA_CONNECTION_STATUS.STARTED) { skipped++; continue; }

      // Prefer ActualStartDate; fall back to AssignedAt for accounts where
      // work has been assigned but the actual-start field wasn't populated.
      var startRaw = connData[ci][coh['ActualStartDate']] || connData[ci][coh['AssignedAt']];
      if (!startRaw) { skipped++; continue; }
      var startDate = startRaw instanceof Date ? startRaw : new Date(startRaw);
      if (isNaN(startDate.getTime())) { skipped++; continue; }

      var vaName    = String(connData[ci][coh['VAName']]||'');
      var requestId = String(connData[ci][coh['RequestID']]||'');

      try {
        var genRes = generateMeetingsForConnection(
          connId, clientId, clientInfo.customerId, vaName, requestId, startDate
        );
        if (genRes.success) {
          generated += (genRes.created || 0);
        } else {
          errors.push(connId + ': ' + (genRes.error || 'unknown error'));
        }
      } catch (genErr) {
        errors.push(connId + ': ' + genErr.message);
      }
    }

    _writeLog('System', 'MEETINGS_RESET', onlyMissing ? 'FILL_MISSING' : 'BULK_REGENERATE', '',
      String(deleted) + ' deleted', String(generated) + ' created', perm.user);

    return { success: true, onlyMissing: !!onlyMissing, deleted: deleted, generated: generated, skipped: skipped, errors: errors };
  } catch (e) {
    return { success: false, error: 'resetAndRegenerateMeetings: ' + e.message };
  }
}
// Builds a preview of the "please schedule this meeting" email for a
// specific meeting — client name, VA name (from the meeting's own
// AnchorConnectionID), and meeting type/date are all available as
// {{placeholders}} in the template, same pattern as the Celebrations
// module's birthday/anniversary emails.
function getMeetingScheduleEmailPreview(meetingId) {
  try {
    var mRes = getMeetingById(meetingId);
    if (!mRes || !mRes.success) return mRes;
    var m = mRes.data;

    var tplRes = getDefaultTemplateForCategory(CONFIG.EMAIL_TEMPLATE_CATEGORY.MEETING_SCHEDULE);
    var tpl = tplRes.success ? tplRes.data : null;

    var cliRes = getClientById(m.clientId);
    var client = (cliRes && cliRes.success) ? cliRes.data : null;
    var toEmails = [];
    if (client) {
      [client.primaryEmail, client.secondaryEmail].forEach(function(e) {
        if (e && toEmails.indexOf(e) === -1) toEmails.push(e);
      });
    }

    var vaName = '';
    try {
      var connRes = getVAConnById(m.anchorConnectionId);
      if (connRes && connRes.success) vaName = connRes.data.vaName || '';
    } catch (vaEx) { Logger.log('getMeetingScheduleEmailPreview VA lookup: ' + vaEx.message); }

    var vars = {
      clientName:      client ? (client.primaryContact || client.accountName || client.companyName) : '',
      accountName:     client ? (client.accountName || client.companyName) : '',
      vaName:          vaName,
      meetingType:     m.meetingTypeLabel || '',
      meetingDate:     m.scheduledDate ? _formatLongDate(m.scheduledDate) : ''
    };

    return {
      success: true,
      data: {
        templateId: tpl ? tpl.templateId : '',
        isHtml:     tpl ? !!tpl.isHtml : false,
        subject:    tpl ? _mergeTemplate(tpl.subject, vars) : ('Scheduling ' + (vars.meetingType||'a check-in') + ' with ' + (vars.accountName||'your account')),
        body:       tpl ? _mergeTemplate(tpl.body, vars) : '',
        to:         toEmails,
        clientName: vars.accountName
      }
    };
  } catch (e) {
    return { success: false, error: 'getMeetingScheduleEmailPreview: ' + e.message };
  }
}

// Sends the schedule-request email and marks it on the meeting row —
// this is the single source of truth for "has this meeting's schedule
// email already gone out," and since one Meeting row can cover multiple
// VAs (ActiveVAConnectionIDs), marking it here naturally means only one
// email per meeting is ever possible, not one per VA it happens to include.
function sendMeetingScheduleEmail(meetingId, subject, body, toOverride, isHtml) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['MeetingID']]) !== meetingId) continue;
      if (h['ScheduleEmailSentAt'] !== undefined && data[i][h['ScheduleEmailSentAt']]) {
        return { success: false, error: 'A schedule-request email has already been sent for this meeting.' };
      }

      var toList = toOverride && toOverride.length ? toOverride : [];
      if (!toList.length) return { success: false, error: 'No email address for this account.' };

      var mailOpts = { to: toList.join(','), subject: subject };
      if (isHtml) { mailOpts.htmlBody = body; } else { mailOpts.body = body; }
      MailApp.sendEmail(mailOpts);

      var rowNum = i + 1;
      var now = new Date();
      if (h['ScheduleEmailSentAt'] !== undefined) sheet.getRange(rowNum, h['ScheduleEmailSentAt']+1).setValue(now);
      if (h['ScheduleEmailSentBy'] !== undefined) sheet.getRange(rowNum, h['ScheduleEmailSentBy']+1).setValue(perm.user.email);
      _writeLog('Meeting', meetingId, 'SCHEDULE_EMAIL_SENT', '', toList.join(', '), '', perm.user);
      return { success: true };
    }
    return { success: false, error: 'Meeting not found.' };
  } catch (e) {
    return { success: false, error: 'sendMeetingScheduleEmail: ' + e.message };
  }
}

// Records the Onboarding Meeting confirmation for a connection — required
// at the point a VA is actually marked Started (reqDoMarkStarted), since
// this is a retroactive "did this happen" confirmation rather than a
// future-scheduled check-in. Either logs it as Completed (with whatever
// date the CS Specialist confirms, which may differ from today) or as
// Waived (with a required reason) — needed for onboarding reporting
// either way, since "waived" is itself a meaningful, trackable outcome.
function confirmOnboardingMeeting(connectionId, wasConducted, onboardingDate, wasWaived, waivedReason) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!connectionId) return { success: false, error: 'connectionId is required.' };
    if (!wasConducted && !wasWaived) {
      return { success: false, error: 'Confirm whether the Onboarding Meeting was conducted, or check that it was waived.' };
    }
    if (wasWaived && !String(waivedReason||'').trim()) {
      return { success: false, error: 'A reason is required when waiving the Onboarding Meeting.' };
    }

    // Look up connection details (client/customer) and the Onboarding
    // Meeting type's ID — same pattern generateMeetingsForConnection uses.
    var connRes = getVAConnectionById(connectionId);
    if (!connRes || !connRes.success) return { success: false, error: 'Connection not found.' };
    var conn = connRes.data;

    var typesRes = getMeetingTypes();
    var obType = (typesRes.success ? typesRes.data : []).find(function(t){ return t.shortName === 'OB'; });
    if (!obType) return { success: false, error: 'Onboarding Meeting type not found — it may need to be re-seeded in Settings.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    _migrateSheetColumns(ss, CONFIG.SHEETS.MEETINGS, CONFIG.SCHEMA.Meetings);
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    var now = new Date();

    // One Onboarding Meeting per connection — if one already exists
    // (e.g. someone re-opens this from the connection profile to correct
    // it), update that row instead of creating a duplicate.
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['AnchorConnectionID']]||'') !== connectionId) continue;
      if (String(data[i][h['MeetingTypeID']]||'') !== obType.typeId) continue;
      var rowNum = i + 1;
      var cmUpdate = {
        'ScheduledDate': wasConducted ? new Date(onboardingDate) : data[i][h['ScheduledDate']],
        'Status': wasWaived ? 'Waived' : 'Completed',
        'Notes': wasWaived ? waivedReason : '',
        'UpdatedAt': now, 'UpdatedBy': perm.user.email
      };
      Object.keys(cmUpdate).forEach(function(col){ if (h[col] !== undefined) sheet.getRange(rowNum, h[col]+1).setValue(cmUpdate[col]); });
      _writeLog('VAConnection', connectionId, 'ONBOARDING_MEETING_UPDATED', '', wasWaived ? 'Waived' : 'Completed', '', perm.user);
      return { success: true, meetingId: String(data[i][h['MeetingID']]||'') };
    }

    var id = generateID('MTG');
    var row = data[0].map(function(){ return ''; });
    var cm = {
      'MeetingID': id,
      'ClientID': conn.clientId || '',
      'CustomerID': conn.customerId || '',
      'AnchorConnectionID': connectionId,
      'ActiveVAConnectionIDs': connectionId,
      'MeetingTypeID': obType.typeId,
      'MeetingTypeLabel': obType.label,
      'ScheduledDate': wasConducted ? new Date(onboardingDate) : now,
      'OriginalScheduledDate': wasConducted ? new Date(onboardingDate) : now,
      'Status': wasWaived ? 'Waived' : 'Completed',
      'Notes': wasWaived ? waivedReason : '',
      'RiskFlag': false, 'RiskReason': '',
      'AssignedTo': conn.vaName || '',
      'CreatedAt': now, 'CreatedBy': perm.user.email,
      'UpdatedAt': now, 'UpdatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    _writeLog('VAConnection', connectionId, 'ONBOARDING_MEETING_LOGGED', '', wasWaived ? 'Waived' : 'Completed', '', perm.user);
    return { success: true, meetingId: id };
  } catch (e) {
    return { success: false, error: 'confirmOnboardingMeeting: ' + e.message };
  }
}

// Scheduled vs Actual meetings per month, per the request — "Scheduled"
// is based on OriginalScheduledDate (falling back to ScheduledDate for
// a meeting that's never been rescheduled), so a meeting that got moved
// still counts toward the month it was originally due, not wherever it
// ended up. "Actual/Conducted" counts how many of those same meetings
// are now marked Completed, regardless of which month that completion
// actually happened in — this answers "of what was due this month, how
// much got done," not "how much got done this month."
function getMeetingsScheduledVsActualReport(year) {
  try {
    var perm = checkPermission('view');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    year = parseInt(year, 10) || new Date().getFullYear();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.MEETINGS);
    if (!sheet) return { success: true, months: [] };
    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    var MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var byMonth = {};
    for (var m = 0; m < 12; m++) byMonth[m] = { scheduled: 0, actual: 0, custSeen: {} };

    for (var i = 1; i < data.length; i++) {
      var origRaw = h['OriginalScheduledDate'] !== undefined ? data[i][h['OriginalScheduledDate']] : '';
      var schedRaw = origRaw || (h['ScheduledDate'] !== undefined ? data[i][h['ScheduledDate']] : '');
      if (!schedRaw) continue;
      var schedDate = schedRaw instanceof Date ? schedRaw : new Date(schedRaw);
      if (isNaN(schedDate.getTime()) || schedDate.getFullYear() !== year) continue;

      var monthIdx = schedDate.getMonth();
      byMonth[monthIdx].scheduled++;
      // Per-customer count — a customer with 3 VA connections each
      // scheduled this month counts once here, not 3 times, per the request.
      var custIdForSched = h['CustomerID'] !== undefined ? String(data[i][h['CustomerID']]||'') : '';
      if (custIdForSched) byMonth[monthIdx].custSeen[custIdForSched] = true;
      var status = String(data[i][h['Status']]||'');
      if (status === 'Completed') byMonth[monthIdx].actual++;
    }

    var months = MONTH_LABELS.map(function(label, idx) {
      return {
        month: label,
        scheduled: byMonth[idx].scheduled,
        scheduledByCustomer: Object.keys(byMonth[idx].custSeen).length,
        actual: byMonth[idx].actual
      };
    });

    return { success: true, year: year, months: months };
  } catch (e) {
    return { success: false, error: 'getMeetingsScheduledVsActualReport: ' + e.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// MERGE AN OPEN MEETING INTO THE NEXT CADENCE
// ════════════════════════════════════════════════════════════════════
// Per the request — cadence meetings are generated one at a time (the next
// is only created after the previous is Completed), so if e.g. the 1-month
// meeting keeps getting rescheduled until it lands almost on the 2-month
// meeting's due date, the 2-month meeting doesn't exist yet and can't be
// conducted. This lets the open meeting be conducted AS the next cadence:
// the next cadence is recorded as Completed, the earlier meeting is marked
// "Merged" into it (so it isn't left outstanding/overdue), and the cadence
// after that is generated as usual.
var MTG_MERGE_WINDOW_DAYS = 14; // available once the open meeting is within this many days of (or past) the next cadence's due date

function _mtgMergeOptionForRow(ss, data, h, rowIdx) {
  var status = String(data[rowIdx][h['Status']] || '');
  if (status !== 'Upcoming' && status !== 'Rescheduled') return { available: false, reason: 'Only an Upcoming or Rescheduled meeting can be merged.' };
  var clientId   = String(data[rowIdx][h['ClientID']] || '');
  var anchorId   = String(data[rowIdx][h['AnchorConnectionID']] || '');
  var thisTypeId = String(data[rowIdx][h['MeetingTypeID']] || '');
  if (!clientId || !thisTypeId) return { available: false, reason: 'Meeting has no account or type.' };

  var typesRes = getMeetingTypes();
  var types = (typesRes.success ? typesRes.data : [])
    .filter(function(t){ return t.isActive && t.offsetValue !== null && !isNaN(t.offsetValue); })
    .map(function(t){ return { t: t, days: _offsetToApproxDays(t.offsetValue, t.offsetUnit) }; })
    .sort(function(a, b){ return a.days - b.days; });
  var idx = -1;
  for (var i = 0; i < types.length; i++) if (types[i].t.typeId === thisTypeId) { idx = i; break; }
  if (idx < 0) return { available: false, reason: 'Not a recognised offset-based cadence.' };
  var next = types[idx + 1];
  if (!next) return { available: false, reason: 'This is the last cadence.' };

  // The next cadence must not already exist for this account.
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][h['ClientID']] || '') !== clientId) continue;
    if (String(data[r][h['MeetingTypeID']] || '') !== next.t.typeId) continue;
    var st = String(data[r][h['Status']] || '');
    if (st === 'Cancelled' || st === 'Superseded' || st === 'Merged') continue;
    return { available: false, reason: 'A ' + next.t.label + ' meeting already exists for this account.' };
  }

  // When the next cadence is actually due: the anchor connection's start
  // date + that cadence's offset (the same base the schedule is built from);
  // falls back to this meeting's original date + the gap between cadences.
  var nextDue = null;
  try {
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (connSheet && anchorId) {
      var cd = connSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c, k){ if (c) ch[String(c).trim()] = k; });
      for (var ci = 1; ci < cd.length; ci++) {
        if (String(cd[ci][ch['ConnectionID']] || '') !== anchorId) continue;
        var startRaw = cd[ci][ch['ActualStartDate']] || cd[ci][ch['AssignedAt']];
        var startD = startRaw instanceof Date ? startRaw : new Date(startRaw);
        if (startRaw && !isNaN(startD.getTime())) nextDue = _addOffsetSkippingWeekends(startD, next.t.offsetValue, next.t.offsetUnit);
        break;
      }
    }
  } catch (e) {}
  if (!nextDue) {
    var orig = data[rowIdx][h['OriginalScheduledDate']] || data[rowIdx][h['ScheduledDate']];
    var origD = orig instanceof Date ? orig : new Date(orig);
    if (isNaN(origD.getTime())) return { available: false, reason: 'Could not work out when the next cadence is due.' };
    nextDue = new Date(origD.getTime() + (next.days - types[idx].days) * 86400000);
  }
  var schedRaw = data[rowIdx][h['ScheduledDate']];
  var sched = schedRaw instanceof Date ? schedRaw : new Date(schedRaw);
  if (isNaN(sched.getTime())) return { available: false, reason: 'Meeting has no scheduled date.' };
  var daysApart = Math.round((nextDue.getTime() - sched.getTime()) / 86400000); // >0 = still before the next due date
  return {
    available: daysApart <= MTG_MERGE_WINDOW_DAYS,
    reason: daysApart <= MTG_MERGE_WINDOW_DAYS ? '' : 'Not close enough to the next cadence yet.',
    thisTypeLabel: String(data[rowIdx][h['MeetingTypeLabel']] || ''),
    nextTypeId: next.t.typeId, nextTypeLabel: next.t.label,
    nextDueDate: nextDue.toISOString(), scheduledDate: sched.toISOString(),
    daysApart: daysApart, windowDays: MTG_MERGE_WINDOW_DAYS
  };
}

function getMeetingMergeOption(meetingId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: false, error: 'Meetings sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['MeetingID']]) !== meetingId) continue;
      return { success: true, data: _mtgMergeOptionForRow(ss, data, h, i) };
    }
    return { success: false, error: 'Meeting not found.' };
  } catch (e) {
    return { success: false, error: 'getMeetingMergeOption: ' + e.message };
  }
}

function mergeMeetingIntoNextCadence(meetingId, dateConducted) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    var conducted = new Date(dateConducted);
    if (!dateConducted || isNaN(conducted.getTime())) return { success: false, error: 'Date Conducted is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: false, error: 'Meetings sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) if (String(data[i][h['MeetingID']]) === meetingId) { rowIdx = i; break; }
    if (rowIdx < 0) return { success: false, error: 'Meeting not found.' };

    // Re-checked here, not just hidden in the UI.
    var opt = _mtgMergeOptionForRow(ss, data, h, rowIdx);
    if (!opt.available) return { success: false, error: opt.reason || 'This meeting can\'t be merged into the next cadence.' };

    var now = new Date();
    var newId = generateID('MTG');
    var oldStatus = String(data[rowIdx][h['Status']] || '');
    var oldNotes = String(data[rowIdx][h['Notes']] || '');
    var conductedStr = Utilities.formatDate(conducted, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'MMM d, yyyy');

    // 1. The next cadence, recorded as conducted.
    var row = data[0].map(function(){ return ''; });
    var cm = {
      'MeetingID': newId,
      'ClientID': data[rowIdx][h['ClientID']] || '',
      'CustomerID': data[rowIdx][h['CustomerID']] || '',
      'AnchorConnectionID': data[rowIdx][h['AnchorConnectionID']] || '',
      'ActiveVAConnectionIDs': data[rowIdx][h['ActiveVAConnectionIDs']] || '',
      'MeetingTypeID': opt.nextTypeId,
      'MeetingTypeLabel': opt.nextTypeLabel,
      'ScheduledDate': conducted,
      'OriginalScheduledDate': new Date(opt.nextDueDate),
      'Status': 'Completed',
      'Notes': (oldNotes ? oldNotes + '\n' : '') + '[Conducted ' + conductedStr + ' as the ' + opt.nextTypeLabel + ' meeting, merged with the ' + opt.thisTypeLabel + ' meeting]',
      'RiskFlag': data[rowIdx][h['RiskFlag']] === undefined ? false : data[rowIdx][h['RiskFlag']],
      'RiskReason': data[rowIdx][h['RiskReason']] || '',
      'AssignedTo': data[rowIdx][h['AssignedTo']] || '',
      'CreatedAt': now, 'CreatedBy': perm.user.email, 'UpdatedAt': now, 'UpdatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);

    // 2. The earlier meeting is merged into it — no longer open/overdue.
    sheet.getRange(rowIdx + 1, h['Status'] + 1).setValue('Merged');
    var mergeNote = '[Merged into ' + newId + ' (' + opt.nextTypeLabel + ') — conducted ' + conductedStr + ']';
    sheet.getRange(rowIdx + 1, h['Notes'] + 1).setValue(oldNotes ? oldNotes + '\n' + mergeNote : mergeNote);
    sheet.getRange(rowIdx + 1, h['UpdatedAt'] + 1).setValue(now);
    sheet.getRange(rowIdx + 1, h['UpdatedBy'] + 1).setValue(perm.user.email);
    _writeLog('Meeting', meetingId, 'MERGED', 'Status', oldStatus, 'Merged', perm.user, null, 'Merged into ' + newId + ' (' + opt.nextTypeLabel + ') being conducted.');
    _writeLog('Meeting', newId, 'CREATE', 'Status', '', 'Completed', perm.user, conducted, 'Conducted as ' + opt.nextTypeLabel + ', merged with ' + opt.thisTypeLabel + ' (' + meetingId + ').');
    SpreadsheetApp.flush();

    // 3. Same follow-through as a normal completion.
    var data2 = sheet.getDataRange().getValues();
    var h2 = _mHMap(data2[0]);
    var newIdx = data2.length - 1;
    _mtgSupersedeEarlierRescheduled(ss, sheet, data2, h2, newIdx, newId);
    _mtgGenerateNextCadenceIfDue(ss, data2[newIdx], h2);
    return { success: true, newMeetingId: newId, mergedMeetingId: meetingId, nextTypeLabel: opt.nextTypeLabel };
  } catch (e) {
    return { success: false, error: 'mergeMeetingIntoNextCadence: ' + e.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// WAIVE A MEETING
// ════════════════════════════════════════════════════════════════════
// Per the request — the client opted not to have this meeting. Marks it
// "Waived" with the reason (required) and any extra details, so it stops
// counting as outstanding/overdue. The reason is written into the meeting's
// Notes and the activity log, and ALSO into WaivedReason / WaivedDetails /
// WaivedBy / WaivedAt columns if those exist on the Meetings sheet (not
// required). A waived cadence still lets the schedule move forward: the
// next cadence is generated, same as if it had been conducted.
function waiveMeeting(meetingId, reason, details) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    reason = String(reason || '').trim();
    details = String(details || '').trim();
    if (!reason) return { success: false, error: 'A reason is required to waive a meeting.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: false, error: 'Meetings sheet not found.' };
    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) if (String(data[i][h['MeetingID']]) === meetingId) { rowIdx = i; break; }
    if (rowIdx < 0) return { success: false, error: 'Meeting not found.' };

    var oldStatus = String(data[rowIdx][h['Status']] || '');
    if (['Completed', 'Waived', 'Cancelled', 'Superseded', 'Merged'].indexOf(oldStatus) !== -1) {
      return { success: false, error: 'A ' + oldStatus + ' meeting can\'t be waived.' };
    }

    var now = new Date();
    var by = perm.user.name || perm.user.email;
    var dateStr = Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), 'MMM d, yyyy');
    var line = '[Waived ' + dateStr + ' by ' + by + ' — client opted not to have this meeting. Reason: ' + reason + (details ? '. Details: ' + details : '') + ']';
    var oldNotes = String(data[rowIdx][h['Notes']] || '');
    var rn = rowIdx + 1;

    sheet.getRange(rn, h['Status'] + 1).setValue('Waived');
    sheet.getRange(rn, h['Notes'] + 1).setValue(oldNotes ? oldNotes + '\n' + line : line);
    if (h['WaivedReason']  !== undefined) sheet.getRange(rn, h['WaivedReason']  + 1).setValue(reason);
    if (h['WaivedDetails'] !== undefined) sheet.getRange(rn, h['WaivedDetails'] + 1).setValue(details);
    if (h['WaivedBy']      !== undefined) sheet.getRange(rn, h['WaivedBy']      + 1).setValue(perm.user.email);
    if (h['WaivedAt']      !== undefined) sheet.getRange(rn, h['WaivedAt']      + 1).setValue(now);
    sheet.getRange(rn, h['UpdatedAt'] + 1).setValue(now);
    sheet.getRange(rn, h['UpdatedBy'] + 1).setValue(perm.user.email);
    _writeLog('Meeting', meetingId, 'WAIVED', 'Status', oldStatus, 'Waived', perm.user, null, reason + (details ? ' — ' + details : ''));
    SpreadsheetApp.flush();

    // Keep the schedule moving, same as a conducted meeting.
    try {
      var data2 = sheet.getDataRange().getValues();
      var h2 = _mHMap(data2[0]);
      _mtgGenerateNextCadenceIfDue(ss, data2[rowIdx], h2);
    } catch (nextEx) { Logger.log('waiveMeeting next cadence: ' + nextEx.message); }
    return { success: true };
  } catch (e) {
    return { success: false, error: 'waiveMeeting: ' + e.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// ADD A MEETING FOR A CADENCE THAT HAS NONE
// ════════════════════════════════════════════════════════════════════
// Per the request — lets a user add the meeting for a cadence column that
// shows no meeting at all (a dash) on the Account Meetings table, with its
// date. Anchored to that row's VA connection, the same way generated
// meetings are. Refuses a duplicate (same connection + cadence already has a
// live meeting). A meeting added as Completed follows the normal completion
// follow-through (supersede earlier Rescheduled ones, generate the next
// cadence if this is now the latest).
function addAccountMeeting(connectionId, meetingTypeId, scheduledDate, status, notes) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!connectionId || String(connectionId).indexOf('__no_conn_') === 0) return { success: false, error: 'This row has no VA connection to attach a meeting to.' };
    if (!meetingTypeId) return { success: false, error: 'Meeting type is required.' };
    var when = new Date(scheduledDate);
    if (!scheduledDate || isNaN(when.getTime())) return { success: false, error: 'A valid date is required.' };
    status = (status === 'Completed') ? 'Completed' : 'Upcoming';
    if (status === 'Completed' && when.getTime() > new Date().getTime() + 86400000) return { success: false, error: 'A meeting can\'t be Completed with a future date.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _mtgSheet(ss);
    if (!sheet) return { success: false, error: 'Meetings sheet not found.' };

    // The type
    var typesRes = getMeetingTypes();
    var type = null;
    (typesRes.success ? typesRes.data : []).forEach(function(t){ if (t.typeId === meetingTypeId) type = t; });
    if (!type) return { success: false, error: 'Meeting type not found.' };

    // The connection this row belongs to
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!connSheet) return { success: false, error: 'VAConnections sheet not found.' };
    var cd = connSheet.getDataRange().getValues();
    var ch = {}; cd[0].forEach(function(c, i){ if (c) ch[String(c).trim()] = i; });
    var clientId = '', customerId = '', vaName = '', found = false;
    for (var ci = 1; ci < cd.length; ci++) {
      if (String(cd[ci][ch['ConnectionID']] || '') !== connectionId) continue;
      clientId   = String(cd[ci][ch['ClientID']] || '');
      customerId = String(cd[ci][ch['CustomerID']] || '');
      vaName     = String(cd[ci][ch['VAName']] || '');
      found = true; break;
    }
    if (!found) return { success: false, error: 'VA connection not found.' };

    var data = sheet.getDataRange().getValues();
    var h = _mHMap(data[0]);
    // No duplicate for this connection + cadence
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][h['AnchorConnectionID']] || '') !== connectionId) continue;
      if (String(data[r][h['MeetingTypeID']] || '') !== meetingTypeId) continue;
      var st = String(data[r][h['Status']] || '');
      if (st === 'Cancelled' || st === 'Superseded' || st === 'Merged') continue;
      return { success: false, error: 'A ' + type.label + ' meeting already exists for this VA connection.' };
    }

    var activeIds = [];
    try {
      var a = _getActiveConnectionIdsForClient(clientId);
      activeIds = Array.isArray(a) ? a.slice() : String(a || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean);
    } catch (e) {}
    if (activeIds.indexOf(connectionId) === -1) activeIds.unshift(connectionId);

    var now = new Date();
    var id = generateID('MTG');
    var row = data[0].map(function(){ return ''; });
    var cm = {
      'MeetingID': id, 'ClientID': clientId, 'CustomerID': customerId,
      'AnchorConnectionID': connectionId, 'ActiveVAConnectionIDs': activeIds.join(','),
      'MeetingTypeID': type.typeId, 'MeetingTypeLabel': type.label,
      'ScheduledDate': when, 'OriginalScheduledDate': when,
      'Status': status,
      'Notes': (String(notes || '').trim() ? String(notes).trim() + '\n' : '') + '[Added manually by ' + (perm.user.name || perm.user.email) + ']',
      'RiskFlag': false, 'RiskReason': '', 'AssignedTo': vaName,
      'CreatedAt': now, 'CreatedBy': perm.user.email, 'UpdatedAt': now, 'UpdatedBy': perm.user.email
    };
    Object.keys(cm).forEach(function(col){ if (h[col] !== undefined) row[h[col]] = cm[col]; });
    sheet.appendRow(row);
    _writeLog('Meeting', id, 'CREATE', 'Status', '', status, perm.user, when, 'Added manually: ' + type.label + ' for ' + vaName + '.');
    SpreadsheetApp.flush();

    if (status === 'Completed') {
      try {
        var data2 = sheet.getDataRange().getValues();
        var h2 = _mHMap(data2[0]);
        var idx = data2.length - 1;
        _mtgSupersedeEarlierRescheduled(ss, sheet, data2, h2, idx, id);
        _mtgGenerateNextCadenceIfDue(ss, data2[idx], h2);
      } catch (fx) { Logger.log('addAccountMeeting follow-through: ' + fx.message); }
    }
    return { success: true, meetingId: id };
  } catch (e) {
    return { success: false, error: 'addAccountMeeting: ' + e.message };
  }
}