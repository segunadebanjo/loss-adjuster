# CLAUDE.md — Loss Adjuster & Claims Management

Guidance for Claude Code when working in this repository. It is a **standalone app**: it was first built inside the
Green Pacific broker ERP's repository (as `loss-adjuster/`) and moved here with its history on 2026-11-20. It shares no
code, database, accounts or deployment with that ERP and is not to be integrated with it.

Status: **Phases 1-4 done** (2026-11-20): the four planned phases are built. Open items are listed at the end of section 13.
Decisions marked _(assumption)_ were accepted by the user on 2026-11-20 and can still be changed.

---

## 1. What it is

A web app for a Nigerian loss adjusting firm. Insurers (or brokers) instruct the firm on a claim; a loss adjuster
inspects the site, gathers evidence, values the loss (schedule of loss, average clause, excess) and drafts reports; the
Principal Adjuster signs them off; the insurer sees milestones and downloads approved reports and fee notes.

## 2. Stack and layout

npm workspaces monorepo, TypeScript everywhere, Node 20 LTS.

```
(repository root)
  .github/workflows/ci.yml  typecheck, lint, build and tests on every push and pull request
  package.json            workspaces: client, server; root scripts (dev, build, test, lint)
  docker-compose.yml      MySQL 8.0 (port 3306, volume, utf8mb4) + optional Adminer
  client/                 React 18 + Vite + TS + Tailwind + React Router + TanStack Query + Axios + Lucide
    .env.example          VITE_API_URL
    src/app/              router, providers, layout shell, auth guard (RequireRole)
    src/features/<area>/  auth, dashboard, intake, claims, workspace (claim detail tabs), portal (insurer view)
    src/shared/api/       one axios instance (withCredentials, 401 -> refresh -> retry), typed API functions
    src/shared/lib/       money.ts (formatNaira), dates, sla helpers
    src/shared/components ui primitives (Button, Table, Tabs, Modal, StatusBadge, MoneyInput, FileDropzone)
  server/                 Express + TS + Prisma (MySQL) + JWT/bcrypt + Multer + Cloudinary/S3 + PDFKit
    .env.example          DATABASE_URL, JWT secrets, CLOUDINARY_*, AWS_*/S3_*, STORAGE_DRIVER, CORS origin, tax rates
    prisma/schema.prisma  the schema (section 4); prisma/migrations; prisma/seed.ts
    src/app.ts, server.ts app factory (testable without listening) and entry point
    src/config/env.ts     zod-validated env; the process refuses to start on a bad value
    src/middleware/       authenticate, requireRole, validate(zod), errorHandler, rateLimit, upload (multer)
    src/modules/<area>/   <area>.routes.ts (wiring) / <area>.controller.ts (HTTP) / <area>.service.ts (logic + Prisma)
                          / <area>.schema.ts (zod)
    src/lib/              money.ts (kobo maths), claimRef.ts, audit.ts, sla.ts, errors.ts (AppError -> HTTP)
    src/lib/settlement.ts PURE schedule-of-loss / average / excess engine (no Prisma; unit-tested)
    src/lib/feeNote.ts    PURE VAT / WHT maths
    src/storage/          StorageDriver interface; cloudinary.ts, s3.ts; chosen by STORAGE_DRIVER
    src/pdf/              PDFKit builders: preliminaryReport, finalReport, feeNote (data in, Buffer out; no DB)
    tests/                vitest + supertest, against a throwaway MySQL database per run
```

**PDF: PDFKit, not Puppeteer** _(assumption)_. Puppeteer needs Chromium on the host (heavy, fragile on Render/cPanel-style
hosting). PDFKit is pure JS and enough for formal, branded, tabular reports.

## 3. Roles (RBAC)

| Role | Enum | Can |
| --- | --- | --- |
| Admin / Principal Adjuster | `ADMIN` | everything: users, assign/reassign claims, intake, sign off / return reports, fee notes, settle/repudiate |
| Loss Adjuster | `ADJUSTER` | claims **assigned to them** only: inspections, evidence, schedule of loss, draft reports, submit for sign-off |
| Insurer / Broker | `INSURER` | read-only, claims of **their organisation** only: milestones, SLA, **approved** reports and **issued** fee notes |

- Enforcement is on the server: `requireRole(...)` per route **and** row scoping in the service
  (`claimScope(user)` returns a Prisma `where`: ADJUSTER -> `assignedAdjusterId = me`, INSURER -> policy's insurer or
  broker org = my org). A claim outside scope is **404**, not 403, so ids can't be probed. UI hiding is presentation only.
- The role is re-read from the DB on each request (cheap lookup), so deactivating a user or changing a role is immediate.
- INSURER users never see: valuation working notes, internal audit trail, draft reports, adjuster notes, unapproved fees.

## 4. Database schema (Prisma -> MySQL 8)

Conventions: `Int` autoincrement ids; `createdAt`/`updatedAt` on every table; **soft delete** via `deletedAt DateTime?`
on users, organisations, policies, claims, inspections, evidence_files, valuation_items (a Prisma client extension filters
`deletedAt: null` by default); money is `Decimal @db.Decimal(15,2)`; percentages `Decimal @db.Decimal(5,2)`; enums are
Prisma enums (MySQL ENUM). Table names snake_case via `@@map`.

Your requested tables, with the additions in **bold** and why:

- **`organisations`** — id, name, type (`INSURER`, `BROKER`), naicom_licence_no, email, phone, address. _Needed so an
  INSURER user can be scoped to their company's claims; free-text names can't do that reliably._
- `users` — id, full_name, email (unique), password_hash, role (`ADMIN`,`ADJUSTER`,`INSURER`), phone,
  naicom_license_no, cii_qualification (e.g. ACII, AIIN), is_active, **organisation_id** (required for INSURER),
  **last_login_at**.
- **`refresh_tokens`** — id, user_id, token_hash (SHA-256), expires_at, revoked_at, replaced_by_id. _Refresh rotation._
- `policies` — id, policy_number, naicom_uid (unique), **insurer_org_id**, **broker_org_id?**, insurer_name,
  broker_name (kept as printed text), insured_name, insured_contact, policy_type (`MOTOR`,`PROPERTY_FIRE`,
  `MARINE_CARGO`,`OIL_AND_GAS`,`ENGINEERING_CAR`,`GENERAL_ACCIDENT`), sum_insured, excess_amount, excess_percentage,
  start_date, end_date. Unique (insurer_org_id, policy_number).
- `claims` — id, claim_reference (unique, `LA-YYYY-NNNN`), policy_id, assigned_adjuster_id?, date_of_loss,
  date_instructed, loss_state (36 states + FCT enum/list), loss_lga, loss_address, incident_description, status (9 values
  as specified), initial_reserve, recommended_settlement, adjuster_fee, **insurer_claim_no?**, **value_at_risk?**,
  **apply_average** (bool, default true for property-type lines), **settled_amount?**, **closed_at?**,
  **repudiation_reason?**.
- **`claim_sequences`** — year (PK), last_no. Reference allocated by `UPDATE ... last_no = last_no + 1` inside the
  create transaction, so two intakes never get the same number.
- **`claim_status_history`** — claim_id, from_status, to_status, changed_by, reason?, changed_at. _Drives SLA clocks
  and the insurer's milestone timeline; append-only._
- `inspections` — id, claim_id, adjuster_id, scheduled_date, completed_date?, gps_latitude/gps_longitude (DECIMAL 9,6)
  _(instead of one text field, so it can be validated and mapped)_, site_notes, cause_of_loss_verified,
  policy_liability_confirmed, third_party_involvement.
- `evidence_files` — id, claim_id, uploaded_by, file_name, **storage_driver** (`CLOUDINARY`,`S3`), cloud_public_id
  (or S3 key), file_url, **thumbnail_url?**, **mime_type**, **size_bytes**, file_type (`PHOTO`,`DOCUMENT`,`INVOICE`,`VIDEO`),
  category (fixed list: Site Damage Photo, Police Report, Fire Service Report, Waybill/Bill of Lading, Repair
  Estimate/Proforma, Survey Report, Claim Form, Other), caption, **visible_to_insurer** (bool).
- `valuation_items` — id, claim_id, item_description, category (Building/Civil Works, Plant & Machinery, Stock & Contents, Motor Parts,
  Marine Cargo, Labor, Salvage Recovery, Other), claimed_amount, assessed_amount, depreciation_amount,
  betterment_deduction, net_payable (**computed by the server, never accepted from the client**), adjuster_notes,
  **sort_order**.
- **`reports`** — id, claim_id, type (`PRELIMINARY`,`FINAL`), version, status (`DRAFT`,`SUBMITTED`,`RETURNED`,
  `APPROVED`), body sections (JSON: background, circumstances, cause, policy liability, recommendations…), figures
  snapshot (JSON of the settlement computation at submission), drafted_by, submitted_at, reviewed_by, reviewed_at,
  return_reason?, pdf_url?, pdf_sha256?. _Sign-off needs a record; an approved report is frozen (new version to change)._
- **`fee_notes`** — id, claim_id, fee_note_no (`FN-YYYY-NNNN`), professional_fee, expenses (JSON lines: travel,
  photography…), vat_rate, wht_rate, vat_amount, wht_amount, gross_amount, net_payable, status (`DRAFT`,`ISSUED`,`PAID`,
  `CANCELLED`), issued_at, paid_at, pdf_url?.
- **`sla_targets`** — milestone key, target_days, business_days (bool). Seeded _(assumption, editable by admin)_:
  instruction -> inspection 2 working days; instruction -> preliminary report 7 days; documents complete -> final report
  14 days; final submitted -> sign-off 3 working days.
- `audit_logs` — id, claim_id?, user_id?, action, entity_type, entity_id, details (JSON incl. from/to changes),
  ip_address, created_at. Append-only (no update/delete in code). Written in the same Prisma `$transaction` as the change.

## 5. Settlement engine (`server/src/lib/settlement.ts`, pure)

All arithmetic in **integer kobo** (bigint), round half away from zero; converted to/from DECIMAL at the edges.

1. Per line: `net = assessed − depreciation − betterment` (not below 0). `Salvage Recovery` lines are **deducted**.
2. `grossAdjustedLoss = Σ net (non-salvage) − Σ salvage`.
3. **Average (underinsurance)**: if `apply_average` and `value_at_risk > sum_insured`:
   `afterAverage = grossAdjustedLoss × sum_insured / value_at_risk`; else unchanged. Result shows the ratio and the
   reduction so the report can explain it.
4. **Excess**: `excess = max(excess_amount, excess_percentage% × afterAverage)` _(assumption: % applied to the adjusted
   loss after average, which is the common wording; some policies apply it to the claim as presented, so a per-policy
   `excess_basis` can be added if needed)_.
5. `netRecommended = max(0, afterAverage − excess)`, capped at `sum_insured`. Written to `claims.recommended_settlement`.

The engine returns every intermediate figure; the API, the UI table and the PDFs all display that same object.
Unit tests cover: no average, average triggered, fixed vs % excess winning, salvage, rounding, caps, zero/negative lines.

## 6. Fee note maths (`server/src/lib/feeNote.ts`, pure)

`gross = fee + expenses`; `VAT = 7.5% × gross`; `WHT = wht_rate × fee` (on the fee, excluding VAT);
`net payable by insurer = gross + VAT − WHT`. Defaults from env/settings: `VAT_RATE=7.5`, `WHT_RATE=10` _(assumption:
company-to-company professional services; confirm with your tax adviser, and whether WHT should also apply to
reimbursable expenses)_. Rates are copied onto the fee note when created, so a later rate change never alters an issued one.

## 7. Claim workflow

```
NEW_INSTRUCTION -> INSPECTION_SCHEDULED -> UNDER_INVESTIGATION -> PRELIM_REPORT_SUBMITTED -> AWAITING_DOCUMENTS
  -> FINAL_REPORT_DRAFTED -> PENDING_SIGNOFF -> SETTLED | REPUDIATED
```
- Allowed moves live in one table `CLAIM_TRANSITIONS` (server), with who may make each. Some moves are automatic:
  scheduling an inspection -> INSPECTION_SCHEDULED; submitting the final report -> PENDING_SIGNOFF.
- PRELIM_REPORT_SUBMITTED is reached only when the preliminary report is **approved** by ADMIN.
- Sign-off: ADMIN approves (freezes report + figures snapshot, renders and stores the PDF with SHA-256) or returns with a
  reason (report back to DRAFT, claim back to FINAL_REPORT_DRAFTED). An ADMIN can't approve a report they drafted
  unless they're the only admin _(assumption: maker-checker by default, override logged)_.
- SETTLED needs an approved final report; REPUDIATED needs a reason. Both are terminal (reopen = ADMIN, audited).
- As built, see section 13 "Workflow coupling": report actions make three of these moves, not buttons.
- Every move writes `claim_status_history` + `audit_logs` in one transaction.

## 8. API conventions

- Base `/api/v1`. JSON, camelCase. `GET /health` public.
- Auth: `POST /auth/login` -> short-lived access JWT (15 min) in body; refresh token (7 days, rotating, hashed in DB)
  in an `httpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `/api/v1/auth`. `POST /auth/refresh`, `POST /auth/logout`,
  `GET /auth/me`. Access token is sent as `Authorization: Bearer` (no cookie auth on mutating routes, so no CSRF token
  needed). Login rate-limited (5 / 15 min per IP+email). bcrypt cost 12.
- Lists: `?page=1&pageSize=25&sort=-dateInstructed&status=...&adjusterId=...&policyType=...&insurerId=...&from=&to=&q=`
  -> `{ data, meta: { page, pageSize, total } }`.
- Errors: `{ error: { code, message, details? } }`. 400 validation (zod issues in `details`), 401, 403, 404 (incl.
  out-of-scope), 409 conflict / invalid transition, 422 business rule, 500 (no stack in production).
- Money in JSON is a **string** with 2 decimals (`"1250000.00"`), never a float; the client formats with
  `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })` -> `₦1,250,000.00`.
- Dates: ISO `YYYY-MM-DD` for dates, ISO UTC for timestamps; displayed in `Africa/Lagos`.
- Main resources: `/users`, `/organisations`, `/policies` (+ `/policies/verify?naicomUid=`), `/claims`,
  `/claims/:id/{transition,inspections,evidence,valuation-items,settlement,reports,fee-notes,audit,timeline}`,
  `/reports/:id/{submit,approve,return,pdf}`, `/fee-notes/:id/{issue,mark-paid,pdf}`, `/dashboard/kpis`.

## 9. File uploads

- `StorageDriver` interface: `upload(buffer|stream, {folder, mime}) -> {publicId, url, thumbnailUrl}`, `delete`,
  `signedUrl`. `STORAGE_DRIVER=cloudinary|s3`.
- Multer memory storage, limits: images/PDF/DOCX/XLSX 15 MB, video 100 MB, 20 files per request. Allowed types checked
  by **magic bytes** (`file-type`), not by extension/mime header.
- Cloudinary: folder `loss-adjuster/<claimRef>`, `resource_type: auto`, eager thumbnail (400px, `q_auto,f_auto`),
  images re-encoded with `quality: auto`. S3: private bucket, thumbnails skipped, downloads through short-lived signed URLs.
- Delete is a soft delete in MySQL; the cloud object is kept (evidence must not vanish). Insurers only see files marked
  `visible_to_insurer`.

## 10. Dashboard KPIs (all ₦, scoped to the caller)

Active instructions (not SETTLED/REPUDIATED); pending site inspections (scheduled, not completed + NEW_INSTRUCTION with
none); total claimed vs total adjusted (Σ claimed vs Σ net recommended) and **savings** = difference and %; SLA tracker
(per milestone: on time / at risk ≥ 80% of target / breached, from `claim_status_history` + `sla_targets`). Pipeline table
filterable by status, adjuster, line (Motor; Marine = MARINE_CARGO; Oil & Gas; Property = PROPERTY_FIRE + ENGINEERING_CAR
_(assumption)_; General Accident), insurer and date range.

## 11. Commands (once Phase 1 lands)

```sh
docker compose up -d                       # MySQL 8 on :3306
cp server/.env.example server/.env && cp client/.env.example client/.env
npm install                                # all workspaces
npm run db:migrate -w server               # prisma migrate dev
npm run db:seed -w server                  # realistic Nigerian sample data
npm run dev                                # server :4100, client :5174 (Vite proxies /api)
npm test                                   # vitest (server: unit + API against MySQL)
npm run build && npm run lint && npm run typecheck
```
Ports 4100/5174 (not the usual 4000/5173) so this app can run beside other local projects.

**Deployment (Render, one web service):** build `npm ci --include=dev && npm run db:generate -w server && npm run build`,
start `npm run start:prod -w server` (`prisma migrate deploy`, then `prisma/firstStart.ts`, then the server). In
production `app.ts` serves `CLIENT_DIST` (default `../client/dist`) with an SPA fallback for every path outside `/api/` and
`/health`, so the site and API share an origin (no CORS, the refresh cookie stays first-party). `firstStart.ts`: `LOAD_DEMO_DATA=true` runs the seed only
while there are no users (allowed in production only through it, `SEED_IN_PRODUCTION=empty-database`); `ADMIN_EMAIL` +
`ADMIN_PASSWORD` make that email an active ADMIN with that password on every start (create, or restore/re-role/reset,
revoking its sessions; audited `ADMIN_SET_FROM_SETTINGS`). Its errors are logged, never fatal. The CSP allows https
images and media for Cloudinary/S3 links. Details in README.md.

## 12. Build phases

1. **Foundation** — workspaces, docker-compose, env validation, full Prisma schema + first migration, seed (3 insurers
   e.g. fictionalised Lagos insurers, 2 brokers, 1 principal + 4 adjusters with ACII/AIIN, ~10 policies, ~15 claims across
   Motor/Marine/Property/Oil & Gas in Lagos, Rivers, Kano, FCT… at varied statuses), auth API (login/refresh/logout/me,
   RBAC middleware, scoping helper), Login UI + app shell + role-aware nav. Tests: auth, RBAC, scoping.
2. **Claims & dashboard** — claims CRUD + list filters, transitions + status history, instruction intake (policy lookup by
   NAICOM UID or create, excess rules, assign adjuster), users/organisations admin, KPI API, dashboard UI, insurer portal list.
3. **Adjuster workspace** — claim detail tabs (Overview & Policy, Site Inspection, Evidence Gallery, Schedule of Loss,
   Audit Trail), inspections, storage drivers + drag-and-drop uploads, valuation items + settlement engine + live UI.
4. **Sign-off & documents** — report drafting/submission/approval/return, audit trail UI, PDFKit preliminary & final
   reports and fee note (VAT/WHT), insurer downloads, settle/repudiate.

Each phase ends green on build, typecheck, lint and tests, committed and pushed before the next starts.

## 13. As built (versions and things to know)

- **Versions (pinned exactly):** Node 20+, TypeScript 5.9, Express 5 (async errors reach the error handler natively),
  Prisma 6.19 (`url = env("DATABASE_URL")` in the schema; Prisma 7's driver adapters are not used), zod 4, vitest 3.2
  (vitest 4 trips npm's peer resolver), React 18.3, React Router 7 (library mode, `react-router` package), TanStack
  Query 5, Vite 7, Tailwind 4 (`@tailwindcss/vite`, theme tokens in `client/src/index.css`, brand green `brand-*`).
- **Soft delete** is a Prisma client extension in `server/src/lib/prisma.ts`: reads on the soft-delete models add
  `deletedAt: null` unless the `where` names `deletedAt`. **Nested includes are not filtered**: add
  `where: { deletedAt: null }` to an include of one of those relations. Always import `prisma` from `lib/prisma.ts`,
  never `new PrismaClient()` (the seed is the one exception: it must see and wipe everything).
- **Auth:** `modules/auth` (`tokens.ts`, service, controller, routes). Access JWT (HS256, `sub` = user id only, 15 min)
  in memory on the client; refresh token is opaque random bytes, stored as an HMAC (keyed by `JWT_REFRESH_SECRET`) in
  `refresh_tokens`, sent as the httpOnly `la_refresh` cookie on `/api/v1/auth`. Rotation is conditional
  (`updateMany ... revokedAt: null`), so a race can't fork a session; a rotated token reused more than 10 s later
  revokes every session of that user and writes `REFRESH_TOKEN_REUSE` to the audit log. `authenticate` re-reads the
  user per request. Wrong password and unknown email give the same 401 message and timing. Login rate limit counts
  failures only (5 / 15 min per IP + email). Logins, failures and logouts are audited.
- **Client API:** `client/src/shared/api/client.ts` is the only axios instance: attaches the bearer token, on a 401
  does one single-flight `/auth/refresh` and retries; if that fails, `AuthProvider` drops to the sign-in page. On page
  load `AuthProvider` restores the session from the cookie. Role guards (`app/guards.tsx`) and the nav
  (`app/nav.ts`) are presentation only.
- **Claim references:** `lib/claimRef.ts` `allocateClaimReference(tx, year)` (INSERT ... ON DUPLICATE KEY UPDATE inside
  the caller's transaction). The seed numbers claims itself and then writes `claim_sequences`.
- **Seed** (`prisma/seed.ts`) wipes every table, refuses in production; all fictional: 3 insurers (Lagoon Assurance,
  Niger Delta General, Sahel Mutual), 2 brokers, principal `principal@pinnacle-adjusters.example`, 4 adjusters + 1
  inactive, 4 insurer/broker users, 10 policies, 15 claims at every status, inspections, 17 valuation lines. Password:
  `SEED_PASSWORD`. Seeded `recommended_settlement` figures are illustrative; Phase 3's engine recomputes them.
- **Tests** (`server/tests`): `globalSetup.ts` creates `la_test_<timestamp>` on the `TEST_DATABASE_URL` server, runs
  `prisma migrate deploy`, and drops it afterwards; files run one at a time and create their own rows with
  `tests/helpers.ts`. Covered so far: money maths, auth (login, validation, inactive users, forged tokens, rotation and
  reuse detection, logout, rate limit) and claim scoping per role, plus soft delete.
- **Phase 2 (claims, dashboard, intake, admin):**
  - `lib/claimWorkflow.ts` holds `CLAIM_TRANSITIONS` (who may make which move; reason / settled amount needed),
    `STATUS_LABEL` and `LINES` (Motor, Marine = MARINE_CARGO, Oil & Gas, Property = PROPERTY_FIRE + ENGINEERING_CAR,
    General Accident). `claims.service.ts` `moveClaimStatus(tx, actor, claimId, to, opts)` is the only status writer:
    conditional update on the status read (409 if it changed), history row and audit in the caller's transaction.
    **Phase 3/4 actions (scheduling an inspection, approving a report) must call it**, not write `status`. Until then
    the moves are manual buttons. Reopen = ADMIN, closed -> UNDER_INVESTIGATION with a reason; it clears closedAt,
    settledAmount and repudiationReason (the audit keeps them).
  - `buildClaimWhere(user, filters)` is shared by the list and the dashboard and always ANDs `claimScope`. Insurers get
    no `adjusterFee` / `valueAtRisk` / `applyAverage`, `recommendedSettlement` only once SETTLED, and a timeline without
    who moved it or internal reasons (`figuresFor`, `getClaim`). Detail returns `allowedTransitions` and `permissions`
    for the caller; the UI only renders them.
  - Intake (`POST /claims`) takes `policyId` or a new `policy` (created in the same transaction, so a failed intake
    leaves no policy), defaults `applyAverage` on for Property/Fire, CAR and Oil & Gas, and answers 409
    `DUPLICATE_SUSPECTED` when the policy has an open claim with the same date of loss unless `confirmDuplicate`.
    A loss outside the policy period is a warning on the claim, not a refusal. Delete = ADMIN, NEW_INSTRUCTION only,
    soft. `GET /policies/verify?naicomUid=` (UIDs are stored upper-case).
  - Edits: ADMIN all fields; the assigned adjuster only `ADJUSTER_EDITABLE` (site details, value at risk, average);
    closed claims refuse edits (422). Users: an admin can't change their own role or deactivate themselves; an adjuster
    with open claims can't be deactivated or re-roled (409, reassign first); deactivation, role change and a password
    set revoke refresh tokens. Renaming an organisation rewrites the name printed on its policies.
  - SLA: `lib/sla.ts` (pure) works clocks out of status history and inspections; targets are rows in `sla_targets`,
    seeded by the `sla_target_defaults` migration (not the dev seed). Working days skip weekends only, **not Nigerian
    public holidays**. Dashboard (`GET /dashboard/kpis`, same filters as the list) loads the filtered claims and sums in
    kobo in JS; fine for thousands of claims, revisit with SQL aggregates beyond that. "Claimed vs adjusted" compares
    claims that have a figure and a schedule of loss (insurers: settled only); salvage lines are not "claimed".
  - Validation: `lib/validation.ts` (`zMoney`, `zPercent`, `zDate`, `zText`, plain-English defaults via `z.config`).
    The client shows the first message per field (`fieldErrors`). Filters live in the URL (`useClaimFilters`).
  - Tests: `claims.test.ts` (intake, scope, filters, workflow, dashboard), `users.test.ts` (admin rules and a 401 check
    on every route), `sla.test.ts`. 55 in all.
- **Phase 3 (adjuster workspace):**
  - **Settlement engine** `lib/settlement.ts` (pure, `tests/settlement.test.ts`): line net = assessed - depreciation -
    betterment (not below 0; deductions above the assessed amount are refused); a `Salvage Recovery` line is the amount
    recovered and is deducted (no deductions allowed on it); average only when applied **and** value at risk > sum
    insured (no value at risk = not tested, with a warning); excess = greater of fixed and % of the loss after
    average; net not below 0 nor above the sum insured. `valuation/settlementStore.ts` `recomputeSettlement(tx, id)`
    stores `claims.recommended_settlement` (null while there are no lines) and is called after every line change, a
    value-at-risk/average edit on the claim, and a sum-insured/excess edit on the policy (for its open claims). The
    schedule, value at risk and average are frozen at PENDING_SIGNOFF (and closed). The seed computes its figures
    with the same engine. The client never adds money: per-line `deductions` and `totalDeductions` come from the API.
  - **Zod partial + default trap:** `.partial()` keeps `.default()`, so an update schema built from a create schema
    with defaults silently resets omitted fields. Update schemas are built from a base without defaults (policies,
    valuation items); create schemas `.extend` it with the defaults. Same for transforms that turn `undefined` into
    `null` (organisation email). `users.test.ts` "an update changes only the fields sent" pins this.
  - **Inspections** (`/claims/:claimId/inspections`, staff only): scheduling the first one moves NEW_INSTRUCTION ->
    INSPECTION_SCHEDULED, and recording `completedDate` moves INSPECTION_SCHEDULED -> UNDER_INVESTIGATION, both through
    `moveClaimStatus`. Only the principal may send an adjuster other than the claim's. GPS is two DECIMAL(9,6)
    columns; points outside Nigeria's bounding box are flagged, not refused. A completed inspection can't be removed;
    a pending one is cancelled with a reason (soft).
  - **Evidence** (`/claims/:claimId/evidence`): multer memory upload (field `files`, 20 per request, 100 MB cap), then
    the file's **magic bytes** (`file-type`) decide the type: JPG/PNG/WebP/HEIC (15 MB), MP4/MOV/WebM/3GP (100 MB),
    PDF/DOCX/XLSX (15 MB). A batch is all or nothing. Each row stores the SHA-256 of the original. Files go to
    storage first, then rows in one transaction (a DB failure can leave an orphan object). Removing is soft with a
    reason; the stored object is kept. Insurers list only `visibleToInsurer` files; the uploader's "share" box resets
    after each batch so sharing is always deliberate.
  - **Storage** (`src/storage`): `STORAGE_DRIVER=cloudinary|s3|local`. Links are generated per request, never stored:
    Cloudinary uploads as type `authenticated` (original kept unchanged; previews are signed delivery transformations
    `c_fill,q_auto,f_auto`; signed URLs don't expire), S3 uses a private bucket with 1-hour presigned GETs (no
    previews except the image itself), `local` writes under `STORAGE_DIR` and serves `/api/v1/files/<key>` with an
    expiring HMAC (public by mount order, refused in production). `driverFor(row.storageDriver)` keeps old files
    readable after a driver change only for LOCAL; switching between Cloudinary and S3 needs a migration of files.
    **The Cloudinary and S3 drivers have not been run against the live services** (tests cover link signing only);
    test an upload on a real account before going live.
  - Tests: `workspace.test.ts` (inspections, evidence with real PNG/PDF bytes and a disguised HTML file, signed
    links, the schedule of loss end to end). 72 in all.
- **Phase 4 (sign-off, documents, audit):**
  - **Reports** (`modules/reports`, `/claims/:claimId/reports`): sections per type in `REPORT_SECTIONS` (print order,
    required flags). Draft (prefilled from the claim, the previous version, or for a final report the signed-off
    preliminary) -> SUBMITTED (required sections filled; final needs a schedule of loss) -> APPROVED or RETURNED.
    Submitting freezes everything the PDF prints into `reports.figures` (`snapshot`), so later claim edits never
    change what is signed off. Approval renders the PDF once (`pdf/reportPdf.ts`), stores it in `reports.pdf_data`
    (MEDIUMBLOB) with `pdf_sha256`, and every download re-checks the hash (500 `PDF_ALTERED` instead of sending a
    changed file). Maker-checker: the author can't sign off their own report while another active principal exists;
    a sole principal must give a note (`self_approval_note`). Insurers see only APPROVED reports (others are 404).
  - **Workflow coupling:** three moves are `viaReport` in `CLAIM_TRANSITIONS` and refused by `/transition` (409 with
    where to do it): UNDER_INVESTIGATION -> PRELIM_REPORT_SUBMITTED (approving the preliminary report),
    -> PENDING_SIGNOFF (submitting the final report, passing through FINAL_REPORT_DRAFTED if needed), and
    PENDING_SIGNOFF -> FINAL_REPORT_DRAFTED (returning it). SETTLED needs an APPROVED final report. After sign-off the
    claim stays PENDING_SIGNOFF until settled; the SIGNOFF SLA clock ends at the sign-off (`signedOffAt`).
  - **Fee notes** (`modules/fee-notes`, principal only to write; adjusters read; insurers see ISSUED/PAID): maths in
    `lib/feeNote.ts` (VAT on fee + expenses, WHT on the fee only, rates copied onto the note when drafted). The
    `FN-YYYY-NNNN` number is allocated at issue (`document_sequences`), so issued numbers have no gaps; drafts carry a
    hidden `DRAFT-...` key. Issue freezes the PDF like a report. Cancelled notes keep number and PDF.
    `claims.adjuster_fee` = sum of ISSUED/PAID professional fees. Allowed on closed claims (fees follow settlement).
  - **PDFs** (`src/pdf`, PDFKit): pure builders (data in, Buffer out, no DB, date passed in). Money prints as
    "NGN 1,234.00" because the built-in PDF fonts have no naira sign; amounts in words via `lib/amountInWords.ts`.
    Previews are rendered on demand with a DRAFT watermark. Firm details come from `FIRM_*` settings (`lib/firm.ts`);
    the defaults are `[placeholders]`, and principals see a banner until they are replaced. `GET /meta/firm`.
  - **Audit trail** `GET /claims/:claimId/audit` (staff): the claim's entries plus its policy's, newest first; IPs
    only for principals. The client labels actions and from/to changes (`AuditTab.tsx`).
  - The seed builds reports and fee notes with the same snapshot and PDF code, matching each claim's status.
  - Tests: `reports.test.ts` (both reports end to end, maker-checker, tamper detection, fee notes, audit),
    `feeNote.test.ts` (VAT/WHT and amounts in words). 88 in all.
- **Open items / not built:** WHT rate and its application to expenses need the firm's tax adviser's confirmation;
  SLA working days ignore public holidays; Cloudinary and S3 have not been exercised against live accounts; users
  can't change their own password (an admin sets it); no email notifications.

## 14. Rules for every change

- No float money anywhere; use `lib/money.ts`. Server computes every derived figure; client values are never trusted.
- Every mutating route: `requireRole` + scope check + zod validation + audit entry in the same transaction.
- Approved reports and issued fee notes are immutable; changes are new versions.
- Never commit `.env`, credentials or real client data. Seed data is fictional.
