// ─────────────────────────────────────────
// Config.gs
// ─────────────────────────────────────────

const CONFIG = {
  APP_NAME: 'Customer Management System',
  VERSION:  '1.0.0',
  SPREADSHEET_ID: '',
  // Per the request — a separate Google Sheet, distinct from this app's
  // main bound spreadsheet, intended for upcoming accounting-related
  // features. Use getAccountingSpreadsheet() (in Code.gs) to open it,
  // rather than SpreadsheetApp.getActiveSpreadsheet() — every existing
  // sheet reference in this codebase uses the latter, which always
  // resolves to the main spreadsheet, not this one.
  ACCOUNTING_SPREADSHEET_ID: '1sRCWLc7WG8UI7mcH4SMBBroxY4XRgKTA_z3izUj05pI',
  CACHE_EXPIRY:   300,

  SHEETS: {
    CUSTOMERS:          'Customers',
    CLIENTS:            'Accounts',
    CONTACTS:           'Contacts',
    ACTIVITY_LOGS:      'ActivityLogs',
    // Service Request activity gets its own sheet, separate from the
    // generic ActivityLogs used by every other entity type — see
    // _writeLog's routing logic and getLogs's merge logic in
    // LogService.gs for how the two stay transparently combined for
    // every existing caller.
    REQUEST_ACTIVITY_LOGS: 'RequestActivityLogs',
    SETTINGS:           'Settings',
    WR_TEMPLATE_SETTINGS: 'WRTemplateSettings',
    ATTENDANCE_RECORDS: 'AttendanceRecords',
    IMPORT_BATCHES:     'ImportBatches',
    REQUEST_WORKFLOW_HISTORY: 'RequestWorkflowHistory',
    REQUEST_STAGE_ACKNOWLEDGEMENTS: 'RequestStageAcknowledgements',
    USERS:              'Users',
    ROLES:              'Roles',
    VIRTUAL_ASSISTANTS: 'VirtualAssistants',
    VA_REQUESTS:        'VARequests',
    SERVICE_MANAGERS: 'ServiceManagers',
    VA_CONNECTIONS:     'VAConnections',
    VA_CONNECTION_COMP_HISTORY: 'VAConnectionCompHistory',
    VA_BONDS:           'VABonds',
    MODULE_PERMISSIONS: 'ModulePermissions',
    FIELD_PERMISSIONS:  'FieldPermissions',
    ACCT_ENROLLMENT:    'ClientDeptEnrollment',
    ACCT_DEPOSITS:      'Deposits',
    ACCT_BILLING_CYCLES:'BillingCycles',
    ACCT_PAYMENTS:      'Payments',
    ACCT_RECONCILIATION:'HoursReconciliation',
    ACCT_BOND_LEDGER:   'TrainingBondLedger',
    ACCT_CONN_BILLING_DETAIL: 'ConnectionBillingDetail',
    CONNECTION_KPI:      'ConnectionKPI',
    CUSTOMER_TAKEOVERS:  'CustomerTakeovers',
    PAGE_LOAD_LOGS:      'PageLoadLogs',
    VA_CONNECTION_NOTES:'VAConnectionNotes',
    VA_CONNECTION_PAUSE_LOG: 'VAConnectionPauseLog',
    INQUIRIES:           'Inquiries',
    INQUIRY_UPDATES:     'InquiryUpdates',
    CUSTOMER_ACCOUNT_NOTES: 'CustomerAccountNotes',
    CONTRACTS:           'Contracts',
    CONTRACT_SECTION_DEFS:'ContractSectionDefs',
    CONTRACT_SECTIONS:    'ContractSections',
    CONTRACT_ASSIGNMENTS:'ContractAssignments',
    FOLLOW_UPS:          'FollowUps',
    MEETING_TYPES:       'MeetingTypes',
    MEETINGS:            'Meetings',
    MEETING_CONCERNS:    'MeetingConcerns',
    EMAIL_TEMPLATES:          'EmailTemplates',
    CELEBRATION_LOGS:         'CelebrationLogs'
  },

   ROLES: {
    ADMINISTRATOR:   'Administrator',
    CS_MANAGER:      'CS Manager',
    CS_SPECIALIST:   'CS Specialist',
    MANAGER:         'Manager',
    HR_SPECIALIST:   'HR Specialist',
    HR_MANAGER:      'HR Manager',
    SERVICE_MANAGER: 'Service Manager',
    ACCOUNTING:      'Accounting',
    RECRUITMENT:     'Recruitment Specialist',
    TRAINING:        'Training Manager',
    EXECUTIVE:       'Executive',
    EXECUTIVE_SUPPORT: 'Executive Support'
  },

  STATUS: {
    ACTIVE:     'Active',
    INACTIVE:   'Inactive',
    TERMINATED: 'Terminated',
    PENDING:    'Pending',
    CANCELLED:  'Cancelled',
    PAUSED:     'Paused',
    RETURNING:  'Returning'
  },

  // The full list of modules shown as rows in the Permissions page's
  // matrix. Kept as a flat array (not derived from anything else) since
  // this is the actual list an admin configures against — adding a new
  // module here makes it appear in the matrix with all-false defaults
  // until explicitly granted.
  PERMISSION_MODULES: [
    'Customers', 'Accounts (Clients)', 'VA Database', 'VA Connections',
    'Service Requests', 'Concerns & Inquiries', 'Account Meetings',
    'VA Rates & Compensation', 'Playbook', 'Reports', 'Settings', 'Billing & Payments',
    'CS Specialists', 'Users', 'Follow-Ups'
  ],

  // Fields within a module that support a granular per-role visibility
  // override beyond that module's own CRUD grant — e.g. a role might have
  // full Update on "VA Connections" generally, but Rate specifically
  // needs to stay invisible to them regardless. Only fields listed here
  // are configurable on the Permissions page's field-level tab.
  PERMISSION_FIELDS: {
    'VA Connections': ['Rate', 'Night Differential', 'Training Bond'],
    'VA Database': ['Base Rate'],
    'VA Rates & Compensation': ['Rate History', 'Bond Status', 'Bond Amount']
  },

  INQUIRY_STATUS: {
    OPEN:        'Open',
    IN_PROGRESS: 'In Progress',
    // Per the restructuring — a Concern ticket sits here once escalated
    // to a Termination ticket, until that termination's own outcome
    // determines which Closed status this transitions to.
    ESCALATED:   'Escalated',
    CLOSED_WON:  'Closed - Resolved',
    CLOSED_LOST: 'Closed - Unresolved'
  },

  // For Termination-type inquiries specifically. Cause is two-way — the
  // VA's side (Resigned/Removed/AWOL) or the Client's side (Client
  // Initiated). Outcome drives the automatic status: Cancelled and
  // Changed to Replacement both resolve it (the connection continues in
  // some form), Pushed Through means it actually ended (unresolved, since
  // the account lost the VA).
  TERMINATION_CAUSE: {
    VA_RESIGNED:      'VA Resigned',
    VA_REMOVED:       'VA Removed',
    VA_AWOL:          'VA AWOL',
    CLIENT_INITIATED: 'Client Initiated'
  },
  TERMINATION_OUTCOME: {
    CANCELLED:              'Retracted',
    PUSHED_THROUGH:         'Accepted'
  },
  // New, per the restructuring — separate from TERMINATION_OUTCOME
  // above (which drives the workflow: still open, retracted, or
  // accepted). This classifies *why* a termination happened, computed
  // automatically rather than chosen directly:
  //   End of Project  — the connection itself is Project Based
  //   End of Contract — a standalone termination, not raised from a
  //                     Concern ticket (a direct client-initiated close)
  //   Remove          — raised from a Concern, no replacement ticket
  //   Replace         — raised from a Concern, a linked replacement
  //                     ticket exists and was itself accepted; reverts
  //                     to Remove if that replacement isn't/wasn't
  TERMINATION_STATUS_TYPE: {
    END_OF_PROJECT:  'End of Project',
    END_OF_CONTRACT: 'End of Contract',
    REMOVE:          'Remove',
    REPLACE:         'Replace'
  },

  INQUIRY_PRIORITY: {
    LOW:    'Low',
    MEDIUM: 'Medium',
    HIGH:   'High',
    URGENT: 'Urgent'
  },

  VA_REQUEST_STATUS: {
    OPEN:        'Open',
    IN_PROGRESS: 'In Progress',
    CLOSED_WON:  'Closed - Won',
    CLOSED_LOST: 'Closed - Lost'
  },

  VA_CONNECTION_TYPE: {
    REGULAR:       'Regular',
    PROJECT_BASED: 'Project Based'
  },

  VA_CONNECTION_STATUS: {
    PENDING:    'Pending',
    ACCEPTED:   'Accepted',
    DECLINED:   'Declined',
    STARTED:    'Started',
    CANCELLED:  'Cancelled',
    // A Started connection that ends — distinct from Cancelled, which is for
    // a connection that never actually got underway (still Pending/Accepted
    // when it ended).
    TERMINATED: 'Terminated'
  },

  EMAIL_TEMPLATE_CATEGORY: {
    BIRTHDAY_NOTIFY:      'Birthday - Notify',
    BIRTHDAY_FOLLOWUP:    'Birthday - Follow-up',
    ANNIVERSARY_NOTIFY:   'Anniversary - Notify',
    ANNIVERSARY_FOLLOWUP: 'Anniversary - Follow-up',
    MEETING_SCHEDULE:     'Meeting - Schedule Request'
  },

  // The broader "which part of the system does this template apply to"
  // grouping — Category above is specifically the celebration sub-type
  // (Birthday/Anniversary Notify vs Follow-up), which only makes sense
  // within the Celebrations module. Kept as a plain array (not frozen to
  // an enum-like object) since Settings should be able to grow this list
  // over time without a code change — see getEmailTemplateModules().
  EMAIL_TEMPLATE_MODULES: ['Celebrations', 'Customer Onboarding', 'Account Meetings'],

  MEETING_FEEDBACK_TYPE: {
    CONCERN: 'Concern',
    GOOD:    'Good Feedback',
    NEUTRAL: 'Neutral'
  },

  SCHEMA: {
    Customers: [
      'CustomerID', 'CustomerName', 'AssignedSpecialist', 'CreatedAt', 'CreatedBy',
      'UpdatedAt', 'UpdatedBy', 'Notes', 'Status', 'StatusDate',
      'TerminationCount', 'ReactivationCount',
      'LastTerminatedDate', 'LastReactivatedDate', 'LastStatusReason',
      'StatusHistory', 'PaymentDate', 'NoPaymentYet',
      // Accounting module (see PermissionsService.gs's sibling files) —
      // drives which billing formula branch applies: Prepaid bills the
      // upcoming month's projected hours, Postpaid bills the
      // just-completed month's actual hours. Defaults to Prepaid when
      // blank (see _acctDefaultBillingType), kept at the true end per
      // the same ordering convention as everything else added to this
      // schema after the sheet already existed live.
      'BillingType',
      // Status change pending manager review — set when anyone other
      // than CS Manager terminates or pauses (the status change applies
      // immediately; this just flags it for review). CS Manager can
      // Confirm (clear these fields, status stays as changed) or Cancel
      // (revert Status to StatusBeforePendingReview, clear these fields).
      // Mirrors the same pattern already used for VA Connection
      // termination requests, extended to cover Pause too.
      'TerminationRequestedBy', 'TerminationRequestedAt',
      'TerminationRequestedDate', 'TerminationRequestReason',
      'PendingReviewAction', 'StatusBeforePendingReview'
    ],
    ServiceManagers: [
      'SMID', 'UserEmail', 'UserName', 'Department', 'IsActive',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    Clients: [
      'ClientID', 'CustomerID', 'CompanyName', 'AccountName',
      'PrimaryContact', 'PrimaryRole', 'PrimaryEmail', 'PrimaryIsFocal',
      'PrimaryLinkedToCustomer',
      'SecondaryContact', 'SecondaryRole', 'SecondaryEmail', 'SecondaryIsFocal',
      'AccountManagers',
      // Comma-separated, positionally matched to AccountManagers above —
      // same simple pattern, just tracking each manager's email alongside
      // their name (previously names-only, with no way to reach them).
      'AccountManagerEmails',
      'Category', 'Type', 'CountryRegion',
      'InvoiceContactName', 'InvoiceContactRole', 'InvoiceContactEmail',
      'Status', 'StatusDate', 'TerminationReason', 'IsReturning', 'Notes',
      'SellerOnboardingLink', 'ContractID',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy',
      // Cached copy of the parent Customer's name — set at creation time
      // and cascaded on every rename (see _cascadeCustomerNameToClients in
      // CustomerService.gs), so reads that just need "this account's
      // customer name" don't have to join against the Customers sheet at
      // all. AssignedSpecialist is NOT cached here the same way — that one
      // genuinely needs to always reflect the customer's CURRENT
      // specialist, and re-reading it live is cheap; a name rename is far
      // rarer than an assignment change, which is what makes caching it
      // worthwhile here specifically.
      'CustomerName',
      // Status change pending manager review — mirrors the same fields
      // on Customers, extended to cover Pause too. Set when anyone other
      // than CS Manager terminates or pauses (the status change applies
      // immediately; this just flags it for review). CS Manager can
      // Confirm (clear these fields, status stays as changed) or Cancel
      // (revert Status to StatusBeforePendingReview, clear these fields).
      'TerminationRequestedBy', 'TerminationRequestedAt',
      'TerminationRequestedDate', 'TerminationRequestReason',
      'PendingReviewAction', 'StatusBeforePendingReview'
    ],
    Contacts: [
      'ContactID', 'ClientID', 'ContactName', 'Role',
      'Email', 'Phone', 'IsPrimary', 'IsActive',
      'CreatedAt', 'UpdatedAt'
    ],
    ActivityLogs: [
      'LogID', 'EntityType', 'EntityID', 'Action',
      'FieldChanged', 'OldValue', 'NewValue',
      'ChangedBy', 'ChangedByEmail', 'Timestamp', 'Notes', 'EffectiveDate'
    ],
    // Same columns as ActivityLogs above — a dedicated sheet specifically
    // for VARequest entity activity, kept structurally identical so
    // _writeLog/getLogs (LogService.gs) can route/merge between the two
    // transparently without any other function needing to know two
    // sheets exist.
    RequestActivityLogs: [
      'LogID', 'EntityType', 'EntityID', 'Action',
      'FieldChanged', 'OldValue', 'NewValue',
      'ChangedBy', 'ChangedByEmail', 'Timestamp', 'Notes', 'EffectiveDate'
    ],
    Settings: [
      'SettingID', 'Category', 'Value', 'Label',
      'SortOrder', 'IsActive', 'CreatedAt', 'UpdatedAt', 'ParentDepartment', 'Timezone'
    ],
    // One row per department (Regular WR template link, Project-Based WR
    // template link, target Drive folder — these are genuinely different
    // documents/destinations, not just a label/value pair, hence a
    // dedicated sheet rather than folding into the generic Settings sheet
    // above). One additional row with Department = "__GLOBAL__" holds only
    // FilenamePattern, applying to every department.
    WRTemplateSettings: [
      'SettingID', 'Department', 'RegularTemplateLink', 'ProjectTemplateLink',
      'FolderLink', 'FilenamePattern', 'UpdatedAt', 'UpdatedBy'
    ],
    // One row per (VA Connection, calendar day) with an actual-hours entry
    // or reference link on file. Projected hours are never stored here —
    // they're always derived live from the connection's own schedule via
    // VAConnectionHoursLog, so a later schedule correction is
    // automatically reflected without needing to touch old attendance
    // rows. Only rows where the actual value differs from projected, or a
    // reference link was attached, need to exist at all.
    // Append-only timeline of stage transitions for a Service Request's
    // fulfillment workflow — VA Assignment → (Recruitment/Training branch
    // if no VA available) → VA Prep & Mock Interview → Rate Agreement →
    // Kick Off Call → VA-Client Connection Call → Start. One row per
    // transition; CurrentStage/PersonInChargeRole on VARequests itself
    // always reflects the LATEST row here, kept redundantly for fast reads.
    RequestWorkflowHistory: [
      'LogID', 'RequestID', 'FromStage', 'ToStage', 'FromRole', 'ToRole',
      'Notes', 'ChangedBy', 'ChangedByEmail', 'ChangedAt'
    ],
    // One row per acknowledgement/update the person-in-charge of a stage
    // gives — Stage is recorded explicitly so an update given for a
    // PREVIOUS stage never counts toward the CURRENT stage's 24-hour
    // clock once the request has moved on.
    RequestStageAcknowledgements: [
      'AckID', 'RequestID', 'Stage', 'Notes', 'AcknowledgedBy', 'AcknowledgedByEmail', 'AcknowledgedAt'
    ],
    // Restructured from daily to monthly granularity — one row per
    // (ConnectionID, YearMonth), with two embedded cutoffs rather than
    // one row per day. Billing/payment happen once a month even though
    // hours are tracked in two cutoffs, so those fields live at the
    // monthly level, not per-cutoff.
    AttendanceRecords: [
      'RecordID', 'ConnectionID', 'YearMonth',
      // Cutoff 1 — normally the 15th of the month.
      'Cutoff1Date', 'Cutoff1ProjectedHours', 'Cutoff1ActualHours',
      // Cutoff 2 — normally the last day of the month.
      'Cutoff2Date', 'Cutoff2ProjectedHours', 'Cutoff2ActualHours',
      // Additions (monthly total, not per-cutoff)
      'OvertimeHours', 'NightDifferentialHours',
      // Dollar-amount additions, not hours — a fixed monthly bump (e.g.
      // $100/month) rather than a change to the base hourly rate itself,
      // plus a catch-all for reimbursements and similar one-off amounts.
      'SalaryIncrease', 'Others',
      // Reductions (monthly total, not per-cutoff)
      'RefundHours', 'AbsenceHours',
      // Manually entered — not derived from the above, since the actual
      // billed figure may reflect adjustments beyond a simple formula.
      'TotalBilledHours',
      // 'Not Billed' / 'Billed' — whether this month has been invoiced yet.
      'BilledStatus', 'BillingDate',
      // 'Not Yet Paid' / 'Paid' / 'Late' — tracks who's unpaid and which
      // months came in late, independent of whether hours are Prepaid or
      // Postpaid (that's on the customer/billing cycle itself).
      'PaymentStatus', 'PaymentDate',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    // Phase 5 (§2.13) — audit log of every attendance file imported. Every
    // row inserted via importAttendanceCSV() carries the resulting
    // BatchID, so a bad import can be traced/deleted as a unit rather
    // than hunting for individual rows.
    ImportBatches: [
      'BatchID', 'UploadedBy', 'DateUploaded', 'FileName',
      'RowsTotal', 'RowsImported', 'RowsRejected', 'RowsDuplicate',
      'Status', // Success/Partial/Failed
      'ErrorLog' // JSON array of {row, reason}
    ],
    Users: [
      'UserID', 'Email', 'Name', 'Role',
      'IsActive', 'CreatedAt', 'LastLogin',
      // Which department this user manages/belongs to — used to scope a
      // Service Manager's dashboard and data to just their own department.
      'Department'
    ],
    Roles: [
      'RoleID', 'RoleName', 'CanDelete', 'CanEdit',
      'RequiresApproval', 'CanManageSettings', 'CanAssignVA',
      'CanViewReports', 'CreatedAt'
    ],
    VirtualAssistants: [
      'VAID', 'VAName', 'Email', 'Department',
      'Service', 'Gender', 'Status', 'Notes', 'Birthday', 'HireDate',
      // Compensation data — HR-only. See _canSeeVARate() in AuthManager.gs:
      // never sent to the client for any role except Administrator/HR
      // Specialist/HR Manager, regardless of which function reads this sheet.
      'BaseRate',
      'CreatedAt', 'UpdatedAt',
      // Link to the VA's portfolio — attached during the Kick Off Call
      // sub-process (see VAKickoffCalls schema) but stored here since
      // it's a property of the VA themselves, reusable across every
      // kickoff call/connection they're ever part of.
      'PortfolioLink'
    ],
    VARequests: [
      'RequestID', 'ClientID', 'CustomerID',
      'RequestType', 'Department', 'PrimaryAccount', 'SecondaryAccount',
      'AccountManager',
      'Service', 'Hours', 'ScheduleType', 'ScheduleDays', 'ScheduleNotes',
      'ClientTimezone', 'PHTimezone',
      'ReplacementForVAID', 'ParentRequestID', 'RequestGroup',
      'SellerOnboardingDate', 'TargetStartDate',
      'Status', 'Notes',
      'PaymentStatus',
      'ServiceManagerEmail',
      'MockCallDoneAt', 'MockCallDoneBy',
      'PrepStartedAt',  'PrepStartedBy',
      'PrepDoneAt',     'PrepDoneBy',
      // Which specific connection (of possibly several on this request)
      // VA Preparation/Mock Interview actually applied to — set by
      // markVAPrepDone in WorkflowService.gs, always the connection
      // marked IsFinalVA at the time this stage completed.
      'PrepDoneForConnectionID',
      // Work schedule confirmation by the assigned CS Specialist — a
      // second gate (alongside Final VA being designated) before the
      // request can proceed to Rate Agreement. See markVAPrepDone in
      // WorkflowService.gs and confirmWorkScheduleByCS in
      // VARequestService.gs.
      'ScheduleConfirmedByCS', 'ScheduleConfirmedByCSAt',
      'VACancelledAt',  'VACancelledBy', 'VACancelledNote',
      'PaymentDate', 'CompletedAt', 'ClosedAt',
      // Hours/Schedule Change request type only: references the existing,
      // already-active VA Connection this request is ABOUT (not a new VA —
      // see ReplacementForVAID above, which is a different concept: that's
      // for a VA being swapped out, this is for a VA staying in place but
      // needing more hours or a schedule change). RequestedHours/
      // RequestedScheduleNotes capture what's being asked for, kept separate
      // from the connection's own CURRENT Hours/ScheduleNotes so the
      // before/after is never ambiguous once the change is actioned.
      'ChangeRequestForConnectionID', 'RequestedHours', 'RequestedScheduleNotes',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy',
      // Workflow stage tracking — CurrentStage is a human-readable label
      // ('VA Assignment', 'Rate Agreement', etc.), PersonInChargeRole is
      // which role currently owns moving it forward. See
      // RequestWorkflowHistory below for the full timeline of how it got
      // there; these two columns are just "where is it right now," kept
      // directly on the request for fast reads without a join.
      'CurrentStage', 'PersonInChargeRole', 'PendingApprovalReturnStage',
      // Hours Type (Fixed/Flexible/Daily/Project Based) for the Hours field
      // above, plus — when Daily is selected — a structured day-by-day
      // breakdown (JSON array of {days:[...],hoursPerDay:N}, same format
      // VAConnectionHoursLog uses). Carried through to the VA Connection at
      // assignment time (see assignVA in VAConnectionService.gs) so hours
      // set at request stage don't need to be re-entered once a VA is
      // assigned. Kept at the END of this array — see the same note on
      // VAConnectionHoursLog's schema for why that matters on existing sheets.
      'HoursType', 'HoursBreakdown', 'RequiredPHTime',
      // Only meaningful for RequestType='New' — set up alongside Payment
      // Date when onboarding a brand-new customer relationship.
      'PaymentMethod',
      // Which specific VA Connection a Replacement request is for — distinct
      // from ReplacementForVAID (which VA), this is which CONNECTION record,
      // so the request detail view can link straight to it.
      'ReplacementForConnectionID',
      // Set by CS Specialist when configuring the schedule — whether the
      // required PH working window falls in PH nighttime hours (Night
      // Differential applicable), and whether breaks are already
      // included within the entered total hours (defaults true). Kept at
      // the very end, same reasoning as the note above on HoursType etc.
      'NightDiffApplicableAtSchedule', 'BreaksIncludedInTotal',
      // Required when moving to VA Assignment (see moveToVAAssignment in
      // WorkflowService.gs) — confirms the seller onboarding either
      // genuinely happened (Done, alongside SellerOnboardingDate above,
      // which the CS Specialist can update at that point) or was
      // explicitly waived with a reason. Kept at the true end, same
      // reasoning as everything else added here after this sheet
      // already existed on live spreadsheets.
      'SellerOnboardingStatus', 'SellerOnboardingWaivedReason',
      // The actual input now, per the PH-time rework — the client's own
      // local working-hours commitment, entered directly. RequiredPHTime
      // above is derived from this (client's timezone + a reference
      // date), rather than being the direct input as it was before.
      // Kept at the true end, same reasoning as everything else added
      // here after this sheet already existed on live spreadsheets.
      'RequiredClientTime',
      // Per the request — a Special Request type, distinct from the
      // standard RequestType. Defaults to blank (none).
      'SpecialRequestType',
      // Per the request — the started VA's own name, set once a VA
      // connection under this request actually Starts. Kept at the true
      // end, same reasoning as everything else added here after this
      // sheet already existed on live spreadsheets.
      'AssignedVA'
    ],
    VAConnections: [
      'ConnectionID', 'RequestID', 'VAID', 'VAName',
      'ClientID', 'CustomerID',
      'AssignedBy', 'AssignedAt',
      // When a request has more than one connection (multiple candidates
      // tried, or a replacement after a decline), IsFinalVA marks which
      // one is actually the main VA proceeding through VA Preparation &
      // Mock Interview and Rate Agreement — those two stages apply to
      // this specific VA, not just "the request" in the abstract. Only
      // one connection per request should ever be true at a time; see
      // _setFinalVA in VAConnectionService.gs, which enforces that by
      // un-marking any previous final VA whenever a new one is set.
      'IsFinalVA',
      'IsBuffer', 'ConnectionStatus', 'ConnectionType',
      'Hours', 'HoursType',
      // Per-connection pay rate — same HR-only visibility rule as VA Base
      // Rate above. Only Administrator/HR Specialist/HR Manager can ever
      // set or see this (assignVAConnectionRate() in VAConnectionService.gs
      // is the only write path — enforced server-side there, not just hidden
      // in the UI).
      'Rate', 'RateSetBy', 'RateSetAt',
      // Rate Agreement (RA) detail fields — captured alongside the rate
      // itself since they're part of the same agreement document sent to
      // the VA. NightDiffPercent defaults to 10 when applicable (the
      // typical rate) but can be overridden per-connection.
      'NightDiffApplicable', 'NightDiffPercent',
      'TrainingBondApplicable', 'TrainingBondAmount', 'TrainingBondMonths',
      'IncrementalWageApplicable',
      'RASentDate',
      // Accounting's confirmation that the RA (rate + these terms) is
      // correct before it's considered final — separate from RateSetBy
      // above, which is whoever originally set the rate (HR/CS Manager),
      // not necessarily the same person confirming it.
      'RAConfirmedBy', 'RAConfirmedAt',
      'VAConnectionDate', 'ActualStartDate',
      'TerminationDate', 'ReplacedByConnectionID',
      // The actual, final reason once terminated — distinct from
      // TerminationRequestReason below, which is the pending request's
      // reason before approval (may get revised/confirmed at execution).
      'TerminationReason',
      // Pending termination request — set when a Service Manager
      // terminates (this only requests termination, pending approval),
      // cleared once a CS Assigned/CS Manager/Administrator actually
      // executes it. Never actually changes ConnectionStatus on its own.
      'TerminationRequestedBy', 'TerminationRequestedAt',
      'TerminationRequestedDate', 'TerminationRequestReason',
      // Summary-only fields — fast "currently paused since X" lookups
      // without a join. The full back-and-forth history (a connection can
      // be paused/resumed many times) lives in VAConnectionPauseLog below;
      // these two always just reflect the MOST RECENT pause/resume event.
      'LastPausedAt', 'LastResumedAt',
      'WRLink',
      // Whether this connection has been added to payroll — defaults to
      // "Not Yet Added" the moment a connection is marked Started (see
      // updateVAConnectionStatus), so HR Specialists have a clear queue
      // of what still needs doing rather than an ambiguous blank field.
      'PayrollStatus',
      'Notes', 'UpdatedAt', 'UpdatedBy',
      // Per the request — Rate Agreement is conducted per Assigned VA
      // (per connection), not once for the whole request, since a
      // request can have multiple VA candidates over time and each one's
      // own rate needs to be separately agreed. See markVAPrepDone/
      // setFinalVA in WorkflowService.gs/VAConnectionService.gs for how
      // this drives whether a request can proceed past Rate Agreement,
      // and how changing the Final VA designation can send a request
      // back to that stage if the new Final VA doesn't have this yet.
      'RateAgreementDone', 'RateAgreementDoneAt', 'RateAgreementDoneBy', 'RateAgreementNotes',
      // Per the request — VA Preparation/Mock Interview completion is
      // now tracked per Assigned VA (per connection), same pattern as
      // RateAgreementDone above. The general "Mark Complete" button that
      // advances the request's own stage now requires at least one
      // connection to have this done first — see markVAPrepDone in
      // WorkflowService.gs.
      'VAPrepDone', 'VAPrepDoneAt', 'VAPrepDoneBy', 'VAPrepNotes',
      // Per the request — the preparation period's own start/end dates,
      // with the Mock Interview considered part of this same span
      // rather than tracked separately.
      'VAPrepStartDate', 'VAPrepEndDate',
      // Per the request — Kick-Off Call is now its own explicit, per
      // Assigned VA step, distinct from and preceding Accept/Decline
      // (previously the same moment). See _wfConnStageIndex in
      // WorkflowService.gs and the Accept/Decline gating in
      // VAConnectionService.gs for how this drives the new sequence:
      // Final VA → VA Prep → Rate Agreement → Kick-Off Call Done →
      // Accept/Decline → Start VA.
      'KickOffCallDone', 'KickOffCallDoneAt', 'KickOffCallDoneBy', 'KickOffCallNotes'
    ],
    VAConnectionNotes: [
      'NoteID', 'ConnectionID', 'RequestID',
      'AuthorEmail', 'AuthorName', 'Content', 'CreatedAt'
    ],
    // One row per pause OR resume event — preserves the full history across
    // however many times a connection is toggled, unlike the two summary
    // columns on VAConnections above (which only ever hold the latest).
    VAConnectionPauseLog: [
      'LogID', 'ConnectionID', 'EventType', 'EventDate',
      'LoggedBy', 'CreatedAt'
    ],
    // Rate/night-differential/salary-increase history — one row per
    // period during which a specific set of compensation terms was in
    // effect for a connection. Kept as ONE unified timeline (rather than
    // three separate ones for rate/night-diff/salary-increase) because
    // payroll needs to know, for any given date, everything that applied
    // at once — a single "as of" record per period is the right shape
    // for that, rather than joining three independent timelines. Night
    // diff toggling on/off on its own date (with no rate change) still
    // just means closing out the current period and opening a new one.
    // Comprehensive permissions system — one row per (Module, Role)
    // combination, with the 4 CRUD flags for that pair. This is the
    // single source of truth every module's own permission checks should
    // ultimately read from, replacing scattered role-only checks
    // (checkPermission('edit') etc.) with module-aware ones.
    ModulePermissions: [
      'Module', 'Role', 'CanCreate', 'CanRead', 'CanUpdate', 'CanDelete',
      'UpdatedAt', 'UpdatedBy'
    ],
    // Field-level overrides for specific sensitive fields within a module
    // — e.g. Rate within VA Connections: HR Specialist gets full CRUD,
    // CS Specialist gets no visibility at all. Visibility is one of
    // 'None' (field doesn't appear at all), 'Read' (visible, not
    // editable), 'Edit' (visible and editable). Only rows that exist here
    // override the module-level default for that specific field+role —
    // absence means "fall back to whatever the module-level permission
    // already grants."
    // ═══ ACCOUNTING MODULE — Phase 1: Core Ledger ═══════════════════
    // One row per ClientID (Account), ever — gates whether a new VA
    // request for that account owes a One-Time Fee. Adapted from the
    // original Customer+Department model per the request: an account is
    // already scoped to one department, so ClientID alone is the
    // correct, simpler unique key. CustomerID is kept for
    // reporting/joining only, not part of the identity. See
    // checkOneTimeFeeDue() in AccountingService.gs.
    ClientDeptEnrollment: [
      'EnrollmentID', 'ClientID', 'CustomerID', 'Department', 'DateFirstActivated',
      'OneTimeFeeCharged', 'OneTimeFeeAmount',
      'WaivedOrDiscounted', 'WaiverReason',
      'CreatedAt', 'CreatedBy',
      // One-Time Fee's own billing/payment tracking, for the Customer
      // Onboarding Fees & Deposits overview report.
      'BillingDate', 'PaymentDate'
    ],
    // Deposit collection and drawdown — one row per ClientID (Account),
    // adapted from the original Customer+Department model per the same
    // request as above. RemainingBalance is computed (AmountCollected
    // minus every AmountApplied against it), not manually entered, to
    // avoid it drifting out of sync.
    Deposits: [
      'DepositID', 'ClientID', 'CustomerID', 'Department', 'DepositFee', 'PaymentDate',
      'AmountApplied', 'ConsumedDate', 'ApplicationReason', // 'Outstanding balance' or 'Final funding on exit'
      'RemainingBalance',
      // Explicit status (Active/Waived/Refunded/Consumed) rather than
      // derived purely from RemainingBalance — Active means collected
      // and not yet drawn down; Waived means never charged in the first
      // place; Refunded means collected then paid back to the customer;
      // Consumed means fully applied against billing. Kept explicit so
      // it can be its own direct report column rather than recomputed
      // each time.
      'Status', 'Reason', 'BillingDate',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    // One row per customer per month — the generated invoice. ServiceMonth
    // and BillingMonth are tracked as two separate fields deliberately
    // (never collapsed into one date) — for Prepaid customers
    // ServiceMonth is usually the month AFTER BillingMonth; for Postpaid,
    // the month BEFORE. Phase 1 is manual entry only — no automated
    // generation yet (that's Phase 2, §4.2-4.3 of the plan).
    BillingCycles: [
      'BillingID', 'CustomerID', 'BillingMonth', 'ServiceMonth',
      'OneTimeFeeCharged', 'ServicePaymentAmount', 'NDAmount',
      'RateAdjustmentAmount', 'PriorMonthAdjustment', 'TotalBilled',
      'DateIssued', 'ExpectedPaymentDate',
      'Status', // Draft/Issued/Paid/PartiallyPaid/Overdue
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    // One row per actual payment received — always references an
    // existing BillingID (never auto-creates one). A single BillingID can
    // have multiple Payment rows for partial payments over time.
    Payments: [
      'PaymentID', 'CustomerID', 'BillingID', 'AmountPaid', 'DatePaid',
      'PaymentStatus', // Full/Partial/Late
      'OutstandingAfterPayment', 'Notes',
      'CreatedAt', 'CreatedBy'
    ],
    // Phase 3 — compares projected vs actual hours per VA connection per
    // month. Status: Pending (computed, awaiting Accounting's review) →
    // Confirmed (reviewed, ready to queue) → Applied (linked to the next
    // month's BillingID). Never edits an already-issued invoice — the
    // difference only ever posts forward, to AppliedToBillingID.
    HoursReconciliation: [
      'ReconID', 'ConnectionID', 'CustomerID', 'BillingMonth',
      'ProjectedHours', 'ActualHours', 'DifferenceHours', 'DifferenceValue',
      'Status', // Pending/Confirmed/Applied
      'AppliedToBillingID', 'ConfirmedBy', 'ConfirmedAt',
      'CreatedAt', 'CreatedBy'
    ],
    // Phase 4 (§2.8, §4.8) — one row per VA connection per month of
    // Training Bond accrual, distinct from VABonds (VACompensationService.gs),
    // which holds the bond's own single lifecycle record (status, amount,
    // dates). This ledger is the month-by-month detail feeding that
    // record's RunningTotal — accrual must stop once VABonds.Status is
    // Released or Forfeited (§3's integrity rule), enforced in
    // accrueTrainingBond() rather than left to the caller to remember.
    TrainingBondLedger: [
      'LedgerID', 'ConnectionID', 'Month', 'HoursWorked',
      'DeductionRate', 'AmountDeducted', 'RunningTotal',
      'CreatedAt', 'CreatedBy'
    ],
    // Connection-level monthly billing detail grid — one row per
    // (connection, month), direct-entry. Reference columns (customer, VA,
    // start/end dates, billing type, rate) are intentionally NOT stored
    // here — they're always derived live from VAConnections/Customers/
    // VAConnectionCompHistory, so they can never drift out of sync with
    // whatever's actually true there. Only the billing-specific detail
    // that has no other home lives in this table.
    ConnectionBillingDetail: [
      'DetailID', 'ConnectionID', 'Month',
      // Denormalized reference snapshot — cached at save time so a
      // subsequent load of this same row never needs to re-join
      // Customers/VAConnectionCompHistory just to redisplay them. Can go
      // stale if the source data changes later (e.g. a customer renamed) —
      // a deliberate speed/freshness tradeoff, not an oversight.
      'CustomerName', 'VAName', 'BillingType', 'Rate',
      'BillingDate', 'PaymentDate',
      'ProjectedHours', 'ActualHours',
      // Stored, not just live-computed like the grid's other derived
      // values — Rate × Projected Hours, per the request.
      'TotalBilledServiceAmount',
      'NightDiffHours', 'NightDiffFactorType', 'NightDiffFactorValue', // 'Percent' or 'Amount'
      'OvertimeAmount', 'AbsencesAmount', 'RefundsAmount',
      'Notes',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],

    ConnectionKPI: [
      'RecordID', 'ConnectionID',
      'KPIType',   // 'Weekly' or 'Monthly'
      // Stored as plain text 'YYYY-MM-DD', never as a real date value —
      // Google Sheets silently converts a date-shaped string on write
      // unless told not to, which breaks every future key-based lookup
      // for this exact row (ConnectionID + KPIType + PeriodDate). Same
      // bug already found and fixed once this session with the billing
      // grid's Month column.
      'PeriodDate', // Monday of the week (Weekly) or 1st of the month (Monthly)
      'Status',     // 'No Data', 'On Target', 'At Risk', 'Critical'
      'InterventionDetails', // Team Lead's notes — visible to CMS too
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],

    // Replaces Backup Specialist entirely, per the request — instead of
    // one CS Specialist blanket-covering everything for another, a CS
    // Manager assigns SPECIFIC customers to a covering specialist for a
    // fixed date range (e.g. 10 of CS1's 20 customers to CS2, the other
    // 10 to CS3, Jan 10 - Jan 30). Once EndDate passes, the covering
    // specialist loses access to those customers again — enforced by
    // date comparison at read time, not by anything expiring this row.
    CustomerTakeovers: [
      'TakeoverID', 'CustomerID',
      'TakeoverSpecialistEmail', // who's covering
      // Plain text 'YYYY-MM-DD', same reasoning as ConnectionKPI's
      // PeriodDate above — these get string-compared against today's
      // date on every access check, so they can never be allowed to
      // silently become a real Date value instead.
      'StartDate', 'EndDate',
      'Reason',
      'CreatedAt', 'CreatedBy'
    ],

    // Page-load performance monitoring, per the request — one row per
    // page navigation, capturing how long that module actually took to
    // finish loading. IsFlagged is computed and stored at write time
    // (LoadTimeSeconds > 90) rather than only derived on read, so this
    // sheet can be filtered/sorted on the flag directly.
    PageLoadLogs: [
      'LogID', 'UserName', 'UserEmail', 'Module',
      'LoadTimeSeconds', 'IsFlagged',
      'CreatedAt'
    ],

    FieldPermissions: [
      'Module', 'Field', 'Role', 'Visibility',
      'UpdatedAt', 'UpdatedBy'
    ],
    VAConnectionCompHistory: [
      'CompHistoryID', 'ConnectionID',
      'Rate', 'EffectiveDate', 'EndDate',
      // NightDiffType is 'Percentage' (the typical case — e.g. 10%) or
      // 'Fixed' (some VAs get a flat $ amount instead, e.g. $1/hr).
      'NightDiffActive', 'NightDiffType', 'NightDiffValue',
      // A flat monthly $ increase layered on top of Rate, rather than
      // changing Rate itself — e.g. +$100/month.
      'MonthlySalaryIncrease',
      'Notes', 'CreatedAt', 'CreatedBy'
    ],
    // Training bond lifecycle — one row per connection (not a history;
    // a bond has one lifecycle per connection, tracked via Status rather
    // than multiple rows). Distinct from VAConnections.TrainingBond* above,
    // which only ever captured the initial Rate Agreement terms — this
    // tracks what actually happens to the bond over time.
    VABonds: [
      'BondID', 'ConnectionID',
      'Amount',        // per-hour deduction amount, defaults to 0.50
      // Pending = still being deducted monthly, not yet released.
      // Released = bond paid out (can happen early, pending review, or at
      // the expected end date). Forfeited = VA/account situation meant
      // the bond is kept, not paid out. No Bond = deduction never applies
      // at all for this connection.
      'Status',
      'StartDate',
      'ExpectedEndDate', // defaults to StartDate + 6 months
      'ReleaseDate',     // when the bond was actually paid out, if released
      'Notes', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    // Hours change log — one row per approved hours/schedule change on a
    // VA Connection. Tracks both the previous and new values so the full
    // history of hours changes is preserved. Used by the Hours/Schedule
    // Changes module to show a timeline of changes per connection.
    VAConnectionHoursLog: [
      'LogID', 'ConnectionID', 'ChangeType',
      'PrevHours', 'NewHours', 'PrevHoursType', 'NewHoursType',
      'PrevConnectionType', 'NewConnectionType',
      'PrevScheduleType', 'NewScheduleType',
      'PrevScheduleDays', 'NewScheduleDays',
      'LimitHours', 'LimitFrom', 'LimitTo', 'LimitNotes',
      'EffectiveDate', 'Notes',
      'LoggedBy', 'CreatedAt',
      // Structured per-day-group schedule (JSON array of {days:[...],
      // hoursPerDay:N}), e.g. 3 hrs Mon–Wed, 2 hrs Thu–Fri, 1 hr Sat — the
      // PrevScheduleDays/NewScheduleDays columns above only ever supported
      // one uniform hours value across every selected day.
      // IMPORTANT: kept at the END of this array, not grouped with the
      // other Schedule* columns above — on an existing sheet, the
      // self-healing column migration (_ensureAllSheets in SheetSetup.gs)
      // always appends newly-added columns after whatever already exists,
      // regardless of where they're declared in this schema array. Putting
      // them anywhere else here would misalign every appendRow([...]) call
      // that writes to this sheet by position.
      'PrevScheduleBreakdown', 'NewScheduleBreakdown',
      // Who asked for the additional hours logged via "Log Additional
      // Hours" (ChangeType='Project Hours Entry') — 'VA' or 'Client'. Blank
      // for every other ChangeType.
      'RequestedBy',
      // Required PH working-time window for Weekly Fixed / Daily Fixed
      // schedule updates — same concept as VARequests.RequiredPHTime.
      'RequiredPHTime',
      // Same concept as on VARequests — added here too so a schedule
      // change made after the request stage (via the Hours & Schedule
      // Change modal) can also record these. Kept at the very end per
      // this schema's ordering requirement above.
      'NightDiffApplicableAtSchedule', 'BreaksIncludedInTotal',
      // RequiredClientTime is the actual input now (the client's own
      // local working-hours commitment); RequiredPHTime above is
      // derived from it. Kept at the very end per this schema's
      // ordering requirement above — same reasoning as every other
      // column added here after the sheet already existed.
      'RequiredClientTime',
      // Per the request — a CS Specialist's own Hours/Schedule change
      // must be explicitly confirmed (or cancelled) before it actually
      // takes effect, rather than applying immediately. "ApplyStatus"
      // (Pending/Applied/Cancelled) is deliberately not called
      // "Confirmed"/"ConfirmedAt" to avoid clashing with the different,
      // existing multi-role Acknowledgement concept described just below
      // this array — this is a separate, earlier gate, before that one.
      // Blank ApplyStatus on existing rows (created before this field
      // existed) is treated as Applied everywhere this is read, for
      // backward compatibility — see _hoursBuildTimeline in
      // VAHoursService.gs. Kept at the true end, same reasoning as
      // every other column added here after the sheet already existed.
      'ApplyStatus', 'AppliedAt', 'AppliedBy', 'CancelledAt', 'CancelledBy', 'CancelReason'
    ],
    // Acknowledgements for Hours/Schedule changes logged above — a change
    // needs sign-off from at least one Service Manager, one HR person
    // (Specialist or Manager), and one Accounting person before it's
    // considered fully confirmed. One row per person who acknowledges;
    // "fully acknowledged" is computed from these, not stored directly.
    HoursChangeAcknowledgements: [
      'AckID', 'LogID', 'AcknowledgedByRole', 'AcknowledgedBy', 'AcknowledgedByName', 'Notes', 'CreatedAt'
    ],
    Contracts: [
      'ContractID', 'ContractName', 'Description',
      'Period',
      'IsActive', 'Notes',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    ContractSectionDefs: [
      'SectionDefID', 'SectionName', 'FieldType',
      'Description', 'SortOrder', 'IsActive',
      'CreatedAt', 'CreatedBy'
    ],
    ContractSections: [
      'SectionID', 'ContractID', 'SectionDefID',
      'SectionName', 'FieldType', 'Value',
      'UpdatedAt', 'UpdatedBy'
    ],
    ContractAssignments: [
      'AssignmentID', 'ContractID', 'EntityType', 'EntityID',
      'AssignedAt', 'AssignedBy', 'Notes'
    ],
    FollowUps: [
      'FollowUpID', 'CustomerID', 'ClientID',
      'Subject', 'Description',
      'DueDate', 'RemindDaysBefore',
      'Status',
      'AssignedTo',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    MeetingTypes: [
      'TypeID', 'Label', 'ShortName', 'OffsetValue', 'OffsetUnit', 'OffsetDays',
      'IsActive', 'SortOrder',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    // Redesigned 2026-06-24: meetings moved from VA-Connection-level to
    // Account-level. One meeting per (ClientID, MeetingTypeID), generated
    // once from the account's FIRST VA connection to reach Started — not
    // regenerated for every subsequent VA on the same account. AnchorConnectionID
    // records which connection's start date the schedule was built from, for
    // traceability. ActiveVAConnectionIDs is a comma-separated snapshot, taken
    // when the meeting is generated, of every VA connection active on the
    // account at that time — the per-VA concern/feedback log (MeetingConcerns)
    // is keyed off this list. ConnectionID/VAName/ConcernedVA*/LinkedMeetingIDs
    // are retired along with this change: "linking" multiple VA meetings into
    // one session was only ever needed because the old model created a
    // separate meeting per VA — at the account level there's nothing left to
    // combine, since each type only ever produces one meeting per account.
    Meetings: [
      'MeetingID', 'ClientID', 'CustomerID',
      'AnchorConnectionID', 'ActiveVAConnectionIDs',
      'MeetingTypeID', 'MeetingTypeLabel',
      'ScheduledDate', 'OriginalScheduledDate',
      'Status', 'Notes',
      'RiskFlag', 'RiskReason',
      // Per the request — a CS Manager's intervention in response to a
      // flagged (at-risk) meeting's own concern (RiskReason above).
      'InterventionNotes', 'InterventionBy', 'InterventionAt',
      'AssignedTo',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy',
      // Tracks whether a "please schedule this meeting" email has already
      // been sent to the client for this specific meeting — since one
      // Meeting row can cover multiple VAs (ActiveVAConnectionIDs), this
      // naturally means only one email is ever needed per meeting, not
      // one per VA it happens to include.
      'ScheduleEmailSentAt', 'ScheduleEmailSentBy'
    ],
    // FeedbackType distinguishes a Concern from Good Feedback — both are
    // logged the same way (checkbox reveals a textbox, see the Meeting
    // modal), but only Concerns go through the Open/Resolved workflow;
    // Good Feedback entries are just a permanent log entry (status stays
    // blank/'Logged').
    MeetingConcerns: [
      'ConcernID', 'MeetingID', 'ConnectionID', 'VAName', 'FeedbackType',
      'Details', 'Status', 'Resolution',
      'RaisedBy', 'RaisedAt', 'ResolvedBy', 'ResolvedAt'
    ],
    Inquiries: [
      'InquiryID', 'Subject', 'InquiryType', 'Priority',
      'CustomerID', 'ClientID',
      'ContactName', 'ContactEmail',
      'Status', 'Resolution',
      'ClosedReason', 'LostReason',
      'AssignedTo',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy',
      // Link to an external Ticket Report document (e.g. a Google Doc the
      // full inquiry text was pasted into) — see iqGenerateReportText() in
      // scripts-core.html for the text this is meant to be paired with.
      'TicketReportLink',
      // Which VA (if any) this inquiry/concern is specifically about — many
      // concerns are about a particular VA's performance, no-shows, etc.,
      // and this was previously untracked (only Customer/Account existed).
      'RelatedVAID', 'RelatedVAName',
      // Termination-ticket-specific fields — a Termination inquiry is
      // bound to a specific VA Connection (not just the VA, since a VA
      // could have had more than one connection over time), tracks which
      // side caused it, and its outcome, which drives Status
      // automatically (see _iqApplyTerminationOutcome in
      // InquiryService.gs): Cancelled or Changed to Replacement both
      // resolve the underlying concern (Closed - Resolved), while Pushed
      // Through means the termination actually happened (Closed -
      // Unresolved, since the account did lose the VA).
      'RelatedConnectionID', 'TerminationCause', 'TerminationOutcome',
      // Links this inquiry to a Service Request it was escalated into —
      // see reqDoClose/reqDoConfirmAcceptPayment-adjacent close logic in
      // WorkflowService.gs/VAConnectionService.gs, which auto-closes the
      // linked inquiry (Won if the VA started, Lost if the request closed
      // Lost) when this request closes. Kept at the end, same ordering
      // reasoning as other schemas in this file.
      'EscalatedToRequestID',
      // Supports selecting multiple Related VAs when "one ticket for all
      // VAs" is chosen (comma-separated) — RelatedVAID/RelatedVAName above
      // stay as the first/primary VA for backward compatibility with
      // existing code that only ever reads those singular fields (e.g.
      // the department lookup for the ticket modal/table).
      'RelatedVAIds', 'RelatedVANames',
      // Lets a ticket be routed to a service department directly when no
      // specific VA is related to the concern — previously the only way
      // to reach a department was indirectly, through a VA's own
      // department (relatedVADepartment above, Termination-only).
      'Department',
      // Termination-ticket workflow fields, per the request — this is
      // the "clearance" a Termination inquiry goes through before its
      // outcome (Pushed Through vs Changed to Replacement) actually
      // cascades to the linked VA Connection. CSRetention documents what
      // retention effort was made before the termination was accepted.
      // Security/VAExitCall are only relevant when TerminationCause is
      // 'Client' (a client-initiated termination) — each tracks whether
      // it was conducted and when. TargetTerminationDate is the planned
      // date going in; the VA Connection's own TerminationDate gets set
      // to the actual date once the outcome is confirmed. TerminationReason
      // mirrors the same field already on VAConnections, applied there
      // automatically once the termination is Pushed Through.
      'CSRetention',
      'SecurityConducted', 'SecurityDate',
      'VAExitCallConducted', 'VAExitCallDate',
      'TargetTerminationDate', 'TerminationReason',
      // Cross-links a Concern ticket to the Termination ticket it
      // auto-creates when a replacement is triggered from it, per the
      // request — LinkedTerminationTicketId lives on the originating
      // Concern ticket, OriginatingInquiryId lives on the Termination
      // ticket itself, pointing back the other way.
      'LinkedTerminationTicketId', 'OriginatingInquiryId',
      // Per the restructuring — ActualLastWorkingDate is the VA's real
      // last working date, confirmed once the termination is processed
      // (distinct from TargetTerminationDate above, which is only ever
      // the plan going in). TerminationStatusType is the new,
      // automatically-computed classification — see
      // CONFIG.TERMINATION_STATUS_TYPE and _iqComputeTerminationStatusType
      // in InquiryService.gs.
      'ActualLastWorkingDate', 'TerminationStatusType'
    ],
    InquiryUpdates: [
      'UpdateID', 'InquiryID',
      'AuthorEmail', 'AuthorName',
      'SenderType',
      'MessageType',
      'Content', 'StatusChange', 'PostedAt', 'CreatedAt'
    ],
    // NoteType is 'Customer' or 'Account'. CustomerID is always set (even
    // for an Account-type note, via that account's own parent customer)
    // — this is what lets a single query pull both a specific account's
    // own notes and its parent customer's notes together, per the
    // request ("in the account notes, the customer notes should also be
    // visible"). ClientID is only set for an Account-type note; blank
    // for a Customer-type note, since that isn't about any one account.
    CustomerAccountNotes: [
      'NoteID', 'NoteType', 'CustomerID', 'ClientID',
      'NoteText', 'CreatedAt', 'CreatedBy'
    ],
    EmailTemplates: [
      'TemplateID', 'Module', 'Category', 'Name', 'Subject', 'Body', 'ImageUrl', 'IsHtml',
      'IsActive', 'IsDefault',
      'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
    ],
    CelebrationLogs: [
      'LogID', 'OccasionType', 'VAID', 'ClientID', 'ConnectionID',
      'OccasionYear', 'EmailType', 'TemplateID',
      'Subject', 'Body', 'Recipients',
      'SentAt', 'SentBy'
    ],

    // One row per customer per month/year — uploaded via CSV by CS
    // Manager. Used both for its own dedicated Client Payments module
    // (a pivot of every customer × every month) and to flag an unpaid
    // customer with a warning in Birthdays & Anniversaries.
    ClientPayments: [
      'PaymentRecordID', 'CustomerID', 'CustomerName',
      'Month', 'Year', 'Status',
      'UploadedBy', 'UploadedAt'
    ],
    // One record per VA candidate's Kick Off Call — a sub-process inside
    // the Kick Off Call workflow stage. Every VA Assignment candidate that
    // reaches Rate Agreement gets their own Kick Off Call; if the current
    // one is Declined, the next candidate goes through Rate Agreement +
    // their own new Kick Off Call record here (see WorkflowService.gs /
    // VAConnectionService.gs for the loop-back logic). Approve/Decline/
    // Cancel is done by the assigned CS Specialist normally, or CS
    // Manager specifically when the request is a Replacement.
    VAKickoffCalls: [
      'KickoffCallID', 'RequestID', 'ConnectionID', 'VAID', 'VAName',
      'KickoffCallDateTime', 'VAConnectionCallTargetDate',
      'Result', 'ResultBy', 'ResultAt', 'ResultNotes',
      'CreatedBy', 'CreatedAt'
    ]
  }
};

// Per the request — opens the separate Google Sheet intended for
// upcoming accounting-related features, distinct from this app's main
// bound spreadsheet (which every other sheet reference in this codebase
// reaches via SpreadsheetApp.getActiveSpreadsheet() instead). Cached per
// execution to avoid repeated SpreadsheetApp.openById() calls within
// the same run.
var _accountingSpreadsheetCache = null;
function getAccountingSpreadsheet() {
  if (_accountingSpreadsheetCache) return _accountingSpreadsheetCache;
  if (!CONFIG.ACCOUNTING_SPREADSHEET_ID) {
    throw new Error('CONFIG.ACCOUNTING_SPREADSHEET_ID is not set.');
  }
  _accountingSpreadsheetCache = SpreadsheetApp.openById(CONFIG.ACCOUNTING_SPREADSHEET_ID);
  return _accountingSpreadsheetCache;
}

// Run this once from the Apps Script editor (select it in the function
// dropdown, then Run) to confirm the Accounting spreadsheet above is
// actually reachable — logs its name and the sheet tabs it currently
// has, or throws a clear error if it can't be opened (wrong ID, no
// access, etc.) before any real accounting feature gets built on it.
function testAccountingSpreadsheetConnection() {
  var ss = getAccountingSpreadsheet();
  var sheetNames = ss.getSheets().map(function(s){ return s.getName(); });
  Logger.log('Connected to: ' + ss.getName());
  Logger.log('Existing tabs: ' + (sheetNames.length ? sheetNames.join(', ') : '(none yet)'));
  return { name: ss.getName(), sheets: sheetNames };
}