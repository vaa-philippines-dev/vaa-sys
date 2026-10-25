# Legacy VAA-CMS (Apps Script): reference notes

How the old Customer Management System works. Use this when rebuilding it in vaa-sys. The source is in [`legacy/vaa-cms-gas/`](../legacy/vaa-cms-gas), cloned with clasp on 2026-10-26. It is about 68k lines: 33 `.js` server files and 20 `.html` UI files. Every file was read in full. File:line references point into that folder.

**Data migration is paused.** When we import, take only records from **2026-08-01 to today**, for testing.

## 1. Platform

- **Database:** a web app bound to a **Google Sheet**. Each tab is a table; `CONFIG.SCHEMA` in `Config.js` lists the columns.
  - **ClientDeptEnrollment** and **Deposits** live in a second spreadsheet (`CONFIG.ACCOUNTING_SPREADSHEET_ID`, Config.js:15).
  - The main sheet may also hold empty or stale copies of those two tabs, created by `initializeAccountingModule`. Read the live ones from the accounting sheet.
- **Serving:** `doGet` renders `app-shell.html`, which includes the `scripts-*.html` and `styles-main.html` files.
  - The browser calls the server through `google.script.run.<fn>`. Every top-level function without a `_` prefix can be called from the browser.
  - The `page-*.html` files are dead; nothing includes them.
- **Schema changes:** tables "self-heal" by appending any missing columns at the right-hand end. Many writes use `appendRow` **by column position**, so the live column order can differ from the schema order. Read by header name when migrating.
- **Manifest:** `executeAs: USER_ACCESSING`, `access: ANYONE`, timezone `Asia/Taipei` (UTC+8, same as Manila).
- **External services:**
  - MailApp: welcome, birthday/anniversary and meeting-schedule emails, all sent as the signed-in user.
  - DriveApp: Work Report docs are copied from per-department templates.
  - UrlFetchApp: xlsx exports.
  - CacheService: some reports, cached for 5 minutes.
  - Triggers: none.
- **Secrets:** none hardcoded. The only fixed ID is the accounting spreadsheet's.

## 2. Tables (sheet tabs)

| Area | Tabs |
|---|---|
| Customers | `Customers`, `Accounts` (in code `CONFIG.SHEETS.CLIENTS`, keyed by `ClientID`), `CustomerAccountNotes`, `CustomerTakeovers`, `Contacts` (**unused**: contacts are flattened onto Accounts) |
| Contracts | `Contracts`, `ContractSectionDefs`, `ContractSections`, `ContractAssignments` |
| Service requests | `VARequests`, `RequestWorkflowHistory`, `RequestStageAcknowledgements`, `RequestActivityLogs`, `VAKickoffCalls` |
| VAs & connections | `VirtualAssistants`, `VAConnections`, `VAConnectionNotes`, `VAConnectionPauseLog`, `VAConnectionHoursLog`, `HoursChangeAcknowledgements`, `VAConnectionCompHistory`, `VABonds`, `ServiceManagers` |
| Tickets | `Inquiries`, `InquiryUpdates` |
| Meetings | `MeetingTypes`, `Meetings`, `MeetingConcerns`, `PlaybookContactLog` (created on first use, not in CONFIG) |
| CS extras | `FollowUps`, `EmailTemplates`, `CelebrationLogs`, `ClientPayments` |
| Accounting | `ClientDeptEnrollment`\*, `Deposits`\*, `BillingCycles`, `Payments`, `HoursReconciliation`, `TrainingBondLedger`, `ConnectionBillingDetail`, `AttendanceRecords`, `ImportBatches`, `ConnectionKPI` (\* = accounting spreadsheet) |
| System | `Users`, `Roles`, `ModulePermissions`, `FieldPermissions`, `Settings`, `WRTemplateSettings`, `ActivityLogs`, `PageLoadLogs` |

**IDs:**
- Most are `PREFIX_` + 12 uppercase hex characters (`generateID`, SheetSetup.js:444). Prefixes: CUST, CLT, REQ, CONN, IQ, IQU, MTG, MCN, HCL, COMP, BOND, KOC, NOTE, PAU, WFL, ACK, HACK, CAN, EMT, CEL, PCL, USR.
- Exceptions: contracts are `CON-001`, follow-ups `FU-001`, contract assignments `ASN-<epoch>`.
- vaa-sys already keeps the `CUST_` / `CLT_` codes as `customerCode` / `accountCode`.

## 3. Roles and access

- **Roles (12):** Administrator, CS Manager, CS Specialist, Manager, HR Specialist, HR Manager, Service Manager, Accounting, Recruitment Specialist, Training Manager, Executive, Executive Support.
- **Sign-in:** the user is identified by `Session.getActiveUser().getEmail()`, matched case-sensitively against `Users.Email`.
  - **Any unknown Google account is auto-created as a CS Specialist** (AuthManager.js:92). Together with `access: ANYONE`, anyone with the link gets in.
- **Three overlapping permission layers:**
  1. **Role flags** from the `Roles` tab (canEdit, canDelete, requiresApproval, canManageSettings, canAssignVA, canViewReports) via `checkPermission(action)`. **Any unknown action, such as `'view'`, is allowed** (AuthManager.js:162).
  2. **ModulePermissions:** a module × role grid of create/read/update/delete flags. Only used for Customers delete and Billing & Payments. **FieldPermissions** can be configured but are never enforced.
  3. **Nav visibility:** `NAV_ROLE_DEFAULT` (scripts-core.html:339), which an admin can override per role.
- **Data scoping:**
  - **CS Specialist:** customers whose `AssignedSpecialist` is their email, **plus** active `CustomerTakeovers`. A takeover covers specific customers for a StartDate..EndDate window and replaced the old "backup specialist".
  - **Service Manager:** their department, taken from `Users.Department` in some places and from the `ServiceManagers` tab in others.
  - **HR, Recruitment, Training, Executive:** only requests where they own the current workflow stage.
- **Rates:** visible to Admin, CS Manager, HR Specialist, HR Manager and Accounting (`_canSeeVARate`, AuthManager.js:11). The comments say "Admin/HR only". Rates are removed from server responses for every other role.
- **Admin "View As":** simulates a role in the UI only.

## 4. Domain rules

### Customers & accounts

- **Customer statuses:** Pending (default), Active, Paused, Inactive, Terminated, Cancelled.
- **Account statuses:** Active (default), Paused, Inactive, Terminated, Cancelled. Accounts cannot be set to Pending.
- **"Returning"** is the `Accounts.IsReturning` flag, not a status. It is set when a terminated account comes back, or when a new account matches a terminated one's company name.
- **Customer status history:**
  - `StatusHistory` is a JSON array `{from,to,date,reason,by}`, capped at 50 entries.
  - `TerminationCount` / `ReactivationCount` are counters.
  - `LastTerminatedDate` / `LastReactivatedDate` are actually **comma-separated date lists**.
- **Cascades:**
  - Customer Paused pauses its Active accounts. Customer Terminated or Cancelled applies to every account that isn't already terminal.
  - After an account status change, the customer is recomputed: any account Active → Active; otherwise any Paused → Paused; otherwise all Terminated → Terminated.
  - Neither customer nor account can be terminated or cancelled while any connection is Started.
- **Pending review:** when anyone other than a CS Manager pauses, terminates or cancels, the change applies immediately and is flagged with `PendingReviewAction` / `StatusBeforePendingReview`. A CS Manager then Confirms, or Cancels (which reverts the status).
  - The dedicated Terminate button follows a different path: it never applies the status, so Confirm does nothing (bug).
- **Reactivation:** the customer goes to Pending and the chosen accounts go back to Pending. They become Active when a VA connection Starts.
- **Contacts:** stored inline on the account (Primary*, Secondary*, Invoice*, plus focal flags). `AccountManagers` / `AccountManagerEmails` are comma-separated lists matched by position, and can drift out of step.
- **Notes:** `CustomerAccountNotes` with NoteType Customer or Account. An account's view shows its own notes plus its customer's.
- **Shown in the UI only:**
  - Warnings: has a VA but isn't Active; no CS assigned; Active with zero VAs.
  - Account health: 100 − 10×open service requests − 8×open inquiries, then −15 if Paused, −25 if Inactive, 0 if Terminated or Cancelled. Bands: ≥70 / ≥40.

### Service requests (VARequests)

- **Types:** New, Additional, Replacement, Hours/Schedule Change, Special.
- **Status:** Open → In Progress (set when the first VA is assigned) → Closed - Won / Closed - Lost. Closed is final.
- **Workflow stages** (`WORKFLOW_STAGES`, WorkflowService.js:25), with the owning role:
  1. Request Intake (CS Specialist)
  2. Management Approval (Executive; optional)
  3. VA Assignment (Service Manager)
  4. Recruitment - Sourcing (Recruitment)
  5. Training (Training Manager)
  6. VA Preparation & Mock Interview (Service Manager)
  7. Payment Confirmation (CS Specialist; skipped if Paid or Add to Next Bill)
  8. Rate Agreement (HR Specialist)
  9. Kick Off Call (CS Specialist)
  10. VA-Client Connection Call (CS Specialist)
  11. Start VA (Service Manager)
  12. Completed
- **Who can act on a stage:** its owner role or Admin. CS Manager also covers the CS Specialist and Executive stages; HR Manager also covers HR Specialist.
- **Gates:**
  - Intake → VA Assignment needs seller onboarding marked Done (with a date) or Waived (with a reason). Replacements skip this.
  - From VA Prep onward, the stage is **computed** from the Final VA connection's per-connection flags (VAPrepDone → RateAgreementDone → KickOffCallDone → Accepted/Started).
- **24h acknowledgement rule:** the stage owner must post an acknowledgement or note at least every 24 hours for the current stage, otherwise the request is flagged "NEEDS UPDATE".
- **Closing:**
  - Won happens automatically when a connection Starts. ClosedAt is set to the VA's start date.
  - Lost needs a reason. It cancels open connections and closes any linked inquiry.

### VA connections

- **Statuses:** Pending, Accepted, Declined, Started, Paused, Cancelled (ended before it started), Terminated (ended after it started).
- **Final VA:** a request can have several candidate connections; one is the Final VA (`IsFinalVA`). Accepting one **hard-deletes** the other Pending candidates.
- **Rate agreement**, per connection: Rate, ND% (default 10), training bond terms, incremental wage, RA sent date.
  - Any edit resets Accounting's `RAConfirmedBy`.
  - `VAConnectionCompHistory` holds the dated history of rate, night differential (Percentage or Fixed) and monthly salary increase.
- **Pause/Resume:** each event is logged in `VAConnectionPauseLog`. Pausing the last Started connection pauses the account and customer.
- **Termination:** a Service Manager only *requests* it (`TerminationRequested*`); a CS user executes it. Termination tickets also execute it.
- **Payroll:** set to "Not Yet Added" on Start; HR toggles it to "Added".
- **Work Report:** a Drive copy of the department's template, named by a pattern. The link is saved in `WRLink`.
- **Schedule:** the source of truth is `VAConnectionHoursLog`, with a JSON breakdown `[{days:[…],hoursPerDay}]`. `VAConnections.Hours` is only a cache.
  - Changes are Pending until confirmed.
  - A change is fully acknowledged once it is signed by at least one Service Manager, one HR person and one Accounting person.

### Tickets (Inquiries)

- **Types** come from Settings: VA-Related Concern, Payment/Account, General, Termination, Account Meeting Concern.
- **Statuses:** Open, In Progress, Escalated, Closed - Resolved, Closed - Unresolved.
- **Thread:** `InquiryUpdates`. Each entry has a sender type (client/cs/manager) and a message type (email/whatsapp/note/…).
- **Termination tickets:**
  - Bound to a connection.
  - Cause: VA Resigned, VA Removed, VA AWOL or Client Initiated.
  - Outcome: Retracted → Resolved; Accepted → Unresolved, and the connection is terminated.
  - Status type: End of Project, End of Contract, Remove or Replace.
- **Linking:**
  - A Concern can spawn a Termination ticket (`LinkedTerminationTicketId`).
  - A ticket can be escalated to a service request (`EscalatedToRequestID`); the ticket closes automatically when that request closes.
- **Report text:** `iqGenerateReportText` (scripts-core.html:10808) builds the plain-text ticket report.

### Meetings

- **One cadence per account**, anchored on the first Started connection.
- **Types** with offsets: OB (Onboarding, ad hoc), W2, M1, M2, M3, M6, Y1. Dates that fall on a weekend move to Monday.
- **Generation:** only the next missing cadence is created; it is generated when the previous one is Completed, Waived or Merged.
- **Statuses:** Upcoming, Rescheduled, Completed, Waived, Superseded, Merged (within 14 days of the next cadence), Cancelled.
- **Feedback:** Concern, Good or Neutral. Every Concern automatically creates a High-priority inquiry.
- **Risk flag:** set on the meeting, with a CS Manager intervention.

### Accounting (Billing & Payments module)

- **Billing type:** Prepaid (default) bills projected hours for the next month; Postpaid bills actual hours for the previous month.
- **Projected hours:** weekly ÷ 7 × days in month.
- **One-Time Fee:** once per account, default $250, plus a paired $250 deposit. Each can be waived, with a reason.
- **Deposits:** Active → Consumed or Refunded.
- **Billing cycle:** `TotalBilled = OTF + service + ND + rate adjustment + prior-month adjustment`. Due on the 10th. Payments set the invoice to Paid or PartiallyPaid.
- **Hours reconciliation:** (actual − projected) × rate, posted to the next month's bill.
- **Training bond:** hours × $0.50 a month until the bond is Released or Forfeited. Default term is 6 months.
- **Night differential:** Fixed = hours × value; Percentage = hours × rate × value / 100.
- **First month:** prorated. If 5 or fewer days remain in the month, it bills $0, and **nothing carries forward**.
- **Billing grid** (`ConnectionBillingDetail`): base = actual hours if Postpaid, otherwise projected. Total = base + ND + OT − absences − refunds. This is separate from BillingCycles.
- **Attendance:** monthly rows with two cutoffs (days 1–15 and 16–end of month).
  - **The page is broken:** the frontend still expects the old daily format.
- **Client Payments:** a separate customer × month Paid/Unpaid grid uploaded by CSV. It only feeds the unpaid warning in Birthdays & Anniversaries.
- **KPI:** `ConnectionKPI` rows (Weekly or Monthly) with status No Data, On Target, At Risk or Critical, plus intervention notes, all entered by hand.

### Reports

- **Report list:** Headcount, Hours, Customer Idle Time, SR Completion, Customer/Account, Customer Onboarding, Performance (Jan–Dec × department; the KPI and Retention sections are empty), Lifetime Value, Termination Reasons, Meetings scheduled vs actual, Audit (about 15 integrity checks), and Playbook (an account health overview).
- **Rules worth keeping:**
  - Churn lags by one month.
  - "Non-Regular" (project) connections count as Project Completed, not churn.
  - TOC vs EOC depends on whether the account has another Started connection.
  - In the Hours report, hours per day = weekly ÷ 5, counted on weekdays only.

## 5. Known legacy bugs (fix them in the rebuild; don't copy them)

- **Security:**
  - Auto-provisioning combined with `access: ANYONE`.
  - `'view'` permission checks always pass.
  - Many report and audit endpoints have no permission check.
  - With `USER_ACCESSING`, every user needs edit access to the Sheet itself.
- **Account activation on Start writes to a tab named `'Clients'`**, but the tab is `Accounts` (VAConnectionService.js:1646, 3857). Accounts may never be auto-activated, unless the live sheet still has an old `Clients` tab. Check the sheet.
- **xlsx exports:**
  - They add a temporary tab to the live database sheet and fetch `export?format=xlsx&gid=…`.
  - Google likely ignores `gid` for xlsx, so the whole workbook may download, including rates and PII. **Not yet confirmed.**
  - Two users exporting at the same time can delete each other's temporary tabs.
- **Terminate button:** the dedicated Terminate path for non-CS-Managers never applies the termination.
- **`updateCustomer`:** with no status in the payload, it defaults to `'Active'`, so a name-only edit writes fake status history.
- **Termination ticket links:** `OriginatingInquiryId` is never written, so the computed status type and the cascades back to the Concern never fire.
- **Replacement check:** it compares against `'Won'` instead of `'Closed - Won'`.
- **Pause/resume:** `pauseVAConnection` toggles any status, including Pending or Terminated.
- **Rate agreement:** a failed payment check leaves the rate already saved.
- **Missing functions:** `createFollowUp` calls `_logActivity`, which doesn't exist (the row is saved but the user sees an error). `saveNavPermissions` calls `saveSettingValue`, which doesn't exist.
- **Stage recalculation:** the guard stops requests moving forward once they reach VA-Client Connection Call (`backfillStuckRequestsMissingVA` exists to repair this).
- **Dates:** a mix of real dates, `YYYY-MM-DD` text and `YYYY-MM` text. `toISOString()` under UTC+8 shifts some dates back a day.
- **Booleans:** stored as `true` or `"TRUE"`; some readers use `=== true` and others `!!`.

## 6. Data migration notes (for the Aug 2026+ test import)

- **Read by header name**, never by column position.
- **Normalise dates** (Date objects, `YYYY-MM-DD` text, `YYYY-MM` text) and booleans.
- **Parse JSON cells:**
  - `Customers.StatusHistory` → `customer_status_logs`
  - Schedule breakdowns
  - `ImportBatches.ErrorLog`
  - ActivityLogs Old/New values
- **Split comma lists:** AccountManagers/Emails, ScheduleDays, ActiveVAConnectionIDs, RelatedVAIds/Names, LastTerminated/ReactivatedDate.
- **Account contacts:** split the flattened Primary/Secondary/Invoice fields into `account_contacts`.
- **Logs:** EntityType appears as both `Client` and `Account`; treat them as the same. VARequest logs live in `RequestActivityLogs`.
- **Denormalised copies:** treat them as caches. Don't import them as truth: Accounts.CustomerName, VAConnections.VAName/CustomerName/Hours/Rate, VARequests.CurrentStage/AssignedVA, Meetings.MeetingTypeLabel.
- **Enum spelling drift:** `Project Based` / `Project-based` / `Non-Regular` / `Casual`.
- **Attendance:** the `AttendanceRecords` tab may mix old daily rows with new monthly rows. Inspect it before importing.
- **Inquiry links:** reconstruct `OriginatingInquiryId` from each Concern's `LinkedTerminationTicketId`.
- **Shared data:** va-management already holds a copy of the legacy customers and accounts in `public.customers` / `public.accounts`. VA records (`VirtualAssistants`) probably belong to va-management's workforce data, not vaa_sys.
