// ═══════════════════════════════════════════════════════════════════════
// CUSTOMER ONBOARDING REPORT
// ═══════════════════════════════════════════════════════════════════════
// Monthly counts across two sections (Customers, VAs) × two categories
// (New = 'New' requests, Expansion = 'Additional' requests) × three
// metrics each. Reads VARequests and the Onboarding Meetings sheet once
// and processes everything in memory, rather than re-querying per metric
// or per month.

// Returns the last N periods (default 6) as keys, oldest first. Month
// keys are 'YYYY-MM'; week keys are the week's Monday date ('YYYY-MM-DD'),
// not an ISO week number — simpler to compute correctly and display.
function _obrLastPeriods(granularity, n) {
  n = n || 6;
  var periods = [];
  var now = new Date();
  if (granularity === 'week') {
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var dow = today.getDay(); // 0=Sun, 1=Mon...
    var daysSinceMonday = (dow === 0) ? 6 : dow - 1;
    var thisMonday = new Date(today); thisMonday.setDate(thisMonday.getDate() - daysSinceMonday);
    for (var i = n - 1; i >= 0; i--) {
      var weekStart = new Date(thisMonday); weekStart.setDate(weekStart.getDate() - i*7);
      periods.push(_obrDateToIsoStr(weekStart));
    }
  } else {
    for (var j = n - 1; j >= 0; j--) {
      var d = new Date(now.getFullYear(), now.getMonth() - j, 1);
      periods.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2, '0'));
    }
  }
  return periods;
}
function _obrPeriodKey(dateVal, granularity) {
  if (!dateVal) return '';
  var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  if (granularity === 'week') {
    var dow = d.getDay();
    var daysSinceMonday = (dow === 0) ? 6 : dow - 1;
    var weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday);
    return _obrDateToIsoStr(weekStart);
  }
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2, '0');
}
function _obrDateToIsoStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
// Per the request — an explicit date range instead of a fixed count of
// recent periods. Generates every period key from fromDate through
// toDate inclusive, oldest first — same key formats as _obrLastPeriods
// (month: 'YYYY-MM'; week: that week's own Monday date).
function _obrPeriodsInRange(granularity, fromDate, toDate) {
  var periods = [];
  if (granularity === 'week') {
    var dow = fromDate.getDay();
    var daysSinceMonday = (dow === 0) ? 6 : dow - 1;
    var cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() - daysSinceMonday);
    var guard = 0;
    while (cursor <= toDate && guard < 600) { // guard: ~11.5 years of weeks, well beyond any sane range
      periods.push(_obrDateToIsoStr(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
      guard++;
    }
  } else {
    var mCursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    var mGuard = 0;
    while (mCursor <= toDate && mGuard < 300) { // guard: 25 years of months
      periods.push(mCursor.getFullYear() + '-' + String(mCursor.getMonth()+1).padStart(2, '0'));
      mCursor = new Date(mCursor.getFullYear(), mCursor.getMonth() + 1, 1);
      mGuard++;
    }
  }
  return periods.length ? periods : [_obrPeriodKey(fromDate, granularity)];
}
// A metric bucket is { count, items: [{customerId, customerName, requestId}] }
// per month — this shape is what the frontend both counts and drills into.
function _obrNewBucket(months) {
  var b = {};
  months.forEach(function(m) { b[m] = { count: 0, items: [] }; });
  return b;
}
// Per the request — splits a Started or Cancelled bucket's items into
// Regular vs. Project-based sub-buckets, for each month. Called once per
// bucket after it's fully built, using the classifier (isProjectBasedFn)
// to decide each item — doesn't touch _obrAdd/_obrAddUnique/
// _obrAddUniqueVA themselves, so every other metric (requestIntake,
// onboarded, etc.) is completely unaffected. An item can represent more
// than one underlying request (e.g. a customer with two New requests
// starting the same month) — if ANY of them is Project-based, the whole
// item is classified Project-based, the more conservative reading.
// rawValueLookups (optional) — {connectionType: {requestId: value},
// hoursType: {requestId: value}} — when given, the raw (un-normalized)
// values actually on file are attached to each item as _connectionType/
// _hoursType, purely so the drill-down can show exactly what's stored
// for each request. Lets you directly verify why something landed in
// Regular vs. Project-based instead of taking the classification on
// faith. Only meaningful for Started (Cancelled has no connection at
// all, so these simply won't be present there).
// Per the request — splits each bucket's items into THREE sub-groups per month:
// Regular, Project-based and Casual. classifyFn(requestId) returns 'casual',
// 'projectBased' or 'regular' (see _obrClassifyRequest). An item can stand for
// more than one request; Casual wins over Project-based, which wins over
// Regular, so every item lands in exactly one group. rawLookups
// ({scheduleType, requestGroup}, optional) attaches the raw values on file to
// each item as _scheduleType/_requestGroup so the drill-down can show them.
function _obrSplitByType(bucket, months, classifyFn, rawLookups) {
  months.forEach(function(m) {
    var mb = bucket[m]; if (!mb) return;
    var regular = [], projectBased = [], casual = [];
    mb.items.forEach(function(it) {
      var ids = it.requestIds || (it.requestId ? [it.requestId] : []);
      var cats = ids.map(function(rid){ return classifyFn(rid); });
      var cat = cats.indexOf('casual') !== -1 ? 'casual' : (cats.indexOf('projectBased') !== -1 ? 'projectBased' : 'regular');
      if (rawLookups) {
        it._scheduleType = ids.map(function(rid){ return rawLookups.scheduleType[rid] || ''; }).filter(function(v){ return v; }).join(', ');
        it._requestGroup = ids.map(function(rid){ return rawLookups.requestGroup[rid] || ''; }).filter(function(v){ return v; }).join(', ');
      }
      (cat === 'casual' ? casual : (cat === 'projectBased' ? projectBased : regular)).push(it);
    });
    mb.regular      = { count: regular.length,      items: regular };
    mb.projectBased = { count: projectBased.length, items: projectBased };
    mb.casual       = { count: casual.length,       items: casual };
  });
}
function _obrAdd(bucket, month, customerId, customerName, requestId, vaNames) {
  if (!bucket[month]) return; // outside the requested window — ignore
  bucket[month].items.push({ customerId: customerId, customerName: customerName, requestId: requestId, vaNames: vaNames||[] });
  bucket[month].count = bucket[month].items.length;
}
// Same as _obrAdd, but only counts each customerId once per month — used
// for every "unique customer" metric (all of Customers/New and
// Customers/Expansion), vs. the VAs section's metrics, which count every
// request/connection individually.
function _obrAddUnique(bucket, month, customerId, customerName, requestId, vaNames) {
  if (!bucket[month]) return;
  var existing = bucket[month].items.filter(function(it){ return it.customerId === customerId; })[0];
  if (existing) {
    // Merge in any new VA names AND any new request ID rather than
    // skipping entirely — a customer with two VAs starting the same
    // month should show both, and a customer with two requests this
    // month should show both request IDs too, not just whichever was
    // processed first.
    (vaNames||[]).forEach(function(n){ if (existing.vaNames.indexOf(n) === -1) existing.vaNames.push(n); });
    if (requestId && existing.requestIds.indexOf(requestId) === -1) existing.requestIds.push(requestId);
    return;
  }
  bucket[month].items.push({ customerId: customerId, customerName: customerName, requestIds: requestId ? [requestId] : [], vaNames: vaNames||[] });
  bucket[month].count = bucket[month].items.length;
}
// Per the request — dedup by VA IDENTITY instead of customer, used only
// for the VAs section's "Started" metric: if the same VA started two
// connections in the same period (two different clients), that's ONE
// row listing both client names, not two separate rows. customerId/
// customerName are kept as the first client seen (for backward-
// compatible single-link rendering); customerIds/customerNames carry
// the full list for when there's more than one.
function _obrAddUniqueVA(bucket, month, vaKey, vaName, customerId, customerName, requestId) {
  if (!bucket[month]) return;
  var existing = bucket[month].items.filter(function(it){ return it.vaKey === vaKey; })[0];
  if (existing) {
    if (customerId && existing.customerIds.indexOf(customerId) === -1) {
      existing.customerIds.push(customerId);
      existing.customerNames.push(customerName);
    }
    if (requestId && existing.requestIds.indexOf(requestId) === -1) existing.requestIds.push(requestId);
    return;
  }
  bucket[month].items.push({
    vaKey: vaKey,
    vaNames: [vaName],
    customerId: customerId,
    customerName: customerName,
    customerIds: customerId ? [customerId] : [],
    customerNames: customerId ? [customerName] : [],
    requestIds: requestId ? [requestId] : []
  });
  bucket[month].count = bucket[month].items.length;
}

function getCustomerOnboardingReport(granularity, periodsBack, fromDateStr, toDateStr) {
  try {
    var perm = checkPermission('viewReports');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    granularity = (granularity === 'week') ? 'week' : 'month';
    // Per the request — an explicit date range (default Year-to-Date,
    // set by the frontend) takes priority when given; periodsBack stays
    // as a fallback for any other caller that doesn't send dates.
    var months;
    if (fromDateStr && toDateStr) {
      var ffParts = String(fromDateStr).split('-');
      var fromD = new Date(Number(ffParts[0]), Number(ffParts[1])-1, Number(ffParts[2]));
      var ttParts = String(toDateStr).split('-');
      var toD2 = new Date(Number(ttParts[0]), Number(ttParts[1])-1, Number(ttParts[2]));
      months = _obrPeriodsInRange(granularity, fromD, toD2);
    } else {
      months = _obrLastPeriods(granularity, periodsBack || 6);
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var reqData = reqSheet ? reqSheet.getDataRange().getValues() : [[]];
    var rh = {}; (reqData[0]||[]).forEach(function(c,i){ if(c) rh[String(c).trim()]=i; });

    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var custData = custSheet ? custSheet.getDataRange().getValues() : [[]];
    var ch = {}; (custData[0]||[]).forEach(function(c,i){ if(c) ch[String(c).trim()]=i; });
    var custNameById = {};
    for (var ci = 1; ci < custData.length; ci++) {
      var cid = String(custData[ci][ch['CustomerID']]||''); if (!cid) continue;
      custNameById[cid] = String(custData[ci][ch['CustomerName']]||cid);
    }

    // Request type per RequestID — needed below to classify each Started
    // connection as belonging to a New or Additional (Expansion) request.
    var reqTypeByRequestId = {};
    var scheduleTypeByRequestId = {};
    var requestGroupByRequestId = {};
    var customerIdByRequestId = {};
    for (var rti = 1; rti < reqData.length; rti++) {
      var rtiId = String(reqData[rti][rh['RequestID']]||''); if (!rtiId) continue;
      reqTypeByRequestId[rtiId] = String(reqData[rti][rh['RequestType']]||'');
      scheduleTypeByRequestId[rtiId] = rh['ScheduleType'] !== undefined ? String(reqData[rti][rh['ScheduleType']]||'') : '';
      requestGroupByRequestId[rtiId] = rh['RequestGroup'] !== undefined ? String(reqData[rti][rh['RequestGroup']]||'') : '';
      customerIdByRequestId[rtiId] = rh['CustomerID'] !== undefined ? String(reqData[rti][rh['CustomerID']]||'').trim() : '';
    }

    // Actual start date per connection, needed for the "Started" metrics
    // (a request's own status is Closed-Won, but the actual start MONTH
    // comes from its connection, not the request row itself).
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var connData = connSheet ? connSheet.getDataRange().getValues() : [[]];
    var coh = {}; (connData[0]||[]).forEach(function(c,i){ if(c) coh[String(c).trim()]=i; });
    var startDateByRequestId = {};
    var vaNamesByRequestId = {};
    var intakeVaNamesByRequestId = {};
    // Per the request — "Started > Project-based" is now defined by
    // HoursType alone (NOT ConnectionType), read directly from the
    // VAConnections row itself — tracked per the SAME connection that
    // sets startDateByRequestId below, so if a request somehow has more
    // than one connection, the classification always matches whichever
    // one is actually driving the Started date. Normalized (case-folded,
    // hyphens/spaces stripped) for tolerance against minor formatting
    // variations.
    function _obrNorm(v) { return String(v||'').toLowerCase().replace(/[\s-]/g, ''); }
    var startedIsProjectBasedByRequestId = {};
    var connTypeByRequestId = {};
    var hoursTypeByRequestId = {};
    // Per the request — Regular/Project-based is based on VAConnections'
    // own HoursType, never VARequests, for Cancelled too. A Cancelled
    // (Closed-Lost) request can still have had a connection created for
    // it even though it never reached Started (a VA was assigned, then
    // the request fell through before kickoff) — this captures that
    // connection's own HoursType regardless of its status, so Cancelled
    // isn't forced to fall back to the request's own field. A request
    // with no connection at all simply has nothing here and falls back
    // to Regular — there's no VAConnections data to classify it by.
    var hoursTypeAnyConnByRequestId = {};
    // Per the request — "VAs > Started" buckets, built here directly from
    // Started connections (filled in below, in this same pass). Declared
    // ahead of the main request loop that follows so it can be filled
    // before vaNew/vaExp are used anywhere else.
    var vaStartedByConnection = { New: _obrNewBucket(months), Additional: _obrNewBucket(months), Replacement: _obrNewBucket(months) };
    // Real bug fixed here: Started used to require the connection to be
    // CURRENTLY 'Started', so a VA who started in January and was
    // terminated since dropped out of January's Started count and list
    // entirely. A connection counts as having started if it got underway
    // at all — i.e. anything other than Pending/Accepted/Declined/
    // Cancelled (those never began).
    function _obrDidStart(status) { return ['Pending','Accepted','Declined','Cancelled',''].indexOf(String(status||'')) === -1; }
    var vaStartedRequestIds = {};
    var anyConnVaByRequestId = {};
    for (var vi = 1; vi < connData.length; vi++) {
      var reqIdForConn = String(connData[vi][coh['RequestID']]||''); if (!reqIdForConn) continue;
      if (coh['HoursType'] !== undefined && hoursTypeAnyConnByRequestId[reqIdForConn] === undefined) {
        hoursTypeAnyConnByRequestId[reqIdForConn] = String(connData[vi][coh['HoursType']]||'');
      }
      if (!anyConnVaByRequestId[reqIdForConn]) {
        anyConnVaByRequestId[reqIdForConn] = {
          vaKey: (coh['VAID'] !== undefined ? String(connData[vi][coh['VAID']]||'') : '') || (coh['VAName'] !== undefined ? String(connData[vi][coh['VAName']]||'') : ''),
          vaName: coh['VAName'] !== undefined ? String(connData[vi][coh['VAName']]||'') : ''
        };
      }
      // VA name(s) to show on Request Intake rows: connections that started, else the Final VA, else the
      // candidates assigned so far. Declined / Cancelled connections are ignored.
      var icStatus = String(connData[vi][coh['ConnectionStatus']]||'');
      var icName = coh['VAName'] !== undefined ? String(connData[vi][coh['VAName']]||'') : '';
      if (icName && icStatus !== 'Declined' && icStatus !== 'Cancelled') {
        var icKind = _obrDidStart(icStatus) ? 'started' : ((coh['IsFinalVA'] !== undefined && String(connData[vi][coh['IsFinalVA']]).toLowerCase() === 'true') ? 'final' : 'candidate');
        if (!intakeVaNamesByRequestId[reqIdForConn]) intakeVaNamesByRequestId[reqIdForConn] = { started: [], final: [], candidate: [] };
        if (intakeVaNamesByRequestId[reqIdForConn][icKind].indexOf(icName) === -1) intakeVaNamesByRequestId[reqIdForConn][icKind].push(icName);
      }
      if (_obrDidStart(connData[vi][coh['ConnectionStatus']])) {
        if (!vaNamesByRequestId[reqIdForConn]) vaNamesByRequestId[reqIdForConn] = [];
        var vaNameForConn = String(connData[vi][coh['VAName']]||'');
        if (vaNameForConn && vaNamesByRequestId[reqIdForConn].indexOf(vaNameForConn) === -1) {
          vaNamesByRequestId[reqIdForConn].push(vaNameForConn);
        }
      }
      var actualStart = connData[vi][coh['ActualStartDate']];
      if (!actualStart) continue;
      // Real bug fixed here: this picked the earliest ActualStartDate
      // across EVERY connection a request ever had, regardless of that
      // connection's current status — so a request whose FIRST VA later
      // left (Terminated/Cancelled) and was replaced would have its
      // Project-based classification driven by that old, no-longer-
      // relevant connection's own ConnectionType/HoursType, not the
      // CURRENT Started one's. Now requires ConnectionStatus = 'Started'
      // before a connection can win this comparison at all — matching
      // what startDateByRequestId is actually meant to represent (when
      // THIS request's actual, currently-Started VA began).
      if (!_obrDidStart(connData[vi][coh['ConnectionStatus']])) continue;
      // A request could in theory have more than one connection — use the
      // earliest actual start if so, since that's when the VA genuinely
      // began for this request.
      if (!startDateByRequestId[reqIdForConn] || new Date(actualStart) < new Date(startDateByRequestId[reqIdForConn])) {
        startDateByRequestId[reqIdForConn] = actualStart;
        var connTypeForConn = coh['ConnectionType'] !== undefined ? String(connData[vi][coh['ConnectionType']]||'') : '';
        var hoursTypeForConn = coh['HoursType'] !== undefined ? String(connData[vi][coh['HoursType']]||'') : '';
        // Per the request — based on HoursType alone now, not
        // ConnectionType. connTypeByRequestId is still tracked below
        // purely for the drill-down's own diagnostic columns, not used
        // in this decision at all anymore.
        startedIsProjectBasedByRequestId[reqIdForConn] = _obrNorm(hoursTypeForConn) === 'projectbased';
        // Raw (un-normalized) values, kept alongside the boolean purely
        // so the drill-down can show exactly what's on file for each
        // request — lets you directly verify why something landed in
        // Regular vs. Project-based, rather than having to take the
        // classification on faith.
        connTypeByRequestId[reqIdForConn] = connTypeForConn;
        hoursTypeByRequestId[reqIdForConn] = hoursTypeForConn;
      }

      // Real bug fixed here, per the request — "VAs > Started" used to
      // count Closed-Won REQUESTS by their CompletedAt date, not actual
      // VA Connections by their own ActualStartDate. Those two dates can
      // genuinely differ (a request can be marked Closed-Won before or
      // after its VA actually starts), which is exactly what caused an
      // undercount against the real number of VA connections that
      // started. Now built directly from Started connections here, and
      // deduplicated by VA identity (_obrAddUniqueVA) — per the request,
      // the same VA starting two connections in the same period shows as
      // ONE row listing both client names, not two rows.
      if (!_obrDidStart(connData[vi][coh['ConnectionStatus']])) continue;
      var vsReqType = reqTypeByRequestId[reqIdForConn] || '';
      if (vsReqType !== 'New' && vsReqType !== 'Additional' && vsReqType !== 'Replacement') continue;
      var vsVaId = coh['VAID'] !== undefined ? String(connData[vi][coh['VAID']]||'') : '';
      var vsVaName = coh['VAName'] !== undefined ? String(connData[vi][coh['VAName']]||'') : '';
      var vsVaKey = vsVaId || vsVaName; if (!vsVaKey) continue;
      // Real bug fixed here: the customer was read only from the connection's own
      // CustomerID, which is blank on older connections — so the VA Started drill-down
      // showed an empty Customer / Account. Falls back to the request's customer (always
      // set), and to the connection's CustomerName column if that's all there is.
      var vsCustId = (coh['CustomerID'] !== undefined ? String(connData[vi][coh['CustomerID']]||'').trim() : '') || customerIdByRequestId[reqIdForConn] || '';
      var vsCustName = custNameById[vsCustId] || (coh['CustomerName'] !== undefined ? String(connData[vi][coh['CustomerName']]||'') : '') || vsCustId;
      var vsMonth = _obrPeriodKey(actualStart, granularity);
      _obrAddUniqueVA(vaStartedByConnection[vsReqType], vsMonth, vsVaKey, vsVaName, vsCustId, vsCustName, reqIdForConn);
      vaStartedRequestIds[reqIdForConn] = true;
    }

    // Per the request — the sub-metrics under Started and Cancelled:
    //   Casual        — the request's own RequestGroup is 'Casual'
    //   Project-based — the request's own Schedule Type is 'Project-based'
    //   Regular       — everything else (Schedule Types daily / weekly / monthly)
    // Checked in that order, so each request lands in exactly one group.
    // Both fields are read from the VARequests row itself.
    function _obrClassifyRequest(requestId) {
      if (_obrNorm(requestGroupByRequestId[requestId]) === 'casual') return 'casual';
      if (_obrNorm(scheduleTypeByRequestId[requestId]) === 'projectbased') return 'projectBased';
      return 'regular';
    }
    function _obrIntakeVaNames(requestId) {
      var b = intakeVaNamesByRequestId[requestId]; if (!b) return [];
      return b.started.length ? b.started : (b.final.length ? b.final : b.candidate);
    }

    // ── Build buckets ────────────────────────────────────────────────
    var custNew = { requestIntake: _obrNewBucket(months), onboarded: _obrNewBucket(months), started: _obrNewBucket(months), cancelled: _obrNewBucket(months) };
    var custExp = { requestIntake: _obrNewBucket(months), started: _obrNewBucket(months), cancelled: _obrNewBucket(months) };
    // started: now the connection-based buckets built above
    // (vaStartedByConnection), not a fresh empty one.
    var vaNew   = { requestIntake: _obrNewBucket(months), started: _obrNewBucket(months), cancelled: _obrNewBucket(months) };
    var vaExp   = { requestIntake: _obrNewBucket(months), started: _obrNewBucket(months), cancelled: _obrNewBucket(months) };
    // Per the request — Replacement tickets get their own section with the
    // same metrics as Expansion (Request Intake / Started / Cancelled).
    // No Onboarded metric: a Replacement doesn't carry a Seller Onboarding
    // Date (it's hidden and not required for that request type).
    var custRep = { requestIntake: _obrNewBucket(months), started: _obrNewBucket(months), cancelled: _obrNewBucket(months) };
    var vaRep   = { requestIntake: _obrNewBucket(months), started: _obrNewBucket(months), cancelled: _obrNewBucket(months) };

    // Group every 'New' request by customer first, since the Cancelled
    // metric's rule ("only Cancelled if ALL of this customer's New
    // requests are Closed-Lost — even one Started means Started instead")
    // needs the full set per customer, not a per-request pass.
    var newReqsByCustomer = {};
    var reqStatusById = {}; // requestId -> current status, for the drill-down modal

    for (var i = 1; i < reqData.length; i++) {
      var requestId = String(reqData[i][rh['RequestID']]||''); if (!requestId) continue;
      var reqType   = String(reqData[i][rh['RequestType']]||'');
      var status    = String(reqData[i][rh['Status']]||'');
      reqStatusById[requestId] = status;
      var customerId = String(reqData[i][rh['CustomerID']]||'');
      var customerName = custNameById[customerId] || customerId;
      var createdAt = reqData[i][rh['CreatedAt']];
      // CompletedAt is the basis for every Won/Lost-based metric below —
      // falls back to ClosedAt for historical Closed-Lost requests that
      // predate CompletedAt being populated on that path (it used to be
      // Won-only; see the fix in closeVARequest).
      var completedAt = (rh['CompletedAt'] !== undefined && reqData[i][rh['CompletedAt']]) ? reqData[i][rh['CompletedAt']]
                       : (rh['ClosedAt'] !== undefined ? reqData[i][rh['ClosedAt']] : '');
      // Per the request — Cancelled (Closed - Lost) is based on the request's
      // own CompletedAt date only, NOT ClosedAt and with no fallback to it.
      // (Variable keeps its earlier name, closedAtOnly, but now holds
      // CompletedAt.)
      var closedAtOnly = rh['CompletedAt'] !== undefined ? reqData[i][rh['CompletedAt']] : '';
      // Per the request — a request's Closed-Won date and its VA
      // Connection's start date are expected to be the same, so Started
      // uses the connection's start date and falls back to the
      // Closed-Won date, so a record can't go missing from the count or
      // the list just because one of the two sources is absent. Any
      // actual disagreement between them is listed in the Audit.
      var closedWonDate = (status === 'Closed - Won') ? completedAt : '';
      var startedAt = startDateByRequestId[requestId] || closedWonDate || '';

      if (reqType === 'New') {
        if (!newReqsByCustomer[customerId]) newReqsByCustomer[customerId] = { customerName: customerName, requests: [] };
        newReqsByCustomer[customerId].requests.push({ requestId: requestId, status: status, completedAt: completedAt, closedAt: closedAtOnly, startedAt: startedAt });

        // Started — the month the VA actually started, one count per
        // customer per month regardless of how many New requests started
        // that same month.
        if (startedAt) {
          var startedMonth = _obrPeriodKey(startedAt, granularity);
          _obrAddUnique(custNew.started, startedMonth, customerId, customerName, requestId, vaNamesByRequestId[requestId]);
        }

        // VAs section counts every request individually, not per unique
        // customer. 'Started' is NOT bumped here anymore — see
        // vaStartedByConnection above, built directly from actual VA
        // Connections instead of this request's own Closed-Won status.
        var intakeMonth = _obrPeriodKey(createdAt, granularity);
        _obrAddUnique(custNew.requestIntake, intakeMonth, customerId, customerName, requestId);
        _obrAdd(vaNew.requestIntake, intakeMonth, customerId, customerName, requestId, _obrIntakeVaNames(requestId));
        // Per the request — VAs > Started counts every REQUEST, not unique VAs: a VA with two
        // requests in the month is two rows / counts as two. Dated by the connection's start
        // date, falling back to the Closed-Won date (startedAt, above).
        if (startedAt) {
          _obrAdd(vaNew.started, _obrPeriodKey(startedAt, granularity), customerId, customerName, requestId, vaNamesByRequestId[requestId]);
        }
        if (status === 'Closed - Lost' && closedAtOnly) {
          _obrAdd(vaNew.cancelled, _obrPeriodKey(closedAtOnly, granularity), customerId, customerName, requestId);
        }
      }

      if (reqType === 'Additional') {
        var expIntakeMonth = _obrPeriodKey(createdAt, granularity);
        _obrAddUnique(custExp.requestIntake, expIntakeMonth, customerId, customerName, requestId);
        _obrAdd(vaExp.requestIntake, expIntakeMonth, customerId, customerName, requestId, _obrIntakeVaNames(requestId));

        if (startedAt) {
          var expStartedMonth = _obrPeriodKey(startedAt, granularity);
          _obrAddUnique(custExp.started, expStartedMonth, customerId, customerName, requestId, vaNamesByRequestId[requestId]);
        }
        // Per the request — VAs > Started counts every REQUEST, not unique VAs: a VA with two
        // requests in the month is two rows / counts as two. Dated by the connection's start
        // date, falling back to the Closed-Won date (startedAt, above).
        if (startedAt) {
          _obrAdd(vaExp.started, _obrPeriodKey(startedAt, granularity), customerId, customerName, requestId, vaNamesByRequestId[requestId]);
        }
        if (status === 'Closed - Lost' && closedAtOnly) {
          var expCancelMonth = _obrPeriodKey(closedAtOnly, granularity);
          _obrAddUnique(custExp.cancelled, expCancelMonth, customerId, customerName, requestId);
          _obrAdd(vaExp.cancelled, expCancelMonth, customerId, customerName, requestId);
        }
      }

      if (reqType === 'Replacement') {
        var repIntakeMonth = _obrPeriodKey(createdAt, granularity);
        _obrAddUnique(custRep.requestIntake, repIntakeMonth, customerId, customerName, requestId);
        _obrAdd(vaRep.requestIntake, repIntakeMonth, customerId, customerName, requestId, _obrIntakeVaNames(requestId));

        if (startedAt) {
          _obrAddUnique(custRep.started, _obrPeriodKey(startedAt, granularity), customerId, customerName, requestId, vaNamesByRequestId[requestId]);
        }
        // Per the request — VAs > Started counts every REQUEST, not unique VAs: a VA with two
        // requests in the month is two rows / counts as two. Dated by the connection's start
        // date, falling back to the Closed-Won date (startedAt, above).
        if (startedAt) {
          _obrAdd(vaRep.started, _obrPeriodKey(startedAt, granularity), customerId, customerName, requestId, vaNamesByRequestId[requestId]);
        }
        if (status === 'Closed - Lost' && closedAtOnly) {
          var repCancelMonth = _obrPeriodKey(closedAtOnly, granularity);
          _obrAddUnique(custRep.cancelled, repCancelMonth, customerId, customerName, requestId);
          _obrAdd(vaRep.cancelled, repCancelMonth, customerId, customerName, requestId);
        }
      }
    }

    // Customers/New/Cancelled — only a customer whose New requests are
    // ALL Closed-Lost counts here at all; even a single Started request
    // means this customer is fully excluded from Cancelled (counted only
    // under Started instead, already handled above).
    Object.keys(newReqsByCustomer).forEach(function(customerId) {
      var entry = newReqsByCustomer[customerId];
      var anyStarted = entry.requests.some(function(r){ return !!r.startedAt; });
      if (anyStarted) return; // this customer already counted under Started — never also Cancelled
      var allCancelled = entry.requests.length > 0 && entry.requests.every(function(r){ return r.status === 'Closed - Lost'; });
      if (!allCancelled) return; // still open / in progress — not yet a final outcome either way
      // Use the LATEST Closed-Lost request's completedAt as the month this
      // customer's cancellation is attributed to, since that's when the
      // final (only) outcome actually became final.
      var latestClosed = entry.requests
        .filter(function(r){ return r.closedAt; })
        .sort(function(a,b){ return new Date(b.closedAt) - new Date(a.closedAt); })[0];
      if (!latestClosed) return;
      var cancelMonth = _obrPeriodKey(latestClosed.closedAt, granularity);
      entry.requests.forEach(function(r) {
        _obrAddUnique(custNew.cancelled, cancelMonth, customerId, entry.customerName, r.requestId);
      });
    });

    // Customers/New/Onboarded — unique customers with at least one NEW
    // (not Additional) VARequest whose Seller Onboarding Date is set.
    // Includes Closed - Lost requests too, per an earlier request — a
    // customer that was genuinely onboarded at some point still counts
    // as onboarded, even if the relationship later ended in Closed -
    // Lost for some other reason. Counted in the period of that date.
    var custOnboarded = _obrNewBucket(months);
    for (var obi = 1; obi < reqData.length; obi++) {
      if (String(reqData[obi][rh['RequestType']]||'') !== 'New') continue;
      var obSellerDate = rh['SellerOnboardingDate'] !== undefined ? reqData[obi][rh['SellerOnboardingDate']] : '';
      if (!obSellerDate) continue;
      var obCustId = String(reqData[obi][rh['CustomerID']]||'');
      var obRequestId = String(reqData[obi][rh['RequestID']]||'');
      var obPeriod = _obrPeriodKey(obSellerDate, granularity);
      _obrAddUnique(custOnboarded, obPeriod, obCustId, custNameById[obCustId] || obCustId, obRequestId);
    }
    custNew.onboarded = custOnboarded;

    // Per the request — Regular / Project-based sub-metrics for Started
    // and Cancelled, across both Customers and VAs, both New and
    // Expansion. Applied after every bucket is fully built, so this
    // can't affect the main counts above, only add the sub-breakdown
    // alongside them.
    var _obrRawTypeLookups = { scheduleType: scheduleTypeByRequestId, requestGroup: requestGroupByRequestId };
    _obrSplitByType(custNew.started, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(custNew.cancelled, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(custExp.started, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(custExp.cancelled, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(vaNew.started, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(vaNew.cancelled, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(vaExp.started, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(vaExp.cancelled, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(custRep.started, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(custRep.cancelled, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(vaRep.started, months, _obrClassifyRequest, _obrRawTypeLookups);
    _obrSplitByType(vaRep.cancelled, months, _obrClassifyRequest, _obrRawTypeLookups);

    return {
      success: true,
      granularity: granularity,
      months: months,
      customers: { new: custNew, expansion: custExp, replacement: custRep },
      vas: { new: vaNew, expansion: vaExp, replacement: vaRep },
      reqStatusById: reqStatusById
    };
  } catch (e) {
    return { success: false, error: 'getCustomerOnboardingReport: ' + e.message };
  }
}