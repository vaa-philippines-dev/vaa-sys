// ─────────────────────────────────────────
// Router.gs — Web app entry point & server calls
// ─────────────────────────────────────────

function doGet(e) {
  try {
    var page  = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'dashboard';
    // Sub-page deep-link param (e.g. a specific customer/request id) — kept
    // separate from `page` so profile-style pages (customer-profile,
    // va-request-profile, etc.) can also survive a refresh, not just the
    // top-level page. See navigate() in scripts-core.html, which keeps this
    // in sync via history.replaceState() on every navigation.
    var param = (e && e.parameter && e.parameter.id) ? e.parameter.id : '';
    var template = HtmlService.createTemplateFromFile('app-shell');
    template.page  = page;
    template.param = param;
    return template.evaluate()
      .setTitle(CONFIG.APP_NAME)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    // Return a clean error page instead of leaking raw file content
    var errorHtml = '<!DOCTYPE html><html><head><title>CMS Error</title>' +
      '<style>body{font-family:system-ui,sans-serif;padding:40px;background:#f8f9fc;}' +
      '.box{max-width:600px;margin:0 auto;background:white;border-radius:12px;padding:32px;' +
      'border:1px solid #e4e8f0;box-shadow:0 4px 12px rgba(0,0,0,.08);}' +
      'h2{color:#ef4444;margin-top:0;}pre{background:#f1f5f9;padding:16px;border-radius:8px;' +
      'font-size:12px;overflow-x:auto;white-space:pre-wrap;color:#475569;}' +
      '.step{background:#eff6ff;border-left:3px solid #3b82f6;padding:12px 16px;' +
      'border-radius:0 8px 8px 0;margin:8px 0;font-size:13px;}' +
      '</style></head><body><div class="box">' +
      '<h2>⚠ CMS Setup Error</h2>' +
      '<p style="color:#64748b;font-size:14px;">The app failed to load. This is almost always caused by a <strong>duplicate function</strong> in your Apps Script project.</p>' +
      '<h3 style="font-size:14px;color:#0f172a;">How to fix:</h3>' +
      '<div class="step">1. Open your Apps Script project editor</div>' +
      '<div class="step">2. Look for a file called <strong>Code.gs</strong> — this is the default file GAS creates automatically</div>' +
      '<div class="step">3. If Code.gs exists and contains any functions (doGet, include, etc.), <strong>delete its entire content</strong> or delete the file entirely</div>' +
      '<div class="step">4. Make sure no two .gs files define the same function name</div>' +
      '<div class="step">5. Save all files and redeploy the Web App</div>' +
      '<details style="margin-top:16px;"><summary style="cursor:pointer;font-size:13px;color:#64748b;">Technical error details</summary>' +
      '<pre>' + String(err.message || err).replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre></details>' +
      '</div></body></html>';
    return HtmlService.createHtmlOutput(errorHtml)
      .setTitle('CMS — Setup Error');
  }
}

function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    // Return empty string rather than crashing the whole page
    Logger.log('include() failed for "' + filename + '": ' + err.message);
    return '<!-- include failed: ' + filename + ' -->';
  }
}

// ── Initialisation data — single round-trip ───────────────────────
function getInitialData() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) {
      return { success: false, error: (user && user.error) || 'Authentication failed.' };
    }
    // Only load what is essential for app shell setup.
    // Customers and dashboard stats are loaded lazily on first page render —
    // putting them here adds 2-4 seconds to every page load for no gain.
    return {
      success:  true,
      user:     user,
      settings: _tryGetSettingsMap()
    };
  } catch (e) {
    return { success: false, error: 'getInitialData: ' + e.message };
  }
}

function _tryGetSettingsMap()   { try { return getSettingsMap(); }  catch (e) { Logger.log('getSettingsMap: '  + e.message); return {};  } }
function _tryGetDashboardStats(){ try { return getDashboardStats();}catch (e) { Logger.log('getDashboardStats: '+ e.message); return _emptyStats(); } }
// NOTE (2026-07-11 fix): was calling plain getCustomers() here, which does NOT
// include activeVACount/openRequests. Since the dashboard is usually the first
// thing to load, it seeded CMS.customers on the frontend with un-enriched rows;
// the Customers page then saw a non-empty cache and skipped its own (enriched)
// reload, so "Active VAs" rendered blank for every row. Using the enriched
// fetch here keeps the cache correct no matter which page populates it first.
function _tryGetCustomers(preloaded)     { try { var r=getEnrichedCustomers({}, preloaded); return (r&&r.success)?r.data:[]; } catch (e) { Logger.log('getEnrichedCustomers: '+e.message); return []; } }
function _emptyStats() {
  return { totalCustomers:0, totalClients:0, activeClients:0, inactiveClients:0, terminatedClients:0, returningClients:0, recentActivity:[] };
}

// ── Combined dashboard data loader ─────────────────────────────────────────
// Replaces the 5+ sequential google.script.run calls that the dashboard was
// firing (getDashboardStats, getMyClientsForDash, getFollowUpReminders,
// getNotifications, getMeetingNotifications, getStatusMismatches).
// One round-trip instead of 5-7 = ~10-15 seconds faster initial render.
// Role-aware "what needs my attention right now" widget for the dashboard —
// CS Specialists see only their own open Service Requests and Concerns
// (Inquiries); every other role (Manager, CS Manager, Administrator, etc.)
// sees the company-wide open items, since those roles don't have a
// personal "mine" scope the way a CS Specialist does.
// Aggregates the notification categories for the dedicated Notifications
// View — reuses the existing scoped list functions (getVARequests,
// getInquiries, getAllVAConnectionHoursLogs_) rather than duplicating
// their role-based scoping logic here. Each category is capped to a
// reasonable preview count; the frontend can navigate to the full module
// for anything beyond that.
function getMyNotificationsSummary() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: (user && user.error) || 'Not authenticated.' };

    // 1) Service Requests currently needing my action — same
    // "personInChargeRole === my role" / "assigned to me" logic already
    // used for dashboard "YOUR TURN" highlighting, just surfaced here as
    // its own list rather than a highlight within a bigger table.
    var myRequests = [];
    try {
      var reqRes = getVARequests({});
      if (reqRes.success) {
        var myEmail = (user.email||'').toLowerCase().trim();
        var myTakeoverIds = getTakeoverCustomerIdsForSpecialist(myEmail);
        var myDept  = (user.department||'').toLowerCase().trim();
        myRequests = reqRes.data.filter(function(r) {
          if (r.status === 'Closed - Won' || r.status === 'Closed - Lost') return false;
          if (r.personInChargeRole === user.role) return true;
          if (user.role === CONFIG.ROLES.CS_SPECIALIST) {
            if ((r.assignedSpecialistEmail||'').toLowerCase().trim() === myEmail) return true;
            return myTakeoverIds.indexOf(String(r.customerId||'').trim()) !== -1;
          }
          if (user.role === CONFIG.ROLES.SERVICE_MANAGER) return myDept && (r.department||'').toLowerCase().trim() === myDept && r.currentStage === 'VA Assignment';
          return false;
        }).slice(0, 20);
      }
    } catch (reqEx) { Logger.log('getMyNotificationsSummary requests: ' + reqEx.message); }

    // 2) Hours/Schedule changes I haven't acknowledged yet — only
    // relevant for the roles that actually participate in that
    // acknowledgement system (Service Manager, HR, Accounting).
    var myHoursChanges = [];
    var ackRoleMap = { 'Service Manager':'serviceManager', 'HR Specialist':'hr', 'HR Manager':'hr', 'Accounting':'accounting' };
    var myAckRole = ackRoleMap[user.role];
    if (myAckRole) {
      try {
        var hoursRes = getAllVAConnectionHoursLogs_();
        if (hoursRes.success) {
          myHoursChanges = hoursRes.data.filter(function(l) {
            return l.applyStatus === 'Applied' && !l.fullyAcknowledged && !(l.ackStatus && l.ackStatus[myAckRole]);
          }).slice(0, 20);
        }
      } catch (hoursEx) { Logger.log('getMyNotificationsSummary hours: ' + hoursEx.message); }
    }

    // 3) Open Concerns/Inquiries relevant to me — getInquiries already
    // applies Service Manager's department scope server-side; for other
    // roles this is just "everything open."
    var myInquiries = [];
    try {
      var iqRes = getInquiries({});
      if (iqRes.success) {
        myInquiries = iqRes.data.filter(function(iq) {
          return iq.status !== 'Closed - Resolved' && iq.status !== 'Closed - Unresolved';
        }).slice(0, 20);
      }
    } catch (iqEx) { Logger.log('getMyNotificationsSummary inquiries: ' + iqEx.message); }

    return {
      success: true,
      requests: myRequests,
      requestsTotal: myRequests.length,
      hoursChanges: myHoursChanges,
      hoursChangesTotal: myHoursChanges.length,
      inquiries: myInquiries,
      inquiriesTotal: myInquiries.length,
      generatedAt: new Date().toISOString()
    };
  } catch (e) {
    return { success: false, error: 'getMyNotificationsSummary: ' + e.message };
  }
}

function getMyDashboardTickets(viewAsOverride) {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: 'Not signed in.' };
    // "View As" simulation support — an Administrator previewing another
    // role's dashboard needs the backend to actually compute as that role
    // would see it, not as the Administrator's own (unrestricted) role.
    // Only ever honored when the REAL logged-in user is genuinely an
    // Administrator — otherwise this parameter is silently ignored, so it
    // can't be used to spoof another role's scoped data.
    if (viewAsOverride && viewAsOverride.simulateRole && user.role === CONFIG.ROLES.ADMINISTRATOR) {
      user = { id: user.id, email: user.email, name: user.name, role: viewAsOverride.simulateRole, department: viewAsOverride.simulateDepartment || '', permissions: user.permissions };
    }
    var isSpecialist = user.role === CONFIG.ROLES.CS_SPECIALIST;
    var isServiceManager = user.role === CONFIG.ROLES.SERVICE_MANAGER;
    // These roles only ever exist in this system to act on their specific
    // step of the request workflow — showing them every open request
    // regardless of whose turn it is would just be noise. Unlike CS
    // Specialist/Service Manager (which have their own broader scoping
    // above/below), these are scoped purely by workflow ownership.
    var isWorkflowOnlyRole = [CONFIG.ROLES.HR_SPECIALIST, CONFIG.ROLES.HR_MANAGER, CONFIG.ROLES.RECRUITMENT, CONFIG.ROLES.TRAINING, CONFIG.ROLES.EXECUTIVE, CONFIG.ROLES.EXECUTIVE_SUPPORT].indexOf(user.role) !== -1;
    var myEmail = (user.email || '').toLowerCase().trim();
    var myTakeoverIds = getTakeoverCustomerIdsForSpecialist(myEmail);
    var myDept = (user.department || '').toLowerCase().trim();

    // A Service Manager only sees their own department's tickets/concerns.
    // Requests carry Department directly; Inquiries don't, so an inquiry's
    // department is derived from its Related VA (if one was linked) — one
    // with no related VA can't be reliably placed in a department, so it's
    // excluded from a department-scoped view rather than guessed at.
    var vaDeptByVAId = {};
    if (isServiceManager && myDept) {
      try {
        var vaRes = getVAs({});
        (vaRes && vaRes.success ? vaRes.data : []).forEach(function(v) {
          if (v.vaId) vaDeptByVAId[v.vaId] = (v.department || '').toLowerCase().trim();
        });
      } catch (vaErr) { /* fall through — scoping just won't match anything if this fails */ }
    }

    var reqRes = getVARequests({});
    var openRequests = (reqRes.success ? reqRes.data : []).filter(function(r) {
      if (r.status === 'Closed - Won' || r.status === 'Closed - Lost') return false;
      if (user.role === CONFIG.ROLES.EXECUTIVE_SUPPORT) return r.needsPaymentConfirmation;
      if (isWorkflowOnlyRole) {
        if (user.role === CONFIG.ROLES.HR_MANAGER) return r.personInChargeRole === CONFIG.ROLES.HR_SPECIALIST;
        return r.personInChargeRole === user.role;
      }
      if (isServiceManager) return myDept && (r.department || '').toLowerCase().trim() === myDept;
      if (!isSpecialist) return true;
      if ((r.assignedSpecialistEmail || '').toLowerCase().trim() === myEmail) return true;
      return myTakeoverIds.indexOf(String(r.customerId||'').trim()) !== -1;
    });
    // Flagged on every request regardless of role/scoping above, so the
    // dashboard can visually highlight "it's your turn" even for roles
    // (Administrator, CS Manager, etc.) that otherwise see everything.
    openRequests.forEach(function(r) { r.needsMyAction = (r.personInChargeRole === user.role); });

    var iqRes = getInquiries({});
    var openInquiries = (iqRes.success ? iqRes.data : []).filter(function(iq) {
      if (iq.status === 'Closed - Resolved' || iq.status === 'Closed - Unresolved') return false;
      if (isWorkflowOnlyRole) return false; // these roles don't work concerns/inquiries at all
      if (isServiceManager) {
        if (!myDept || !iq.relatedVAId) return false;
        return vaDeptByVAId[iq.relatedVAId] === myDept;
      }
      if (!isSpecialist) return true;
      if ((iq.assignedTo || '').toLowerCase().trim() === myEmail) return true;
      return myTakeoverIds.indexOf(String(iq.customerId||'').trim()) !== -1;
    });

    // Requests: whatever needs THIS user's action specifically comes first,
    // then oldest-open within each group — these need attention soonest.
    // Only the 5 longest-open show on the dashboard; "See all" links to
    // the full list.
    openRequests.sort(function(a,b){
      if (a.needsMyAction !== b.needsMyAction) return a.needsMyAction ? -1 : 1;
      return new Date(a.createdAt||0) - new Date(b.createdAt||0);
    });

    // Concerns: the dashboard only has room for what actually needs eyes on
    // it — Urgent/High priority, or anything that's been sitting open more
    // than a week — rather than every open concern regardless of how minor
    // or how fresh. The total count (for "See all") still reflects every
    // open concern, not just this filtered subset.
    var OLD_THRESHOLD_DAYS = 7;
    var now = new Date();
    function daysOpen(iq) {
      var created = new Date(iq.createdAt||0);
      return isNaN(created.getTime()) ? 0 : Math.floor((now - created) / 86400000);
    }
    var notableInquiries = openInquiries.filter(function(iq) {
      return iq.priority === 'Urgent' || iq.priority === 'High' || daysOpen(iq) >= OLD_THRESHOLD_DAYS;
    });
    var priorityRank = { 'Urgent': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
    notableInquiries.sort(function(a,b) {
      var pr = (priorityRank[a.priority]==null?4:priorityRank[a.priority]) - (priorityRank[b.priority]==null?4:priorityRank[b.priority]);
      if (pr !== 0) return pr;
      return new Date(a.createdAt||0) - new Date(b.createdAt||0); // oldest first within the same priority
    });

    // Open-requests-by-service breakdown — specifically useful for
    // Recruitment Specialist and Training Manager, who are otherwise just
    // looking at a flat list of requests waiting on them. Seeing "Amazon
    // VA: 5, PPC: 3" at a glance tells them where the workload actually is
    // before they click into anything.
    var serviceSummary = [];
    if (isWorkflowOnlyRole) {
      var countByService = {};
      openRequests.forEach(function(r) {
        var svc = r.service || '(Unspecified)';
        countByService[svc] = (countByService[svc] || 0) + 1;
      });
      serviceSummary = Object.keys(countByService).map(function(svc) {
        return { service: svc, count: countByService[svc] };
      }).sort(function(a,b){ return b.count - a.count; });
    }

    // Company-wide (unscoped) open-requests total + per-service breakdown
    // — specifically for Recruitment Specialist and Training Manager,
    // whose dashboard shows this alongside their own role-scoped queue
    // (serviceSummary above) so they can see both the overall picture and
    // what's specifically waiting on them, side by side. HR Specialist/HR
    // Manager do NOT belong in this group — they get the regular
    // isWorkflowOnlyRole ticket list below instead (the actual requests in
    // Rate Agreement, with "your turn" highlighting), not a company-wide
    // total they have no need to see.
    var isRecruitmentOrTraining = user.role === CONFIG.ROLES.RECRUITMENT || user.role === CONFIG.ROLES.TRAINING;
    var allOpenServiceSummary = [];
    var allOpenRequestsTotal = 0;
    if (isRecruitmentOrTraining) {
      var allOpen = (reqRes.success ? reqRes.data : []).filter(function(r) {
        return r.status !== 'Closed - Won' && r.status !== 'Closed - Lost';
      });
      allOpenRequestsTotal = allOpen.length;
      var countByServiceAll = {};
      allOpen.forEach(function(r) {
        var svc = r.service || '(Unspecified)';
        countByServiceAll[svc] = (countByServiceAll[svc] || 0) + 1;
      });
      allOpenServiceSummary = Object.keys(countByServiceAll).map(function(svc) {
        return { service: svc, count: countByServiceAll[svc] };
      }).sort(function(a,b){ return b.count - a.count; });
    }

    return {
      success: true,
      isSpecialist: isSpecialist,
      isServiceManager: isServiceManager,
      isWorkflowOnlyRole: isWorkflowOnlyRole,
      isRecruitmentOrTraining: isRecruitmentOrTraining,
      role: user.role,
      department: user.department || '',
      requests: openRequests.slice(0, 5),
      requestsTotal: openRequests.length,
      serviceSummary: serviceSummary,
      allOpenRequestsTotal: allOpenRequestsTotal,
      allOpenServiceSummary: allOpenServiceSummary,
      inquiries: notableInquiries.slice(0, 5),
      inquiriesTotal: openInquiries.length
    };
  } catch (e) {
    return { success: false, error: 'getMyDashboardTickets: ' + e.message };
  }
}

function getDashboardData() {
  var _gddStart = Date.now();
  try {
    var ssPreload = SpreadsheetApp.getActiveSpreadsheet();
    var preloaded = {};
    var cliSheetPreload = ssPreload.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (cliSheetPreload) {
      preloaded.cliData = cliSheetPreload.getDataRange().getValues();
      preloaded.cliH = {}; preloaded.cliData[0].forEach(function(c,i){ if(c) preloaded.cliH[String(c).trim()]=i; });
    }
    var connSheetPreload = ssPreload.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (connSheetPreload) {
      preloaded.connData = connSheetPreload.getDataRange().getValues();
      preloaded.connH = {}; preloaded.connData[0].forEach(function(c,i){ if(c) preloaded.connH[String(c).trim()]=i; });
    }
    Logger.log('[getDashboardData] Preloaded Clients + VAConnections — ' + (Date.now()-_gddStart) + 'ms elapsed so far');

    var stats     = _tryGetDashboardStats();
    Logger.log('[getDashboardData] _tryGetDashboardStats() done — ' + (Date.now()-_gddStart) + 'ms elapsed so far');
    var customers = _tryGetCustomers(preloaded);
    Logger.log('[getDashboardData] _tryGetCustomers() done — ' + (Date.now()-_gddStart) + 'ms elapsed so far');

    // Follow-up reminders — overdue, read directly from sheet (fast)
    var reminders = [];
    try {
      var ss4 = SpreadsheetApp.getActiveSpreadsheet();
      var fuSh = ss4.getSheetByName(CONFIG.SHEETS.FOLLOW_UPS || 'FollowUps');
      if (fuSh) {
        var fd = fuSh.getDataRange().getValues();
        var fh = {}; fd[0].forEach(function(c,i){ if(c) fh[String(c).trim()]=i; });
        var today = new Date(); today.setHours(0,0,0,0);
        for (var fi=1; fi<fd.length && reminders.length<20; fi++) {
          var fSt = String(fd[fi][fh['Status']]||'');
          if (fSt==='Completed') continue;
          var dueRaw = fd[fi][fh['DueDate']];
          var due = dueRaw instanceof Date ? dueRaw : (dueRaw ? new Date(dueRaw) : null);
          if (!due || due > today) continue;
          reminders.push({
            title:        String(fd[fi][fh['Title']]||fd[fi][fh['Description']]||'Follow-up'),
            customerName: String(fd[fi][fh['CustomerName']]||''),
            dueDate:      due.toISOString(),
            status:       fSt
          });
        }
      }
    } catch(e) { Logger.log('getDashboardData reminders: '+e.message); }

    // Notifications — recent activity from log (last 200 rows only, not full sheet scan)
    var notifications = [];
    try {
      var ss2 = SpreadsheetApp.getActiveSpreadsheet();
      var logSh = ss2.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
      if (logSh) {
        var lastRow = logSh.getLastRow();
        var readFrom = Math.max(2, lastRow - 199); // last 200 rows
        var readCount = lastRow - readFrom + 1;
        if (readCount > 0) {
          var hRow = logSh.getRange(1, 1, 1, logSh.getLastColumn()).getValues()[0];
          var lh = {}; hRow.forEach(function(c,i){ if(c) lh[String(c).trim()]=i; });
          var logRows = logSh.getRange(readFrom, 1, readCount, logSh.getLastColumn()).getValues();
          var now2 = new Date(), from7 = new Date(now2.getTime()-7*86400000);

          // Service Manager only ever sees notifications relevant to
          // them — new Service Requests in their own department, or any
          // ticket (Inquiry) activity — not every entity type's activity
          // company-wide, which is what everyone else still sees.
          var notifUser = getCurrentUser();
          var isServiceManagerNotif = notifUser && !notifUser.error && notifUser.role === CONFIG.ROLES.SERVICE_MANAGER;
          var notifMyDept = isServiceManagerNotif ? (notifUser.department || '').toLowerCase().trim() : '';
          var deptByReqForNotif = {};
          if (isServiceManagerNotif) {
            try {
              var reqSheetForNotif = ss2.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
              if (reqSheetForNotif) {
                var reqDataForNotif = reqSheetForNotif.getDataRange().getValues();
                var reqHForNotif = {}; reqDataForNotif[0].forEach(function(c,i){ if(c) reqHForNotif[String(c)]=i; });
                for (var rni = 1; rni < reqDataForNotif.length; rni++) {
                  var rniId = String(reqDataForNotif[rni][reqHForNotif['RequestID']]||''); if (!rniId) continue;
                  deptByReqForNotif[rniId] = String(reqDataForNotif[rni][reqHForNotif['Department']]||'').toLowerCase().trim();
                }
              }
            } catch (notifDeptEx) { Logger.log('getDashboardData notif dept scope: ' + notifDeptEx.message); }
          }

          logRows.forEach(function(row) {
            var ts2 = row[lh['Timestamp']];
            if (!ts2) return;
            var d2 = ts2 instanceof Date ? ts2 : new Date(ts2);
            if (isNaN(d2.getTime()) || d2 < from7) return;
            if (notifications.length >= 30) return;
            var entityTypeForRow = String(row[lh['EntityType']]||'');
            var entityIdForRow   = String(row[lh['EntityID']]||'');
            if (isServiceManagerNotif) {
              var isRelevantRequest = entityTypeForRow === 'VARequest' && deptByReqForNotif[entityIdForRow] === notifMyDept;
              var isRelevantTicket  = entityTypeForRow === 'Inquiry';
              if (!isRelevantRequest && !isRelevantTicket) return;
            }
            notifications.push({
              action:    String(row[lh['Action']]     ||''),
              entity:    entityTypeForRow,
              entityId:  entityIdForRow,
              changedBy: String(row[lh['ChangedBy']]  ||''),
              timestamp: d2.toISOString()
            });
          });
          notifications.sort(function(a,b){ return new Date(b.timestamp)-new Date(a.timestamp); });
        }
      }
    } catch(e) { Logger.log('getDashboardData notif: '+e.message); }

    // Upcoming meetings — next 14 days, read directly from sheet (no enrichment)
    var upcomingMeetings = [];
    try {
      var ss3 = SpreadsheetApp.getActiveSpreadsheet();
      var mtgSh3 = ss3.getSheetByName(CONFIG.SHEETS.MEETINGS || 'Meetings');
      if (mtgSh3) {
        var md = mtgSh3.getDataRange().getValues();
        var mh = {}; md[0].forEach(function(c,i){ if(c) mh[String(c).trim()]=i; });
        var now3 = new Date();
        var todayStart3 = new Date(now3.getFullYear(), now3.getMonth(), now3.getDate());
        var to7 = new Date(todayStart3.getTime()+7*86400000);

        // Client name + VA name (from the meeting's own AnchorConnectionID)
        // lookups — the raw IDs alone aren't useful to show on the
        // dashboard, and this widget previously only ever surfaced those.
        // Reuses the Clients/VAConnections data already read once at the
        // top of getDashboardData, rather than reading both sheets again.
        var cliNameById3 = {};
        try {
          if (preloaded.cliData) {
            for (var cli3 = 1; cli3 < preloaded.cliData.length; cli3++) {
              var cid3 = String(preloaded.cliData[cli3][preloaded.cliH['ClientID']]||''); if (!cid3) continue;
              cliNameById3[cid3] = String(preloaded.cliData[cli3][preloaded.cliH['CompanyName']]||'') + (preloaded.cliData[cli3][preloaded.cliH['AccountName']] ? ' — ' + String(preloaded.cliData[cli3][preloaded.cliH['AccountName']]) : '');
            }
          }
        } catch (cliLookupEx3) { Logger.log('getDashboardData meetings client lookup: ' + cliLookupEx3.message); }

        var vaNameByConnId3 = {};
        try {
          if (preloaded.connData) {
            for (var cvi3 = 1; cvi3 < preloaded.connData.length; cvi3++) {
              var cvid3 = String(preloaded.connData[cvi3][preloaded.connH['ConnectionID']]||''); if (!cvid3) continue;
              vaNameByConnId3[cvid3] = String(preloaded.connData[cvi3][preloaded.connH['VAName']]||'');
            }
          }
        } catch (connLookupEx3) { Logger.log('getDashboardData meetings VA lookup: ' + connLookupEx3.message); }

        for (var mi=1; mi<md.length && upcomingMeetings.length<20; mi++) {
          var mSt = String(md[mi][mh['Status']]||'');
          if (mSt==='Completed'||mSt==='Cancelled') continue;
          var sdRaw = md[mi][mh['ScheduledDate']||mh['MeetingDate']];
          var sd = sdRaw instanceof Date ? sdRaw : (sdRaw ? new Date(sdRaw) : null);
          if (!sd || isNaN(sd.getTime()) || sd < todayStart3 || sd > to7) continue;
          var mtgClientId  = String(md[mi][mh['ClientID']]||'');
          var mtgAnchorConn = mh['AnchorConnectionID'] !== undefined ? String(md[mi][mh['AnchorConnectionID']]||'') : '';
          upcomingMeetings.push({
            meetingId:    String(md[mi][mh['MeetingID']]||''),
            status:       mSt,
            scheduledDate:sd.toISOString(),
            meetingType:  mh['MeetingTypeLabel'] !== undefined ? String(md[mi][mh['MeetingTypeLabel']]||'') : String(md[mi][mh['MeetingType']]||''),
            clientId:     mtgClientId,
            customerId:   String(md[mi][mh['CustomerID']]||''),
            clientName:   cliNameById3[mtgClientId] || mtgClientId,
            vaName:       vaNameByConnId3[mtgAnchorConn] || '',
            scheduleEmailSentAt: mh['ScheduleEmailSentAt'] !== undefined ? (md[mi][mh['ScheduleEmailSentAt']] ? (md[mi][mh['ScheduleEmailSentAt']] instanceof Date ? md[mi][mh['ScheduleEmailSentAt']].toISOString() : String(md[mi][mh['ScheduleEmailSentAt']])) : '') : ''
          });
        }
      }
    } catch(e) { Logger.log('getDashboardData meetings: '+e.message); }

    // Status mismatches — customers/accounts with active VAs but wrong status
    var mismatches = [];
    try {
      var mm = _getDashStatusMismatches();
      mismatches = mm || [];
    } catch(e) { Logger.log('getDashboardData mismatches: '+e.message); }

    Logger.log('[getDashboardData] Complete — total ' + (Date.now()-_gddStart) + 'ms.');
    return {
      success:       true,
      stats:         stats,
      customers:     customers,
      reminders:     reminders,
      notifications: notifications,
      upcomingMeetings: upcomingMeetings,
      mismatches:    mismatches
    };
  } catch(e) {
    return { success: false, error: 'getDashboardData: ' + e.message };
  }
}

// Extract status-mismatch logic into a reusable helper
function _getDashStatusMismatches() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Active VA connections by customer and client
  var activeByClient = {}, activeByCustomer = {};
  var connSh = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
  if (connSh) {
    var cd = connSh.getDataRange().getValues();
    var coh = {}; cd[0].forEach(function(c,i){ if(c) coh[String(c).trim()]=i; });
    for (var ci=1; ci<cd.length; ci++) {
      if (String(cd[ci][coh['ConnectionStatus']]||'').trim()!=='Started') continue;
      var clid = String(cd[ci][coh['ClientID']]||''); if(clid) activeByClient[clid]=(activeByClient[clid]||0)+1;
      var cuid = String(cd[ci][coh['CustomerID']]||''); if(cuid) activeByCustomer[cuid]=(activeByCustomer[cuid]||0)+1;
    }
  }
  var mismatches = [];
  var custSh = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
  if (custSh) {
    var kd=custSh.getDataRange().getValues(), kh={};
    kd[0].forEach(function(c,i){if(c)kh[String(c).trim()]=i;});
    for (var ki=1;ki<kd.length;ki++) {
      var cid2=String(kd[ki][kh['CustomerID']]||''); if(!cid2) continue;
      var st=String(kd[ki][kh['Status']]||'');
      var hasActive=(activeByCustomer[cid2]||0)>0;
      if (hasActive && st!=='Active')
        mismatches.push({type:'customer',id:cid2,name:String(kd[ki][kh['CustomerName']]||''),status:st,issue:'Has active VA but status is '+st});
    }
  }
  return mismatches.slice(0,30);
}

// ── Dashboard stats ───────────────────────────────────────────────
function getDashboardStats() {
  var _dsStart = Date.now();
  function _dsLog(label) { Logger.log('[getDashboardStats] ' + label + ' — ' + (Date.now()-_dsStart) + 'ms elapsed so far'); }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var custData   = _safeGetData(ss, CONFIG.SHEETS.CUSTOMERS);
    var clientData = _safeGetData(ss, CONFIG.SHEETS.CLIENTS);
    var logData    = _safeGetData(ss, CONFIG.SHEETS.ACTIVITY_LOGS);
    _dsLog('Read Customers (' + (custData.length-1) + ' rows), Clients (' + (clientData.length-1) + ' rows), ActivityLogs (' + (logData.length-1) + ' rows)');

    var custH   = _headerMap(custData[0]);
    var clientH = _headerMap(clientData[0]);
    var logH    = _headerMap(logData[0]);

    var custRows   = _dataRows(custData,   custH,   'CustomerID');
    var clientRows = _dataRows(clientData, clientH, 'ClientID');
    var logRows    = _dataRows(logData,    logH,    'LogID');

    // CS Specialists only ever see counts for their own assigned customers
    // — this is the server-side source for the dashboard scorecards, which
    // previously showed company-wide totals to every role including CS
    // Specialist.
    var statsUser = getCurrentUser();
    var myCustomerIds = null; // null = no restriction (every other role)
    if (statsUser && !statsUser.error && statsUser.role === CONFIG.ROLES.CS_SPECIALIST) {
      var myEmail = (statsUser.email || '').toLowerCase().trim();
      var myTakeoverIdsForStats = getTakeoverCustomerIdsForSpecialist(myEmail);
      myCustomerIds = {};
      custRows.forEach(function(r) {
        var rCustId = String(r[custH['CustomerID']] || '');
        var rSpec = String(r[custH['AssignedSpecialist']] || '').toLowerCase().trim();
        if (rSpec === myEmail || myTakeoverIdsForStats.indexOf(rCustId) !== -1) {
          myCustomerIds[rCustId] = true;
        }
      });
      custRows   = custRows.filter(function(r) { return myCustomerIds[String(r[custH['CustomerID']] || '')]; });
      clientRows = clientRows.filter(function(r) { return myCustomerIds[String(r[clientH['CustomerID']] || '')]; });
    }
    // Service Manager only ever sees counts for their own department.
    // Customers/Clients have no Department field directly — it comes from
    // VAConnections' associated request — so this builds the set of
    // customer/client IDs that have at least one connection in this
    // department, the same way the scorecards' underlying VA Connections
    // count itself is scoped below.
    if (statsUser && !statsUser.error && statsUser.role === CONFIG.ROLES.SERVICE_MANAGER) {
      var myDeptForStats = (statsUser.department || '').toLowerCase().trim();
      myCustomerIds = {};
      var myClientIdsForStats = {};
      try {
        var reqDataForStats = _safeGetData(ss, CONFIG.SHEETS.VA_REQUESTS);
        var reqHForStats = _headerMap(reqDataForStats[0]);
        var deptByReqForStats = {};
        for (var rdi = 1; rdi < reqDataForStats.length; rdi++) {
          var rdiId = String(reqDataForStats[rdi][reqHForStats['RequestID']]||''); if (!rdiId) continue;
          deptByReqForStats[rdiId] = String(reqDataForStats[rdi][reqHForStats['Department']]||'').toLowerCase().trim();
        }
        var connDataForStats = _safeGetData(ss, CONFIG.SHEETS.VA_CONNECTIONS);
        var connHForStats = _headerMap(connDataForStats[0]);
        for (var cdi = 1; cdi < connDataForStats.length; cdi++) {
          var cdiReqId = String(connDataForStats[cdi][connHForStats['RequestID']]||'');
          if (deptByReqForStats[cdiReqId] !== myDeptForStats) continue;
          var cdiCustId = String(connDataForStats[cdi][connHForStats['CustomerID']]||'');
          var cdiCliId  = String(connDataForStats[cdi][connHForStats['ClientID']]||'');
          if (cdiCustId) myCustomerIds[cdiCustId] = true;
          if (cdiCliId)  myClientIdsForStats[cdiCliId] = true;
        }
      } catch (deptScopeEx) { Logger.log('getDashboardStats Service Manager dept scope: ' + deptScopeEx.message); }
      custRows   = custRows.filter(function(r) { return myCustomerIds[String(r[custH['CustomerID']] || '')]; });
      clientRows = clientRows.filter(function(r) { return myClientIdsForStats[String(r[clientH['ClientID']] || '')]; });
    }

    // ── Last 30 days window — defined first so the VAConnections block
    // below can reference it. (Moving it here fixes a ReferenceError that
    // caused getDashboardStats to silently return _emptyStats() on every
    // call: the connSheet block was using from30 before it was declared.)
    var now30  = new Date();
    var from30 = new Date(now30.getFullYear(), now30.getMonth(), now30.getDate() - 29);

    // Active VA Connections + new connections in the last 30 days
    var activeVAConnections  = 0;
    var pendingVAConnections = 0; // Accepted/Pending = assigned but not yet started
    var pausedVAConnections  = 0;
    var last30Connections    = [];
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (connSheet) {
      var connD = connSheet.getDataRange().getValues();
      var connH = _headerMap(connD[0]);
      if (connH['ConnectionStatus'] !== undefined) {
        for (var ci = 1; ci < connD.length; ci++) {
          // Same "my customers only" scoping as above, applied per-row.
          if (myCustomerIds && !myCustomerIds[String(connD[ci][connH['CustomerID']] || '')]) continue;
          // Service Manager additionally needs THIS SPECIFIC connection to
          // be in their department — a customer can have connections
          // across multiple departments, so the customer-level filter
          // above isn't precise enough on its own for this count.
          if (statsUser && !statsUser.error && statsUser.role === CONFIG.ROLES.SERVICE_MANAGER) {
            var connReqIdForDept = String(connD[ci][connH['RequestID']]||'');
            if ((deptByReqForStats[connReqIdForDept]||'') !== myDeptForStats) continue;
          }
          var connStatus = String(connD[ci][connH['ConnectionStatus']]||'').trim();
          if (connStatus === CONFIG.VA_CONNECTION_STATUS.STARTED)  activeVAConnections++;
          if (connStatus === 'Paused')                             pausedVAConnections++;
          if (connStatus === CONFIG.VA_CONNECTION_STATUS.PENDING ||
              connStatus === CONFIG.VA_CONNECTION_STATUS.ACCEPTED) pendingVAConnections++;
          var startD = connD[ci][connH['ActualStartDate']] || connD[ci][connH['AssignedAt']];
          if (startD) {
            var startDate = startD instanceof Date ? startD : new Date(startD);
            if (!isNaN(startDate.getTime()) && startDate >= from30) {
              last30Connections.push({
                name:   String(connD[ci][connH['VAName']]  || ''),
                status: connStatus,
                date:   startDate.toISOString()
              });
            }
          }
        }
      }
      last30Connections.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
    }

    logRows.sort(function (a, b) {
      var tsA = a[logH['Timestamp']]; if (tsA instanceof Date) tsA = tsA.getTime(); else tsA = new Date(tsA||0).getTime();
      var tsB = b[logH['Timestamp']]; if (tsB instanceof Date) tsB = tsB.getTime(); else tsB = new Date(tsB||0).getTime();
      return tsB - tsA;
    });

    // ── Last 30 days: new customers and accounts
    function last30new(rows, h, idCol) {
      return rows.filter(function(r) {
        var d = r[h['CreatedAt']]; if (d instanceof Date) {} else d = new Date(d||0);
        return d >= from30;
      }).map(function(r) {
        return {
          name:   String(r[h['CustomerName']] || r[h['CompanyName']] || r[h['AccountName']] || ''),
          status: String(r[h['Status']] || ''),
          date:   (r[h['CreatedAt']] instanceof Date) ? r[h['CreatedAt']].toISOString() : String(r[h['CreatedAt']]||'')
        };
      }).sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
    }

    // ── "Important Changes" — last 7 days, replacing the old 30-day
    // new-customers/accounts/connections panels with what's actually
    // actionable day to day: new Service Requests, and new Hours/Schedule
    // changes. Scoped by the same customer/department restrictions
    // already applied elsewhere in this function.
    var now7  = new Date();
    var from7 = new Date(now7.getFullYear(), now7.getMonth(), now7.getDate() - 6);
    var last7Requests = [];
    var custNameById = {};
    try { custRows.forEach(function(r){ if (r[custH['CustomerID']]) custNameById[String(r[custH['CustomerID']])] = String(r[custH['CustomerName']]||''); }); }
    catch (custNameEx) { Logger.log('getDashboardStats custNameById build: ' + custNameEx.message); }
    try {
      var reqSheetForLast7 = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
      if (reqSheetForLast7) {
        var reqDataForLast7 = reqSheetForLast7.getDataRange().getValues();
        var reqHForLast7 = _headerMap(reqDataForLast7[0]);
        for (var r7i = 1; r7i < reqDataForLast7.length; r7i++) {
          var r7CreatedAt = reqDataForLast7[r7i][reqHForLast7['CreatedAt']];
          var r7Date = r7CreatedAt instanceof Date ? r7CreatedAt : new Date(r7CreatedAt||0);
          if (isNaN(r7Date.getTime()) || r7Date < from7) continue;
          if (myCustomerIds && !myCustomerIds[String(reqDataForLast7[r7i][reqHForLast7['CustomerID']]||'')]) continue;
          // Per this report — only genuinely still-new requests (still at
          // Request Intake) belong in a "New Service Request" feed. A
          // request created recently but already progressed to VA
          // Assignment or later isn't "new" anymore, even if it's still
          // within the last 7 days by creation date.
          var r7CurrentStage = String(reqDataForLast7[r7i][reqHForLast7['CurrentStage']]||'');
          if (r7CurrentStage && r7CurrentStage !== 'Request Intake') continue;
          if (statsUser && !statsUser.error && statsUser.role === CONFIG.ROLES.SERVICE_MANAGER) {
            if ((String(reqDataForLast7[r7i][reqHForLast7['Department']]||'').toLowerCase().trim()) !== myDeptForStats) continue;
          }
          var r7CustId = String(reqDataForLast7[r7i][reqHForLast7['CustomerID']]||'');
          var r7Service = String(reqDataForLast7[r7i][reqHForLast7['Service']]||'Service');
          var r7CustName = custNameById[r7CustId] || r7CustId || 'a customer';
          last7Requests.push({
            category: 'New Service Request',
            requestId: String(reqDataForLast7[r7i][reqHForLast7['RequestID']]||''),
            name:   'New request for ' + r7Service + ' from ' + r7CustName,
            status: String(reqDataForLast7[r7i][reqHForLast7['Status']] || ''),
            changedBy: String(reqDataForLast7[r7i][reqHForLast7['CreatedBy']]||''),
            date:   r7Date.toISOString()
          });
        }
        last7Requests.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
      }
    } catch (last7ReqEx) { Logger.log('getDashboardStats last7Requests: ' + last7ReqEx.message); }

    // Shared lookups for the hours-changes / VA-connected / VA-terminated
    // sections below — built once, reused across all three so each
    // doesn't re-scan the same sheets independently.
    var connDataForLast7 = connD || [];
    var connHForLast7 = connH || {};
    var custIdByConn = {}, deptByConnReq = {}, vaNameByConn = {};
    if (connDataForLast7.length) {
      for (var c7i = 1; c7i < connDataForLast7.length; c7i++) {
        var c7id = String(connDataForLast7[c7i][connHForLast7['ConnectionID']]||''); if (!c7id) continue;
        custIdByConn[c7id] = String(connDataForLast7[c7i][connHForLast7['CustomerID']]||'');
        deptByConnReq[c7id] = deptByReqForStats ? (deptByReqForStats[String(connDataForLast7[c7i][connHForLast7['RequestID']]||'')]||'') : '';
        vaNameByConn[c7id]  = String(connDataForLast7[c7i][connHForLast7['VAName']]||'a VA');
      }
    }
    function passesScope(connId) {
      if (myCustomerIds && !myCustomerIds[custIdByConn[connId]||'']) return false;
      if (statsUser && !statsUser.error && statsUser.role === CONFIG.ROLES.SERVICE_MANAGER) {
        if ((deptByConnReq[connId]||'') !== myDeptForStats) return false;
      }
      return true;
    }

    var last7HoursChanges = [];
    _dsLog('Starting last7HoursChanges (reads VAConnectionHoursLog in full)');
    try {
      var hoursSheetForLast7 = ss.getSheetByName('VAConnectionHoursLog');
      if (hoursSheetForLast7) {
        var hoursDataForLast7 = hoursSheetForLast7.getDataRange().getValues();
        var hoursHForLast7 = {}; hoursDataForLast7[0].forEach(function(c,i){ if(c) hoursHForLast7[String(c).trim()]=i; });
        for (var h7i = 1; h7i < hoursDataForLast7.length; h7i++) {
          var h7ChangeType = String(hoursDataForLast7[h7i][hoursHForLast7['ChangeType']]||'');
          // Initial Assignment is the setup that happens automatically
          // when a VA is first assigned — not a "change" in the sense
          // meant here, which is specifically about an existing
          // schedule/hours arrangement actually being modified.
          if (h7ChangeType === 'Initial Assignment') continue;
          // Per the same confirmation workflow used everywhere else this
          // log is read — a Pending or Cancelled change hasn't actually
          // taken effect, so it shouldn't be reported here as "changed"
          // yet. Blank ApplyStatus (rows logged before this field
          // existed) is treated as Applied, for backward compatibility.
          var h7ApplyStatus = hoursHForLast7['ApplyStatus'] !== undefined ? String(hoursDataForLast7[h7i][hoursHForLast7['ApplyStatus']]||'') : '';
          if (h7ApplyStatus === 'Pending' || h7ApplyStatus === 'Cancelled') continue;
          var h7CreatedAt = hoursDataForLast7[h7i][hoursHForLast7['CreatedAt']];
          var h7Date = h7CreatedAt instanceof Date ? h7CreatedAt : new Date(h7CreatedAt||0);
          if (isNaN(h7Date.getTime()) || h7Date < from7) continue;
          var h7ConnId = String(hoursDataForLast7[h7i][hoursHForLast7['ConnectionID']]||'');
          if (!passesScope(h7ConnId)) continue;
          var h7CustName = custNameById[custIdByConn[h7ConnId]] || custIdByConn[h7ConnId] || 'a customer';
          var h7PrevHours = hoursHForLast7['PrevHours'] !== undefined ? hoursDataForLast7[h7i][hoursHForLast7['PrevHours']] : '';
          var h7NewHours  = hoursHForLast7['NewHours']  !== undefined ? hoursDataForLast7[h7i][hoursHForLast7['NewHours']]  : '';
          var h7HoursDetail = (h7PrevHours !== '' && h7NewHours !== '') ? (' (' + h7PrevHours + 'h → ' + h7NewHours + 'h)') : '';
          var h7LoggedBy = hoursHForLast7['LoggedBy'] !== undefined ? String(hoursDataForLast7[h7i][hoursHForLast7['LoggedBy']]||'') : '';
          last7HoursChanges.push({
            category: 'Hours/Schedule Change',
            connectionId: h7ConnId,
            name:   (vaNameByConn[h7ConnId]||'A VA') + '\u2019s hours/schedule changed for ' + h7CustName + h7HoursDetail,
            status: '',
            changedBy: h7LoggedBy,
            date:   h7Date.toISOString()
          });
        }
        last7HoursChanges.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
      }
    } catch (last7HrsEx) { Logger.log('getDashboardStats last7HoursChanges: ' + last7HrsEx.message); }

    // VA Connected / VA Terminated — built directly from each connection's
    // own ActualStartDate / TerminationDate, rather than scanning Activity
    // Logs, since these two dates are already the authoritative record of
    // when each of those events actually happened.
    var last7VAConnected = [], last7VATerminated = [], last7VAPaused = [];
    try {
      if (connDataForLast7.length) {
        for (var vc7i = 1; vc7i < connDataForLast7.length; vc7i++) {
          var vc7Id = String(connDataForLast7[vc7i][connHForLast7['ConnectionID']]||''); if (!vc7Id) continue;
          if (!passesScope(vc7Id)) continue;
          var vc7CustName = custNameById[custIdByConn[vc7Id]] || custIdByConn[vc7Id] || 'a customer';
          var vc7VAName = vaNameByConn[vc7Id] || 'A VA';

          var vc7UpdatedBy = String(connDataForLast7[vc7i][connHForLast7['UpdatedBy']]||'');

          var vc7Started = connDataForLast7[vc7i][connHForLast7['ActualStartDate']];
          var vc7StartedDate = vc7Started instanceof Date ? vc7Started : new Date(vc7Started||0);
          if (!isNaN(vc7StartedDate.getTime()) && vc7Started && vc7StartedDate >= from7) {
            last7VAConnected.push({ category: 'VA Connected', connectionId: vc7Id, name: vc7VAName + ' has been connected to ' + vc7CustName, status: '', changedBy: vc7UpdatedBy, date: vc7StartedDate.toISOString() });
          }

          var vc7Term = connDataForLast7[vc7i][connHForLast7['TerminationDate']];
          var vc7TermDate = vc7Term instanceof Date ? vc7Term : new Date(vc7Term||0);
          if (!isNaN(vc7TermDate.getTime()) && vc7Term && vc7TermDate >= from7) {
            last7VATerminated.push({ category: 'VA Terminated', connectionId: vc7Id, name: vc7VAName + ' has been terminated for ' + vc7CustName, status: '', changedBy: vc7UpdatedBy, date: vc7TermDate.toISOString() });
          }

          if (connHForLast7['LastPausedAt'] !== undefined) {
            var vc7Paused = connDataForLast7[vc7i][connHForLast7['LastPausedAt']];
            var vc7PausedDate = vc7Paused instanceof Date ? vc7Paused : new Date(vc7Paused||0);
            // Only counts as a currently-relevant pause event if the
            // connection is still actually Paused right now — otherwise
            // this is a stale timestamp from a pause that's since ended.
            var vc7CurrentlyPaused = String(connDataForLast7[vc7i][connHForLast7['ConnectionStatus']]||'') === 'Paused';
            if (vc7CurrentlyPaused && !isNaN(vc7PausedDate.getTime()) && vc7Paused && vc7PausedDate >= from7) {
              last7VAPaused.push({ category: 'VA Paused', connectionId: vc7Id, name: vc7VAName + ' has been paused for ' + vc7CustName, status: '', changedBy: vc7UpdatedBy, date: vc7PausedDate.toISOString() });
            }
          }
        }
        last7VAConnected.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
        last7VATerminated.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
        last7VAPaused.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
      }
    } catch (vaEventEx) { Logger.log('getDashboardStats VA connected/terminated: ' + vaEventEx.message); }

    var last7CustTerminated = [], last7CustPaused = [];
    try {
      var custLogSheet = ss.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
      if (custLogSheet) {
        var custLogData = custLogSheet.getDataRange().getValues();
        var clh = {}; custLogData[0].forEach(function(c,i){ if(c) clh[String(c).trim()]=i; });
        for (var cli = 1; cli < custLogData.length; cli++) {
          if (String(custLogData[cli][clh['EntityType']]||'') !== 'Customer') continue;
          var fieldChanged = String(custLogData[cli][clh['FieldChanged']]||'').toLowerCase();
          if (fieldChanged !== 'status') continue;
          var newVal = String(custLogData[cli][clh['NewValue']]||'');
          if (['Terminated','Cancelled','Paused'].indexOf(newVal) === -1) continue;

          var evDateRaw = custLogData[cli][clh['EffectiveDate']] || custLogData[cli][clh['Timestamp']];
          var evDate = evDateRaw instanceof Date ? evDateRaw : new Date(evDateRaw||0);
          if (isNaN(evDate.getTime()) || evDate < from7) continue;

          var custIdForLog = String(custLogData[cli][clh['EntityID']]||'');
          var custNameForLog = custNameById[custIdForLog] || custIdForLog || 'A customer';
          var changedByForLog = String(custLogData[cli][clh['ChangedByEmail']] || custLogData[cli][clh['ChangedBy']] || '');

          if (newVal === 'Paused') {
            last7CustPaused.push({ category: 'Customer Paused', customerId: custIdForLog, name: custNameForLog + ' has been paused', status: '', changedBy: changedByForLog, date: evDate.toISOString() });
          } else {
            last7CustTerminated.push({ category: 'Customer Terminated', customerId: custIdForLog, name: custNameForLog + ' has been terminated', status: '', changedBy: changedByForLog, date: evDate.toISOString() });
          }
        }
        last7CustTerminated.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
        last7CustPaused.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
      }
    } catch (custEventEx) { Logger.log('getDashboardStats Customer terminated/paused: ' + custEventEx.message); }

    _dsLog('All sections complete — about to return');
    return {
      totalCustomers:    custRows.length,
      totalClients:      clientRows.length,
      activeClients:     _countWhere(clientRows, clientH, 'Status', CONFIG.STATUS.ACTIVE),
      pausedClients:     _countWhere(clientRows, clientH, 'Status', CONFIG.STATUS.PAUSED),
      pendingClients:    _countWhere(clientRows, clientH, 'Status', CONFIG.STATUS.PENDING),
      inactiveClients:   _countWhere(clientRows, clientH, 'Status', CONFIG.STATUS.INACTIVE),
      terminatedClients: _countWhere(clientRows, clientH, 'Status', CONFIG.STATUS.TERMINATED),
      returningClients:  _countWhere(clientRows, clientH, 'IsReturning', true),
      activeCustomers:   _countWhere(custRows,   custH,   'Status', CONFIG.STATUS.ACTIVE),
      pausedCustomers:   _countWhere(custRows,   custH,   'Status', CONFIG.STATUS.PAUSED),
      pendingCustomers:  _countWhere(custRows,   custH,   'Status', CONFIG.STATUS.PENDING),
      activeVAConnections:  activeVAConnections,
      pendingVAConnections: pendingVAConnections,
      pausedVAConnections:  pausedVAConnections,
      last30Connections:   last30Connections,
      last30Customers:   last30new(custRows,   custH,   'CustomerID'),
      last30Accounts:    last30new(clientRows, clientH, 'ClientID'),
      last7Requests:       last7Requests,
      last7HoursChanges:   last7HoursChanges,
      last7VAConnected:    last7VAConnected,
      last7VATerminated:   last7VATerminated,
      last7VAPaused:       last7VAPaused,
      last7CustTerminated: last7CustTerminated,
      last7CustPaused:     last7CustPaused,
      recentActivity:    logRows.slice(0, 10).map(function (row) {
        var ts = row[logH['Timestamp']];
        return {
          action:    String(row[logH['Action']]       || ''),
          entity:    String(row[logH['EntityType']]   || ''),
          entityId:  String(row[logH['EntityID']]     || ''),
          field:     String(row[logH['FieldChanged']] || ''),
          changedBy: String(row[logH['ChangedBy']]    || ''),
          timestamp: (ts instanceof Date) ? ts.toISOString() : String(ts || '')
        };
      })
    };
  } catch (e) {
    Logger.log('getDashboardStats: ' + e.message);
    return _emptyStats();
  }
}

// ── Detect Customers/Accounts that have a Started VA Connection but whose
// own status isn't Active — a real inconsistency worth flagging, since it
// usually means the status field just never got updated when the VA
// actually started (e.g. customer/account created as Pending, then a VA
// was assigned and started, but nobody flipped the status to Active).
// Checked independently per your design: a Customer can be flagged even if
// its Account is fine, and vice versa.
function getActiveVAStatusMismatches() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var cliSheet  = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!custSheet || !cliSheet || !connSheet) return { success: true, customers: [], accounts: [] };

    var custData = custSheet.getDataRange().getValues();
    var cliData  = cliSheet.getDataRange().getValues();
    var connData = connSheet.getDataRange().getValues();
    var ch  = {}; custData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
    var clh = {}; cliData[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
    var coh = {}; connData[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });

    // Which customerIds / clientIds have at least one Started connection
    var custHasStarted = {}, cliHasStarted = {};
    for (var i = 1; i < connData.length; i++) {
      if (String(connData[i][coh['ConnectionStatus']]||'') !== 'Started') continue;
      var custId = String(connData[i][coh['CustomerID']]||'');
      var cliId  = String(connData[i][coh['ClientID']]||'');
      if (custId) custHasStarted[custId] = true;
      if (cliId)  cliHasStarted[cliId]  = true;
    }

    var customers = [];
    for (var ci = 1; ci < custData.length; ci++) {
      var cId = String(custData[ci][ch['CustomerID']]||''); if (!cId) continue;
      if (!custHasStarted[cId]) continue;
      var cSt = String(custData[ci][ch['Status']]||'');
      if (cSt === CONFIG.STATUS.ACTIVE) continue;
      customers.push({ customerId: cId, customerName: String(custData[ci][ch['CustomerName']]||''), status: cSt });
    }

    var accounts = [];
    for (var li = 1; li < cliData.length; li++) {
      var lId = String(cliData[li][clh['ClientID']]||''); if (!lId) continue;
      if (!cliHasStarted[lId]) continue;
      var lSt = String(cliData[li][clh['Status']]||'');
      if (lSt === CONFIG.STATUS.ACTIVE) continue;
      accounts.push({
        clientId: lId,
        customerId: String(cliData[li][clh['CustomerID']]||''),
        companyName: String(cliData[li][clh['CompanyName']]||''),
        accountName: String(cliData[li][clh['AccountName']]||''),
        status: lSt
      });
    }

    return { success: true, customers: customers, accounts: accounts };
  } catch (e) {
    return { success: false, error: 'getActiveVAStatusMismatches: ' + e.message };
  }
}

// Flip a Customer or Account's status to Active from the dashboard
// notification prompt — a deliberately narrow, single-purpose endpoint
// (just the status field) rather than reusing the full updateCustomer/
// updateClient forms, since this is a one-click fix for a specific
// detected inconsistency, not a general edit.
function fixActiveVAStatusMismatch(entityType, entityId) {
  try {
    var perm = checkPermission('edit');
    if (!perm.allowed) return { success: false, error: 'Permission denied.' };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = entityType === 'customer' ? CONFIG.SHEETS.CUSTOMERS : CONFIG.SHEETS.CLIENTS;
    var idCol     = entityType === 'customer' ? 'CustomerID' : 'ClientID';
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { success: false, error: 'Sheet not found.' };

    var data = sheet.getDataRange().getValues();
    var h = {}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][h[idCol]]||'') !== entityId) continue;
      var oldStatus = String(data[i][h['Status']]||'');
      sheet.getRange(i+1, h['Status'] + 1).setValue(CONFIG.STATUS.ACTIVE);
      if (h['StatusDate'] !== undefined) sheet.getRange(i+1, h['StatusDate'] + 1).setValue(new Date());
      if (h['UpdatedAt']  !== undefined) sheet.getRange(i+1, h['UpdatedAt']  + 1).setValue(new Date());
      if (h['UpdatedBy']  !== undefined) sheet.getRange(i+1, h['UpdatedBy']  + 1).setValue(perm.user.email);
      _writeLog(entityType === 'customer' ? 'Customer' : 'Client', entityId, 'UPDATE', 'Status', oldStatus, CONFIG.STATUS.ACTIVE, perm.user);
      return { success: true };
    }
    return { success: false, error: 'Record not found.' };
  } catch (e) {
    return { success: false, error: 'fixActiveVAStatusMismatch: ' + e.message };
  }
}

// ── Settings map (dropdown data) ─────────────────────────────────
function getSettingsMap() {
  try {
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    var data = _safeGetData(ss, CONFIG.SHEETS.SETTINGS);
    var h    = _headerMap(data[0]);
    if (h['SettingID'] === undefined) return {};
    var result = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[h['SettingID']]) continue;
      if (row[h['IsActive']] === false || row[h['IsActive']] === 'false' || row[h['IsActive']] === 0) continue;
      var cat = String(row[h['Category']] || '');
      if (!cat) continue;
      if (!result[cat]) result[cat] = [];
      result[cat].push({ id: String(row[h['SettingID']]||''), value: String(row[h['Value']]||''), label: String(row[h['Label']]||''), sort: Number(row[h['SortOrder']]||0), dept: h['ParentDepartment'] !== undefined ? String(row[h['ParentDepartment']]||'') : '', timezone: h['Timezone'] !== undefined ? String(row[h['Timezone']]||'') : '' });
    }
    Object.keys(result).forEach(function (cat) {
      result[cat].sort(function (a, b) { return a.sort - b.sort; });
    });
    return result;
  } catch (e) {
    Logger.log('getSettingsMap: ' + e.message);
    return {};
  }
}

// ── Settings admin view ───────────────────────────────────────────
function getSettingsForAdmin() {
  try {
    var perm = checkPermission('manageSettings');
    if (!perm.allowed) return { success: false, error: 'Only Administrators can access settings.' };
    return getAllSettings();
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── VA Module wrappers ────────────────────────────────────────────
function getVAList(filters)          { try { return getVAs(filters||{}); }             catch (e) { return { success:false, error:e.message }; } }
function getVARequestList(filters)   { try { return getVARequests(filters||{}); }       catch (e) { return { success:false, error:e.message }; } }
function getVARequestDetail(id)      { try { return getVARequestById(id); }             catch (e) { return { success:false, error:e.message }; } }
function getVAConnectionList(filters){ try { return getVAConnections(filters||{}); }    catch (e) { return { success:false, error:e.message }; } }
function getVANoteList(requestId)    { try { return getVAConnectionNotes(requestId); }  catch (e) { return { success:false, error:e.message }; } }

// ── User management wrappers ──────────────────────────────────────
function getSpecialistsList()        { try { return getSpecialists(); }                 catch (e) { return { success:false, error:e.message }; } }
function getMyAssignedCustomers()    { try { return getMyCustomers(); }                 catch (e) { return { success:false, error:e.message }; } }

// ── Private sheet helpers ─────────────────────────────────────────
function _safeGetData(ss, sheetName) {
  try {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [[]];
    var data = sheet.getDataRange().getValues();
    return (!data || !data.length) ? [[]] : data;
  } catch (e) { return [[]]; }
}
function _headerMap(headerRow) {
  var h = {};
  if (!headerRow) return h;
  for (var i = 0; i < headerRow.length; i++) { if (headerRow[i]) h[String(headerRow[i])] = i; }
  return h;
}
function _dataRows(data, h, idCol) {
  if (!data || data.length < 2 || h[idCol] === undefined) return [];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var v = data[i][h[idCol]];
    if (v !== '' && v !== null && v !== undefined) rows.push(data[i]);
  }
  return rows;
}
function _countWhere(rows, h, col, value) {
  if (h[col] === undefined) return 0;
  var n = 0;
  for (var i = 0; i < rows.length; i++) { if (rows[i][h[col]] === value) n++; }
  return n;
}

// ── CS Specialists page data
function getCSSpecialistsData() {
  try { return getCSSpecialistsWithData(); }
  catch (e) { return { success: false, error: e.message }; }
}
function addCSSpecialist(payload) {
  try { return createUser(payload); }
  catch (e) { return { success: false, error: e.message }; }
}
// Was referenced by doReassignSpecialist (Router.gs) but never actually
// implemented anywhere — every reassignment attempt threw a ReferenceError
// regardless of the specific scenario being tested. Built now to match how
// getCSSpecialistsWithData already resolves specialist assignment:
// Customers.AssignedSpecialist stores an EMAIL address (not a UserID), so
// matching/updating has to go through each user's email, not their UserID.
function doReassignSpecialist(payload) {
  try { return reassignSpecialist(payload); }
  catch (e) { return { success: false, error: 'doReassignSpecialist: ' + e.message }; }
}
function reassignSpecialist(payload) {
  var perm = checkPermission('manageSettings');
  if (!perm.allowed) return { success: false, error: 'Only Administrators can reassign specialists.' };
  if (!payload || !payload.fromUserId) return { success: false, error: 'fromUserId is required.' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var userSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
  if (!userSheet) return { success: false, error: 'Users sheet not found.' };
  var userData = userSheet.getDataRange().getValues();
  var uh = {}; userData[0].forEach(function(c,i){ if(c) uh[String(c)]=i; });

  // Resolve the FROM specialist's email — this is what Customers rows are
  // actually keyed on, not their UserID.
  var fromEmail = '', fromRowNum = -1;
  for (var i = 1; i < userData.length; i++) {
    if (String(userData[i][uh['UserID']]||'') !== payload.fromUserId) continue;
    fromEmail = String(userData[i][uh['Email']]||'').toLowerCase().trim();
    fromRowNum = i + 1;
    break;
  }
  if (!fromEmail) return { success: false, error: 'Could not find the specialist being replaced.' };

  // Resolve (or create) the TO specialist, and their email.
  var toUserId = String(payload.toExistUserId || '').trim();
  var toEmail = '';
  if (toUserId) {
    for (var j = 1; j < userData.length; j++) {
      if (String(userData[j][uh['UserID']]||'') !== toUserId) continue;
      toEmail = String(userData[j][uh['Email']]||'').toLowerCase().trim();
      break;
    }
    if (!toEmail) return { success: false, error: 'Could not find the selected existing specialist.' };
  } else {
    var toName = (payload.toName||'').trim();
    var toEmailInput = (payload.toEmail||'').trim();
    if (!toName)  return { success: false, error: 'New specialist name is required.' };
    if (!toEmailInput) return { success: false, error: 'New specialist email is required.' };

    // Same email as the specialist being replaced — this is a seat/role
    // being handed to someone new under a persistent, reused email address
    // (e.g. a role-based mailbox), not a duplicate-user error. Rename the
    // existing user record in place — that email's assignments don't need
    // to move anywhere, they're already correct — and log the name change
    // so there's a record of who held that seat when.
    if (toEmailInput.toLowerCase().trim() === fromEmail) {
      var oldName = String(userData[fromRowNum-1][uh['Name']]||'');
      userSheet.getRange(fromRowNum, uh['Name']+1).setValue(toName);
      if (payload.toRole && uh['Role'] !== undefined) userSheet.getRange(fromRowNum, uh['Role']+1).setValue(payload.toRole);
      _writeLog('User', payload.fromUserId, 'UPDATE', 'Name', oldName, toName, perm.user);
      return { success: true, toUserId: payload.fromUserId, customersTransferred: 0, renamedInPlace: true };
    }

    // createUser already rejects a duplicate email with a clear message —
    // e.g. reassigning to someone who already exists under a DIFFERENT
    // existing user's email should go through toExistUserId instead of
    // trying to create a new user row here.
    var createRes = createUser({ email: toEmailInput, name: toName, role: payload.toRole || CONFIG.ROLES.CS_SPECIALIST });
    if (!createRes.success) return createRes;
    toUserId = createRes.id;
    toEmail = toEmailInput.toLowerCase().trim();
  }

  if (fromEmail === toEmail) {
    return { success: false, error: 'The new specialist has the same email as the one being replaced — nothing to reassign.' };
  }

  // Move every customer currently assigned to the FROM specialist over to
  // the TO specialist's email.
  var transferCount = 0;
  if (payload.moveCustomers !== false) {
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSheet) {
      var custData = custSheet.getDataRange().getValues();
      var ch = {}; custData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
      if (ch['AssignedSpecialist'] !== undefined) {
        var now = new Date();
        for (var k = 1; k < custData.length; k++) {
          if (String(custData[k][ch['AssignedSpecialist']]||'').toLowerCase().trim() !== fromEmail) continue;
          custSheet.getRange(k+1, ch['AssignedSpecialist']+1).setValue(toEmail);
          if (ch['UpdatedAt'] !== undefined) custSheet.getRange(k+1, ch['UpdatedAt']+1).setValue(now);
          if (ch['UpdatedBy'] !== undefined) custSheet.getRange(k+1, ch['UpdatedBy']+1).setValue(perm.user.email);
          transferCount++;
        }
      }
    }
  }

  // Deactivate the old specialist's user account.
  if (fromRowNum > -1 && uh['IsActive'] !== undefined) {
    userSheet.getRange(fromRowNum, uh['IsActive']+1).setValue(false);
  }

  _writeLog('User', payload.fromUserId, 'REASSIGN', 'AssignedSpecialist', fromEmail, toEmail, perm.user);

  return { success: true, toUserId: toUserId, customersTransferred: transferCount };
}
function getConnectionsForHoursChange(filters) {
  try { return getConnectionsForHoursChange_(filters||{}); }
  catch(e){ return {success:false,error:e.message}; }
}
function applyVAConnectionHoursChange(payload) {
  try { return applyVAConnectionHoursChange_(payload||{}); }
  catch(e){ return {success:false,error:e.message}; }
}
function getVAConnectionHoursLog(connectionId) {
  try { return getVAConnectionHoursLog_(connectionId||''); }
  catch(e){ return {success:false,error:e.message}; }
}
function getAllVAConnectionHoursLogs() {
  try { return getAllVAConnectionHoursLogs_(); }
  catch(e){ return {success:false,error:e.message}; }
}
function addProjectHoursEntry(connectionId, hoursAdded, description, entryDate, requestedBy) {
  try { return addProjectHoursEntry_(connectionId, hoursAdded, description, entryDate, requestedBy); }
  catch(e){ return {success:false,error:e.message}; }
}


// ── Active Customers trend for dashboard chart
function getActiveCustomersTrend(fromDateStr, toDateStr) {
  try {
    var ss        = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet  = ss.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!custSheet) return { success: true, series: [] };

    var fromDate = fromDateStr ? new Date(fromDateStr) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    var toDate   = toDateStr   ? new Date(toDateStr)   : new Date();
    toDate.setHours(23, 59, 59, 999);

    // Build daily active customer count
    // Strategy: for each day in range, count customers with Status=Active whose 
    // createdAt <= that day and (no termination date or termination date > that day)
    var custData = custSheet.getDataRange().getValues();
    var h = _headerMap(custData[0]);

    var ms_per_day = 86400000;
    var days = Math.min(90, Math.max(1, Math.floor((toDate - fromDate) / ms_per_day) + 1));
    var series = [];

    for (var d = 0; d < days; d++) {
      var dayTs = new Date(fromDate.getTime() + d * ms_per_day);
      dayTs.setHours(23, 59, 59, 999);
      var count = 0;

      for (var i = 1; i < custData.length; i++) {
        var row     = custData[i];
        if (!row[h['CustomerID']]) continue;
        var created = row[h['CreatedAt']];
        if (created && created > dayTs) continue; // created after this day
        var status  = String(row[h['Status']] || '');
        // Count as active on this day if status is Active (simplified: use current status)
        if (status === 'Active' || status === 'Pending') count++;
      }

      var label = (dayTs.getMonth()+1) + '/' + dayTs.getDate();
      series.push({ label: label, count: count, date: dayTs.toISOString().substring(0,10) });
    }

    return { success: true, series: series };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── VA Connections module wrappers
// VAConnectionService.gs MUST be added to the Apps Script project.
// All wrappers below guard against it being absent.
function _vaConnGuard(fnName) {
  if (typeof getActiveVAConnections === 'undefined') {
    return { success: false, error: '⚠ VAConnectionService.gs is missing from this Apps Script project. In the GAS editor: click + → Script → paste VAConnectionService.gs content → Save → Redeploy.' };
  }
  return null;
}
function getActiveVAConnectionList(filters) {
  var g = _vaConnGuard(); if (g) return g;
  try { return getActiveVAConnections(filters || {}); } catch(e){ return { success:false, error:e.message }; }
}
function terminateVAConn(connectionId, terminationDate, reason, replacedByVAId, explicitResult) { var g=_vaConnGuard();if(g)return g;
  try { return terminateVAConnection(connectionId, terminationDate, reason, replacedByVAId || '', explicitResult || ''); }
  catch (e) { return { success: false, error: e.message }; }
}

function pauseVAConn(connectionId, pauseDate) { var g=_vaConnGuard();if(g)return g;
  try { return pauseVAConnection(connectionId, pauseDate); }
  catch(e) { return { success: false, error: e.message }; }
}
function getVAConnById(connectionId) { var g=_vaConnGuard();if(g)return g;
  try { return getVAConnectionById(connectionId); }
  catch(e) { return { success: false, error: e.message }; }
}

// ═══════════════════════════════════════════
// LIFETIME VALUE REPORT
// ═══════════════════════════════════════════
function getLifetimeReportData() {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var now = new Date();

    function monthsBetween(start, end) {
      if (!start) return 0;
      var s = (start instanceof Date) ? start : new Date(start);
      var e = (end   instanceof Date) ? end   : (end ? new Date(end) : now);
      if (isNaN(s.getTime())) return 0;
      if (isNaN(e.getTime())) e = now;
      var months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
      var dayFraction = (e.getDate() - s.getDate()) / 30;
      return Math.max(0, Math.round((months + dayFraction) * 10) / 10);
    }

    // Build dynamic bucket list based on the actual max value in the dataset
    // Fixed bands up to 4 years, then yearly bands for each additional year
    function buildBuckets(items) {
      var maxM = 0;
      items.forEach(function(x){ if (x.lifetimeMonths > maxM) maxM = x.lifetimeMonths; });
      var keys = ['0–3 mo', '3–6 mo', '6–12 mo', '12–24 mo'];
      // Add yearly bands from 24 mo up to ceiling of maxM (in 12-mo steps)
      var ceilYr = Math.max(4, Math.ceil(maxM / 12)); // at least up to 4 yrs
      for (var yr = 2; yr < ceilYr; yr++) {
        keys.push((yr * 12) + '–' + ((yr + 1) * 12) + ' mo');
      }
      keys.push(ceilYr * 12 + '+ mo');
      return keys;
    }

    function bucket(m, bucketKeys) {
      if (m < 3)  return '0–3 mo';
      if (m < 6)  return '3–6 mo';
      if (m < 12) return '6–12 mo';
      // Walk yearly bands
      for (var i = 3; i < bucketKeys.length - 1; i++) {
        var bk  = bucketKeys[i];
        // Parse upper bound from label like '24–36 mo'
        var parts = bk.replace(' mo','').split('–');
        var upper = parseInt(parts[1], 10);
        if (m < upper) return bk;
      }
      return bucketKeys[bucketKeys.length - 1];
    }

    function stats(items) {
      if (!items.length) return { avg: 0, median: 0, min: 0, max: 0, total: 0 };
      var vals = items.map(function(x){ return x.lifetimeMonths; }).sort(function(a,b){ return a-b; });
      var sum  = vals.reduce(function(a,b){ return a+b; }, 0);
      var mid  = Math.floor(vals.length / 2);
      return {
        avg:    Math.round(sum / vals.length * 10) / 10,
        median: vals.length % 2 === 0 ? Math.round((vals[mid-1]+vals[mid])/2*10)/10 : vals[mid],
        min:    vals[0],
        max:    vals[vals.length - 1],
        total:  vals.length
      };
    }

    function bucketCounts(items, bucketKeys) {
      var b = {};
      bucketKeys.forEach(function(k){ b[k] = 0; });
      items.forEach(function(x){ var bk = bucket(x.lifetimeMonths, bucketKeys); if (b[bk] !== undefined) b[bk]++; });
      return b;
    }

    // ── CUSTOMERS ──────────────────────────────────────────
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var customers = [];
    if (custSheet) {
      var cd = custSheet.getDataRange().getValues();
      var ch = {}; cd[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });
      for (var i=1; i<cd.length; i++) {
        if (!cd[i][ch['CustomerID']]) continue;
        var status     = String(cd[i][ch['Status']]     || '');
        var createdAt  = cd[i][ch['CreatedAt']];
        var statusDate = ch['StatusDate'] !== undefined ? cd[i][ch['StatusDate']] : null;
        var isClosed   = ['Terminated','Cancelled'].indexOf(status) !== -1;
        var endDate    = isClosed && statusDate ? statusDate : null;
        var months     = monthsBetween(createdAt, endDate);
        customers.push({
          id:              String(cd[i][ch['CustomerID']]   || ''),
          name:            String(cd[i][ch['CustomerName']] || ''),
          status:          status,
          specialist:      String(ch['AssignedSpecialist'] !== undefined ? (cd[i][ch['AssignedSpecialist']]||'') : ''),
          createdAt:       createdAt instanceof Date ? createdAt.toISOString() : String(createdAt||''),
          endDate:         endDate   instanceof Date ? endDate.toISOString()   : String(endDate||''),
          lifetimeMonths:  months
        });
      }
    }

    // ── ACCOUNTS (CLIENTS) ─────────────────────────────────
    var cliSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var accounts  = [];
    if (cliSheet) {
      var cldata = cliSheet.getDataRange().getValues();
      var clh = {}; cldata[0].forEach(function(c,i){ if(c) clh[String(c)]=i; });
      for (var j=1; j<cldata.length; j++) {
        if (!cldata[j][clh['ClientID']]) continue;
        var astatus    = String(cldata[j][clh['Status']]     || '');
        var acreated   = cldata[j][clh['CreatedAt']];
        var astatusDate= clh['StatusDate'] !== undefined ? cldata[j][clh['StatusDate']] : null;
        var aClosed    = ['Terminated','Cancelled'].indexOf(astatus) !== -1;
        var aEndDate   = aClosed && astatusDate ? astatusDate : null;
        var aMonths    = monthsBetween(acreated, aEndDate);
        accounts.push({
          id:             String(cldata[j][clh['ClientID']]    || ''),
          companyName:    String(cldata[j][clh['CompanyName']] || ''),
          accountName:    String(cldata[j][clh['AccountName']] || ''),
          customerId:     String(cldata[j][clh['CustomerID']]  || ''),
          status:         astatus,
          category:       String(clh['Category'] !== undefined ? (cldata[j][clh['Category']]||'') : ''),
          type:           String(clh['Type']     !== undefined ? (cldata[j][clh['Type']]    ||'') : ''),
          createdAt:      acreated  instanceof Date ? acreated.toISOString()  : String(acreated||''),
          endDate:        aEndDate  instanceof Date ? aEndDate.toISOString()  : String(aEndDate||''),
          lifetimeMonths: aMonths
        });
      }
    }

    // Build customer name lookup for accounts
    var custNameMap = {};
    customers.forEach(function(c){ custNameMap[c.id] = c.name; });
    accounts.forEach(function(a){ a.customerName = custNameMap[a.customerId] || a.customerId; });

    // ── VA CONNECTIONS ─────────────────────────────────────
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    var connections = [];
    if (connSheet) {
      var connData = connSheet.getDataRange().getValues();
      var coh = {}; connData[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });
      for (var k=1; k<connData.length; k++) {
        if (!connData[k][coh['ConnectionID']]) continue;
        var cstatus  = String(connData[k][coh['ConnectionStatus']]||'');
        var cStart   = connData[k][coh['ActualStartDate']]   || connData[k][coh['VAConnectionDate']];
        var cEnd     = coh['TerminationDate'] !== undefined ? connData[k][coh['TerminationDate']] : null;
        var cisClosed= ['Cancelled','Terminated'].indexOf(cstatus) !== -1;
        var cEndDate = cisClosed && cEnd ? cEnd : null;
        var cMonths  = monthsBetween(cStart, cEndDate);
        var custId   = String(coh['CustomerID'] !== undefined ? (connData[k][coh['CustomerID']]||'') : '');
        var cliId    = String(coh['ClientID']   !== undefined ? (connData[k][coh['ClientID']]  ||'') : '');
        connections.push({
          id:             String(connData[k][coh['ConnectionID']]||''),
          requestId:      String(connData[k][coh['RequestID']]   ||''),
          vaName:         String(connData[k][coh['VAName']]      ||''),
          customerId:     custId,
          clientId:       cliId,
          customerName:   custNameMap[custId] || custId,
          status:         cstatus,
          startDate:      cStart   instanceof Date ? cStart.toISOString()   : String(cStart||''),
          endDate:        cEndDate instanceof Date ? cEndDate.toISOString() : String(cEndDate||''),
          lifetimeMonths: cMonths
        });
      }
    }

    // Enrich connections with account names
    var cliNameMap = {};
    accounts.forEach(function(a){ cliNameMap[a.id] = a.companyName + (a.accountName ? ' — ' + a.accountName : ''); });
    connections.forEach(function(c){ c.accountName = cliNameMap[c.clientId] || c.clientId; });

    // Compute dynamic bucket keys per entity based on actual max values
    var custBuckets = buildBuckets(customers);
    var acctBuckets = buildBuckets(accounts);
    var connBuckets = buildBuckets(connections);

    // Assign bucket label to each item now that keys are known
    customers.forEach(function(x){ x.bucket = bucket(x.lifetimeMonths, custBuckets); });
    accounts.forEach(function(x){  x.bucket = bucket(x.lifetimeMonths, acctBuckets); });
    connections.forEach(function(x){ x.bucket = bucket(x.lifetimeMonths, connBuckets); });

    return {
      success: true,
      customers:   { items: customers,   stats: stats(customers),   buckets: bucketCounts(customers, custBuckets),   bucketKeys: custBuckets },
      accounts:    { items: accounts,    stats: stats(accounts),    buckets: bucketCounts(accounts, acctBuckets),     bucketKeys: acctBuckets },
      connections: { items: connections, stats: stats(connections), buckets: bucketCounts(connections, connBuckets), bucketKeys: connBuckets }
    };
  } catch (e) {
    return { success: false, error: 'getLifetimeReportData: ' + e.message };
  }
}

// ── Authorization helper
// Returns the OAuth URL the user must visit to grant permissions
function getAppAuthorizationUrl() {
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    var status   = authInfo.getAuthorizationStatus();
    // REQUIRED means not yet authorized; NOT_REQUIRED means already authorized
    var needed = (status === ScriptApp.AuthorizationStatus.REQUIRED);
    if (needed) {
      return { success: true, required: true, url: authInfo.getAuthorizationUrl() };
    }
    // Double-check by trying to access Sheets — if it throws, auth IS actually needed
    try {
      SpreadsheetApp.getActiveSpreadsheet();
      return { success: true, required: false, url: '' };
    } catch(sheetErr) {
      // Sheets not authorized — get URL and return it
      var url2 = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationUrl();
      return { success: true, required: true, url: url2 };
    }
  } catch(e) {
    try {
      var url3 = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationUrl();
      return { success: true, required: true, url: url3 };
    } catch(e2) {
      return { success: false, error: e2.message };
    }
  }
}

// ── Inquiry wrappers
function getInquiryList(filters)              { try { return getInquiries(filters||{}); }             catch(e){ return {success:false,error:e.message}; } }
function getInquiry(id)                       { try { return getInquiryById(id); }                    catch(e){ return {success:false,error:e.message}; } }
function createInq(payload)                   { try { return createInquiry(payload); }                catch(e){ return {success:false,error:e.message}; } }
function updateInq(id, payload)               { try { return updateInquiry(id, payload); }             catch(e){ return {success:false,error:e.message}; } }
function closeInq(id, outcome, reason, note)  { try { return closeInquiry(id,outcome,reason,note); }  catch(e){ return {success:false,error:e.message}; } }
function reopenInq(id)                        { try { return reopenInquiry(id); }                     catch(e){ return {success:false,error:e.message}; } }
function addInqUpdate(id, content)            { try { return addInquiryUpdate(id, content); }         catch(e){ return {success:false,error:e.message}; } }

// ═══════════════════════════════════════════
// UNIFIED DASHBOARD ANALYTICS
// ═══════════════════════════════════════════
function getDashboardAnalytics(params) {
  try {
    params = params || {};
    var fromStr = params.from || '';
    var toStr   = params.to   || '';
    var grain   = params.grain || 'daily'; // 'daily' | 'weekly' | 'monthly'

    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var now = new Date();

    var fromDate = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth() - 2, 1);
    var toDate   = toStr   ? new Date(toStr)   : now;
    toDate.setHours(23,59,59,999);

    // ─── Optional: scope to a specialist's assigned customers
    var specEmail   = (params.specialistEmail || '').toLowerCase().trim();
    var specCustIds = null;
    if (specEmail) {
      specCustIds = {};
      var spCS = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
      if (spCS) {
        var spCD = spCS.getDataRange().getValues();
        var spCH = {}; spCD[0].forEach(function(col,idx){ if(col) spCH[String(col)]=idx; });
        for (var si=1; si<spCD.length; si++) {
          if (String(spCD[si][spCH['AssignedSpecialist']]||'').toLowerCase().trim() === specEmail)
            specCustIds[String(spCD[si][spCH['CustomerID']]||'')] = true;
        }
      }
    }

    // ─── helpers
    function sdString(d) { return (d instanceof Date) ? d.toISOString() : String(d||''); }
    function toDate2(v)  { if (v instanceof Date) return v; if (v) return new Date(v); return null; }
    function bucketKey(d, g) {
      if (g === 'monthly') return (d.getFullYear()) + '-' + String(d.getMonth()+1).padStart(2,'0');
      if (g === 'weekly') {
        var day = new Date(d); day.setHours(0,0,0,0);
        var dow = day.getDay(); day.setDate(day.getDate()-dow); // Sunday
        return day.toISOString().substring(0,10);
      }
      return d.toISOString().substring(0,10); // daily
    }
    function bucketLabel(k, g) {
      if (g === 'monthly') { var p=k.split('-'); var mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return mn[parseInt(p[1],10)-1]+' '+p[0]; }
      if (g === 'weekly') { var dt=new Date(k+'T00:00:00'); return (dt.getMonth()+1)+'/'+(dt.getDate()); }
      var dt2=new Date(k+'T00:00:00'); return (dt2.getMonth()+1)+'/'+(dt2.getDate());
    }
    function buildBuckets() {
      var keys=[], d=new Date(fromDate); d.setHours(0,0,0,0);
      var end=new Date(toDate); end.setHours(0,0,0,0);
      var seen={};
      while (d<=end) {
        var k=bucketKey(d, grain);
        if (!seen[k]) { seen[k]=true; keys.push(k); }
        d.setDate(d.getDate()+1);
      }
      return keys;
    }

    // ─── Generic: count records by CreatedAt bucket (new records over time)
    function countNew(sheetName, idCol) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return {};
      var data=sheet.getDataRange().getValues();
      if (data.length<2) return {};
      var h={}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
      var counts={};
      for (var i=1;i<data.length;i++) {
        if (!data[i][h[idCol]]) continue;
        if (specCustIds) {
          var cnCid=String(data[i][h['CustomerID']]||data[i][h[idCol]]||'');
          if (!specCustIds[cnCid]) continue;
        }
        var d=toDate2(data[i][h['CreatedAt']]);
        if (!d) continue;
        if (d<fromDate||d>toDate) continue;
        var k=bucketKey(d,grain);
        counts[k]=(counts[k]||0)+1;
      }
      return counts;
    }

    // ─── Generic: count ACTIVE records per bucket
    // "active on day X" = createdAt <= X AND status is still Active (current-status approximation)
    function countActive(sheetName, idCol, statusCol, activeStatuses, dateField) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return {};
      var data=sheet.getDataRange().getValues();
      if (data.length<2) return {};
      var h={}; data[0].forEach(function(c,i){ if(c) h[String(c)]=i; });
      var recs=[];
      for (var i=1;i<data.length;i++) {
        if (!data[i][h[idCol]]) continue;
        if (specCustIds) {
          var caCid=String(data[i][h['CustomerID']]||data[i][h[idCol]]||'');
          if (!specCustIds[caCid]) continue;
        }
        var status=String(data[i][h[statusCol]]||'');
        var created=toDate2(data[i][h[dateField||'CreatedAt']]);
        recs.push({ status:status, created:created });
      }
      var keys=buildBuckets();
      var counts={};
      keys.forEach(function(k) {
        var dayEnd=new Date(k+'T23:59:59'); if(isNaN(dayEnd)) dayEnd=toDate;
        var c=0;
        recs.forEach(function(r) {
          if (!r.created||r.created>dayEnd) return;
          if (activeStatuses.indexOf(r.status)<0) return;
          c++;
        });
        counts[k]=c;
      });
      return counts;
    }

    // ─── Build final series array from counts + bucket keys
    function buildSeries(counts, keys) {
      return keys.map(function(k) {
        return { key:k, label:bucketLabel(k,grain), value:counts[k]||0 };
      });
    }

    var keys = buildBuckets();

    // Active
    var activeCust = buildSeries(countActive(CONFIG.SHEETS.CUSTOMERS,  'CustomerID','Status',['Active'],'CreatedAt'), keys);
    var activeAcct = buildSeries(countActive(CONFIG.SHEETS.CLIENTS,     'ClientID',  'Status',['Active'],'CreatedAt'), keys);
    var activeConn = buildSeries(countActive(CONFIG.SHEETS.VA_CONNECTIONS,'ConnectionID','ConnectionStatus',['Started'],'AssignedAt'), keys);

    // New
    var newCust = buildSeries(countNew(CONFIG.SHEETS.CUSTOMERS,   'CustomerID'), keys);
    var newAcct = buildSeries(countNew(CONFIG.SHEETS.CLIENTS,     'ClientID'),   keys);
    var newConn = buildSeries(countNew(CONFIG.SHEETS.VA_CONNECTIONS,'ConnectionID'), keys);

    // Terminated/cancelled records by bucket (using StatusDate if available, else CreatedAt)
    function countTerminated(sheetName, idCol, statusCol) {
      var sheet2 = ss.getSheetByName(sheetName);
      if (!sheet2) return {};
      var d2=sheet2.getDataRange().getValues();
      if (d2.length<2) return {};
      var h2={}; d2[0].forEach(function(col,i){ if(col) h2[String(col)]=i; });
      var counts={};
      for (var i2=1;i2<d2.length;i2++) {
        if (!d2[i2][h2[idCol]]) continue;
        var status2=String(d2[i2][h2[statusCol]]||'');
        if (['Terminated','Cancelled'].indexOf(status2)<0) continue;
        // Use StatusDate if present, else CreatedAt
        var dateVal = h2['StatusDate']!==undefined ? d2[i2][h2['StatusDate']] : null;
        if (!dateVal || (dateVal instanceof Date && isNaN(dateVal))) dateVal = d2[i2][h2['CreatedAt']];
        var d3=toDate2(dateVal);
        if (!d3||d3<fromDate||d3>toDate) continue;
        var k=bucketKey(d3,grain);
        counts[k]=(counts[k]||0)+1;
      }
      return counts;
    }

    var termCust = buildSeries(countTerminated(CONFIG.SHEETS.CUSTOMERS,       'CustomerID',   'Status'), keys);
    var termAcct = buildSeries(countTerminated(CONFIG.SHEETS.CLIENTS,         'ClientID',     'Status'), keys);
    var termConn = buildSeries(countTerminated(CONFIG.SHEETS.VA_CONNECTIONS,  'ConnectionID', 'ConnectionStatus'), keys);

    return {
      success: true,
      grain: grain, from: fromDate.toISOString(), to: toDate.toISOString(),
      active: { customers: activeCust, accounts: activeAcct, connections: activeConn },
      newRecords: { customers: newCust, accounts: newAcct, connections: newConn },
      terminated: { customers: termCust, accounts: termAcct, connections: termConn }
    };
  } catch(e) {
    return { success: false, error: 'getDashboardAnalytics: ' + e.message };
  }
}

function doTransferCustomer(customerId, toEmail, fromSpecName, toSpecName, notes) {
  try { return transferCustomerToSpecialist(customerId, toEmail, fromSpecName, toSpecName, notes||''); }
  catch(e){ return { success:false, error:e.message }; }
}

// ═══════════════════════════════════════════
// CUSTOMER / ACCOUNT REPORT BY DEPARTMENT
// ═══════════════════════════════════════════
function getCustomerAccountReport(params) {
  try {
    params = params || {};
    var cache = CacheService.getScriptCache();
    var cacheKey = 'caReport_v2_' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(params)));
    try {
      var cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (cacheReadEx) { Logger.log('getCustomerAccountReport cache read: ' + cacheReadEx.message); }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var now = new Date();

    // Date windows — New uses its own 1-month default
    // selectedMonth: 'YYYY-MM' for single month mode; months: ['YYYY-MM',...] for multi-month
    // In multi-month mode we run metrics for each month window and return a monthly breakdown
    // periodType 'weekly' builds ISO week strings ('YYYY-Www') instead —
    // monthWindow() below detects the format and delegates to weekWindow()
    // for these, so none of the metric logic further down needs to know
    // or care which granularity it's actually looking at.
    // Converts a date to its ISO week string 'YYYY-Www' — the inverse of
    // weekWindow() above, used when building the "last 8 weeks" list.
    function _isoWeekString(d) {
      var target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var dayNum = target.getDay() || 7; // Sunday=0 -> 7
      target.setDate(target.getDate() + 4 - dayNum); // nearest Thursday
      var yearStart = new Date(target.getFullYear(), 0, 1);
      var weekNum = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
      return target.getFullYear() + '-W' + String(weekNum).padStart(2,'0');
    }
    var isWeekly = params.periodType === 'weekly';
    var months = [];
    if (params.months && params.months.length) {
      months = params.months;
    } else if (isWeekly) {
      // Last 8 weeks ending at the week containing selectedWeek (or today)
      var anchorDate = params.selectedWeek ? new Date(params.selectedWeek) : now;
      if (isNaN(anchorDate.getTime())) anchorDate = now;
      for (var wi = 7; wi >= 0; wi--) {
        var wd = new Date(anchorDate);
        wd.setDate(wd.getDate() - (wi * 7));
        months.push(_isoWeekString(wd));
      }
    } else if (params.selectedMonth) {
      // Build last 6 months ending at selectedMonth
      var selParts = params.selectedMonth.split('-');
      var selY = parseInt(selParts[0],10), selM = parseInt(selParts[1],10)-1;
      for (var mi=5; mi>=0; mi--) {
        var my = selY, mm2 = selM-mi;
        while (mm2 < 0) { mm2+=12; my--; }
        months.push(my+'-'+String(mm2+1).padStart(2,'0'));
      }
    } else {
      // Default: last 6 months
      for (var mi2=5; mi2>=0; mi2--) {
        var my2=now.getFullYear(), mm3=now.getMonth()-mi2;
        while(mm3<0){mm3+=12;my2--;} while(mm3>11){mm3-=12;my2++;}
        months.push(my2+'-'+String(mm3+1).padStart(2,'0'));
      }
    }

    // Helper: build fromDate/toDate for an ISO week string 'YYYY-Www'
    // (Monday through Sunday, matching the ISO 8601 week convention).
    function weekWindow(wkStr) {
      var parts = wkStr.split('-W');
      var y = parseInt(parts[0],10), wk = parseInt(parts[1],10);
      // ISO week 1 is the week containing the first Thursday of the year.
      var jan4 = new Date(y, 0, 4);
      var jan4Day = jan4.getDay() || 7; // Sunday=0 -> 7, so Monday=1..Sunday=7
      var week1Monday = new Date(jan4);
      week1Monday.setDate(jan4.getDate() - (jan4Day - 1));
      var from = new Date(week1Monday);
      from.setDate(from.getDate() + (wk - 1) * 7);
      var to = new Date(from);
      to.setDate(to.getDate() + 6);
      to.setHours(23,59,59,999);
      return { from: from, to: to, label: 'Wk ' + wk + ' \'' + String(y).slice(-2) };
    }

    // Helper: build fromDate/toDate for a month string 'YYYY-MM' — or, if
    // given a week string 'YYYY-Www' instead, delegate to weekWindow().
    // This polymorphism is what lets the rest of the report treat weekly
    // and monthly periods identically everywhere below.
    function monthWindow(ym) {
      if (ym.indexOf('-W') !== -1) return weekWindow(ym);
      var p=ym.split('-'), y=parseInt(p[0],10), m2=parseInt(p[1],10)-1;
      var f=new Date(y,m2,1), t=new Date(y,m2+1,0,23,59,59,999);
      return {from:f, to:t, label:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m2]+' '+y};
    }

    // For "New": always use the selected month window (first VA conn in that month)
    // For Active/Paused/Churned: use the month window too
    // We'll compute metrics for each month and return monthlyData
    var fromDate, toDate;
    if (isWeekly && months.length) {
      // Derive from the actual built week list rather than defaulting to a
      // 6-month span, which would badly mismatch what's actually shown.
      fromDate = monthWindow(months[0]).from;
      toDate   = monthWindow(months[months.length-1]).to;
    } else {
      fromDate = params.from ? new Date(params.from) : new Date(now.getFullYear(), now.getMonth()-5, 1);
      toDate   = params.to   ? new Date(params.to)   : now;
    }
    var newFrom   = fromDate; var newTo = toDate; // kept for backward compat
    toDate.setHours(23,59,59,999);

    function hMap(row) { var h={}; row.forEach(function(c,i){ if(c) h[String(c).trim()]=i; }); return h; }
    function sd(v)   { return (v instanceof Date)?v.toISOString():String(v||''); }
    // Real bug fixed here — the root cause behind two related symptoms:
    // dates displayed one day off (e.g. a Jun 25 start date showing as
    // Jun 24), and terminations landing in the wrong month bucket (a
    // December termination showing under January). A date-only
    // VAConnections cell (no time component) comes back from
    // getValues() as a Date object anchored to MIDNIGHT IN THE
    // SPREADSHEET'S OWN CONFIGURED TIMEZONE. This report's own month
    // windows (monthWindow() below) are built with the plain
    // new Date(y, m, d) constructor instead, which uses the SCRIPT
    // project's timezone — a separate setting that doesn't have to
    // match the spreadsheet's. Comparing the two directly, whenever
    // they disagree even by the time zones' own offset difference, can
    // push a date right at a boundary into the wrong day or month, and
    // shifts every date by a day once serialized to ISO and read back.
    // Fixed the same way _safeParseDateNoon (VAConnectionService.gs)
    // already fixes this exact class of bug on the write side: extract
    // the calendar day as the SPREADSHEET's own timezone says it is,
    // then reconstruct using the SAME local-Date-constructor convention
    // monthWindow() uses, anchored at noon so no further timezone
    // conversion downstream (ISO serialization, UTC or local display
    // getters) can ever shift it across a day boundary.
    function toD(v) {
      if (!v) return null;
      var d = (v instanceof Date) ? v : new Date(v);
      if (isNaN(d.getTime())) return null;
      var ymd = Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd').split('-');
      return new Date(Number(ymd[0]), Number(ymd[1]) - 1, Number(ymd[2]), 12, 0, 0);
    }
    function inRange(d, f, t) { return d && d>=f && d<=t; }
    function normDept(s) { return (s||'').trim().toLowerCase(); }

    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    var cliSheet  = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    var reqSheet  = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!custSheet||!cliSheet||!reqSheet||!connSheet)
      return { success:false, error:'Required sheets missing. Run initializeSystem().' };

    var custData=custSheet.getDataRange().getValues(), cliData=cliSheet.getDataRange().getValues();
    var reqData =reqSheet.getDataRange().getValues(),  connData=connSheet.getDataRange().getValues();
    var ch=hMap(custData[0]),clh=hMap(cliData[0]),rh=hMap(reqData[0]),coh=hMap(connData[0]);

    // Fallback for the Clients sheet's cached CustomerName column — that
    // cache only gets backfilled onto existing rows by running
    // backfillClientCustomerNames() once (ClientService.gs); until that's
    // been run, or for any row it missed, this lookup fills the gap so
    // the report is correct either way.
    var custNameById = {};
    for (var cni = 1; cni < custData.length; cni++) {
      var cniId = String(custData[cni][ch['CustomerID']]||''); if (!cniId) continue;
      custNameById[cniId] = String(custData[cni][ch['CustomerName']]||'');
    }
    // Per the request — Disconnected VAs needs the actual Account name
    // the VA was disconnected from, not just the VA's own name (see the
    // vaRec fix below). Same display format used everywhere else in
    // this report: "Company — Account".
    var cliDisplayNameById = {};
    for (var cdni = 1; cdni < cliData.length; cdni++) {
      var cdniId = String(cliData[cdni][clh['ClientID']]||''); if (!cdniId) continue;
      var cdniCompany = String(cliData[cdni][clh['CompanyName']]||'');
      var cdniAccount = clh['AccountName'] !== undefined ? String(cliData[cdni][clh['AccountName']]||'') : '';
      cliDisplayNameById[cdniId] = cdniCompany + (cdniAccount ? ' — ' + cdniAccount : '');
    }

    // Per the request — Incident Report link and "had a replacement?"
    // for the Terminated/Churned drill-down and copy. A Termination
    // ticket (Inquiries, InquiryType='Termination') is bound to one
    // specific VA Connection via RelatedConnectionID, carries its own
    // TicketReportLink (the closest existing field to "IR"/"Incident
    // Report" — this system has no separate, dedicated IR field), and
    // EscalatedToRequestID tells whether a Replacement request was ever
    // created from it. Per the request, the ORIGINATING Concern ticket
    // is also checked (via its own LinkedTerminationTicketId pointing
    // forward to this Termination) in case the report/IR link lives
    // there instead — the Termination's own link wins if both exist.
    var terminationByConnId = {}; // connectionId -> {inquiryId, ticketReportLink, escalatedToRequestId}
    var concernReportLinkByTerminationId = {}; // terminationInquiryId -> the originating Concern's own TicketReportLink
    var inqSheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
    if (inqSheet) {
      var inqData = inqSheet.getDataRange().getValues();
      var inqh = {}; (inqData[0]||[]).forEach(function(c,i){ if(c) inqh[String(c).trim()]=i; });
      if (inqh['InquiryID'] !== undefined) {
        for (var iqi = 1; iqi < inqData.length; iqi++) {
          var iqId = String(inqData[iqi][inqh['InquiryID']]||''); if (!iqId) continue;
          var iqType = inqh['InquiryType'] !== undefined ? String(inqData[iqi][inqh['InquiryType']]||'') : '';
          var iqReportLink = inqh['TicketReportLink'] !== undefined ? String(inqData[iqi][inqh['TicketReportLink']]||'') : '';
          if (iqType === 'Termination') {
            var iqConnId = inqh['RelatedConnectionID'] !== undefined ? String(inqData[iqi][inqh['RelatedConnectionID']]||'') : '';
            if (iqConnId) {
              terminationByConnId[iqConnId] = {
                inquiryId: iqId,
                ticketReportLink: iqReportLink,
                escalatedToRequestId: inqh['EscalatedToRequestID'] !== undefined ? String(inqData[iqi][inqh['EscalatedToRequestID']]||'') : ''
              };
            }
          }
          var iqLinkedTermId = inqh['LinkedTerminationTicketId'] !== undefined ? String(inqData[iqi][inqh['LinkedTerminationTicketId']]||'') : '';
          if (iqLinkedTermId && iqReportLink) concernReportLinkByTerminationId[iqLinkedTermId] = iqReportLink;
        }
      }
    }

    // Per the request — "Terminated > With Connected Replacement" is based
    // on the VAConnections table itself: a terminated connection's
    // ReplacedByConnectionID names the connection that replaced it, and
    // it counts only if THAT connection has become Started — i.e. it got
    // underway (Started, or since Terminated/Paused after starting). A
    // replacement that is still Pending/Accepted, was Declined, or was
    // Cancelled never pushed through and is NOT counted. No replacement
    // named, or an ID that matches no connection, also doesn't count.
    var connStatusByConnectionId = {};
    for (var csbi = 1; csbi < connData.length; csbi++) {
      var csbId = String(connData[csbi][coh['ConnectionID']]||'').trim(); if (!csbId) continue;
      connStatusByConnectionId[csbId] = String(connData[csbi][coh['ConnectionStatus']]||'');
    }
    function _replacementConnected(replacedByConnectionId) {
      if (!replacedByConnectionId) return false;
      var rcs = connStatusByConnectionId[replacedByConnectionId];
      if (rcs === undefined) return false;
      return ['Pending','Accepted','Declined','Cancelled',''].indexOf(rcs) === -1;
    }

    // ── Full status-transition history per Client/Customer. Several of
    // these metrics can genuinely recur over an account's lifetime — it
    // can be paused more than once, terminated more than once (if
    // reactivated in between), cancelled more than once, reactivated more
    // than once, and resumed (Paused→Active) more than once. Status/
    // StatusDate on the Customers/Clients sheet only ever reflects the
    // single most recent transition, so relying on that alone silently
    // loses every earlier occurrence once a later one overwrites it.
    // Pulling the full history from Activity Logs once here lets each
    // metric correctly attribute every one of its occurrences to the
    // month it actually happened in.
    var pausedDatesByClient = {}, pausedDatesByCustomer = {};
    var terminatedDatesByClient = {}, terminatedDatesByCustomer = {};
    var cancelledDatesByClient = {}, cancelledDatesByCustomer = {};
    var reactivatedDatesByClient = {}, reactivatedDatesByCustomer = {};
    var resumedDatesByClient = {}, resumedDatesByCustomer = {};
    function _processStatusLog(log, pausedMap, termMap, cancelMap, reactMap, resumeMap) {
      if (log.fieldChanged !== 'Status') return;
      var nv = String(log.newValue||''), ov = String(log.oldValue||'');
      var evDate = new Date(log.effectiveDate || log.timestamp); // effective date preferred over timestamp — see item 2
      var id = log.entityId;
      if (nv === 'Paused') {
        if (!pausedMap[id]) pausedMap[id] = []; pausedMap[id].push(evDate);
      } else if (nv === 'Terminated') {
        if (!termMap[id]) termMap[id] = []; termMap[id].push(evDate);
      } else if (nv === 'Cancelled') {
        if (!cancelMap[id]) cancelMap[id] = []; cancelMap[id].push(evDate);
      } else if (nv === 'Active' && (ov === 'Terminated' || ov === 'Cancelled')) {
        if (!reactMap[id]) reactMap[id] = []; reactMap[id].push(evDate);
      } else if (nv === 'Active' && ov === 'Paused') {
        if (!resumeMap[id]) resumeMap[id] = []; resumeMap[id].push(evDate);
      }
    }
    try {
      var cliStatusLogsRes = getLogs({ entityType: ['Client', 'Account'], allTime: true, limit: 50000 });
      var cliStatusLogs = (cliStatusLogsRes && cliStatusLogsRes.success) ? cliStatusLogsRes.data : [];
      cliStatusLogs.forEach(function(log) {
        _processStatusLog(log, pausedDatesByClient, terminatedDatesByClient, cancelledDatesByClient, reactivatedDatesByClient, resumedDatesByClient);
      });
      var custStatusLogsRes = getLogs({ entityType: 'Customer', allTime: true, limit: 50000 });
      var custStatusLogs = (custStatusLogsRes && custStatusLogsRes.success) ? custStatusLogsRes.data : [];
      custStatusLogs.forEach(function(log) {
        _processStatusLog(log, pausedDatesByCustomer, terminatedDatesByCustomer, cancelledDatesByCustomer, reactivatedDatesByCustomer, resumedDatesByCustomer);
      });
    } catch (termHistEx) { Logger.log('CA report status history: ' + termHistEx.message); }
    // Generic "did this record have a matching event during this month's
    // window" check — computed per-month below (needs win, defined
    // inside that loop). Falls back to a caller-supplied current-state
    // check for any record with no matching history entries at all (e.g.
    // a status change that happened before this history tracking existed).
    // ── Request → {deptKey, deptDisplay} lookup (normalized to avoid duplicates)
    var reqDept = {}, deptDisplayMap = {}; // normKey → display name
    // Per the request — Position/Service per RequestID, for the
    // Performance Report's Copy-to-Excel drill-down enrichment below.
    // Kept as its own independent fill (not nested inside the `if
    // (!rId||!raw) continue` below) so a request with a Service but a
    // blank Department still gets its Service captured.
    var reqService = {};
    for (var i=1;i<reqData.length;i++) {
      var rId=String(reqData[i][rh['RequestID']]||'');
      if (rId && rh['Service'] !== undefined) reqService[rId] = String(reqData[i][rh['Service']]||'');
      var raw=String(reqData[i][rh['Department']]||'').trim();
      if (!rId||!raw) continue;
      var key=normDept(raw);
      reqDept[rId]=key;
      // Store display name (first seen, properly cased)
      if (!deptDisplayMap[key]) deptDisplayMap[key]=raw;
    }

    // ── Connections grouped by clientId and customerId
    // Each conn: { deptKey, clientId, custId, connStatus, actualStart, termDate }
    var connsByClient={}, connsByCustomer={};
    for (var j=1;j<connData.length;j++) {
      if (!connData[j][coh['ConnectionID']]) continue;
      var reqId2   = String(connData[j][coh['RequestID']]||'');
      var deptKey  = reqDept[reqId2] || '';
      var cliId    = String(connData[j][coh['ClientID']] ||'');
      var custId   = String(connData[j][coh['CustomerID']]||'');
      var connSt   = String(connData[j][coh['ConnectionStatus']]||'');
      var startD   = toD(coh['ActualStartDate']!==undefined ? connData[j][coh['ActualStartDate']] : null);
      var termD    = toD(coh['TerminationDate']!==undefined ? connData[j][coh['TerminationDate']] : null);
      var vaId2    = String(connData[j][coh['VAID']]||'');
      // connectionId/vaName/service/terminationReason added here — per
      // the request, for the Performance Report's Copy-to-Excel
      // drill-down enrichment (see cliRec2/custRec3 below). All read
      // from this same row already in hand, no extra sheet read.
      var conn     = {
        deptKey:deptKey, cliId:cliId, custId:custId, connStatus:connSt, actualStart:startD, termDate:termD, vaId:vaId2,
        connectionId: String(connData[j][coh['ConnectionID']]||''),
        vaName: coh['VAName'] !== undefined ? String(connData[j][coh['VAName']]||'') : '',
        service: reqService[reqId2] || '',
        connTerminationReason: coh['TerminationReason'] !== undefined ? String(connData[j][coh['TerminationReason']]||'') : '',
        // Per the request — Project Based connections are excluded from
        // Terminated/Churned and counted separately as Project
        // Completed instead (see the cons2.forEach block below).
        connectionType: coh['ConnectionType'] !== undefined ? String(connData[j][coh['ConnectionType']]||'Regular') : 'Regular',
        // Per the request — the VAConnections column naming the connection that replaced this one.
        replacedByConnectionId: coh['ReplacedByConnectionID'] !== undefined ? String(connData[j][coh['ReplacedByConnectionID']]||'').trim() : ''
      };
      if (cliId)  { if(!connsByClient[cliId])    connsByClient[cliId]   =[]; connsByClient[cliId].push(conn); }
      if (custId) { if(!connsByCustomer[custId]) connsByCustomer[custId]=[]; connsByCustomer[custId].push(conn); }
    }

    // Picks the most plausible connection behind an account/customer's
    // churn — the most recently Terminated one on file for them. Used to
    // enrich cliRec2/custRec3 below with VA-connection-level detail
    // (Connection ID, VA Name, Department, Position, Start Date,
    // Termination Reason) that the account/customer-level record itself
    // doesn't carry, without changing what the Churned/Terminated/
    // Cancelled COUNTS themselves mean — this only affects the drill-
    // down detail shown for each row, not the numbers on the report.
    function _latestTerminatedConn(connsList) {
      var terminated = (connsList || []).filter(function(cc){ return cc.connStatus === 'Terminated' && cc.termDate; });
      if (!terminated.length) return null;
      terminated.sort(function(a,b){ return b.termDate - a.termDate; });
      return terminated[0];
    }

    // ── Account (Client) status lookup, by ClientID and by CustomerID.
    // Needed because "No Active VA" on the CUSTOMER view must NOT count a
    // customer whose status is still Active/Paused but whose underlying
    // Account(s) have all already been Terminated/Cancelled — the customer
    // record just hasn't been formally closed yet, but there's no live
    // relationship left to flag as "missing a VA." Bug fix 2026-06-30.
    var cliStatusById = {};      // clientId -> account status
    var custHasLiveAccount = {}; // customerId -> true if ANY of its accounts is not Terminated/Cancelled
    for (var ci2=1; ci2<cliData.length; ci2++) {
      var cliIdLk = String(cliData[ci2][clh['ClientID']]||''); if (!cliIdLk) continue;
      var cliStLk = String(cliData[ci2][clh['Status']]||'');
      cliStatusById[cliIdLk] = cliStLk;
      var custIdLk = String(cliData[ci2][clh['CustomerID']]||'');
      if (custIdLk && ['Terminated','Cancelled'].indexOf(cliStLk) === -1) {
        custHasLiveAccount[custIdLk] = true;
      }
    }

    // ── Unique sorted department list (display names)
    var allDeptKeys = Object.keys(deptDisplayMap).sort(function(a,b){ return deptDisplayMap[a].localeCompare(deptDisplayMap[b]); });
    var departments = ['(All)'].concat(allDeptKeys.map(function(k){ return deptDisplayMap[k]; }));

    // ── Metric helpers using date-range logic ──────────────────────────
    // NEW: first actualStart for this entity in this dept falls in newFrom–newTo
    function isNew(conns, dKey) {
      var rel = conns.filter(function(c){ return !dKey||c.deptKey===dKey; });
      var dates = rel.map(function(c){ return c.actualStart; }).filter(Boolean);
      if (!dates.length) return false;
      var first = dates.reduce(function(a,b){ return a<b?a:b; });
      return inRange(first, newFrom, newTo);
    }

    // ACTIVE: entity status is Active AND has at least one conn in dept
    // that was Started during [fromDate, toDate] (actualStart ≤ toDate, no termDate or termDate > fromDate)
    function wasActiveInPeriod(conns, dKey, entityStatus) {
      if (entityStatus !== CONFIG.STATUS.ACTIVE && entityStatus !== CONFIG.STATUS.PAUSED) return false;
      var rel = conns.filter(function(c){ return !dKey||c.deptKey===dKey; });
      return rel.some(function(c){
        var started = c.actualStart && c.actualStart<=toDate;
        var notEndedBeforeWindow = !c.termDate || c.termDate>=fromDate;
        return started && notEndedBeforeWindow;
      });
    }

    // PAUSED: entity status is Paused (status changed to Paused within window or currently paused)
    // We approximate: entity status === Paused (statusDate in window handled by caller)
    function isPausedInPeriod(entityStatus, statusDate) {
      return entityStatus === CONFIG.STATUS.PAUSED &&
             (!statusDate || inRange(statusDate, fromDate, toDate) || statusDate <= toDate);
    }

    // CHURNED: status Terminated/Cancelled with statusDate in fromDate–toDate
    function isChurned(entityStatus, statusDate) {
      return ['Terminated','Cancelled'].indexOf(entityStatus)>=0 && inRange(statusDate, fromDate, toDate);
    }

    // ── Build account (client) metrics
    // Structure: { deptDisplay → { active:Set, paused:Set, newRec:Set, returning:Set, churned:Set } }
    // Using Sets (keyed by clientId) to prevent duplicates
    function initMetrics() { return { active:{}, paused:{}, newRec:{}, returning:{}, churned:{} }; }
    var cliMetrics = {};
    function ensureCli(d) { if(!cliMetrics[d]) cliMetrics[d]=initMetrics(); }

    for (var k=1;k<cliData.length;k++) {
      var cliId2     = String(cliData[k][clh['ClientID']]||''); if(!cliId2) continue;
      var cliCustId  = String(cliData[k][clh['CustomerID']]||'');
      var company    = String(cliData[k][clh['CompanyName']]||'');
      var acctName   = String(cliData[k][clh['AccountName']]||'');
      var cliStatus  = String(cliData[k][clh['Status']]||'');
      var statusDate = toD(clh['StatusDate']!==undefined ? cliData[k][clh['StatusDate']] : null);
      var isRet      = cliData[k][clh['IsReturning']]===true||String(cliData[k][clh['IsReturning']]||'')==='true';
      var conns      = connsByClient[cliId2] || [];
      var custNameCached = String(cliData[k][clh['CustomerName']]||'') || custNameById[cliCustId] || '';
      var rec        = {clientId:cliId2,customerId:cliCustId,customerName:custNameCached,accountName:company+(acctName?' — '+acctName:''),name:company+(acctName?' — '+acctName:''),status:cliStatus,statusDate:sd(statusDate),isReturning:isRet};

      // Departments this account has connections in
      var connDeptKeys = {};
      conns.forEach(function(c){ if(c.deptKey) connDeptKeys[c.deptKey]=true; });

      // All dept includes accounts with no connections too (overall view)
      var deptIterList = ['(All)'];
      Object.keys(connDeptKeys).forEach(function(dk){ if(deptDisplayMap[dk]) deptIterList.push(deptDisplayMap[dk]); });

      deptIterList.forEach(function(dDisp) {
        var dKey = dDisp==='(All)' ? '' : normDept(dDisp);
        // For specific dept, only include if account has at least one conn in that dept
        if (dKey && !connDeptKeys[dKey]) return;
        ensureCli(dDisp);
        var mm = cliMetrics[dDisp];
        if (wasActiveInPeriod(conns, dKey, cliStatus))         mm.active[cliId2]    = rec;
        if (isPausedInPeriod(cliStatus, statusDate))           mm.paused[cliId2]    = rec;
        if (isChurned(cliStatus, statusDate))                  mm.churned[cliId2]   = rec;
        if (isRet)                                             mm.returning[cliId2] = rec;
        if (isNew(conns, dKey))                                mm.newRec[cliId2]    = rec;
      });
    }

    // Convert object sets to arrays
    function toArr(m) {
      return {
        active:   Object.values(m.active),
        paused:   Object.values(m.paused),
        newRec:   Object.values(m.newRec),
        returning:Object.values(m.returning),
        churned:  Object.values(m.churned)
      };
    }
    var cliOut = {};
    Object.keys(cliMetrics).forEach(function(d){ cliOut[d]=toArr(cliMetrics[d]); });

    // ── Build customer metrics (same pattern)
    var custMet = {};
    function ensureCust(d) { if(!custMet[d]) custMet[d]=initMetrics(); }

    for (var m2=1;m2<custData.length;m2++) {
      var cid    = String(custData[m2][ch['CustomerID']]||''); if(!cid) continue;
      var cname  = String(custData[m2][ch['CustomerName']]||'');
      var cst    = String(custData[m2][ch['Status']]||'');
      var csd    = toD(ch['StatusDate']!==undefined ? custData[m2][ch['StatusDate']] : null);
      var conns3 = connsByCustomer[cid] || [];
      var crec   = {customerId:cid,name:cname,status:cst,statusDate:sd(csd)};

      var connDepts3 = {};
      conns3.forEach(function(c){ if(c.deptKey) connDepts3[c.deptKey]=true; });
      var dIter3 = ['(All)'];
      Object.keys(connDepts3).forEach(function(dk){ if(deptDisplayMap[dk]) dIter3.push(deptDisplayMap[dk]); });

      dIter3.forEach(function(dDisp) {
        var dKey3 = dDisp==='(All)' ? '' : normDept(dDisp);
        if (dKey3 && !connDepts3[dKey3]) return;
        ensureCust(dDisp);
        var mm3 = custMet[dDisp];
        if (wasActiveInPeriod(conns3, dKey3, cst))  mm3.active[cid]  = crec;
        if (isPausedInPeriod(cst, csd))              mm3.paused[cid]  = crec;
        if (isChurned(cst, csd))                     mm3.churned[cid] = crec;
        if (isNew(conns3, dKey3))                    mm3.newRec[cid]  = crec;
      });
    }
    var custOut = {};
    Object.keys(custMet).forEach(function(d){ custOut[d]=toArr(custMet[d]); });

    // ── Compute metrics per month ──────────────────
    var monthlyCliMetrics   = {}; // month → dept → metrics
    var monthlyCustMetrics  = {};

    // Hoisted out of the per-month loop below — neither of these depends
    // on which month is being processed (latestHoursTypeByConn is built
    // from the full log history; the connection-type classification is
    // based on CURRENT connection status), so recomputing them fresh on
    // every one of 12 monthly iterations was pure redundant sheet I/O
    // producing an identical result each time.
    var latestHoursTypeByConn = {}; // connectionId → {date, hoursType}
    try {
      var hoursLogSh = ss.getSheetByName('VAConnectionHoursLog');
      if (hoursLogSh) {
        var hlD = hoursLogSh.getDataRange().getValues();
        var hlH = {}; hlD[0].forEach(function(c,i){ if(c) hlH[String(c)]=i; });
        for (var hli = 1; hli < hlD.length; hli++) {
          var hlChangeType = String(hlD[hli][hlH['ChangeType']]||'');
          if (hlChangeType === 'Project Hours Entry') continue; // one-off addition, not a schedule redefinition
          // Per the same confirmation workflow used everywhere else
          // this log is read — a Pending or Cancelled change hasn't
          // actually taken effect, so it shouldn't factor into this
          // report's computed hours type either.
          var hlApplyStatus = hlH['ApplyStatus'] !== undefined ? String(hlD[hli][hlH['ApplyStatus']]||'') : '';
          if (hlApplyStatus === 'Pending' || hlApplyStatus === 'Cancelled') continue;
          var hlConnId = String(hlD[hli][hlH['ConnectionID']]||''); if (!hlConnId) continue;
          var hlHoursType = String(hlD[hli][hlH['NewHoursType']]||'');
          if (!hlHoursType) continue;
          var hlDate = hlD[hli][hlH['EffectiveDate']];
          if (!latestHoursTypeByConn[hlConnId] || new Date(hlDate) > new Date(latestHoursTypeByConn[hlConnId].date)) {
            latestHoursTypeByConn[hlConnId] = { date: hlDate, hoursType: hlHoursType };
          }
        }
      }
    } catch (hlEx) { Logger.log('CA report hours-log index: ' + hlEx.message); }
    var hoistedCliConnTypes = {};  // clientId → {Regular:bool, Project:bool}
    var hoistedCustConnTypes = {}; // customerId → {Regular:bool, Project:bool}
    try {
      // connData/coh already hold this exact sheet's data in full, read
      // once at the top of this function — no need to re-read it here.
      for (var vciHoisted = 1; vciHoisted < connData.length; vciHoisted++) {
        if (String(connData[vciHoisted][coh['ConnectionStatus']]||'') !== 'Started') continue;
        var vcConnIdHoisted = String(connData[vciHoisted][coh['ConnectionID']]||'');
        var vcHrsTypeHoisted = (latestHoursTypeByConn[vcConnIdHoisted] && latestHoursTypeByConn[vcConnIdHoisted].hoursType)
          || String(coh['HoursType']!==undefined ? (connData[vciHoisted][coh['HoursType']]||'') : '');
        var vcBucketHoisted = (String(vcHrsTypeHoisted).trim().toLowerCase() === 'project based') ? 'Project' : 'Regular';
        var vcCliHoisted = String(connData[vciHoisted][coh['ClientID']]||'');
        if (vcCliHoisted) {
          if (!hoistedCliConnTypes[vcCliHoisted]) hoistedCliConnTypes[vcCliHoisted] = {};
          hoistedCliConnTypes[vcCliHoisted][vcBucketHoisted] = true;
        }
        var vcCustHoisted = String(connData[vciHoisted][coh['CustomerID']]||'');
        if (vcCustHoisted) {
          if (!hoistedCustConnTypes[vcCustHoisted]) hoistedCustConnTypes[vcCustHoisted] = {};
          hoistedCustConnTypes[vcCustHoisted][vcBucketHoisted] = true;
        }
      }
    } catch (vcExHoisted) { Logger.log('CA report connection-type index: ' + vcExHoisted.message); }

    months.forEach(function(ym) {
      var win = monthWindow(ym);
      var mCliMet  = {};
      var mCustMet = {};

      // isNew for this month: first conn in dept has actualStart in this month
      function isNewM(conns, dKey) {
        var rel=conns.filter(function(c){return !dKey||c.deptKey===dKey;});
        var dates=rel.map(function(c){return c.actualStart;}).filter(Boolean);
        if(!dates.length) return false;
        var first=dates.reduce(function(a,b){return a<b?a:b;});
        return inRange(first, win.from, win.to);
      }
      function wasActiveM(conns, dKey, st, statusDate) {
        // An account is "Active" in month X when ALL of these are true:
        //   1. It had a started VA connection that overlapped the month window
        //   2. The account was NOT Paused during this month
        //   3. The account was NOT Terminated or Cancelled during or before this month
        //      (unless it was reactivated — handled by isReturning flag separately)
        //
        // Rule (3): if status is Terminated/Cancelled, the account only counts
        // as Active for months that ended BEFORE the statusDate (i.e. it was
        // still Active at month-end). If statusDate falls within the month, the
        // account was active for part of the month but formally closed — we still
        // count it as Active for that month to avoid under-counting.
        // Rule (2): Paused accounts have their own Paused row — exclude from Active.
        if (st === CONFIG.STATUS.PAUSED) return false;

        // If terminated/cancelled AND statusDate is BEFORE this month started,
        // the account was already gone before this month — not Active.
        var isGone = (st === 'Terminated' || st === 'Cancelled');
        if (isGone && statusDate && statusDate < win.from) return false;

        var rel = conns.filter(function(c){ return !dKey || c.deptKey === dKey; });
        return rel.some(function(c) {
          return c.actualStart && c.actualStart <= win.to &&
                 (!c.termDate || c.termDate >= win.from);
        });
      }
      // Generic "did this record have a matching event during this
      // month's window" check. Falls back to a caller-supplied
      // current-state check when there's no history at all for this
      // record (e.g. a transition that happened before this history
      // tracking existed) — never for a record that DOES have history,
      // since falling back there would silently prefer stale current
      // state over the record's own real history.
      function hasEventInWindowM(id, historyMap, fallbackFn) {
        var dates = historyMap[id];
        if (dates && dates.length) return dates.some(function(d){ return inRange(d, win.from, win.to); });
        return fallbackFn ? fallbackFn() : false;
      }
      // PAUSED: can happen more than once over an account's lifetime, so
      // Status/StatusDate alone (which only reflects the most recent
      // pause) isn't enough — checked against the full pause history
      // instead. Falls back to current-state only when there's no
      // history at all for this record.
      function isPausedM(id, historyMap, st, sd2) {
        return hasEventInWindowM(id, historyMap, function() {
          if (st !== CONFIG.STATUS.PAUSED) return false;
          return !sd2 || sd2 <= win.to;
        });
      }
      // RETURNING: a genuine reactivation (Terminated/Cancelled → Active),
      // which — like Paused/Terminated/Cancelled — can happen more than
      // once, so it's tracked via its own history rather than inferred
      // from Status/ActualStartDate alone. Still requires the account to
      // actually have a VA connection at all (not just a status flip with
      // nothing connected) — that qualifying condition doesn't need to be
      // within this same month, just true at all.
      function isReturningM(id, historyMap, conns) {
        var hasAnyConnection = conns.some(function(c){ return !!c.actualStart; });
        if (!hasAnyConnection) return false;
        return hasEventInWindowM(id, historyMap, function() { return false; });
      }
      // TERMINATED-CHURN: the termination happened in the month BEFORE
      // this window (churn is conventionally reported with a one-month
      // lag). Checked against the full termination history so an account
      // terminated more than once (if reactivated in between) has EVERY
      // termination correctly counted in its own lagged month, not just
      // whichever one happens to be reflected in current StatusDate.
      function isTerminatedChurnM(id, historyMap, st, sd2) {
        var prevMonthFrom = new Date(win.from.getFullYear(), win.from.getMonth() - 1, 1);
        var prevMonthTo   = new Date(win.from.getFullYear(), win.from.getMonth(), 0, 23, 59, 59, 999);
        var dates = historyMap[id];
        if (dates && dates.length) return dates.some(function(d){ return d >= prevMonthFrom && d <= prevMonthTo; });
        return st === 'Terminated' && sd2 && sd2 >= prevMonthFrom && sd2 <= prevMonthTo;
      }
      // VA-CONNECTION-LEVEL CHURN — per the request, "VA Connections
      // Churn" needs to count individual terminated connections, not the
      // account's own overall status. Same one-month lag as
      // isTerminatedChurnM above, checked directly against a single
      // connection's own TerminationDate — completely independent of the
      // account-level status history, so a VA that left while a
      // different VA on the same account stayed active is still counted.
      function isConnChurnedM(termDate) {
        if (!termDate) return false;
        var prevMonthFrom = new Date(win.from.getFullYear(), win.from.getMonth() - 1, 1);
        var prevMonthTo   = new Date(win.from.getFullYear(), win.from.getMonth(), 0, 23, 59, 59, 999);
        return termDate >= prevMonthFrom && termDate <= prevMonthTo;
      }
      // VA-CONNECTION-LEVEL TERMINATED (current-month, unlagged) — the
      // same connection-level fix as isConnChurnedM above, but for the
      // current-month window isTerminatedM uses (not the one-month lag),
      // checked directly against the connection's own TerminationDate.
      function isConnTerminatedM(termDate) {
        if (!termDate) return false;
        return inRange(termDate, win.from, win.to);
      }
      // CANCELLED: can happen more than once (if reactivated in between),
      // so tracked via its own history rather than Status/StatusDate
      // alone. Tracked separately from Terminated — not included in Churned.
      function isCancelledM(id, historyMap, st, sd2) {
        return hasEventInWindowM(id, historyMap, function() {
          return st === 'Cancelled' && inRange(sd2, win.from, win.to);
        });
      }
      // TERMINATED (current-month, unlagged): can happen more than once
      // (if reactivated in between), so tracked via its own history
      // rather than Status/StatusDate alone. Deliberately separate from
      // "Churned" above, which is lagged one month on purpose.
      function isTerminatedM(id, historyMap, st, sd2) {
        return hasEventInWindowM(id, historyMap, function() {
          return st === 'Terminated' && inRange(sd2, win.from, win.to);
        });
      }
      // RESUMING: a Paused→Active transition, tracked via its own history
      // for the same reason as the others above — an account can be
      // paused and resumed more than once over its lifetime.
      function isResumingM(id, historyMap) {
        return hasEventInWindowM(id, historyMap, function() { return false; });
      }
      // NO ACTIVE VA / PENDING: from the day the account was added until the
      // day it FIRST ever had a VA start — a one-time window, not something
      // that recurs. Previously checked only "any active connection during
      // THIS month's window," which meant a customer who'd already been
      // active before and later lost their VA (churn, mid-replacement, etc.)
      // would incorrectly show as "Pending" again — that's a different
      // situation (already onboarded once, currently without coverage), not
      // the "never onboarded yet" gap Pending is meant to represent.
      function hasNoActiveVAM(conns, st, requireLiveAccount, createdAt) {
        if (['Terminated', 'Cancelled', CONFIG.STATUS.PAUSED].indexOf(st) >= 0) return false;
        if (requireLiveAccount && !requireLiveAccount()) return false;
        if (createdAt && createdAt > win.to) return false; // didn't exist yet as of this month
        var firstEverStart = null;
        conns.forEach(function(c) {
          if (!c.actualStart) return;
          if (!firstEverStart || c.actualStart < firstEverStart) firstEverStart = c.actualStart;
        });
        return !firstEverStart || firstEverStart > win.to;
      }

      // Real bug fixed here — the actual crash reported ("Cannot read
      // properties of undefined (reading 'push')"): both of these use a
      // fixed list of known metric keys to pre-initialize each bucket.
      // 'projectCompleted' (added for the Project Based / Project
      // Completed split) was never added to either list, so
      // cliRecsM[d]['projectCompleted'] was undefined the first time
      // bumpCli('projectCompleted', ...) tried to .push() into it.
      function initMM(dst, d) {
        if (!dst[d]) dst[d] = { active:0, paused:0, newRec:0, returning:0, resuming:0, churned:0, terminated:0, cancelled:0, noActiveVA:0, eoc:0, disconnectedVAs:0, projectCompleted:0, terminatedReplaced:0 };
      }
      var cliRecsM  = {};
      var custRecsM = {};
      function initRecs(dst, d) {
        if (!dst[d]) dst[d] = { active:[], paused:[], newRec:[], returning:[], resuming:[], churned:[], terminated:[], cancelled:[], noActiveVA:[], eoc:[], disconnectedVAs:[], projectCompleted:[], terminatedReplaced:[] };
      }

      // Clients
      var cliSeen  = {}; // dept → {metric → Set of ids}
      // Connection type tracking per client for VA type breakdown. IMPORTANT:
      // this classifies by each connection's CURRENT hours type as recorded
      // in VAConnectionHoursLog — not VAConnections.HoursType directly (that
      // column can lag behind the log once changes start getting applied,
      // since the log is the actual source of truth for a connection's
      // current state) and not ConnectionType (which defaults to 'Regular'
      // at creation and is almost never changed afterward). Computed once,
      // outside this per-month loop, as hoistedCliConnTypes — see above.

      function bumpCli(d, metric, id, rec) {
        if(!cliSeen[d]) cliSeen[d]={};
        if(!cliSeen[d][metric]) cliSeen[d][metric]={};
        if(cliSeen[d][metric][id]) return;
        cliSeen[d][metric][id]=true;
        initMM(mCliMet,d); mCliMet[d][metric]++;
        initRecs(cliRecsM,d); cliRecsM[d][metric].push(rec);
        // Also track VA type when bumping active — pushes into its own
        // record list too (not just a count), so the breakdown values are
        // clickable the same way every other metric on this report is.
        if(metric==='active') {
          var ct=hoistedCliConnTypes[id]||{};
          var subKey = (ct['Regular']&&ct['Project'])?'activeMixed':ct['Project']?'activeProject':'activeRegular';
          if(!cliSeen[d][subKey])cliSeen[d][subKey]={};
          if(!cliSeen[d][subKey][id]){
            cliSeen[d][subKey][id]=true;
            mCliMet[d][subKey]=(mCliMet[d][subKey]||0)+1;
            if (!cliRecsM[d][subKey]) cliRecsM[d][subKey] = [];
            cliRecsM[d][subKey].push(rec);
          }
        }
      }
      for (var k2=1;k2<cliData.length;k2++) {
        var cId2=String(cliData[k2][clh['ClientID']]||''); if(!cId2) continue;
        var cCustId2 = String(cliData[k2][clh['CustomerID']]||'');
        var cCompany2= String(cliData[k2][clh['CompanyName']]||'');
        var cAcctNm2 = String(cliData[k2][clh['AccountName']]||'');
        var cSt2=String(cliData[k2][clh['Status']]||'');
        var cSD2=toD(clh['StatusDate']!==undefined?cliData[k2][clh['StatusDate']]:null);
        // isRet2 (the persisted IsReturning flag) intentionally not read
        // here anymore — see returningThisM2 below for why.
        var cons2=connsByClient[cId2]||[];
        var cCustNameCached = String(cliData[k2][clh['CustomerName']]||'') || custNameById[cCustId2] || '';
        var latestTermConn2 = _latestTerminatedConn(cons2);
        var cliRec2 = {
          clientId:cId2,customerId:cCustId2,customerName:cCustNameCached,accountName:cCompany2+(cAcctNm2?' — '+cAcctNm2:''),name:cCompany2+(cAcctNm2?' — '+cAcctNm2:''),status:cSt2,statusDate:sd(cSD2),
          reason:(clh['TerminationReason']!==undefined?String(cliData[k2][clh['TerminationReason']]||''):''),
          // Per the request — VA-connection-level detail for the
          // Performance Report's Copy-to-Excel drill-down, pulled from
          // this account's most recently Terminated connection.
          connectionId: latestTermConn2 ? latestTermConn2.connectionId : '',
          vaName: latestTermConn2 ? latestTermConn2.vaName : '',
          connDepartment: latestTermConn2 ? (deptDisplayMap[latestTermConn2.deptKey] || '') : '',
          position: latestTermConn2 ? latestTermConn2.service : '',
          vaStartDate: latestTermConn2 ? sd(latestTermConn2.actualStart) : '',
          connTerminationDate: latestTermConn2 ? sd(latestTermConn2.termDate) : '',
          connTerminationReason: latestTermConn2 ? latestTermConn2.connTerminationReason : ''
        };
        var cdKeys2={}; cons2.forEach(function(cc){if(cc.deptKey)cdKeys2[cc.deptKey]=true;});
        var dIter2=['(All)']; Object.keys(cdKeys2).forEach(function(dk){if(deptDisplayMap[dk])dIter2.push(deptDisplayMap[dk]);});
        dIter2.forEach(function(dD) {
          var dK=dD==='(All)'?'':normDept(dD);
          if(dK&&!cdKeys2[dK])return;
          var returningThisM2 = isReturningM(cId2,reactivatedDatesByClient,cons2);
          var newThisM2       = isNewM(cons2,dK);
          if(wasActiveM(cons2,dK,cSt2,cSD2))          bumpCli(dD,'active',   cId2,cliRec2);
          if(isPausedM(cId2,pausedDatesByClient,cSt2,cSD2))                    bumpCli(dD,'paused',   cId2,cliRec2);
          // 'churned' and 'terminated' intentionally NOT bumped here
          // anymore — see the connection-level block right below
          // dIter2.forEach instead.
          if(isCancelledM(cId2,cancelledDatesByClient,cSt2,cSD2))                 bumpCli(dD,'cancelled',cId2,cliRec2);
          if(returningThisM2)                          bumpCli(dD,'returning',cId2,cliRec2);
          if(isResumingM(cId2,resumedDatesByClient)) bumpCli(dD,'resuming',cId2,cliRec2);
          // Per the request — enriched with whichever of this account's
          // own connections is the one that actually makes it "New" this
          // month (the earliest-started one, matching isNewM's own
          // definition), so the drill-down/copy can show that
          // connection's own VA/Department/Position/Start Date rather
          // than just the account's own status fields.
          if(newThisM2) {
            var newConn2 = null;
            cons2.forEach(function(c){
              if (dK && c.deptKey !== dK) return;
              if (!c.actualStart) return;
              if (!newConn2 || c.actualStart < newConn2.actualStart) newConn2 = c;
            });
            var newRec2 = {
              clientId: cId2, customerId: cCustId2, customerName: cCustNameCached,
              accountName: cCompany2 + (cAcctNm2 ? ' — ' + cAcctNm2 : ''),
              name: cCompany2 + (cAcctNm2 ? ' — ' + cAcctNm2 : ''),
              status: cSt2, statusDate: sd(cSD2),
              connectionId: newConn2 ? newConn2.connectionId : '',
              vaName: newConn2 ? newConn2.vaName : '',
              connDepartment: newConn2 ? (deptDisplayMap[newConn2.deptKey] || '') : '',
              position: newConn2 ? newConn2.service : '',
              vaStartDate: newConn2 ? sd(newConn2.actualStart) : ''
            };
            bumpCli(dD,'newRec', cId2, newRec2);
          }
        });
        // Real bug fixed here, per the request — "VA Connections Churn"
        // (and, per the follow-up request, "VA Connections Terminated"
        // too) are supposed to count one row per DISTINCT VA CONNECTION
        // that terminated, even when one account had more than one VA
        // leave, or when one VA left while a different VA on the same
        // account stayed active. The dIter2.forEach block above used to
        // bump this account's OWN overall status (account-level) into
        // EVERY department the account has EVER touched in its whole
        // history — so an account with an old, unrelated, still-active
        // connection in a second department got its single termination
        // event double-counted there too. That inflated the on-screen
        // Total beyond the true distinct-connection count — exactly why
        // the copy (which already deduplicated) showed fewer rows than
        // the number displayed on screen.
        //
        // This instead checks each of the account's own connections
        // directly against its own TerminationDate — Churned uses the
        // one-month-lag window (isConnChurnedM, matching
        // isTerminatedChurnM's own lag above), Terminated uses the
        // current-month window (isConnTerminatedM, matching isTerminatedM
        // above) — and only ever attributes a connection to its OWN
        // department, never to some other department the account happens
        // to also touch. bumpCli's own (d, metric, id) dedup guard now
        // keys on connectionId, so the same connection can't be
        // double-counted even if this ever ran twice for it.
        //
        // Deliberately independent of bumpCust/'Customer Account Churn'
        // below, which still means "did the account itself end up fully
        // inactive" — that count and its own drill-down are untouched by
        // this change.
        cons2.forEach(function(cc) {
          if (cc.connStatus !== 'Terminated') return;
          // Per the request — ConnectionType's own "Project-based" value
          // has been renamed to "Non-Regular" system-wide. Normalized
          // (case-folded, hyphens/spaces stripped) so this still
          // correctly matches regardless of minor formatting.
          //
          // Only Non-Regular is excluded from Terminated/Churned —
          // Expert, Regular, Trial Task, and any other value all count
          // normally, same as before.
          var normConnType = String(cc.connectionType || '').toLowerCase().replace(/[\s-]/g, '');
          var isProjectBased = normConnType === 'nonregular';
          var isChurnHit = !isProjectBased && isConnChurnedM(cc.termDate);
          var isTermHit  = !isProjectBased && isConnTerminatedM(cc.termDate);
          var isProjectCompletedHit = isProjectBased && isConnTerminatedM(cc.termDate);
          if (!isChurnHit && !isTermHit && !isProjectCompletedHit) return;
          // Per the request — EOC vs. TOC: does this account have any
          // OTHER currently-Started connection left? If so, this
          // termination is just an End of Contract for this one VA (the
          // account carries on) — if not, this is the account's last
          // connection ending, i.e. it Totally left (TOC). Same
          // definition already used for the Termination Reasons report's
          // own TOC column (PerformanceReportService.gs) — checked
          // directly here against cons2, this account's own full
          // connection list, already in scope.
          var isTOC2 = !cons2.some(function(c){ return c.connStatus === 'Started'; });
          // Per the request — Incident Report link (Termination
          // ticket's own TicketReportLink, falling back to the
          // originating Concern's if the Termination itself doesn't
          // have one) and whether a Replacement was ever created from
          // this termination (EscalatedToRequestID).
          var termTicket2 = terminationByConnId[cc.connectionId];
          var incidentReportLink2 = termTicket2
            ? (termTicket2.ticketReportLink || concernReportLinkByTerminationId[termTicket2.inquiryId] || '')
            : '';
          var hadReplacement2 = !!(termTicket2 && termTicket2.escalatedToRequestId);
          var replacementConnected2 = _replacementConnected(cc.replacedByConnectionId);
          var connRec2 = {
            clientId: cId2, customerId: cCustId2, customerName: cCustNameCached,
            accountName: cCompany2 + (cAcctNm2 ? ' — ' + cAcctNm2 : ''),
            name: cCompany2 + (cAcctNm2 ? ' — ' + cAcctNm2 : ''),
            status: cSt2, statusDate: sd(cSD2),
            reason: (clh['TerminationReason'] !== undefined ? String(cliData[k2][clh['TerminationReason']]||'') : ''),
            connectionId: cc.connectionId,
            vaName: cc.vaName,
            connDepartment: deptDisplayMap[cc.deptKey] || '',
            position: cc.service,
            vaStartDate: sd(cc.actualStart),
            connTerminationDate: sd(cc.termDate),
            connTerminationReason: cc.connTerminationReason,
            isTOC: isTOC2,
            incidentReportLink: incidentReportLink2,
            hadReplacement: hadReplacement2,
            replacementConnected: replacementConnected2
          };
          var connDeptDisplay = deptDisplayMap[cc.deptKey];
          var dedupId = cc.connectionId || (cId2 + '|' + cc.termDate);
          if (isChurnHit) {
            bumpCli('(All)', 'churned', dedupId, connRec2);
            if (connDeptDisplay) bumpCli(connDeptDisplay, 'churned', dedupId, connRec2);
          }
          if (isTermHit) {
            bumpCli('(All)', 'terminated', dedupId, connRec2);
            if (connDeptDisplay) bumpCli(connDeptDisplay, 'terminated', dedupId, connRec2);
            if (replacementConnected2) {
              bumpCli('(All)', 'terminatedReplaced', dedupId, connRec2);
              if (connDeptDisplay) bumpCli(connDeptDisplay, 'terminatedReplaced', dedupId, connRec2);
            }
          }
          if (isProjectCompletedHit) {
            bumpCli('(All)', 'projectCompleted', dedupId, connRec2);
            if (connDeptDisplay) bumpCli(connDeptDisplay, 'projectCompleted', dedupId, connRec2);
          }
        });
        // noActiveVA is department-agnostic — only ever evaluated/bumped
        // under (All), since an account with zero active VAs has no
        // department connection to be grouped under in the first place.
        if (hasNoActiveVAM(cons2, cSt2, null, toD(clh['CreatedAt']!==undefined?cliData[k2][clh['CreatedAt']]:null))) bumpCli('(All)','noActiveVA',cId2,cliRec2);
      }
      // Same VA-type classification as Clients above, grouped by customer
      // instead — a customer's own Regular/Project/Mixed bucket depends on
      // ALL its accounts' connections combined, not just one account's.
      // Computed once, outside this per-month loop, as
      // hoistedCustConnTypes — see above.

      // Customers
      var custSeen={};
      function bumpCust(d,metric,id,rec){
        if(!custSeen[d]) custSeen[d]={};
        if(!custSeen[d][metric]) custSeen[d][metric]={};
        if(custSeen[d][metric][id]) return;
        custSeen[d][metric][id]=true;
        initMM(mCustMet,d); mCustMet[d][metric]++;
        initRecs(custRecsM,d); custRecsM[d][metric].push(rec);
        if (metric==='active') {
          var cct = hoistedCustConnTypes[id]||{};
          var custSubKey = (cct['Regular']&&cct['Project'])?'activeMixed':cct['Project']?'activeProject':'activeRegular';
          if(!custSeen[d][custSubKey])custSeen[d][custSubKey]={};
          if(!custSeen[d][custSubKey][id]){
            custSeen[d][custSubKey][id]=true;
            mCustMet[d][custSubKey]=(mCustMet[d][custSubKey]||0)+1;
            if (!custRecsM[d][custSubKey]) custRecsM[d][custSubKey] = [];
            custRecsM[d][custSubKey].push(rec);
          }
        }
      }
      for (var m3=1;m3<custData.length;m3++) {
        var cId3=String(custData[m3][ch['CustomerID']]||''); if(!cId3) continue;
        var cName3 = String(custData[m3][ch['CustomerName']]||'');
        var cSt3=String(custData[m3][ch['Status']]||'');
        var cSD3=toD(ch['StatusDate']!==undefined?custData[m3][ch['StatusDate']]:null);
        var cons3=connsByCustomer[cId3]||[];
        var latestTermConn3 = _latestTerminatedConn(cons3);
        var custRec3 = {
          customerId:cId3,name:cName3,status:cSt3,statusDate:sd(cSD3),
          reason:(ch['TerminationReason']!==undefined?String(custData[m3][ch['TerminationReason']]||''):''),
          connectionId: latestTermConn3 ? latestTermConn3.connectionId : '',
          vaName: latestTermConn3 ? latestTermConn3.vaName : '',
          connDepartment: latestTermConn3 ? (deptDisplayMap[latestTermConn3.deptKey] || '') : '',
          position: latestTermConn3 ? latestTermConn3.service : '',
          vaStartDate: latestTermConn3 ? sd(latestTermConn3.actualStart) : '',
          connTerminationDate: latestTermConn3 ? sd(latestTermConn3.termDate) : '',
          connTerminationReason: latestTermConn3 ? latestTermConn3.connTerminationReason : ''
        };
        var cdKeys3={}; cons3.forEach(function(cc){if(cc.deptKey)cdKeys3[cc.deptKey]=true;});
        var dIter3=['(All)']; Object.keys(cdKeys3).forEach(function(dk){if(deptDisplayMap[dk])dIter3.push(deptDisplayMap[dk]);});
        dIter3.forEach(function(dD) {
          var dK=dD==='(All)'?'':normDept(dD);
          if(dK&&!cdKeys3[dK])return;
          var returningThisM3 = isReturningM(cId3,reactivatedDatesByCustomer,cons3);
          var newThisM3       = isNewM(cons3,dK);
          if(wasActiveM(cons3,dK,cSt3,cSD3))          bumpCust(dD,'active',   cId3,custRec3);
          if(isPausedM(cId3,pausedDatesByCustomer,cSt3,cSD3))                    bumpCust(dD,'paused',   cId3,custRec3);
          if(isTerminatedChurnM(cId3,terminatedDatesByCustomer,cSt3,cSD3))           bumpCust(dD,'churned',  cId3,custRec3);
          if(isTerminatedM(cId3,terminatedDatesByCustomer,cSt3,cSD3))                bumpCust(dD,'terminated',cId3,custRec3);
          if(isCancelledM(cId3,cancelledDatesByCustomer,cSt3,cSD3))                 bumpCust(dD,'cancelled',cId3,custRec3);
          if(returningThisM3)                          bumpCust(dD,'returning',cId3,custRec3);
          if(isResumingM(cId3,resumedDatesByCustomer)) bumpCust(dD,'resuming',cId3,custRec3);
          if(newThisM3)                                bumpCust(dD,'newRec',   cId3,custRec3);
        });
        if (hasNoActiveVAM(cons3, cSt3, function(){ return !!custHasLiveAccount[cId3]; }, toD(ch['CreatedAt']!==undefined?custData[m3][ch['CreatedAt']]:null))) bumpCust('(All)','noActiveVA',cId3,custRec3);
      }

      // Per the request — EOC and Disconnected VAs, computed from
      // connection-level terminations this month (distinct from the
      // existing "Terminated" metric above, which is based on the
      // account's own Status field). All active VA connections for the
      // same clientId are checked directly here, not derived from any
      // other metric, to avoid any risk of double-counting or drift.
      var eocCliNameById = {};
      var eocDebugMatchCount = 0;
      for (var eni = 1; eni < cliData.length; eni++) {
        var eniId = String(cliData[eni][clh['ClientID']]||''); if (!eniId) continue;
        eocCliNameById[eniId] = String(cliData[eni][clh['AccountName']]||'') || String(cliData[eni][clh['CompanyName']]||'') || eniId;
      }
      for (var eci = 1; eci < connData.length; eci++) {
        if (!connData[eci][coh['ConnectionID']]) continue;
        var eConnSt = String(connData[eci][coh['ConnectionStatus']]||'');
        if (eConnSt !== 'Terminated') continue;
        var eTermD = toD(coh['TerminationDate']!==undefined ? connData[eci][coh['TerminationDate']] : null);
        if (!eTermD || !inRange(eTermD, win.from, win.to)) continue;
        eocDebugMatchCount++;

        var eReqId  = String(connData[eci][coh['RequestID']]||'');
        var eDeptKey = reqDept[eReqId] || '';
        var eDept   = eDeptKey ? (deptDisplayMap[eDeptKey] || '') : '';
        var eCliId  = String(connData[eci][coh['ClientID']]||'');
        var eCustId = String(connData[eci][coh['CustomerID']]||'');
        var eVaId   = String(connData[eci][coh['VAID']]||'');
        var eVaName = String(connData[eci][coh['VAName']]||'');
        // Per investigating this report — VAID is sometimes blank on
        // older/inconsistently-populated connection records. Falls back
        // to the VA's name as the dedup key in that case, rather than
        // silently skipping that termination from the count entirely.
        var eVaKey  = eVaId || eVaName;
        if (!eVaName) eVaName = eVaId || 'Unknown VA';

        // Disconnected VAs — every terminated VA counts here, regardless
        // of whether their account has other active connections.
        if (eVaKey) {
          // Real bug fixed here, per the request — accountName was set
          // to the VA's own name (a copy-paste of `name` below), never
          // the actual account the VA was disconnected from. Now pulls
          // the real "Company — Account" display from
          // cliDisplayNameById, so the drill-down/copy can show which
          // client(s) each disconnected VA was working with.
          var vaRec = { clientId: eCliId, customerId: eCustId, customerName: custNameById[eCustId]||eCustId, accountName: cliDisplayNameById[eCliId]||'', name: eVaName, vaName: eVaName, status: 'Terminated', connTerminationDate: sd(eTermD) };
          if (eDept) bumpCli(eDept, 'disconnectedVAs', eVaKey, vaRec);
          bumpCli('(All)', 'disconnectedVAs', eVaKey, vaRec);
          if (eCustId) {
            if (eDept) bumpCust(eDept, 'disconnectedVAs', eVaKey, vaRec);
            bumpCust('(All)', 'disconnectedVAs', eVaKey, vaRec);
          }
        }

        // EOC — only when this account still has another connection
        // that's genuinely active (Started), as of right now. Doesn't
        // touch the existing Terminated (TOC) metric's own computation.
        var stillHasActiveOther = (connsByClient[eCliId]||[]).some(function(c) {
          return c.connStatus === 'Started';
        });
        if (stillHasActiveOther && eCliId) {
          var cliAcctName = eocCliNameById[eCliId] || eCliId;
          var cliRecEoc = { clientId: eCliId, customerId: eCustId, customerName: custNameById[eCustId]||eCustId, accountName: cliAcctName, name: cliAcctName, status: 'Active' };
          if (eDept) bumpCli(eDept, 'eoc', eCliId, cliRecEoc);
          bumpCli('(All)', 'eoc', eCliId, cliRecEoc);
          if (eCustId) {
            var custRecEoc = { clientId: eCliId, customerId: eCustId, customerName: custNameById[eCustId]||eCustId, accountName: cliAcctName, name: custNameById[eCustId]||eCustId, status: 'Active' };
            if (eDept) bumpCust(eDept, 'eoc', eCustId, custRecEoc);
            bumpCust('(All)', 'eoc', eCustId, custRecEoc);
          }
        }
      }

      Logger.log('[EOC-DEBUG] ' + ym + ': terminated connections found in window = ' + eocDebugMatchCount +
        ', (All) eoc=' + ((mCliMet['(All)']||{}).eoc||0) + ', (All) disconnectedVAs=' + ((mCliMet['(All)']||{}).disconnectedVAs||0));

      monthlyCliMetrics[ym]  = { data:mCliMet,  records:cliRecsM,  label:win.label };
      monthlyCustMetrics[ym] = { data:mCustMet, records:custRecsM, label:win.label };
    });

    var result = {
      success: true,
      months: months,
      monthLabels: months.map(function(ym){ return monthWindow(ym).label; }),
      departments: departments,
      monthly: { clients:monthlyCliMetrics, customers:monthlyCustMetrics },
      // Legacy single-window data — kept only as a fallback for any older
      // cached client state; the report itself now drills into monthly.records.
      clients:   cliOut,
      customers: custOut
    };
    try { cache.put(cacheKey, JSON.stringify(result), 300); }
    catch (cacheWriteEx) { Logger.log('getCustomerAccountReport cache write: ' + cacheWriteEx.message); }
    return result;
  } catch(e) {
    return { success:false, error:'getCustomerAccountReport: '+e.message };
  }
}

// ── Specialist Dashboard: my customers with open SR + Inquiry counts
function getSpecialistDashboardData() {
  try {
    var user = getCurrentUser();
    if (!user || user.error) return { success: false, error: user.error || 'Not authenticated.' };

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var email = (user.email || '').toLowerCase().trim();

    // ── 1. My assigned customers
    var custSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!custSheet) return { success: false, error: 'Customers sheet missing.' };
    var custData = custSheet.getDataRange().getValues();
    var ch = {}; custData[0].forEach(function(c,i){ if(c) ch[String(c)]=i; });

    var myCustIds = {}, myCusts = [];
    for (var i=1; i<custData.length; i++) {
      var assigned = String(custData[i][ch['AssignedSpecialist']]||'').toLowerCase().trim();
      if (assigned !== email) continue;
      var cid   = String(custData[i][ch['CustomerID']]||'');
      var cname = String(custData[i][ch['CustomerName']]||'');
      var cst   = String(custData[i][ch['Status']]||'');
      if (!cid) continue;
      myCustIds[cid] = true;
      myCusts.push({ customerId:cid, customerName:cname, status:cst, openRequests:0, openInquiries:0 });
    }

    if (!myCusts.length) return { success: true, data: [], user: { name:user.name, email:user.email } };

    // ── 2. Count open Service Requests per customerId
    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (reqSheet) {
      var reqData = reqSheet.getDataRange().getValues();
      var rh = {}; reqData[0].forEach(function(c,i){ if(c) rh[String(c)]=i; });
      var openReqStatus = [CONFIG.VA_REQUEST_STATUS.OPEN, CONFIG.VA_REQUEST_STATUS.IN_PROGRESS];
      var reqCounts = {};
      for (var r=1; r<reqData.length; r++) {
        var rcid = String(reqData[r][rh['CustomerID']]||'');
        var rst  = String(reqData[r][rh['Status']]||'');
        if (!myCustIds[rcid]) continue;
        if (openReqStatus.indexOf(rst) < 0) continue;
        reqCounts[rcid] = (reqCounts[rcid]||0) + 1;
      }
      myCusts.forEach(function(c){ c.openRequests = reqCounts[c.customerId] || 0; });
    }

    // ── 3. Count open Inquiries per customerId
    var iqSheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
    if (iqSheet) {
      var iqData = iqSheet.getDataRange().getValues();
      var ih = {}; iqData[0].forEach(function(c,i){ if(c) ih[String(c)]=i; });
      var openIqStatus = [CONFIG.INQUIRY_STATUS.OPEN, CONFIG.INQUIRY_STATUS.IN_PROGRESS];
      var iqCounts = {};
      for (var q=1; q<iqData.length; q++) {
        var qcid = String(iqData[q][ih['CustomerID']]||'');
        var qst  = String(iqData[q][ih['Status']]||'');
        if (!myCustIds[qcid]) continue;
        if (openIqStatus.indexOf(qst) < 0) continue;
        iqCounts[qcid] = (iqCounts[qcid]||0) + 1;
      }
      myCusts.forEach(function(c){ c.openInquiries = iqCounts[c.customerId] || 0; });
    }

    // Sort: customers with open items first, then alphabetically
    myCusts.sort(function(a,b){
      var aHas = (a.openRequests + a.openInquiries) > 0;
      var bHas = (b.openRequests + b.openInquiries) > 0;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return (b.openRequests + b.openInquiries) - (a.openRequests + a.openInquiries);
    });

    // ── Scoped stats: active/paused accounts under MY customers
    var myCustIdSet = {};
    myCusts.forEach(function(c){ myCustIdSet[c.customerId] = true; });

    var activeClients = 0, pausedClients = 0;
    var cliSheet2 = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (cliSheet2) {
      var cliD2 = cliSheet2.getDataRange().getValues();
      var clh2  = {}; cliD2[0].forEach(function(col,i){ if(col) clh2[String(col)]=i; });
      for (var c2=1; c2<cliD2.length; c2++) {
        var clCustId = String(cliD2[c2][clh2['CustomerID']]||'');
        if (!myCustIdSet[clCustId]) continue;
        var clSt = String(cliD2[c2][clh2['Status']]||'');
        if (clSt === CONFIG.STATUS.ACTIVE)  activeClients++;
        if (clSt === CONFIG.STATUS.PAUSED)  pausedClients++;
      }
    }

    // ── Last 30 days: new customers and accounts under MY customers
    var now30   = new Date();
    var from30  = new Date(now30.getFullYear(), now30.getMonth(), now30.getDate() - 29);

    var last30Customers = [];
    for (var i30=1; i30<custData.length; i30++) {
      var c30id = String(custData[i30][ch['CustomerID']]||'');
      if (!myCustIdSet[c30id]) continue;
      var crd = custData[i30][ch['CreatedAt']];
      var d30 = crd instanceof Date ? crd : new Date(crd||0);
      if (d30 >= from30) {
        last30Customers.push({
          name:   String(custData[i30][ch['CustomerName']]||''),
          status: String(custData[i30][ch['Status']]||''),
          date:   (crd instanceof Date) ? crd.toISOString() : String(crd||'')
        });
      }
    }
    last30Customers.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });

    var last30Accounts = [];
    if (cliSheet2) {
      var cliD3 = cliSheet2.getDataRange().getValues();
      var clh3  = {}; cliD3[0].forEach(function(col,i){ if(col) clh3[String(col)]=i; });
      for (var c3=1; c3<cliD3.length; c3++) {
        var cl3CustId = String(cliD3[c3][clh3['CustomerID']]||'');
        if (!myCustIdSet[cl3CustId]) continue;
        var crd3 = cliD3[c3][clh3['CreatedAt']];
        var d3   = crd3 instanceof Date ? crd3 : new Date(crd3||0);
        if (d3 >= from30) {
          last30Accounts.push({
            name:   String(cliD3[c3][clh3['CompanyName']]||'') + (cliD3[c3][clh3['AccountName']] ? ' — '+cliD3[c3][clh3['AccountName']] : ''),
            status: String(cliD3[c3][clh3['Status']]||''),
            date:   (crd3 instanceof Date) ? crd3.toISOString() : String(crd3||'')
          });
        }
      }
      last30Accounts.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
    }

    return {
      success: true,
      data: myCusts,
      user: { name: user.name, email: user.email },
      activeClients:    activeClients,
      pausedClients:    pausedClients,
      last30Customers:  last30Customers,
      last30Accounts:   last30Accounts,
      specialistEmail:  email
    };
  } catch(e) {
    return { success: false, error: 'getSpecialistDashboardData: ' + e.message };
  }
}

function loadCustomerFullProfile(customerId) {
  try { return getCustomerFullProfile(customerId); }
  catch(e){ return { success:false, error:e.message }; }
}
// Alias used by frontend to avoid potential naming collisions
function getCustomerFullProfileData(customerId) {
  // Self-contained — does not depend on CustomerService.gs being separate
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    try { _ensureCustomerSheetColumns(ss); } catch(migEx) {} // self-healing, best-effort on read too

    // ── Customer record
    var cSheet = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (!cSheet) return { success:false, error:'Customers sheet missing.' };
    var cData = cSheet.getDataRange().getValues();
    var ch = {}; cData[0].forEach(function(col,i){ if(col) ch[String(col)]=i; });

    var customer = null;
    for (var i=1; i<cData.length; i++) {
      if (String(cData[i][ch['CustomerID']]||'') !== customerId) continue;
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
        terminationCount:    ch['TerminationCount']    !==undefined?Number(cData[i][ch['TerminationCount']]   ||0):0,
        reactivationCount:   ch['ReactivationCount']   !==undefined?Number(cData[i][ch['ReactivationCount']]  ||0):0,
        lastTerminatedDate:  ch['LastTerminatedDate']  !==undefined?_sd(cData[i][ch['LastTerminatedDate']]) :'',
        lastReactivatedDate: ch['LastReactivatedDate'] !==undefined?_sd(cData[i][ch['LastReactivatedDate']]):'',
        statusHistory:       ch['StatusHistory']       !==undefined?String(cData[i][ch['StatusHistory']]||''):'',
        paymentDate:         ch['PaymentDate']  !==undefined?_sd(cData[i][ch['PaymentDate']]):'',
        noPaymentYet:        ch['NoPaymentYet'] !==undefined?_toBool(cData[i][ch['NoPaymentYet']]):false
      };
      break;
    }
    if (!customer) return { success:false, error:'Customer not found.' };

    // Idle Time metric — days from added/paid to the customer's first VA
    // connection reaching Accepted/Started. Shared helper lives in
    // CustomerService.gs; GAS merges all .gs files into one namespace so
    // it's callable directly here without duplicating the VAConnections scan.
    var idle = _computeCustomerIdleDays(customerId, customer.createdAt, customer.paymentDate, customer.noPaymentYet);
    customer.idleDaysSinceAdded = idle.idleDaysSinceAdded;
    customer.idleDaysSincePaid  = idle.idleDaysSincePaid;
    customer.firstVAConnectedAt = idle.firstVAConnectedAt;

    // ── Accounts
    var clients = [];
    var clSheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
    if (clSheet) {
      var clData = clSheet.getDataRange().getValues();
      var clh = {}; clData[0].forEach(function(col,i){ if(col) clh[String(col)]=i; });
      for (var ci=1; ci<clData.length; ci++) {
        if (String(clData[ci][clh['CustomerID']]||'') !== customerId) continue;
        clients.push({
          clientId:       String(clData[ci][clh['ClientID']]||''),
          companyName:    String(clData[ci][clh['CompanyName']]||''),
          accountName:    String(clData[ci][clh['AccountName']]||''),
          status:         String(clData[ci][clh['Status']]||''),
          category:       String(clData[ci][clh['Category']]||''),
          type:           String(clData[ci][clh['Type']]||''),
          countryRegion:  String(clData[ci][clh['CountryRegion']]||''),
          primaryContact: String(clData[ci][clh['PrimaryContact']]||''),
          openSR:0, openIQ:0
        });
      }
    }
    customer.clients = clients;

    // ── Open SR count
    var openSRByClient = {}, openSRTotal = 0;
    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (reqSheet) {
      var rData = reqSheet.getDataRange().getValues();
      var rh = {}; rData[0].forEach(function(col,i){ if(col) rh[String(col)]=i; });
      for (var r=1; r<rData.length; r++) {
        if (String(rData[r][rh['CustomerID']]||'') !== customerId) continue;
        var rst = String(rData[r][rh['Status']]||'');
        if (rst !== CONFIG.VA_REQUEST_STATUS.OPEN && rst !== CONFIG.VA_REQUEST_STATUS.IN_PROGRESS) continue;
        var rcli = String(rData[r][rh['ClientID']]||'');
        openSRByClient[rcli] = (openSRByClient[rcli]||0)+1; openSRTotal++;
      }
    }

    // ── Open Inquiry count
    var openIQByClient = {}, openIQTotal = 0;
    var iqSheet = ss.getSheetByName(CONFIG.SHEETS.INQUIRIES);
    if (iqSheet) {
      var iqData = iqSheet.getDataRange().getValues();
      var iqh = {}; iqData[0].forEach(function(col,i){ if(col) iqh[String(col)]=i; });
      for (var q=1; q<iqData.length; q++) {
        if (String(iqData[q][iqh['CustomerID']]||'') !== customerId) continue;
        var qst = String(iqData[q][iqh['Status']]||'');
        if (qst !== CONFIG.INQUIRY_STATUS.OPEN && qst !== CONFIG.INQUIRY_STATUS.IN_PROGRESS) continue;
        var qcli = String(iqData[q][iqh['ClientID']]||'');
        openIQByClient[qcli] = (openIQByClient[qcli]||0)+1; openIQTotal++;
      }
    }
    customer.clients.forEach(function(cl){
      cl.openSR = openSRByClient[cl.clientId]||0;
      cl.openIQ = openIQByClient[cl.clientId]||0;
    });
    customer.openSRTotal = openSRTotal;
    customer.openIQTotal = openIQTotal;

    // ── Build email→name lookup for specialists
    var specNameMap = {};
    try {
      var uSheet = ss.getSheetByName(CONFIG.SHEETS.USERS);
      if (uSheet) {
        var uData = uSheet.getDataRange().getValues();
        var uh = {}; uData[0].forEach(function(col,i){ if(col) uh[String(col)]=i; });
        for (var u=1; u<uData.length; u++) {
          var uEmail = String(uData[u][uh['Email']]||'').toLowerCase().trim();
          var uName  = String(uData[u][uh['Name']] ||'').trim();
          if (uEmail && uName) specNameMap[uEmail] = uName;
        }
      }
    } catch(uEx) { Logger.log('specNameMap: '+uEx.message); }
    function resolveSpec(email) {
      if (!email) return '';
      return specNameMap[email.toLowerCase().trim()] || email;
    }

    // ── Specialist assignment history + Status change log
    var specHistory = [], statusLog = [];
    var logSheet = ss.getSheetByName(CONFIG.SHEETS.ACTIVITY_LOGS);
    if (logSheet) {
      var lgData = logSheet.getDataRange().getValues();
      var lgh = {}; lgData[0].forEach(function(col,i){ if(col) lgh[String(col)]=i; });
      for (var l=1; l<lgData.length; l++) {
        if (String(lgData[l][lgh['EntityID']]||'') !== customerId) continue;
        var action = String(lgData[l][lgh['Action']]||'');
        var field  = String(lgData[l][lgh['FieldChanged']]||'').toLowerCase();
        var effRaw = lgh['EffectiveDate'] !== undefined ? lgData[l][lgh['EffectiveDate']] : '';
        var entry  = {
          action:   action,
          oldValue: String(lgData[l][lgh['OldValue']]||''),
          newValue: String(lgData[l][lgh['NewValue']]||''),
          by:       String(lgData[l][lgh['UserName']]||lgData[l][lgh['UserEmail']]||''),
          date:     effRaw ? _sd(effRaw) : _sd(lgData[l][lgh['Timestamp']])
        };
        // Specialist history
        if (action === 'TRANSFER' || (action === 'UPDATE' && field === 'assignedspecialist')) {
          entry.newName = resolveSpec(entry.newValue);
          entry.oldName = resolveSpec(entry.oldValue);
          specHistory.push(entry);
        }
        // Status log: any status change OR activation/termination events
        if (action === 'UPDATE' && field === 'status') {
          statusLog.push(entry);
        }
        if (action === 'REACTIVATE' || action === 'TERMINATE' || action === 'CANCEL' || action === 'PAUSE' || action === 'RESUME') {
          statusLog.push(entry);
        }
      }
      specHistory.reverse();
      statusLog.reverse();
    }
    customer.specHistory = specHistory;
    customer.statusLog   = statusLog;

    return { success:true, data:customer };
  } catch(e) {
    return { success:false, error:'getCustomerFullProfileData: '+e.message };
  }
}

// ═══════════════════════════════════════════
// HOURS REPORT — Monthly VA Connection Hours
// ═══════════════════════════════════════════
function getHoursReport(params) {
  try {
    params = params || {};
    var now = new Date();

    // Build month windows (selected month + 5 prior)
    var months = [];
    if (params.selectedMonth) {
      var sp = params.selectedMonth.split('-');
      var sy = parseInt(sp[0],10), sm = parseInt(sp[1],10)-1;
      for (var mi=5; mi>=0; mi--) {
        var my=sy, mm=sm-mi;
        while(mm<0){mm+=12;my--;} while(mm>11){mm-=12;my++;}
        months.push({ y:my, m:mm });
      }
    } else {
      for (var mi2=5; mi2>=0; mi2--) {
        var my2=now.getFullYear(), mm2=now.getMonth()-mi2;
        while(mm2<0){mm2+=12;my2--;} while(mm2>11){mm2-=12;my2++;}
        months.push({ y:my2, m:mm2 });
      }
    }

    function monthLabel(ym) {
      return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ym.m]+' '+ym.y;
    }
    function monthWindow(ym) {
      return { from: new Date(ym.y, ym.m, 1), to: new Date(ym.y, ym.m+1, 0, 23, 59, 59) };
    }
    function countWeekdays(from, to) {
      var d = new Date(from); d.setHours(0,0,0,0);
      var end = new Date(to); end.setHours(23,59,59,0);
      var count = 0;
      while (d <= end) { var dow = d.getDay(); if (dow >= 1 && dow <= 5) count++; d.setDate(d.getDate()+1); }
      return count;
    }
    function toD(v) { if (v instanceof Date) return v; if (v) { var d=new Date(v); return isNaN(d.getTime())?null:d; } return null; }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ── Load VARequests → hours lookup
    var reqSheet = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    var hoursLookup = {}; // requestId → hoursPerWeek (number)
    if (reqSheet) {
      var rd = reqSheet.getDataRange().getValues();
      var rh = {}; rd[0].forEach(function(c,i){ if(c) rh[String(c)]=i; });
      for (var ri=1; ri<rd.length; ri++) {
        var reqId = String(rd[ri][rh['RequestID']]||'');
        var hrs   = parseFloat(rd[ri][rh['Hours']]||'0') || 0;
        if (reqId) hoursLookup[reqId] = hrs;
      }
    }

    // ── Load VAConnections
    var connSheet = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (!connSheet) return { success:false, error:'VAConnections sheet missing.' };
    var cd = connSheet.getDataRange().getValues();
    var coh = {}; cd[0].forEach(function(c,i){ if(c) coh[String(c)]=i; });

    var conns = [];
    for (var ci=1; ci<cd.length; ci++) {
      var connId = String(cd[ci][coh['ConnectionID']]||''); if (!connId) continue;
      var reqId2 = String(cd[ci][coh['RequestID']]||'');
      var cliId  = String(cd[ci][coh['ClientID']]||'');
      var custId = String(cd[ci][coh['CustomerID']]||'');
      var connSt = String(cd[ci][coh['ConnectionStatus']]||'');
      var connTy = String(cd[ci][coh['ConnectionType']]||'Regular');
      var startD = toD(coh['ActualStartDate']!==undefined?cd[ci][coh['ActualStartDate']]:null);
      var termD  = toD(coh['TerminationDate']!==undefined?cd[ci][coh['TerminationDate']]:null);
      var hpw    = hoursLookup[reqId2] || 0;
      var hpd    = hpw > 0 ? hpw / 5 : 0; // hours per weekday
      // Per the request — ConnectionType's "Project-based" value renamed
      // to "Non-Regular" system-wide.
      var isProjBased = connTy.toLowerCase().replace(/[\s-]/g, '') === 'nonregular';
      if (!startD) continue;
      conns.push({ connId:connId, reqId:reqId2, cliId:cliId, custId:custId,
        status:connSt, isProjBased:isProjBased,
        startD:startD, termD:termD, hpd:hpd, hpw:hpw });
    }

    // ── Per-client: sort connections by startDate to identify "first" vs "additional"
    var clientFirstStart = {}; // clientId → earliest start date
    conns.forEach(function(c) {
      if (!clientFirstStart[c.cliId] || c.startD < clientFirstStart[c.cliId]) {
        clientFirstStart[c.cliId] = c.startD;
      }
    });

    // ── Compute per-month metrics
    var monthlyResults = months.map(function(ym) {
      var win = monthWindow(ym);
      var label = monthLabel(ym);

      var regular = { total:0, added_newClient:0, added_addlVA:0, lost_churn:0, lost_reduction:0, activeCount:0 };
      var project  = { total:0, added_newClient:0, added_addlVA:0, lost_churn:0, lost_reduction:0, activeCount:0 };

      conns.forEach(function(conn) {
        var bucket = conn.isProjBased ? project : regular;
        var hpd = conn.hpd;
        if (hpd <= 0) return;

        // Was active during any part of this month?
        var connEnd = conn.termD || win.to; // treat no termination as still running
        if (conn.startD > win.to) return;   // not started yet
        if (conn.termD && conn.termD < win.from) return; // ended before month

        // Active window within this month
        var activeFrom = conn.startD > win.from ? conn.startD : win.from;
        var activeTo   = connEnd < win.to ? connEnd : win.to;
        if (activeFrom > activeTo) return;

        var days  = countWeekdays(activeFrom, activeTo);
        var hours = Math.round(days * hpd * 10) / 10;
        bucket.total += hours;
        bucket.activeCount++;

        // Hours Added — started in this month
        if (conn.startD >= win.from && conn.startD <= win.to) {
          var firstStart = clientFirstStart[conn.cliId];
          var isFirstConn = firstStart && Math.abs(firstStart.getTime() - conn.startD.getTime()) < 86400000;
          if (isFirstConn) { bucket.added_newClient += hours; }
          else             { bucket.added_addlVA    += hours; }
        }

        // Hours Lost — terminated in this month
        if (conn.termD && conn.termD >= win.from && conn.termD <= win.to) {
          // Check if client still has other active connections after termination
          var otherActiveConns = conns.filter(function(other) {
            return other.connId !== conn.connId && other.cliId === conn.cliId &&
                   other.status === 'Started' && (!other.termD || other.termD > conn.termD);
          });
          var lostHours = Math.round(countWeekdays(activeFrom, conn.termD) * hpd * 10) / 10;
          if (otherActiveConns.length > 0) { bucket.lost_reduction += lostHours; }
          else                              { bucket.lost_churn     += lostHours; }
        }
      });

      return {
        label: label,
        regular: {
          total:         Math.round(regular.total * 10)/10,
          added_new:     Math.round(regular.added_newClient * 10)/10,
          added_addl:    Math.round(regular.added_addlVA * 10)/10,
          lost_churn:    Math.round(regular.lost_churn * 10)/10,
          lost_reduction:Math.round(regular.lost_reduction * 10)/10,
          activeCount:   regular.activeCount
        },
        project: {
          total:         Math.round(project.total * 10)/10,
          added_new:     Math.round(project.added_newClient * 10)/10,
          added_addl:    Math.round(project.added_addlVA * 10)/10,
          lost_churn:    Math.round(project.lost_churn * 10)/10,
          lost_reduction:Math.round(project.lost_reduction * 10)/10,
          activeCount:   project.activeCount
        }
      };
    });


    // ── Build connection detail list for drill-down
    var cliNameMap = {};
    try {
      var clS=ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if(clS){
        var clD=clS.getDataRange().getValues(),clH={};
        clD[0].forEach(function(c,i){if(c)clH[String(c)]=i;});
        for(var ix=1;ix<clD.length;ix++){
          var clId2=String(clD[ix][clH['ClientID']]||'');
          if(clId2) cliNameMap[clId2]=(String(clD[ix][clH['CompanyName']]||'')+(clD[ix][clH['AccountName']]?' — '+clD[ix][clH['AccountName']]:'')).trim();
        }
      }
    } catch(e2){}
    var reqInfoMap = {};
    try {
      if(reqSheet){
        for(var vx=1;vx<rd.length;vx++){
          var rid3=String(rd[vx][rh['RequestID']]||'');
          if(rid3) reqInfoMap[rid3]={dept:String(rd[vx][rh['Department']]||''),service:String(rd[vx][rh['Service']]||'')};
        }
      }
    } catch(e3){}
    var connNameLookup = {};
    try {
      for(var cn=1;cn<cd.length;cn++){
        var cnId=String(cd[cn][coh['ConnectionID']]||'');
        if(cnId) connNameLookup[cnId]=String(cd[cn][coh['VAName']]||'');
      }
    } catch(e4){}
    var connectionDetails = conns.map(function(conn){
      var ri=reqInfoMap[conn.reqId]||{};
      return {connId:conn.connId,vaName:connNameLookup[conn.connId]||conn.connId,
        clientName:cliNameMap[conn.cliId]||conn.cliId,
        department:ri.dept||'',service:ri.service||'',
        connType:conn.isProjBased?'Non-Regular':'Regular',
        hpw:conn.hpw,
        startDate:conn.startD?conn.startD.toISOString().substring(0,10):'',
        termDate:conn.termD?conn.termD.toISOString().substring(0,10):'',
        status:conn.status
      };
    });

    return { success:true, months: monthlyResults, connections: connectionDetails };
  } catch(e) {
    return { success:false, error:'getHoursReport: '+e.message };
  }
}

// ── Enriched list functions for Customers and Accounts modules
function getEnrichedCustomers(filters, preloaded) {
  try {
    var res = getCustomers(filters||{});
    if (!res||!res.success) return res;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Open SR per customer
    var openSR = {};
    var reqSh = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (reqSh) {
      var rd=reqSh.getDataRange().getValues(),rh={};
      rd[0].forEach(function(col,i){if(col)rh[String(col)]=i;});
      var openSts=[CONFIG.VA_REQUEST_STATUS.OPEN,CONFIG.VA_REQUEST_STATUS.IN_PROGRESS];
      for(var ri=1;ri<rd.length;ri++){
        var cid=String(rd[ri][rh['CustomerID']]||''); if(!cid)continue;
        if(openSts.indexOf(String(rd[ri][rh['Status']]||''))<0)continue;
        openSR[cid]=(openSR[cid]||0)+1;
      }
    }

    // Active VA connections per customer — derived via ClientID -> the
    // Clients sheet's own CustomerID, not the connection's own CustomerID
    // field. That field can go stale relative to the Clients sheet (e.g.
    // an account reassigned to a different customer without every
    // existing connection's denormalized copy being updated), which
    // caused this count to disagree with the Accounts table's own count
    // for the same account — that one is keyed by ClientID directly.
    // Also builds "Active accounts per customer" in the same pass, since
    // both need the same Clients sheet read.
    //
    // If the caller already read Clients/VAConnections for its own
    // purposes this same execution (getDashboardData does, for its
    // Upcoming Meetings name lookups), it can pass that data in via
    // `preloaded` to skip these two reads entirely — otherwise falls
    // back to reading them itself, exactly as before.
    var activeVA = {};
    var activeAccounts = {};
    var custIdByClientId = {};
    var cliDForActiveVA, clihForActiveVA;
    if (preloaded && preloaded.cliData) {
      cliDForActiveVA = preloaded.cliData; clihForActiveVA = preloaded.cliH;
    } else {
      var cliShForActiveVA = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
      if (cliShForActiveVA) {
        cliDForActiveVA = cliShForActiveVA.getDataRange().getValues(); clihForActiveVA = {};
        cliDForActiveVA[0].forEach(function(col,i){ if(col) clihForActiveVA[String(col).trim()]=i; });
      }
    }
    if (cliDForActiveVA) {
      for (var cvi2 = 1; cvi2 < cliDForActiveVA.length; cvi2++) {
        var cvClientId2 = String(cliDForActiveVA[cvi2][clihForActiveVA['ClientID']]||''); if (!cvClientId2) continue;
        var cvCustId2 = String(cliDForActiveVA[cvi2][clihForActiveVA['CustomerID']]||'');
        custIdByClientId[cvClientId2] = cvCustId2;
        if (cvCustId2 && String(cliDForActiveVA[cvi2][clihForActiveVA['Status']]||'').trim() === 'Active') {
          activeAccounts[cvCustId2] = (activeAccounts[cvCustId2]||0) + 1;
        }
      }
    }
    var cd, coh;
    if (preloaded && preloaded.connData) {
      cd = preloaded.connData; coh = preloaded.connH;
    } else {
      var connSh = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
      if (connSh) {
        cd = connSh.getDataRange().getValues(); coh = {};
        cd[0].forEach(function(col,i){if(col)coh[String(col).trim()]=i;});
      }
    }
    if (cd) {
      for(var ci=1;ci<cd.length;ci++){
        if(String(cd[ci][coh['ConnectionStatus']]||'').trim()==='Started'){
          var ccClientId=String(cd[ci][coh['ClientID']]||'').trim(); if(!ccClientId)continue;
          var ccid=custIdByClientId[ccClientId] || String(cd[ci][coh['CustomerID']]||'').trim(); if(!ccid)continue;
          activeVA[ccid]=(activeVA[ccid]||0)+1;
        }
      }
    }

    res.data.forEach(function(r){
      r.openRequests  = openSR[r.customerId]  || 0;
      r.activeVACount = activeVA[r.customerId] || 0;
      r.activeAccountCount = activeAccounts[r.customerId] || 0;
    });

    // Service Manager only ever sees customers with history in their own
    // department, per the request — "history" means at least one
    // Service Request for that department, any status, past or present.
    try {
      var scopingUser = getCurrentUser();
      if (scopingUser && !scopingUser.error && scopingUser.role === 'Service Manager') {
        var smSheet = ss.getSheetByName(CONFIG.SHEETS.SERVICE_MANAGERS);
        var myDept = '';
        if (smSheet) {
          var smData = smSheet.getDataRange().getValues();
          var smH = {}; smData[0].forEach(function(c,i){ if(c) smH[String(c)]=i; });
          var myEmailForDeptScope = String(scopingUser.email||'').toLowerCase().trim();
          for (var smi = 1; smi < smData.length; smi++) {
            if (String(smData[smi][smH['UserEmail']]||'').toLowerCase().trim() !== myEmailForDeptScope) continue;
            myDept = String(smData[smi][smH['Department']]||'');
            break;
          }
        }
        if (myDept) {
          var custIdsWithDeptHistory = {};
          var reqShForDept = preloaded && preloaded.reqData ? null : ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
          var reqDataForDept = preloaded && preloaded.reqData ? preloaded.reqData : (reqShForDept ? reqShForDept.getDataRange().getValues() : null);
          if (reqDataForDept) {
            var reqHForDept = {}; reqDataForDept[0].forEach(function(c,i){ if(c) reqHForDept[String(c)]=i; });
            for (var rdi = 1; rdi < reqDataForDept.length; rdi++) {
              if (String(reqDataForDept[rdi][reqHForDept['Department']]||'') !== myDept) continue;
              var rdCustId = String(reqDataForDept[rdi][reqHForDept['CustomerID']]||''); if (!rdCustId) continue;
              custIdsWithDeptHistory[rdCustId] = true;
            }
          }
          res.data = res.data.filter(function(r){ return custIdsWithDeptHistory[r.customerId]; });
        } else {
          // No department on file for this Service Manager — a data
          // gap, not a deliberate grant of full visibility, so this
          // shows nothing rather than everything until it's set.
          res.data = [];
        }
      }
    } catch (scopeEx) { Logger.log('getEnrichedCustomers Service Manager scoping: ' + scopeEx.message); }

    return res;
  } catch(e){ return { success:false, error:'getEnrichedCustomers: '+e.message }; }
}

function getEnrichedClients(filters) {
  try {
    var res = getClients(filters||{});
    if (filters && filters.customerIds) {
      var idSet2 = {};
      filters.customerIds.split(',').forEach(function(id){ if(id.trim()) idSet2[id.trim()]=true; });
      res.data = res.data.filter(function(r){ return idSet2[r.customerId]; });
    }
    if (!res||!res.success) return res;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // AssignedSpecialist from the Customers sheet (keyed by customerId)
    var specByCustomer = {};
    var custSh2 = ss.getSheetByName(CONFIG.SHEETS.CUSTOMERS);
    if (custSh2) {
      var kd=custSh2.getDataRange().getValues(),kh={};
      kd[0].forEach(function(col,i){if(col)kh[String(col).trim()]=i;});
      for (var ki=1;ki<kd.length;ki++){
        var kid=String(kd[ki][kh['CustomerID']]||''); if(!kid)continue;
        specByCustomer[kid]=String(kd[ki][kh['AssignedSpecialist']]||'');
      }
    }

    // Open SR per client
    var openSR = {};
    var hasNewTicket = {};
    var reqSh = ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
    if (reqSh) {
      var rd=reqSh.getDataRange().getValues(),rh={};
      rd[0].forEach(function(col,i){if(col)rh[String(col)]=i;});
      var openSts=[CONFIG.VA_REQUEST_STATUS.OPEN,CONFIG.VA_REQUEST_STATUS.IN_PROGRESS];
      for(var ri=1;ri<rd.length;ri++){
        var clid=String(rd[ri][rh['ClientID']]||''); if(!clid)continue;
        if (String(rd[ri][rh['RequestType']]||'') === 'New') hasNewTicket[clid] = true;
        if(openSts.indexOf(String(rd[ri][rh['Status']]||''))<0)continue;
        openSR[clid]=(openSR[clid]||0)+1;
      }
    }

    // Active VA connections per client
    var activeVA={}, connTypes={};
    var connSh = ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if(connSh){
      var cd=connSh.getDataRange().getValues(),coh={};
      cd[0].forEach(function(col,i){if(col)coh[String(col).trim()]=i;});
      for(var ci=1;ci<cd.length;ci++){
        if(String(cd[ci][coh['ConnectionStatus']]||'').trim()==='Started'){
          var clid2=String(cd[ci][coh['ClientID']]||''); if(!clid2)continue;
          activeVA[clid2]=(activeVA[clid2]||0)+1;
          var ct=String(cd[ci][coh['ConnectionType']]||'Regular');
          // Per the request — ConnectionType's "Project-based" value
          // renamed to "Non-Regular" system-wide. Normalized key so
          // any remaining old-format data ('Project Based'/'Project-based')
          // still correctly groups under the new label.
          var ctKey = ct.toLowerCase().replace(/[\s-]/g, '') === 'nonregular' ? 'Non-Regular' : ct;
          if(!connTypes[clid2])connTypes[clid2]={};
          connTypes[clid2][ctKey]=true;
        }
      }
    }

    res.data.forEach(function(r){
      r.assignedSpecialist = specByCustomer[r.customerId] || '';
      r.openRequests  = openSR[r.clientId]    || 0;
      r.activeVACount = activeVA[r.clientId]  || 0;
      r.hasNewTicket  = !!hasNewTicket[r.clientId];
      var t=connTypes[r.clientId]||{};
      r.vaType = (t['Regular']&&t['Non-Regular']) ? 'Mixed'
               : t['Non-Regular'] ? 'Non-Regular'
               : t['Regular']       ? 'Regular' : '';
    });

    // Service Manager only ever sees accounts with history in their own
    // department, per the request — same reasoning and lookup pattern as
    // getEnrichedCustomers above, keyed by ClientID instead.
    try {
      var scopingUser2 = getCurrentUser();
      if (scopingUser2 && !scopingUser2.error && scopingUser2.role === 'Service Manager') {
        var smSheet2 = ss.getSheetByName(CONFIG.SHEETS.SERVICE_MANAGERS);
        var myDept2 = '';
        if (smSheet2) {
          var smData2 = smSheet2.getDataRange().getValues();
          var smH2 = {}; smData2[0].forEach(function(c,i){ if(c) smH2[String(c)]=i; });
          var myEmailForDeptScope2 = String(scopingUser2.email||'').toLowerCase().trim();
          for (var smi2 = 1; smi2 < smData2.length; smi2++) {
            if (String(smData2[smi2][smH2['UserEmail']]||'').toLowerCase().trim() !== myEmailForDeptScope2) continue;
            myDept2 = String(smData2[smi2][smH2['Department']]||'');
            break;
          }
        }
        if (myDept2) {
          var clientIdsWithDeptHistory = {};
          if (reqSh) {
            var rdForDept2 = reqSh.getDataRange().getValues();
            var rhForDept2 = {}; rdForDept2[0].forEach(function(c,i){ if(c) rhForDept2[String(c)]=i; });
            for (var rdi2 = 1; rdi2 < rdForDept2.length; rdi2++) {
              if (String(rdForDept2[rdi2][rhForDept2['Department']]||'') !== myDept2) continue;
              var rdClientId2 = String(rdForDept2[rdi2][rhForDept2['ClientID']]||''); if (!rdClientId2) continue;
              clientIdsWithDeptHistory[rdClientId2] = true;
            }
          }
          res.data = res.data.filter(function(r){ return clientIdsWithDeptHistory[r.clientId]; });
        } else {
          // No department on file — a data gap, not a deliberate grant
          // of full visibility, so this shows nothing rather than
          // everything until it's set.
          res.data = [];
        }
      }
    } catch (scopeEx2) { Logger.log('getEnrichedClients Service Manager scoping: ' + scopeEx2.message); }

    return res;
  } catch(e){ return { success:false, error:'getEnrichedClients: '+e.message }; }
}

// ── Contracts
function getContractList()                           { try { return getContracts(); }                       catch(e){return{success:false,error:e.message};} }
function createContractRecord(payload)               { try { return createContract(payload); }               catch(e){return{success:false,error:e.message};} }
function updateContractRecord(id, payload)           { try { return updateContract(id, payload); }           catch(e){return{success:false,error:e.message};} }
function getContractAssignmentList()                 { try { return getContractAssignments(); }              catch(e){return{success:false,error:e.message};} }
function getAccountsWithContractsList()              { try { return getAccountsWithContracts(); }            catch(e){return{success:false,error:e.message};} }
function assignContractToEntity(cid,etype,eid,notes) { try { return assignContract(cid,etype,eid,notes); }   catch(e){return{success:false,error:e.message};} }
function getContractSectionDefList()                 { try { return getContractSectionDefs(); }              catch(e){return{success:false,error:e.message};} }
function createContractSectionDefRecord(payload)     { try { return createContractSectionDef(payload); }     catch(e){return{success:false,error:e.message};} }
function deleteContractSectionDefRecord(id)          { try { return deleteContractSectionDef(id); }          catch(e){return{success:false,error:e.message};} }

// ── Follow-ups
function getFollowUpList(filters)                    { try { return getFollowUps(filters||{}); }           catch(e){return{success:false,error:e.message};} }
function createFollowUpRecord(payload)               { try { return createFollowUp(payload); }             catch(e){return{success:false,error:e.message};} }
function updateFollowUpRecord(id, payload)           { try { return updateFollowUp(id, payload); }         catch(e){return{success:false,error:e.message};} }
function getUpcomingFollowUpList(assignedTo)         { try { return getUpcomingFollowUps(assignedTo||'');} catch(e){return{success:false,error:e.message};} }

function addInqUpdateV2(id, payload)        { try { return addInquiryUpdateV2(id, payload); }     catch(e){ return {success:false,error:e.message}; } }

function saveNavPermissions(role, pagesJson) { try { return saveSettingValue('_navPermissions_'+role, pagesJson); } catch(e){ return {success:false,error:e.message}; } }
function updateInqEntry(updateId, payload)    { try { return updateInquiryUpdate(updateId, payload); } catch(e){ return {success:false,error:e.message}; } }

// ── Meetings module wrappers ───────────────────────────────────
function getMeetingTypeList()                  { try { return getMeetingTypes(); }                              catch(e){ return {success:false,error:e.message}; } }
function saveMeetingTypeEntry(payload)         { try { return saveMeetingType(payload); }                       catch(e){ return {success:false,error:e.message}; } }
function deleteMeetingTypeEntry(typeId)        { try { return deleteMeetingType(typeId); }                      catch(e){ return {success:false,error:e.message}; } }
function getMeetingList(filters)               { try { return getMeetings(filters||{}); }                      catch(e){ return {success:false,error:e.message}; } }
function getMeetingDetail(meetingId)           { try { return getMeetingById(meetingId); }                      catch(e){ return {success:false,error:e.message}; } }
function rescheduleMeetingEntry(id, newDate, reason) { try { return rescheduleMeeting(id, newDate, reason); }   catch(e){ return {success:false,error:e.message}; } }
function updateMeetingEntry(id, payload)       { try { return updateMeeting(id, payload); }                     catch(e){ return {success:false,error:e.message}; } }
function runMeetingsBackfill()                 { try { return backfillMeetingsForActiveConnections(); } catch(e){ return {success:false,error:e.message}; } }
function getMeetingConcernList(meetingId)      { try { return getMeetingConcerns(meetingId); }                   catch(e){ return {success:false,error:e.message}; } }
// logMeetingFeedbackEntry replaces raiseMeetingConcernEntry as the primary
// entry point — now takes a feedbackType ('Concern' or 'Good Feedback') so
// one function covers both checkbox options in the redesigned meeting modal.
function logMeetingFeedbackEntry(meetingId, connectionId, vaName, feedbackType, details) { try { return logMeetingFeedback(meetingId, connectionId, vaName, feedbackType, details); } catch(e){ return {success:false,error:e.message}; } }
function resolveMeetingConcernEntry(concernId, resolution) { try { return resolveMeetingConcern(concernId, resolution); } catch(e){ return {success:false,error:e.message}; } }
function deleteMeetingConcernEntry(concernId)  { try { return deleteMeetingConcern(concernId); }                 catch(e){ return {success:false,error:e.message}; } }
// combineMeetings / uncombineMeeting retired along with the account-level
// meeting redesign — there's only ever one meeting per account per type now,
// so there's nothing left to combine.

// ── Combined Playbook data load (accounts + VAs + connections in one call) ─
// Replaces 3 sequential google.script.run calls with a single round-trip,
// reducing the typical Playbook load time from ~9 seconds to ~3 seconds.
function getPlaybookData() {
  try {
    var accounts    = getPlaybookAccounts();
    var vas         = getPlaybookVAs();
    var connections = getPlaybookConnections();
    return {
      success:     true,
      accounts:    (accounts    && accounts.data)    || [],
      meetingTypeDefs: (accounts && accounts.meetingTypeDefs) || [],
      vas:         (vas         && vas.data)         || [],
      connections: (connections && connections.data)  || []
    };
  } catch(e) {
    return { success: false, error: 'getPlaybookData: ' + e.message };
  }
}

function getServiceManagers() {
  try {
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sheet=ss.getSheetByName('ServiceManagers');
    if (!sheet) return {success:true,data:[]};
    var data=sheet.getDataRange().getValues();
    if (data.length<2) return {success:true,data:[]};
    var h={}; data[0].forEach(function(c,i){if(c)h[String(c).trim()]=i;});
    var rows=[];
    for (var i=1;i<data.length;i++){
      if (String(data[i][h['IsActive']]||'').toLowerCase()==='false') continue;
      rows.push({
        smId:String(data[i][h['SMID']]||''),
        userEmail:String(data[i][h['UserEmail']]||''),
        userName:String(data[i][h['UserName']]||''),
        department:String(data[i][h['Department']]||'')
      });
    }
    return {success:true,data:rows};
  } catch(e){return {success:false,error:e.message};}
}

function logSMWorkflowStep(requestId,step) {
  try {
    var perm=checkPermission('edit');
    if (!perm.allowed) return {success:false,error:'Permission denied.'};
    var allowed=['MockCallDone','PrepStarted','PrepDone'];
    if (allowed.indexOf(step)<0) return {success:false,error:'Invalid step.'};
    var now=new Date();
    var fields={};
    fields[step+'At']=now; fields[step+'By']=perm.user.email;
    return updateVARequestFields_(requestId,fields,perm);
  } catch(e){return {success:false,error:e.message};}
}

function logVACancellation(requestId,note) {
  try {
    var perm=checkPermission('edit');
    if (!perm.allowed) return {success:false,error:'Permission denied.'};
    var res=updateVARequestFields_(requestId,{
      VACancelledAt:new Date(),VACancelledBy:perm.user.email,VACancelledNote:note||''
    },perm);
    if (!res.success) return res;
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var connSh=ss.getSheetByName(CONFIG.SHEETS.VA_CONNECTIONS);
    if (connSh){
      var cd=connSh.getDataRange().getValues();
      var ch={}; cd[0].forEach(function(c,i){if(c)ch[String(c).trim()]=i;});
      for (var i=1;i<cd.length;i++){
        if (String(cd[i][ch['RequestID']]||'')!==requestId) continue;
        var cst=String(cd[i][ch['ConnectionStatus']]||'');
        if (cst!=='Pending'&&cst!=='Accepted') continue;
        connSh.getRange(i+1,ch['ConnectionStatus']+1).setValue('Cancelled');
      }
    }
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

function updateSRPaymentStatus(requestId,paymentStatus) {
  try {
    var perm=checkPermission('edit');
    if (!perm.allowed) return {success:false,error:'Permission denied.'};
    var valid=['No Payment','Add to Next Bill','Paid'];
    if (valid.indexOf(paymentStatus)<0) return {success:false,error:'Invalid payment status.'};
    return updateVARequestFields_(requestId,{PaymentStatus:paymentStatus},perm);
  } catch(e){return {success:false,error:e.message};}
}

function updateVARequestFields_(requestId,fields,perm) {
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sheet=ss.getSheetByName(CONFIG.SHEETS.VA_REQUESTS);
  if (!sheet) return {success:false,error:'VARequests sheet not found.'};
  var data=sheet.getDataRange().getValues();
  var h={}; data[0].forEach(function(c,i){if(c)h[String(c).trim()]=i;});
  for (var i=1;i<data.length;i++){
    if (String(data[i][h['RequestID']]||'')!==requestId) continue;
    Object.keys(fields).forEach(function(col){
      if (h[col]!==undefined) sheet.getRange(i+1,h[col]+1).setValue(fields[col]);
    });
    if (h['UpdatedAt']!==undefined) sheet.getRange(i+1,h['UpdatedAt']+1).setValue(new Date());
    if (h['UpdatedBy']!==undefined) sheet.getRange(i+1,h['UpdatedBy']+1).setValue(perm.user.email);
    return {success:true};
  }
  return {success:false,error:'Request not found: '+requestId};
}