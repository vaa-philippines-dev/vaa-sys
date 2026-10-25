// ═══════════════════════════════════════════════════════════
// VAHoursService.gs — VA Connection hours: migration + work-hours calculation
// ═══════════════════════════════════════════════════════════
//
// VAConnectionHoursLog already existed as the single sheet capturing every
// hours/schedule/connection-type change for a VA Connection (see
// applyVAConnectionHoursChange_ in VAConnectionService.gs) — but it only
// ever got a row when something CHANGED. A connection that was assigned its
// hours once and never touched again has zero rows in that log, so it's
// incomplete as a source of truth on its own. migrateVAConnectionHours()
// below backfills a starting "Initial Migration" row for every connection
// that doesn't have one yet, so the log covers a connection's full history
// from day one, not just changes made after this feature existed.
//
// The other half of this file is the actual point of having that complete
// history: calculateVAWorkHours() walks it (plus pause/resume events) to
// compute how many hours a VA actually worked in any date range — weekly,
// per cutoff (1–15 / 16–end of month), or calendar month — correctly
// accounting for schedule changes and Limited Period overrides that
// happened partway through that range.
//
// Schedule representation: a "breakdown" is a JSON array of day-groups,
// e.g. [{"days":["Mon","Tue","Wed"],"hoursPerDay":3},
//       {"days":["Thu","Fri"],"hoursPerDay":2},
//       {"days":["Sat"],"hoursPerDay":1}]
// — this is what actually enables "3 hrs Mon–Wed, 2 hrs Thu–Fri, 1 hr Sat,"
// which a single Hours number + a flat day list could never represent
// (that combination implies uniform hours across every selected day).

var HOURS_DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function _hoursParseBreakdown(raw) {
  if (!raw) return null;
  try {
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (e) { /* fall through */ }
  return null;
}

function _hoursWeeklyTotalFromBreakdown(breakdown) {
  if (!breakdown) return 0;
  return breakdown.reduce(function(sum, grp) {
    return sum + (grp.days || []).length * (parseFloat(grp.hoursPerDay) || 0);
  }, 0);
}

// Fallback for log entries that predate the ScheduleBreakdown column (or
// were migrated without day-level detail): splits a weekly hours total
// evenly across either the given day list, or Mon–Fri if none was recorded.
function _hoursFallbackBreakdown(weeklyHours, scheduleDaysRaw) {
  var days = (scheduleDaysRaw || '').split(',').map(function(d){ return d.trim(); }).filter(Boolean);
  if (!days.length) days = ['Mon','Tue','Wed','Thu','Fri'];
  var perDay = days.length ? (parseFloat(weeklyHours) || 0) / days.length : 0;
  return [{ days: days, hoursPerDay: perDay }];
}

function _hoursLookup(breakdown, dayName) {
  for (var i = 0; i < breakdown.length; i++) {
    if (breakdown[i].days.indexOf(dayName) !== -1) return parseFloat(breakdown[i].hoursPerDay) || 0;
  }
  return 0;
}

// ── Migration: backfill an Initial entry for every connection with none ─
function migrateVAConnectionHours() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Permission denied — this is a one-time admin migration.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var connSheet = _connGetSheet(ss);
    var connData  = connSheet.getDataRange().getValues();
    var ch = _connHMap(connData[0]);

    var logSheet = _ensureSheet(ss, 'VAConnectionHoursLog', CONFIG.SCHEMA.VAConnectionHoursLog);
    var logData  = logSheet.getDataRange().getValues();
    var lh = {}; (logData[0] || []).forEach(function(c, i){ if (c) lh[String(c)] = i; });
    var connectionsAlreadyLogged = {};
    for (var li = 1; li < logData.length; li++) {
      connectionsAlreadyLogged[String(logData[li][lh['ConnectionID']] || '')] = true;
    }

    // Look up each connection's originating VARequest for its intended
    // ScheduleDays, if one was recorded there — gives a more accurate
    // migrated breakdown than always defaulting to Mon–Fri.
    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var reqByRequestId = {};
    if (reqSheet) {
      var reqData = reqSheet.getDataRange().getValues();
      var rh = {}; reqData[0].forEach(function(c,i){ if(c) rh[String(c)]=i; });
      for (var ri = 1; ri < reqData.length; ri++) {
        var rid = String(reqData[ri][rh['RequestID']] || ''); if (!rid) continue;
        reqByRequestId[rid] = {
          scheduleDays: String(reqData[ri][rh['ScheduleDays']] || ''),
          scheduleType: rh['ScheduleType']    !== undefined ? String(reqData[ri][rh['ScheduleType']]||'')    : '',
          requiredPHTime: rh['RequiredPHTime'] !== undefined ? String(reqData[ri][rh['RequiredPHTime']]||'') : ''
        };
      }
    }

    var now = new Date();
    var migrated = 0, skipped = 0;
    var logColCount = logData[0].length;
    var newRows = [];

    for (var i = 1; i < connData.length; i++) {
      var connId = String(connData[i][ch['ConnectionID']] || ''); if (!connId) continue;
      if (connectionsAlreadyLogged[connId]) { skipped++; continue; }

      var hours      = String(connData[i][ch['Hours']]      || '0');
      var hoursType  = String(connData[i][ch['HoursType']]  || '');
      var connType   = String(connData[i][ch['ConnectionType']] || 'Regular');
      var requestId  = String(connData[i][ch['RequestID']]  || '');
      var effDate    = connData[i][ch['ActualStartDate']] || connData[i][ch['AssignedAt']] || connData[i][ch['VAConnectionDate']] || now;

      var schedDays = (reqByRequestId[requestId] || {}).scheduleDays || '';
      var schedType = (reqByRequestId[requestId] || {}).scheduleType || '';
      var reqPhTime = (reqByRequestId[requestId] || {}).requiredPHTime || '';
      var breakdown = _hoursFallbackBreakdown(hours, schedDays);

      // Header-mapped, not positional — robust regardless of the sheet's
      // actual column order (which can differ from CONFIG.SCHEMA's declared
      // order once self-healing migration has appended columns over time).
      var rowArr = new Array(logColCount).fill('');
      function setCol(colName, val) { if (lh[colName] !== undefined) rowArr[lh[colName]] = val; }
      setCol('LogID', generateID('HCL'));
      setCol('ConnectionID', connId);
      setCol('ChangeType', 'Initial Migration');
      setCol('NewHours', hours);
      setCol('NewHoursType', hoursType);
      setCol('NewConnectionType', connType);
      setCol('NewScheduleType', schedType);
      setCol('NewScheduleDays', schedDays);
      setCol('NewScheduleBreakdown', JSON.stringify(breakdown));
      setCol('RequiredPHTime', reqPhTime);
      setCol('EffectiveDate', new Date(effDate));
      setCol('Notes', 'Backfilled by migrateVAConnectionHours() — original per-change history predates this log; this row represents the hours/schedule on file at time of migration.');
      setCol('LoggedBy', perm.user.email);
      setCol('CreatedAt', now);

      newRows.push(rowArr);
      migrated++;
    }

    if (newRows.length) {
      logSheet.getRange(logSheet.getLastRow() + 1, 1, newRows.length, logColCount).setValues(newRows);
    }

    return { success: true, migrated: migrated, alreadyHadHistory: skipped };
  } catch (e) {
    return { success: false, error: 'migrateVAConnectionHours: ' + e.message };
  }
}

// ── Build the chronological schedule timeline for one connection ───────
// Returns an array of {from, to, breakdown, weeklyHours} periods covering
// the connection's whole life, PLUS a separate list of Limited Period
// overrides (each with its own from/to/weeklyHours) to be layered on top.
function _hoursBuildTimeline(connectionId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = _ensureSheet(ss, 'VAConnectionHoursLog', CONFIG.SCHEMA.VAConnectionHoursLog);
  var entries = [];
  if (logSheet) {
    var data = logSheet.getDataRange().getValues();
    var h = {}; (data[0] || []).forEach(function(c, i){ if (c) h[String(c)] = i; });
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']] || '') !== connectionId) continue;
      var changeType = String(data[i][h['ChangeType']] || '');
      // Project Hours Entry rows are one-off additional-hours logs, not a
      // schedule redefinition — excluding them here. (Bug fix: this used to
      // check for a ChangeType string, 'Log Project Hours', that never
      // actually got written anywhere — the real value is 'Project Hours
      // Entry' — so these entries were slipping through and being treated
      // as if they permanently redefined the connection's weekly schedule
      // to just the one-time hours added.)
      if (changeType === 'Project Hours Entry') continue;
      // Per the new confirmation workflow — a Pending or Cancelled
      // change hasn't actually taken effect, so it shouldn't factor
      // into the connection's current schedule at all. Blank
      // ApplyStatus (every row logged before this field existed) is
      // treated as Applied, for backward compatibility.
      var applyStatus = h['ApplyStatus'] !== undefined ? String(data[i][h['ApplyStatus']] || '') : '';
      if (applyStatus === 'Pending' || applyStatus === 'Cancelled') continue;
      // Limited Period entries are now just two ordinary bracketing records
      // (one applying the limited hours, one reverting after it ends) —
      // see applyVAConnectionHoursChange_ in VAConnectionService.gs — so
      // they need no special handling here at all; they fall through to
      // the normal period-building logic below like any other change.
      var newHours = data[i][h['NewHours']];
      var newBreakdownRaw = h['NewScheduleBreakdown'] !== undefined ? data[i][h['NewScheduleBreakdown']] : '';
      var newScheduleDays = String(data[i][h['NewScheduleDays']] || '');
      var breakdown = _hoursParseBreakdown(newBreakdownRaw);
      if (!breakdown && newHours !== '' && newHours !== undefined && newHours !== null) {
        breakdown = _hoursFallbackBreakdown(newHours, newScheduleDays);
      }
      if (!breakdown) continue; // this entry didn't actually change hours/schedule (e.g. a Type Change with no hours field)
      entries.push({
        effectiveDate: data[i][h['EffectiveDate']],
        breakdown: breakdown,
        scheduleType: String(data[i][h['NewScheduleType']] || ''),
        hoursType: String(data[i][h['NewHoursType']] || ''),
        requiredPHTime: h['RequiredPHTime'] !== undefined ? String(data[i][h['RequiredPHTime']] || '') : '',
        requiredClientTime: h['RequiredClientTime'] !== undefined ? String(data[i][h['RequiredClientTime']] || '') : ''
      });
    }
  }
  entries.sort(function(a, b) { return new Date(a.effectiveDate) - new Date(b.effectiveDate); });

  var periods = [];
  for (var e = 0; e < entries.length; e++) {
    var from = entries[e].effectiveDate;
    var to = (e + 1 < entries.length) ? _hoursAddDays(entries[e + 1].effectiveDate, -1) : null; // null = open-ended
    periods.push({
      from: from, to: to, breakdown: entries[e].breakdown,
      weeklyHours: _hoursWeeklyTotalFromBreakdown(entries[e].breakdown),
      scheduleType: entries[e].scheduleType, hoursType: entries[e].hoursType, requiredPHTime: entries[e].requiredPHTime,
      requiredClientTime: entries[e].requiredClientTime
    });
  }
  return { periods: periods };
}

function _hoursAddDays(dateVal, n) {
  var d = new Date(dateVal);
  d.setDate(d.getDate() + n);
  return d;
}

// ── Core calculation: total hours worked between two dates (inclusive) ──
function calculateVAWorkHours(connectionId, dateFromStr, dateToStr) {
  try {
    var dateFrom = new Date(dateFromStr);
    var dateTo   = new Date(dateToStr);
    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) return { success: false, error: 'Invalid date range.' };

    var timeline = _hoursBuildTimeline(connectionId);
    if (!timeline.periods.length) {
      return { success: false, error: 'No hours history found for this connection — run migrateVAConnectionHours() first if this is an older connection.' };
    }

    // Paused date ranges, to exclude from the total.
    var pauseResult = getVAConnectionPauseLog(connectionId);
    var pauseRanges = [];
    if (pauseResult.success) {
      var sortedEvents = pauseResult.data.slice().sort(function(a,b){ return new Date(a.eventDate) - new Date(b.eventDate); });
      var openPauseStart = null;
      sortedEvents.forEach(function(ev) {
        if (ev.eventType === 'Paused' && !openPauseStart) openPauseStart = ev.eventDate;
        else if (ev.eventType === 'Resumed' && openPauseStart) { pauseRanges.push({ from: openPauseStart, to: ev.eventDate }); openPauseStart = null; }
      });
      if (openPauseStart) pauseRanges.push({ from: openPauseStart, to: null }); // still paused
    }

    var totalHours = 0;
    var byDay = [];
    for (var d = new Date(dateFrom); d <= dateTo; d = _hoursAddDays(d, 1)) {
      var dayCopy = new Date(d);
      var isPaused = pauseRanges.some(function(pr) {
        return dayCopy >= new Date(pr.from) && (pr.to === null || dayCopy <= new Date(pr.to));
      });
      if (isPaused) { byDay.push({ date: dayCopy.toISOString().substring(0,10), hours: 0, note: 'Paused' }); continue; }

      var period = timeline.periods.find(function(p) {
        return dayCopy >= new Date(p.from) && (p.to === null || dayCopy <= new Date(p.to));
      });
      if (!period) { byDay.push({ date: dayCopy.toISOString().substring(0,10), hours: 0, note: 'No schedule on file' }); continue; }

      var dayName = HOURS_DAY_NAMES[dayCopy.getDay()];
      var hrs = _hoursLookup(period.breakdown, dayName);

      totalHours += hrs;
      byDay.push({ date: dayCopy.toISOString().substring(0,10), hours: hrs });
    }

    return { success: true, totalHours: Math.round(totalHours * 100) / 100, byDay: byDay };
  } catch (e) {
    return { success: false, error: 'calculateVAWorkHours: ' + e.message };
  }
}

// ── Convenience wrapper: weekly / cutoff / monthly totals for a reference date
// period: 'weekly' (Mon–Sun containing refDate), 'cutoff' (1–15 or 16–end of
// month containing refDate), 'monthly' (calendar month containing refDate).
function getVAWorkHoursSummary(connectionId, period, refDateStr) {
  try {
    var ref = refDateStr ? new Date(refDateStr) : new Date();
    var from, to;
    if (period === 'weekly') {
      var dow = ref.getDay(); // 0=Sun..6=Sat
      var mondayOffset = dow === 0 ? -6 : 1 - dow;
      from = _hoursAddDays(ref, mondayOffset);
      to   = _hoursAddDays(from, 6);
    } else if (period === 'cutoff') {
      var day = ref.getDate();
      if (day <= 15) {
        from = new Date(ref.getFullYear(), ref.getMonth(), 1);
        to   = new Date(ref.getFullYear(), ref.getMonth(), 15);
      } else {
        from = new Date(ref.getFullYear(), ref.getMonth(), 16);
        to   = new Date(ref.getFullYear(), ref.getMonth() + 1, 0); // last day of month
      }
    } else { // monthly
      from = new Date(ref.getFullYear(), ref.getMonth(), 1);
      to   = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    }
    var result = calculateVAWorkHours(connectionId, from.toISOString().substring(0,10), to.toISOString().substring(0,10));
    if (!result.success) return result;
    return { success: true, period: period, from: from.toISOString().substring(0,10), to: to.toISOString().substring(0,10), totalHours: result.totalHours };
  } catch (e) {
    return { success: false, error: 'getVAWorkHoursSummary: ' + e.message };
  }
}

// Returns weekly, cutoff, and monthly totals in one call — the connection
// detail modal uses this to show all three at once without three round trips.
function getVAWorkHoursAllPeriods(connectionId, refDateStr) {
  var weekly  = getVAWorkHoursSummary(connectionId, 'weekly',  refDateStr);
  var cutoff  = getVAWorkHoursSummary(connectionId, 'cutoff',  refDateStr);
  var monthly = getVAWorkHoursSummary(connectionId, 'monthly', refDateStr);
  return { success: true, weekly: weekly, cutoff: cutoff, monthly: monthly };
}

// Project Based connections don't have a weekly/cutoff/monthly schedule to
// calculate — instead, "how much has this project done" is: the initial
// hours set at assignment, plus every additional hours entry logged since,
// and which of those was most recent.
function getProjectHoursSummary(connectionId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName('VAConnectionHoursLog');
    if (!logSheet) return { success: false, error: 'No hours history found for this connection.' };
    var data = logSheet.getDataRange().getValues();
    var h = {}; (data[0]||[]).forEach(function(c,i){ if(c) h[String(c)]=i; });

    var initialHours = 0;
    var additionalEntries = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ConnectionID']]||'') !== connectionId) continue;
      var changeType = String(data[i][h['ChangeType']]||'');
      if (changeType === 'Project Hours Entry') {
        additionalEntries.push({
          hours: parseFloat(data[i][h['NewHours']]) || 0,
          date: data[i][h['EffectiveDate']] ? (data[i][h['EffectiveDate']] instanceof Date ? data[i][h['EffectiveDate']].toISOString() : String(data[i][h['EffectiveDate']])) : '',
          requestedBy: h['RequestedBy'] !== undefined ? String(data[i][h['RequestedBy']]||'') : '',
          notes: String(data[i][h['Notes']]||'')
        });
      } else if (changeType === 'Initial Assignment' || changeType === 'Initial Migration') {
        initialHours = Math.max(initialHours, parseFloat(data[i][h['NewHours']]) || 0);
      }
    }
    additionalEntries.sort(function(a,b){ return new Date(b.date||0) - new Date(a.date||0); });
    var additionalTotal = additionalEntries.reduce(function(sum,e){ return sum + e.hours; }, 0);

    return {
      success: true,
      initialHours: initialHours,
      additionalTotal: Math.round(additionalTotal*100)/100,
      grandTotal: Math.round((initialHours + additionalTotal)*100)/100,
      mostRecent: additionalEntries.length ? additionalEntries[0] : null,
      entryCount: additionalEntries.length
    };
  } catch(e) {
    return { success: false, error: 'getProjectHoursSummary: ' + e.message };
  }
}

// Currently-effective schedule breakdown for display purposes (e.g. showing
// "3 hrs Mon–Wed, 2 hrs Thu–Fri, 1 hr Sat" on the connection detail view).
function getVAConnectionCurrentSchedule(connectionId) {
  try {
    var timeline = _hoursBuildTimeline(connectionId);
    if (!timeline.periods.length) return { success: false, error: 'No hours history found for this connection.' };
    var current = timeline.periods[timeline.periods.length - 1];
    return {
      success: true, breakdown: current.breakdown, weeklyHours: current.weeklyHours,
      scheduleType: current.scheduleType || '', hoursType: current.hoursType || '', requiredPHTime: current.requiredPHTime || '',
      requiredClientTime: current.requiredClientTime || ''
    };
  } catch (e) {
    return { success: false, error: 'getVAConnectionCurrentSchedule: ' + e.message };
  }
}