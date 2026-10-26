// ─────────────────────────────────────────
// PlaybookService.gs — Playbook module (Accounts / VAs / Connections)
// A single, dense operational reference table per tab — not a report, just
// "everything CS needs to see about every Account/VA/Connection in one row,"
// computed fresh from the underlying sheets each time it's opened.
// ─────────────────────────────────────────

// ── ACCOUNTS TAB ──────────────────────────────────────────────────────
function getPlaybookAccounts() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var now = new Date();

    // Users — resolve CS Specialist name from their email address.
    // AssignedSpecialist stores the email; we need the display name for the
    // "CS Assigned" column (name on top, email as subtitle).
    var userNameByEmail = {};
    var usersSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
    if (usersSheet) {
      var usd = usersSheet.getDataRange().getValues();
      var ush = {}; usd[0].forEach(function(c,i){ if(c) ush[String(c)]=i; });
      for (var usi = 1; usi < usd.length; usi++) {
        var uEmail = String(usd[usi][ush['Email']]||'').toLowerCase().trim();
        var uName  = String(usd[usi][ush['Name']] ||'');
        if (uEmail) userNameByEmail[uEmail] = uName;
      }
    }

    // Contact Log — manual contact events logged by CS from the Playbook.
    // These are the highest-priority "last contact" signal since they represent
    // intentional outreach rather than system-derived activity timestamps.
    var contactLogByClient = {};
    var contactLogSheet = ss.getSheetByName('PlaybookContactLog');
    if (contactLogSheet) {
      var cld = contactLogSheet.getDataRange().getValues();
      var clhMap = {}; cld[0].forEach(function(c,i){ if(c) clhMap[String(c)]=i; });
      for (var cli2 = 1; cli2 < cld.length; cli2++) {
        var clClientId = String(cld[cli2][clhMap['ClientID']]||''); if (!clClientId) continue;
        var clDate = cld[cli2][clhMap['ContactDate']];
        var clChannel = String(cld[cli2][clhMap['Channel']]||'');
        if (!clDate) continue;
        var clD = clDate instanceof Date ? clDate : new Date(clDate);
        if (isNaN(clD.getTime())) continue;
        if (!contactLogByClient[clClientId] || clD > contactLogByClient[clClientId].date) {
          contactLogByClient[clClientId] = { date: clD, type: clChannel || 'Manual Log' };
        }
      }
    }

    // Customers (for AssignedSpecialist, PaymentDate)
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var custById = {};
    if (custSheet) {
      var cd = custSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
      for (var ci=1; ci<cd.length; ci++) {
        var cid = String(cd[ci][ch['CustomerID']]||''); if (!cid) continue;
        custById[cid] = {
          customerName: String(cd[ci][ch['CustomerName']]||''),
          assignedSpecialist: ch['AssignedSpecialist']!==undefined ? String(cd[ci][ch['AssignedSpecialist']]||'') : '',
          paymentDate: ch['PaymentDate']!==undefined ? cd[ci][ch['PaymentDate']] : null,
          noPaymentYet: ch['NoPaymentYet']!==undefined ? _toBool(cd[ci][ch['NoPaymentYet']]) : false
        };
      }
    }

    // Clients (the Accounts themselves)
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (!cliSheet) return { success:false, error:'Clients sheet not found.' };
    var ld = cliSheet.getDataRange().getValues();
    var lh = {}; ld[0].forEach(function(c,i){ if(c) lh[String(c)]=i; });

    // VARequests — seller onboarding date, target start date, and service
    // request activity as contact signals. Both CreatedAt (when the CS filed
    // the request) and UpdatedAt (when progress was last made) count as
    // contact events, since both represent direct CS-to-client interaction.
    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var reqByClient = {};
    var lastContactFromReq = {};
    if (reqSheet) {
      var rd = reqSheet.getDataRange().getValues();
      var rh = {}; rd[0].forEach(function(c,i){ if(c) rh[String(c).trim()]=i; });
      for (var ri=1; ri<rd.length; ri++) {
        var rclid = String(rd[ri][rh['ClientID']]||''); if (!rclid) continue;
        if (!reqByClient[rclid]) reqByClient[rclid] = [];
        reqByClient[rclid].push({
          requestId:            String(rd[ri][rh['RequestID']]||''),
          requestType:          String(rd[ri][rh['RequestType']]||''),
          sellerOnboardingDate: rd[ri][rh['SellerOnboardingDate']],
          targetStartDate:      rd[ri][rh['TargetStartDate']],
          createdAt:            rd[ri][rh['CreatedAt']]
        });
        // Both CreatedAt and UpdatedAt count — pick the more recent one.
        [rd[ri][rh['CreatedAt']], rd[ri][rh['UpdatedAt']]].forEach(function(val) {
          if (!val) return;
          var d = val instanceof Date ? val : new Date(val);
          if (isNaN(d.getTime())) return;
          if (!lastContactFromReq[rclid] || d > lastContactFromReq[rclid].date) {
            lastContactFromReq[rclid] = { date: d, type: 'Service Request' };
          }
        });
      }
    }

    // VAConnections — active VA counts. Use the established getVAConnections()
    // service (which already has robust trimming, header-map handling, and
    // status normalisation) instead of a raw sheet read, which was silently
    // failing when column headers had trailing spaces.
    var connByClient = {};
    var connRes0 = getVAConnections({});
    if (connRes0 && connRes0.success) {
      connRes0.data.forEach(function(c) {
        var cid = c.clientId; if (!cid) return;
        if (!connByClient[cid]) connByClient[cid] = [];
        connByClient[cid].push({
          connectionId:     c.connectionId,
          connectionStatus: (c.connectionStatus||'').trim(),
          connectionType:   (c.connectionType||'').trim(),
          actualStartDate:  c.actualStartDate || null
        });
      });
    }

    // Meetings — actual scheduled rows per account, keyed by MeetingTypeID,
    // plus the last COMPLETED meeting's UpdatedAt as a "last contact" signal.
    var mtgSheet = ss.getSheetByName(CONFIG.SHEETS.MEETINGS);
    var mtgByClient = {};
    var lastContactFromMtg = {};
    if (mtgSheet) {
      var md = mtgSheet.getDataRange().getValues();
      var mh = {}; md[0].forEach(function(c,i){ if(c) mh[String(c)]=i; });
      for (var mi=1; mi<md.length; mi++) {
        var mclid = String(md[mi][mh['ClientID']]||''); if (!mclid) continue;
        if (!mtgByClient[mclid]) mtgByClient[mclid] = [];
        var mStatus = String(md[mi][mh['Status']]||'');
        mtgByClient[mclid].push({
          meetingId:    String(md[mi][mh['MeetingID']]||''),
          meetingTypeId: String(md[mi][mh['MeetingTypeID']]||''),
          meetingTypeLabel: String(md[mi][mh['MeetingTypeLabel']]||''),
          scheduledDate: md[mi][mh['ScheduledDate']],
          status: mStatus,
          riskFlag: mh['RiskFlag'] !== undefined ? _toBool(md[mi][mh['RiskFlag']]) : false,
          riskReason: mh['RiskReason'] !== undefined ? String(md[mi][mh['RiskReason']]||'') : ''
        });
        if (mStatus === 'Completed') {
          var mUpdated = md[mi][mh['UpdatedAt']];
          if (mUpdated) {
            var mD = mUpdated instanceof Date ? mUpdated : new Date(mUpdated);
            if (!isNaN(mD.getTime()) && (!lastContactFromMtg[mclid] || mD > lastContactFromMtg[mclid].date)) {
              lastContactFromMtg[mclid] = { date: mD, type: 'Meeting' };
            }
          }
        }
      }
    }

    // ConnectionKPI — most recent entry per connection (regardless of
    // Weekly/Monthly type — whichever period date is actually latest),
    // for the new "KPI Status" column, per the request.
    var kpiByConnection = {}; // connectionId -> { status, periodDate }
    var kpiSheet = ss.getSheetByName('ConnectionKPI');
    if (kpiSheet) {
      var kd = kpiSheet.getDataRange().getValues();
      var kh = {}; kd[0].forEach(function(c,i){ if(c) kh[String(c)]=i; });
      for (var ki = 1; ki < kd.length; ki++) {
        var kConnId = String(kd[ki][kh['ConnectionID']]||''); if (!kConnId) continue;
        var kPeriodStr = _ckpiNormalizeDateValue(kd[ki][kh['PeriodDate']]);
        if (!kPeriodStr) continue;
        if (!kpiByConnection[kConnId] || kPeriodStr > kpiByConnection[kConnId].periodDate) {
          kpiByConnection[kConnId] = { status: String(kd[ki][kh['Status']]||''), periodDate: kPeriodStr };
        }
      }
    }

    // MeetingConcerns — the actual per-VA/connection concern log (distinct
    // from the account-level RiskFlag on the meeting itself). A concern can
    // be raised for one specific VA without the meeting's overall RiskFlag
    // necessarily being set, so this is checked as its own, more precise
    // signal for the "Risk Check" column.
    var hasOpenConcernByClient = {};
    var mcSheet = ss.getSheetByName(CONFIG.SHEETS.MEETING_CONCERNS);
    if (mcSheet) {
      var mcd = mcSheet.getDataRange().getValues();
      var mch = {}; mcd[0].forEach(function(c,i){ if(c) mch[String(c)]=i; });
      var mcMeetingToClient = {};
      // Meetings already read above via mtgByClient's own pass — re-derive
      // MeetingID -> ClientID here since that mapping wasn't kept.
      if (mtgSheet) {
        var mtgAllData = mtgSheet.getDataRange().getValues();
        var mtgAllH = {}; mtgAllData[0].forEach(function(c,i){ if(c) mtgAllH[String(c)]=i; });
        for (var mti = 1; mti < mtgAllData.length; mti++) {
          var mtId = String(mtgAllData[mti][mtgAllH['MeetingID']]||''); if (!mtId) continue;
          mcMeetingToClient[mtId] = String(mtgAllData[mti][mtgAllH['ClientID']]||'');
        }
      }
      for (var mci = 1; mci < mcd.length; mci++) {
        var mcFeedbackType = String(mcd[mci][mch['FeedbackType']]||'');
        if (mcFeedbackType !== 'Concern') continue;
        var mcMeetingId = String(mcd[mci][mch['MeetingID']]||''); if (!mcMeetingId) continue;
        var mcClientId = mcMeetingToClient[mcMeetingId]; if (!mcClientId) continue;
        hasOpenConcernByClient[mcClientId] = true;
      }
    }

    // Inquiries + InquiryUpdates — last contact signal #3.
    var iqSheet  = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
    var iqIdToClient = {};
    if (iqSheet) {
      var qd = iqSheet.getDataRange().getValues();
      var qh = {}; qd[0].forEach(function(c,i){ if(c) qh[String(c)]=i; });
      for (var qi=1; qi<qd.length; qi++) {
        var iqId = String(qd[qi][qh['InquiryID']]||''); if (!iqId) continue;
        iqIdToClient[iqId] = String(qd[qi][qh['ClientID']]||'');
      }
    }
    var lastContactFromIq = {};
    var iqUpdSheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRY_UPDATES);
    if (iqUpdSheet) {
      var ud = iqUpdSheet.getDataRange().getValues();
      var uh = {}; ud[0].forEach(function(c,i){ if(c) uh[String(c)]=i; });
      for (var ui=1; ui<ud.length; ui++) {
        var updIqId = String(ud[ui][uh['InquiryID']]||''); if (!updIqId) continue;
        var updClid = iqIdToClient[updIqId]; if (!updClid) continue;
        var postedAt = ud[ui][uh['PostedAt']] || ud[ui][uh['CreatedAt']];
        if (!postedAt) continue;
        var uD = postedAt instanceof Date ? postedAt : new Date(postedAt);
        if (isNaN(uD.getTime())) continue;
        if (!lastContactFromIq[updClid] || uD > lastContactFromIq[updClid].date) {
          lastContactFromIq[updClid] = { date: uD, type: 'Inquiry' };
        }
      }
    }

    var meetingTypesRes = getMeetingTypes();
    var meetingTypeDefs = (meetingTypesRes.success ? meetingTypesRes.data : []).filter(function(t){ return t.isActive; });

    function daysBetween(a, b) {
      if (!a || !b) return null;
      var d1 = a instanceof Date ? a : new Date(a);
      var d2 = b instanceof Date ? b : new Date(b);
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
      return Math.round((d2 - d1) / 86400000);
    }

    var rows = [];
    for (var i = 1; i < ld.length; i++) {
      var clientId = String(ld[i][lh['ClientID']]||''); if (!clientId) continue;
      var customerId = String(ld[i][lh['CustomerID']]||'');
      var custInfo = custById[customerId] || {};
      var companyName = String(ld[i][lh['CompanyName']]||'');
      var accountName = String(ld[i][lh['AccountName']]||'');

      var reqList = reqByClient[clientId] || [];
      var sellerOnboarding = null, targetStart = null;
      var firstRequestId = '';   // the SR carrying the SellerOnboardingDate we'd edit
      var hasNewSR = false;      // true when any SR has a SellerOnboardingDate set —
                                 // the edit button in the Playbook uses this to decide
                                 // whether to show a pencil or a ⚠ "No SR" indicator.
                                 // Previously gated on RequestType === 'New', which was
                                 // wrong — the onboarding date can live on any SR type.
      reqList.forEach(function(r) {
        if (r.sellerOnboardingDate) {
          var sod = new Date(r.sellerOnboardingDate);
          if (!isNaN(sod.getTime()) && (!sellerOnboarding || sod < sellerOnboarding)) {
            sellerOnboarding = sod;
            firstRequestId = r.requestId || '';
            hasNewSR = true;    // at least one SR has a SellerOnboardingDate
          }
        }
        if (r.targetStartDate) {
          var tsd = new Date(r.targetStartDate);
          if (!isNaN(tsd.getTime()) && (!targetStart || tsd < targetStart)) targetStart = tsd;
        }
      });
      // If no SR has a SellerOnboardingDate yet but at least one SR exists,
      // still allow editing (firstRequestId will be set to the first SR found).
      if (!hasNewSR && reqList.length) {
        firstRequestId = reqList[0].requestId || '';
        hasNewSR = true;
      }

      var connList = connByClient[clientId] || [];
      var startedConns = connList.filter(function(c){ return c.connectionStatus === 'Started'; });
      var regularActive = startedConns.filter(function(c){ return c.connectionType !== 'Project Based'; }).length;
      var projectActive = startedConns.filter(function(c){ return c.connectionType === 'Project Based'; }).length;

      // Risk Check — true if any meeting for this account has ever been
      // flagged with a concern, per the request.
      var acctMeetings = mtgByClient[clientId] || [];
      var riskCheck = acctMeetings.some(function(m){ return m.riskFlag; }) || !!hasOpenConcernByClient[clientId];

      // KPI Status — the worst (most concerning) status across this
      // account's connections' own most recent KPI entries, per the
      // request. An account-level table needs one value even when it has
      // several connections, so this surfaces whichever one most needs
      // attention rather than an arbitrary single connection's status.
      var KPI_PRIORITY = { 'Critical': 0, 'At Risk': 1, 'On Target': 2, 'No Data': 3 };
      var kpiStatus = 'No Data';
      var kpiPeriodDate = '';
      var kpiBestPriority = 4;
      connList.forEach(function(c) {
        var kpi = c.connectionId ? kpiByConnection[c.connectionId] : null;
        var thisStatus = kpi ? kpi.status : 'No Data';
        var thisPriority = KPI_PRIORITY[thisStatus] !== undefined ? KPI_PRIORITY[thisStatus] : 4;
        if (thisPriority < kpiBestPriority) { kpiBestPriority = thisPriority; kpiStatus = thisStatus; kpiPeriodDate = kpi ? kpi.periodDate : ''; }
      });

      // Days since payment:
      //   • If no VA has started yet → days from paymentDate to TODAY (ongoing pre-launch)
      //   • If at least one VA has started → days from paymentDate to the targetStartDate
      //     from the first New service request (the moment work officially began).
      //     This tells the CS how many days elapsed between payment and launch.
      var hasStartedVA = startedConns.length > 0;
      var daysSincePaymentVal = null;
      if (!custInfo.noPaymentYet && custInfo.paymentDate) {
        var payD = new Date(custInfo.paymentDate);
        if (!isNaN(payD.getTime())) {
          if (hasStartedVA && targetStart) {
            // Anchor to targetStart — how long from payment to scheduled work start
            daysSincePaymentVal = daysBetween(payD, targetStart);
          } else {
            // No VA yet — count up to today so CS can see how long the account
            // has been paid-but-not-yet-started
            daysSincePaymentVal = daysBetween(payD, now);
          }
        }
      }

      // Days since work start: based on the first New SR's targetStartDate, up to today.
      // This represents "how long has this account been actively running."
      var daysSinceWorkStartVal = targetStart ? daysBetween(targetStart, now) : null;

      var candidates = [
        lastContactFromReq[clientId],
        lastContactFromMtg[clientId],
        lastContactFromIq[clientId],
        contactLogByClient[clientId]
      ].filter(Boolean);
      var lastContact = null;
      candidates.forEach(function(c) { if (!lastContact || c.date > lastContact.date) lastContact = c; });

      // Fallback: if no other contact signal exists, treat the seller onboarding
      // date as the last known contact point (it represents when the CS first
      // actively engaged the account to begin the onboarding process).
      if (!lastContact && sellerOnboarding) {
        lastContact = { date: sellerOnboarding, type: 'Seller Onboarding' };
      }

      var csEmail = (custInfo.assignedSpecialist || '').toLowerCase().trim();
      var csName  = userNameByEmail[csEmail] || '';

      var mtgList = mtgByClient[clientId] || [];
      var mtgByType = {};
      mtgList.forEach(function(m) { mtgByType[m.meetingTypeId] = m; });
      var meetingCols = meetingTypeDefs.map(function(t) {
        var m = mtgByType[t.typeId];
        return {
          typeId: t.typeId, shortName: t.shortName || t.label,
          meetingId:     m ? (m.meetingId || '') : '',
          scheduledDate: m ? _sd(m.scheduledDate) : '',
          status:        m ? m.status : ''
        };
      });

      var upcomingMtgs = mtgList.filter(function(m){ return m.status === 'Upcoming' || m.status === 'Rescheduled'; });
      var overdueMtgs = upcomingMtgs.filter(function(m) {
        var sd = m.scheduledDate ? new Date(m.scheduledDate) : null;
        return sd && !isNaN(sd.getTime()) && sd < now;
      });
      var completedMtgs = mtgList.filter(function(m){ return m.status === 'Completed'; })
        .sort(function(a,b){ return new Date(b.scheduledDate||0) - new Date(a.scheduledDate||0); });
      var nextUpcomingMtgs = upcomingMtgs.filter(function(m){ return overdueMtgs.indexOf(m) === -1; })
        .sort(function(a,b){ return new Date(a.scheduledDate||0) - new Date(b.scheduledDate||0); });

      var clientStatus = String(ld[i][lh['Status']]||'').trim();

      rows.push({
        clientId: clientId,
        customerId: customerId,
        customerName: custInfo.customerName || '',
        companyName: companyName,
        accountName: accountName,
        status: clientStatus,
        csAssigned: custInfo.assignedSpecialist || '',
        csName:     csName,
        csEmail:    csEmail,
        firstPayment: custInfo.noPaymentYet ? '' : _sd(custInfo.paymentDate),
        noPaymentYet: !!custInfo.noPaymentYet,
        sellerOnboarding: sellerOnboarding ? sellerOnboarding.toISOString() : '',
        hasNewSR:         hasNewSR,
        firstRequestId:   firstRequestId,
        daysSincePayment:    daysSincePaymentVal,
        daysSinceWorkStart:  daysSinceWorkStartVal,
        hasStartedVA:        hasStartedVA,
        activeRegular: regularActive,
        activeProjectBased: projectActive,
        lastContactChannel: lastContact ? lastContact.type : '',
        lastContactDate: lastContact ? lastContact.date.toISOString() : '',
        daysSinceLastContact: lastContact ? daysBetween(lastContact.date, now) : null,
        meetingCols: meetingCols,
        cadenceOverdueCount: overdueMtgs.length,
        cadenceIsOverdue: overdueMtgs.length > 0,
        lastCompletedMeeting: completedMtgs.length ? { label: completedMtgs[0].meetingTypeLabel, date: _sd(completedMtgs[0].scheduledDate) } : null,
        nextUpcomingMeeting: nextUpcomingMtgs.length ? { label: nextUpcomingMtgs[0].meetingTypeLabel, date: _sd(nextUpcomingMtgs[0].scheduledDate) } : null,
        riskCheck: riskCheck,
        kpiStatus: kpiStatus,
        kpiPeriodDate: kpiPeriodDate
      });
    }

    rows.sort(function(a,b){ return (a.companyName||'').localeCompare(b.companyName||''); });
    return { success: true, data: rows, meetingTypeDefs: meetingTypeDefs };
  } catch (e) {
    return { success: false, error: 'getPlaybookAccounts: ' + e.message };
  }
}

// ── VAs TAB ────────────────────────────────────────────────────────────
function getPlaybookVAs() {
  try {
    var vaRes = getVAs({});
    if (!vaRes.success) return vaRes;

    var connRes = getVAConnections({});
    var allConns = (connRes && connRes.success) ? connRes.data : [];

    var activeClientsByVA = {};
    allConns.forEach(function(c) {
      if ((c.connectionStatus||'').trim() !== 'Started') return;
      if (!activeClientsByVA[c.vaId]) activeClientsByVA[c.vaId] = {};
      activeClientsByVA[c.vaId][c.clientId] = true;
    });

    var now = new Date();
    function daysBetween(a, b) {
      if (!a || !b) return null;
      var d1 = a instanceof Date ? a : new Date(a);
      var d2 = b instanceof Date ? b : new Date(b);
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
      return Math.round((d2 - d1) / 86400000);
    }

    var rows = vaRes.data.map(function(va) {
      var activeClients = activeClientsByVA[va.vaId] ? Object.keys(activeClientsByVA[va.vaId]).length : 0;
      return {
        vaId: va.vaId,
        vaName: va.vaName,
        hireDate: va.hireDate || '',
        daysWithCompany: va.hireDate ? daysBetween(va.hireDate, now) : null,
        activeClientsCount: activeClients,
        status: va.status || ''
      };
    });

    rows.sort(function(a,b){ return (a.vaName||'').localeCompare(b.vaName||''); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getPlaybookVAs: ' + e.message };
  }
}

// ── CONNECTIONS TAB ────────────────────────────────────────────────────
function getPlaybookConnections() {
  try {
    var connRes = getVAConnections({});
    if (!connRes.success) return connRes;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var cliById = {};
    if (cliSheet) {
      var cd = cliSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
      for (var i=1; i<cd.length; i++) {
        var clid = String(cd[i][ch['ClientID']]||''); if (!clid) continue;
        cliById[clid] = {
          companyName: String(cd[i][ch['CompanyName']]||''),
          accountName: String(cd[i][ch['AccountName']]||'')
        };
      }
    }

    // Most recent KPI entry per connection (regardless of Weekly/Monthly
    // type — whichever period date is actually latest), per the request
    // — falls back per-connection to whatever period actually has data,
    // rather than a single, all-or-nothing period across every row.
    var kpiByConnection = {};
    var kpiSheet = ss.getSheetByName('ConnectionKPI');
    if (kpiSheet) {
      var kd = kpiSheet.getDataRange().getValues();
      var kh = {}; kd[0].forEach(function(c,i){ if(c) kh[String(c)]=i; });
      for (var ki = 1; ki < kd.length; ki++) {
        var kConnId = String(kd[ki][kh['ConnectionID']]||''); if (!kConnId) continue;
        var kPeriodStr = _ckpiNormalizeDateValue(kd[ki][kh['PeriodDate']]);
        if (!kPeriodStr) continue;
        if (!kpiByConnection[kConnId] || kPeriodStr > kpiByConnection[kConnId].periodDate) {
          kpiByConnection[kConnId] = { status: String(kd[ki][kh['Status']]||''), periodDate: kPeriodStr };
        }
      }
    }

    var rows = connRes.data.map(function(c) {
      var cli = cliById[c.clientId] || {};
      var kpi = c.connectionId ? kpiByConnection[c.connectionId] : null;
      return {
        connectionId: c.connectionId,
        clientId: c.clientId,
        accountLabel: (cli.companyName||c.clientId) + (cli.accountName ? ' — '+cli.accountName : ''),
        vaId: c.vaId,
        vaName: c.vaName,
        workStartDate: c.actualStartDate || '',
        endDate: c.terminationDate || '',
        status: c.connectionStatus || '',
        kpiStatus: kpi ? kpi.status : 'No Data',
        kpiPeriodDate: kpi ? kpi.periodDate : ''
      };
    });

    rows.sort(function(a,b){ return new Date(b.workStartDate||b.assignedAt||0) - new Date(a.workStartDate||a.assignedAt||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getPlaybookConnections: ' + e.message };
  }
}

// ── Contact Log ────────────────────────────────────────────────────────
// Stores manual contact entries logged by CS directly from the Playbook
// table's "+" button. Each entry records who contacted whom, via which
// channel, on what date, with optional notes. The most recent entry per
// account is treated as the authoritative "last contact" signal, taking
// precedence over the system-derived signals (meeting timestamps, inquiry
// updates, service request updates) because it represents intentional,
// CS-verified outreach.
function addPlaybookContactLog(clientId, channel, contactDate, notes) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!clientId)    return { success: false, error: 'Client ID is required.' };
    if (!channel)     return { success: false, error: 'Channel is required.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Create the sheet if it doesn't exist yet — no need to add to initializeSystem
    // since it's created on first use here (lazy init pattern).
    var sheet = ss.getSheetByName('PlaybookContactLog');
    if (!sheet) {
      try {
        sheet = ss.insertSheet('PlaybookContactLog');
        sheet.appendRow(['LogID','ClientID','Channel','ContactDate','Notes','LoggedBy','LoggedAt']);
        sheet.getRange(1,1,1,7).setFontWeight('bold');
        sheet.setFrozenRows(1);
      } catch (createEx) {
        // Two clicks close together (or two users) can both see the sheet
        // as missing before either finishes creating it — the second
        // insertSheet() call then throws a raw "a sheet with this name
        // already exists" error. Re-fetch instead of letting that
        // propagate as an unclear failure — by the time we get here, the
        // other call has very likely already finished creating it.
        sheet = ss.getSheetByName('PlaybookContactLog');
        if (!sheet) return { success: false, error: 'Could not create the contact log sheet: ' + createEx.message };
      }
    }

    var now  = new Date();
    var logId = generateID('PCL');
    var contactD = contactDate ? (new Date(contactDate)) : now;
    if (isNaN(contactD.getTime())) contactD = now;

    sheet.appendRow([logId, clientId, channel, contactD, notes || '', perm.user.email, now]);
    _writeLog('PlaybookContactLog', logId, 'CREATE', 'ContactLog',
      '', channel + ' on ' + contactD.toDateString(), perm.user);

    return { success: true, logId: logId, contactDate: contactD.toISOString() };
  } catch (e) {
    return { success: false, error: 'addPlaybookContactLog: ' + e.message };
  }
}

// Returns the full contact log for a single account (most recent first).
function getPlaybookContactLog(clientId) {
  try {
    if (!clientId) return { success: false, error: 'Client ID required.' };
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('PlaybookContactLog');
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, data: [] };
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['ClientID']]||'') !== clientId) continue;
      var cd = data[i][h['ContactDate']];
      rows.push({
        logId:   String(data[i][h['LogID']]||''),
        channel: String(data[i][h['Channel']]||''),
        contactDate: cd instanceof Date ? cd.toISOString() : String(cd||''),
        notes:   String(data[i][h['Notes']]||''),
        loggedBy:String(data[i][h['LoggedBy']]||'')
      });
    }
    rows.sort(function(a,b){ return new Date(b.contactDate||0)-new Date(a.contactDate||0); });
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: 'getPlaybookContactLog: ' + e.message };
  }
}

// ── Inline field edits from the Playbook table ─────────────────────────

// Updates the Customer's First Payment date (and NoPaymentYet flag) directly
// from the Playbook table, without navigating to the full Customer profile.
// Only touches PaymentDate and NoPaymentYet — nothing else is changed.
function pbUpdateFirstPayment(customerId, paymentDateStr, noPaymentYet) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!customerId) return { success: false, error: 'Customer ID required.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!sheet) return { success: false, error: 'Customers sheet not found.' };

    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c).trim()]=i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['CustomerID']]||'') !== customerId) continue;
      var rowNum = i + 1;
      var now    = new Date();

      if (noPaymentYet) {
        if (h['PaymentDate']  !== undefined) sheet.getRange(rowNum, h['PaymentDate']  + 1).setValue('');
        if (h['NoPaymentYet'] !== undefined) sheet.getRange(rowNum, h['NoPaymentYet'] + 1).setValue(true);
      } else {
        var pd = new Date(paymentDateStr);
        if (isNaN(pd.getTime())) return { success: false, error: 'Invalid date.' };
        if (h['PaymentDate']  !== undefined) sheet.getRange(rowNum, h['PaymentDate']  + 1).setValue(pd);
        if (h['NoPaymentYet'] !== undefined) sheet.getRange(rowNum, h['NoPaymentYet'] + 1).setValue(false);
      }
      if (h['UpdatedAt'] !== undefined) sheet.getRange(rowNum, h['UpdatedAt'] + 1).setValue(now);
      if (h['UpdatedBy'] !== undefined) sheet.getRange(rowNum, h['UpdatedBy'] + 1).setValue(perm.user.email);
      _writeLog('Customer', customerId, 'UPDATE', 'PaymentDate',
        String(data[i][h['PaymentDate']]||''), noPaymentYet ? '(No Payment Yet)' : paymentDateStr, perm.user, noPaymentYet ? null : pd);
      return { success: true };
    }
    return { success: false, error: 'Customer not found.' };
  } catch (e) {
    return { success: false, error: 'pbUpdateFirstPayment: ' + e.message };
  }
}

// Updates SellerOnboardingDate on the service request that is the source of
// the account's seller onboarding date in the Playbook. If no request ID is
// provided, a new field cannot be set (the date lives on the SR, not the Client).
function pbUpdateSellerOnboarding(requestId, sellerOnboardingDateStr) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };
    if (!requestId) return { success: false, error: 'No service request found for this account. Create a New service request first to set the seller onboarding date.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (!sheet) return { success: false, error: 'VARequests sheet not found.' };

    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c).trim()]=i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h['RequestID']]||'') !== requestId) continue;
      var rowNum = i + 1;
      var sd = new Date(sellerOnboardingDateStr);
      if (isNaN(sd.getTime())) return { success: false, error: 'Invalid date.' };
      if (h['SellerOnboardingDate'] !== undefined) sheet.getRange(rowNum, h['SellerOnboardingDate'] + 1).setValue(sd);
      if (h['UpdatedAt']            !== undefined) sheet.getRange(rowNum, h['UpdatedAt']            + 1).setValue(new Date());
      if (h['UpdatedBy']            !== undefined) sheet.getRange(rowNum, h['UpdatedBy']            + 1).setValue(perm.user.email);
      _writeLog('VARequest', requestId, 'UPDATE', 'SellerOnboardingDate', '', sellerOnboardingDateStr, perm.user, sd);
      return { success: true };
    }
    return { success: false, error: 'Service request not found.' };
  } catch (e) {
    return { success: false, error: 'pbUpdateSellerOnboarding: ' + e.message };
  }
}