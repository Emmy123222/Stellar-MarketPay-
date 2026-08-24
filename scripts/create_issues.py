#!/usr/bin/env python3
"""
Create the Stellar MarketPay backlog on GitHub Issues.

Every issue below is grounded in a finding reproduced against this repo:
type-check output, jest runs, eslint, npm audit, and the migration files on
disk. Nothing here is speculative filler.

Usage:
    python3 scripts/create_issues.py --dry-run     # print, create nothing
    python3 scripts/create_issues.py --push        # create on GitHub

Auth comes from the `gh` CLI (gh auth status), so no token is handled here.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time

REPO = "Emmy123222/Stellar-MarketPay-"

# Labels that already exist on the repo — we never invent new ones.
BE, FE, SC = "backend", "frontend", "smart contract"
BUG, ENH, DOC = "bug", "enhancement", "documentation"
TEST, SEC, DEVOPS = "testing", "security", "devops"
DB, PERF, UX = "database", "performance", "ui/ux"
EASY, MED, HARD = "good first issue", "🟡 Intermediate", "🔴 Advanced"

issues: list[dict] = []


def add(title: str, body: str, labels: list[str]) -> None:
    issues.append({"title": title, "body": body.strip(), "labels": labels})


def ctx(lines: list[str]) -> str:
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Migration version collisions  (verified against backend/src/db/migrations)
# ─────────────────────────────────────────────────────────────────────────────
MIG_DUPES = [("V22", 10), ("V12", 5), ("V13", 3), ("V19", 3), ("V6", 3),
             ("V10", 2), ("V17", 2), ("V20", 2), ("V21", 2), ("V3", 2), ("V5", 2)]

add(
    "[DB] Migration version numbers collide — ordering is non-deterministic",
    ctx([
        "## Problem",
        "",
        "`backend/src/db/migrations/` reuses the same version prefix across unrelated",
        "migrations. Counting `*.up.sql` files by prefix:",
        "",
        "```",
        *[f"  {v}  x{n}" for v, n in MIG_DUPES],
        "```",
        "",
        "## Why this matters",
        "",
        "`backend/src/db/migrate.js` sorts with:",
        "",
        "```js",
        ".sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));",
        "```",
        "",
        "Within a colliding version the order falls back to **alphabetical filename**,",
        "which has nothing to do with the order the migrations were written or the",
        "dependencies between them. A migration that adds a column can therefore run",
        "after one that indexes it.",
        "",
        "Worse, progress is tracked by `MAX(version)`:",
        "",
        "```js",
        'const { rows } = await pool.query("SELECT MAX(version)::int AS version FROM schema_migrations");',
        "```",
        "",
        "so once *any* `V22` migration is applied the schema reports version 22 and the",
        "remaining nine are at risk of being treated as already-applied.",
        "",
        "## Suggested fix",
        "",
        "Renumber to a strictly increasing sequence (or switch to timestamp prefixes),",
        "and add a startup assertion that version numbers are unique.",
        "",
        "Sub-issues track each colliding prefix individually.",
    ]),
    [BUG, DB, BE, HARD],
)

for ver, count in MIG_DUPES:
    add(
        f"[DB] Renumber the {count} migrations sharing prefix `{ver}`",
        ctx([
            f"Part of the migration-numbering cleanup.",
            "",
            f"`{ver}` is used by **{count}** different migrations in",
            "`backend/src/db/migrations/`. List them with:",
            "",
            "```bash",
            f"ls backend/src/db/migrations/{ver}__*.up.sql",
            "```",
            "",
            "## Task",
            "",
            f"- Assign each of the {count} migrations a unique, strictly increasing version",
            "- Rename the matching `.down.sql` file",
            "- Confirm `npm run migrate` then `npm run migrate:rollback` round-trips cleanly",
            "",
            "Do not renumber a migration that is already applied in production without a",
            "backfill plan for `schema_migrations`.",
        ]),
        [BUG, DB, BE, MED],
    )

# ─────────────────────────────────────────────────────────────────────────────
# 2. Failing backend test suites  (npx jest --selectProjects unit)
# ─────────────────────────────────────────────────────────────────────────────
SUITES = [
    ("src/db/pool.retry.test.js", "pool retry/backoff"),
    ("src/db/migrationValidation.test.js", "migration validation"),
    ("src/middleware/rateLimiter.test.js", "rate limiter"),
    ("src/routes/aiScorer.test.js", "AI job scorer route"),
    ("src/routes/auth.test.js", "SEP-10 auth route"),
    ("src/routes/contributors.test.js", "contributors route"),
    ("src/routes/jobs.boost.test.js", "job boost route"),
    ("src/services/applicationService.test.js", "application service"),
    ("src/services/disputeService.test.js", "dispute service"),
    ("src/services/jobService.test.js", "job service"),
    ("src/services/jobTimeline.test.js", "job timeline"),
    ("src/services/profileService.test.js", "profile service"),
    ("src/services/stellarServiceKey.test.js", "Stellar service key"),
    ("src/services/websocket.test.js", "websocket service"),
    ("src/services/websocket.chaos.test.js", "websocket chaos"),
    ("src/tests/adminUserManagement.test.js", "admin user management"),
    ("src/tests/contract/api.contract.test.js", "API contract"),
    ("src/tests/contract/api.contract.expanded.test.js", "expanded API contract"),
    ("src/tests/contract/error-shape.test.js", "error shape contract"),
    ("tests/csrf.test.js", "CSRF protection"),
    ("tests/pool.test.js", "pg pool"),
    ("tests/savedSearchAlert.test.js", "saved-search alerts"),
    ("tests/turrets.test.js", "turrets"),
    ("__tests__/health.test.js", "health endpoint"),
]
for path, desc in SUITES:
    add(
        f"[Test] Fix failing suite: `{path}`",
        ctx([
            f"The {desc} suite fails on `main`.",
            "",
            "## Reproduce",
            "",
            "```bash",
            "cd backend && npm ci",
            f"npx jest {path}",
            "```",
            "",
            "## Context",
            "",
            "Across the unit project **113 tests fail in 23 suites**. The single biggest",
            "cause is `Error: invalid csrf token` — CSRF protection is working correctly,",
            "but the supertest requests never fetch a token first.",
            "",
            "The bootstrap route is exempt, so a test can obtain one:",
            "",
            "```js",
            'const res = await request(app).get("/api/auth/csrf-token");',
            'const cookie = res.headers["set-cookie"].find(c => c.startsWith("csrf-token="));',
            'await request(app).post(url).set("Cookie", cookie).set("x-csrf-token", res.body.csrfToken);',
            "```",
            "",
            "A shared helper in `src/testUtils/` would fix most suites at once — see the",
            "umbrella issue for the CSRF test harness.",
        ]),
        [BUG, TEST, BE, MED],
    )

add(
    "[Test] Add a shared CSRF-aware supertest helper",
    ctx([
        "## Problem",
        "",
        "Roughly half of the 113 failing backend tests fail with `invalid csrf token`.",
        "Each suite hand-rolls its supertest calls and none of them fetch a token.",
        "",
        "## Proposal",
        "",
        "Add `backend/src/testUtils/authedRequest.js` exposing something like:",
        "",
        "```js",
        "const agent = await authedAgent(app, { publicKey });  // JWT + CSRF wired",
        'await agent.post("/api/jobs").send(payload).expect(201);',
        "```",
        "",
        "It should fetch `GET /api/auth/csrf-token`, retain the `csrf-token` cookie, and",
        "set `x-csrf-token` on every mutating request. Then migrate the failing suites",
        "onto it.",
        "",
        "This is the highest-leverage testing task in the backlog.",
    ]),
    [TEST, BE, ENH, HARD],
)

# ─────────────────────────────────────────────────────────────────────────────
# 3. Frontend type errors  (npx tsc --noEmit → 263 errors in 26 files)
# ─────────────────────────────────────────────────────────────────────────────
TS_FILES = [
    ("pages/dashboard.tsx", 128), ("pages/assessments/project/[id].tsx", 30),
    ("__tests__/wallet-account-monitor.test.tsx", 19), ("pages/jobs/[id].tsx", 19),
    ("pages/assessments/create.tsx", 15), ("pages/assessments/project/[id]/results.tsx", 13),
    ("components/Navbar.tsx", 10), ("pages/jobs/index.tsx", 3),
    ("lib/contractErrors.ts", 3), ("lib/api/notifications.ts", 2),
    ("components/TimeTracker.tsx", 2), ("components/PostJobForm.tsx", 2),
    ("components/FreelancerCard.tsx", 2), ("components/FeeEstimationModal.tsx", 2),
    ("components/EditProfileForm.tsx", 2), ("pages/_app.tsx", 1),
    ("lib/stellar.ts", 1), ("hooks/usePushNotifications.ts", 1),
    ("components/WalletAccountMonitor.tsx", 1), ("components/ProposalComparison.tsx", 1),
    ("components/MessageThread.tsx", 1), ("components/JobCard.tsx", 1),
    ("components/BoostJobModal.tsx", 1), ("stories/NotificationBell.stories.tsx", 1),
    ("stories/FreelancerCard.stories.tsx", 1),
    ("__tests__/snapshots/staticComponents.snap.test.tsx", 1),
]
for path, n in TS_FILES:
    diff = EASY if n <= 3 else (MED if n <= 30 else HARD)
    add(
        f"[Frontend] Fix {n} TypeScript error{'s' if n > 1 else ''} in `{path}`",
        ctx([
            f"`{path}` accounts for **{n}** of the 263 errors reported by `npm run type-check`.",
            "",
            "## Reproduce",
            "",
            "```bash",
            "cd frontend && npm ci",
            f"npx tsc --noEmit 2>&1 | grep '{path}'",
            "```",
            "",
            "## Background",
            "",
            "These errors were previously **masked**: `pages/dashboard.tsx` and",
            "`components/Navbar.tsx` had JSX syntax errors, and TypeScript stops at parse",
            "failures instead of type-checking. With the syntax fixed, the real errors are",
            "now visible.",
            "",
            "The dominant kind is `TS2304: Cannot find name` (143 of 263) — identifiers",
            "used without being imported or declared, e.g. `shortenAddress`, `mounted`,",
            "`toggleDarkMode`, `i18n` in `Navbar.tsx`.",
            "",
            "`npm run type-check` and `npm run build` stay red until these are cleared.",
        ]),
        [BUG, FE, diff],
    )

add(
    "[Frontend] Add missing `@types/jest-axe` dev dependency",
    ctx([
        "`__tests__/accessibility.test.tsx` fails to type-check:",
        "",
        "```",
        "error TS7016: Could not find a declaration file for module 'jest-axe'.",
        "error TS2339: Property 'toHaveNoViolations' does not exist on type 'JestMatchers<any>'.",
        "```",
        "",
        "## Fix",
        "",
        "```bash",
        "cd frontend && npm i -D @types/jest-axe",
        "```",
        "",
        "Then confirm `npm run type-check` no longer reports the accessibility test.",
    ]),
    [BUG, FE, TEST, EASY],
)

# ─────────────────────────────────────────────────────────────────────────────
# 4. Verified defects and dead wiring found while getting CI to run
# ─────────────────────────────────────────────────────────────────────────────
add(
    "[Backend] Expose the deliverable-hash endpoint — service exists, no route",
    ctx([
        "`escrowService.submitDeliverableHash()` is implemented and exported, and the",
        "Soroban contract has the matching entry point, but **no HTTP route calls it**:",
        "",
        "```bash",
        "grep -rn 'submitDeliverableHash' backend/src/routes/   # no results",
        "```",
        "",
        "The import in `routes/escrow.js` was dangling and has been removed. The feature",
        "from PR #659 (Deliverable Hash Verification) is therefore unreachable from the API.",
        "",
        "## Task",
        "",
        "Add `POST /api/escrow/:jobId/deliverable-hash`, guarded so only the assigned",
        "freelancer may submit, and wire the frontend to it.",
    ]),
    [BUG, BE, ENH, MED],
)

add(
    "[Backend] Escrow extension endpoints were never implemented",
    ctx([
        "`routes/escrow.js` contained handlers calling `requestEscrowExtension()` and",
        "`approveEscrowExtension()`. Neither function exists anywhere in the codebase, so",
        "both routes threw `ReferenceError` on every call. They have been removed.",
        "",
        "The supporting pieces **do** exist:",
        "",
        "- `backend/src/db/migrations/V19__escrow_extensions.up.sql` creates `escrow_extensions`",
        "- the contract implements `request_extension` / `approve_extension`",
        "",
        "## Task",
        "",
        "Implement the two service functions against the existing table and contract",
        "methods, then restore the routes:",
        "",
        "- `POST /api/escrow/:jobId/extend` — requester proposes a new timeout",
        "- `POST /api/escrow/:jobId/extend/approve` — counterparty approves",
        "",
        "Enforce that the approver is the party that did *not* request the extension.",
    ]),
    [ENH, BE, SC, HARD],
)

add(
    "[Backend] `verify-freelancer` had an unrelated handler body pasted over it",
    ctx([
        "`POST /api/escrow/verify-freelancer` validated `freelancerAddress`, then ran the",
        "body of the *extension request* handler — referencing `newTimeoutLedger`,",
        "`jobId` and `requestedBy`, none of which exist in that scope. It never called",
        "`verifyFreelancerAccount`, despite that being imported.",
        "",
        "Fixed to do what its doc comment says. This issue tracks **adding a regression",
        "test** so it cannot silently rot again:",
        "",
        "- 200 + `exists: true` for a funded testnet account",
        "- 400 for a malformed address",
        "- 400 when Horizon returns 404",
    ]),
    [TEST, BE, EASY],
)

add(
    "[Backend] Two competing CSRF token mechanisms write the same cookie",
    ctx([
        "There are two unrelated implementations both writing the `csrf-token` cookie:",
        "",
        "1. `middleware/csrf.js` — `csrf-csrf`, HMAC-signed, validated by the middleware",
        "2. `services/authTokens.js` — `createCsrfToken()`, a raw random value, written by",
        "   `setAuthCookies()` on every login and refresh",
        "",
        "The raw token from (2) cannot be validated by (1), so immediately after login the",
        "cookie holds a value the middleware rejects. It only recovers because clients are",
        "expected to call `GET /api/auth/csrf-token` afterwards.",
        "",
        "## Task",
        "",
        "Delete `createCsrfToken()` and have `setAuthCookies()` mint the token through",
        "`generateCsrfToken(req, res)` so login/refresh issue a genuinely valid token.",
    ]),
    [BUG, SEC, BE, MED],
)

add(
    "[Backend] Accepted-bid escrow amount is never passed to `updateJobEscrowId`",
    ctx([
        "`jobService.updateJobEscrowId(jobId, escrowContractId, { amount })` uses `amount`",
        "to record the escrow at the **accepted bid** rather than the original budget —",
        "the fix from #983 / #850.",
        "",
        "But no caller supplies it. `routes/jobs.js` calls it with two arguments:",
        "",
        "```js",
        "const job = await updateJobEscrowId(req.params.id, escrowContractId);",
        "```",
        "",
        "so the escrow row always falls back to `job.budget` and #983 has no effect in",
        "practice. (A wrapper was also dropping the options bag entirely; that part is",
        "fixed.)",
        "",
        "## Task",
        "",
        "Look up the accepted application's bid amount and pass it through.",
    ]),
    [BUG, BE, DB, MED],
)

add(
    "[Repo] `packages/backend` contains an unrelated airline-booking app",
    ctx([
        "`packages/backend/src/app.ts` imports routes for flights, bookings, refunds,",
        "insurance, group bookings, check-in and journeys:",
        "",
        "```ts",
        "import { createFlightRoutes } from './api/routes/flights';",
        "import { bookingRoutes } from './api/routes/bookings';",
        "import { insuranceRoutes } from './api/routes/insurance';",
        "import checkinRoutes from './api/routes/checkin';",
        "```",
        "",
        "None of those files exist in this repo, and none of it relates to a freelance",
        "marketplace. The package cannot build.",
        "",
        "The only genuine MarketPay code under it is `api/routes/messages.ts` and",
        "`utils/logger.ts`, from the in-app messaging PR (#920) and the request-id",
        "logging PR (#988).",
        "",
        "## Task",
        "",
        "Salvage the messaging + logger code into `backend/`, then delete the rest.",
    ]),
    [BUG, BE, HARD],
)

add(
    "[Docs] ROADMAP.md is badly out of date",
    ctx([
        "`ROADMAP.md` still lists these as unstarted, each marked *“Placeholder — Contribute here!”*:",
        "",
        "- v1.2 Escrow Contract",
        "- v1.3 Messaging",
        "- v1.4 Reputation System",
        "- v1.5 Search & Discovery",
        "- v2.0 Multi-Currency & Milestones",
        "- v2.1 DAO Governance",
        "",
        "All six are built and merged — USDC support (#947), in-app messaging (#920),",
        "ratings, job search (#934), milestone escrow, and the DAO arbitrator registry",
        "are all in `main`, and CHANGELOG.md documents them.",
        "",
        "New contributors reading ROADMAP.md will pick up work that is already done.",
        "",
        "## Task",
        "",
        "Rewrite it against the actual state of `main` and add a genuine forward-looking",
        "section.",
    ]),
    [DOC, EASY],
)

add(
    "[Repo] Two migration directories exist; only one is used",
    ctx([
        "- `backend/migrations/` — 2 files (`015_add_push_subscriptions.sql`, `016_add_onboarding_progress.sql`)",
        "- `backend/src/db/migrations/` — 97 files, the ones `migrate.js` actually loads",
        "",
        "The two files in the first directory are never executed, so `push_subscriptions`",
        "and `onboarding_progress` may be missing from a freshly migrated database while",
        "the code expects them.",
        "",
        "## Task",
        "",
        "Confirm whether those tables are created elsewhere (`schema.sql`?). If not, port",
        "both into `src/db/migrations/` with proper version numbers and `.down.sql` files,",
        "then delete `backend/migrations/`.",
    ]),
    [BUG, DB, BE, MED],
)

# ─────────────────────────────────────────────────────────────────────────────
# 5. Route test coverage  (routes with no test file anywhere)
# ─────────────────────────────────────────────────────────────────────────────
UNTESTED_ROUTES = [
    ("admin2fa", "admin TOTP enrolment and verification"),
    ("admin", "admin dashboard, user moderation, reports"),
    ("applications", "proposal submit / withdraw / accept"),
    ("assessments", "skill and project assessments"),
    ("audit", "audit-log querying"),
    ("certificates", "skill certificates"),
    ("dao", "governance proposals and voting"),
    ("developer", "developer API keys"),
    ("disputes", "dispute filing and evidence upload"),
    ("escrow", "escrow release, refund, milestones"),
    ("insights", "platform insights summary"),
    ("invitations", "direct job invitations"),
    ("messageRoutes", "encrypted messaging"),
    ("nft", "NFT completion certificates"),
    ("onboarding", "first-run onboarding progress"),
    ("priceAlerts", "XLM price alerts"),
    ("profiles", "freelancer and client profiles"),
    ("progress", "job progress updates"),
    ("proposalTemplates", "reusable proposal templates"),
    ("ratings", "post-job ratings"),
    ("referrals", "referral tracking and payouts"),
    ("savedSearches", "saved job searches"),
    ("scope", "scope negotiation sessions"),
    ("timeEntries", "time tracking and invoices"),
    ("transactions", "transaction history"),
    ("verification", "identity verification"),
    ("webhooks", "outbound webhooks"),
]
for name, desc in UNTESTED_ROUTES:
    add(
        f"[Test] Add route tests for `src/routes/{name}.js`",
        ctx([
            f"`backend/src/routes/{name}.js` handles {desc} and has **no test file**.",
            "",
            "## Scope",
            "",
            "Add `backend/src/routes/" + name + ".test.js` covering, per endpoint:",
            "",
            "- the happy path with a valid payload",
            "- authentication / authorisation rejection where the route is guarded",
            "- validation failure (400) for a malformed body",
            "- the not-found path where the route takes an id",
            "",
            "## Notes",
            "",
            "Mock the pool with `src/testUtils/pgMock.js`, as the existing service tests do.",
            "Mutating requests need a CSRF token — see the shared-helper issue.",
            "",
            "Good first issue: pick one route and cover it end to end.",
        ]),
        [TEST, BE, EASY],
    )

# ─────────────────────────────────────────────────────────────────────────────
# 6. Dependency vulnerabilities  (npm audit, backend)
# ─────────────────────────────────────────────────────────────────────────────
VULNS = [
    ("js-yaml", "high", "Quadratic CPU consumption in `!!omap` resolution (3.x)"),
    ("nanoid", "high", "Custom generators can loop indefinitely for non-integer sizes"),
    ("dompurify", "moderate", "`IN_PLACE` hook removal leaves a detached subtree"),
    ("qs", "moderate", "Remotely triggerable DoS — `qs.stringify` crash"),
    ("bull", "moderate", "Vulnerable transitive `uuid`"),
    ("@bull-board/api", "moderate", "Vulnerable transitive `@bull-board/ui`"),
    ("@bull-board/express", "moderate", "Vulnerable transitive `@bull-board/api`"),
    ("@bull-board/ui", "moderate", "Vulnerable transitive `@bull-board/api`"),
]
for pkg, sev, detail in VULNS:
    add(
        f"[Security] Resolve {sev} advisory in `{pkg}`",
        ctx([
            f"`npm audit` in `backend/` reports a **{sev}** advisory for `{pkg}`.",
            "",
            f"> {detail}",
            "",
            "## Reproduce",
            "",
            "```bash",
            "cd backend && npm audit",
            "```",
            "",
            "## Task",
            "",
            "Upgrade the package (or the parent that pulls it in). If no fixed version",
            "exists, document why the risk is acceptable and add it to the audit exception",
            "list so CI stays meaningful.",
            "",
            "The `Security` workflow fails the build on **high** advisories in production",
            "dependencies, so high-severity items block CI.",
        ]),
        [SEC, BE, MED],
    )

add(
    "[Security] Replace `multer@1.x` — unmaintained and vulnerable",
    ctx([
        "`npm ci` in `backend/` warns:",
        "",
        "```",
        "npm warn deprecated multer@1.4.5-lts.2: Multer 1.x is impacted by a number of",
        "vulnerabilities, which have been patched in 2.x.",
        "```",
        "",
        "Multer handles **file uploads for dispute evidence** (`routes/disputes.js`), so",
        "this is directly on an untrusted input path.",
        "",
        "## Task",
        "",
        "Upgrade to `multer@^2`, adjust for the breaking changes, and confirm evidence",
        "upload still works end to end (size limits, MIME allow-list, IPFS pin).",
    ]),
    [SEC, BE, MED],
)

add(
    "[Security] Audit for undeclared transitive dependencies",
    ctx([
        "`backend/src/validators/index.js` does `require(\"zod\")`, but `zod` was never",
        "listed in `backend/package.json` — it resolved only because another package",
        "happened to pull it in. That has been fixed by declaring it explicitly.",
        "",
        "## Task",
        "",
        "Sweep both workspaces for the same class of bug — any module `require`d or",
        "`import`ed by our own source that is not a declared dependency. A tool such as",
        "`depcheck` will find them:",
        "",
        "```bash",
        "npx depcheck backend",
        "npx depcheck frontend",
        "```",
        "",
        "Any hit is a latent production break waiting for a transitive dependency to drop it.",
    ]),
    [SEC, BE, FE, MED],
)

# ─────────────────────────────────────────────────────────────────────────────
# 7. Soroban contract
# ─────────────────────────────────────────────────────────────────────────────
add(
    "[Contract] CRITICAL: `lib.rs` does not compile — unbalanced braces",
    ctx([
        "## Problem",
        "",
        "`contracts/marketpay-contract/src/lib.rs` has **two extra closing braces**. The",
        "crate does not build, so `cargo test`, `cargo clippy` and the WASM release build",
        "all fail, and the contract cannot be deployed.",
        "",
        "## Evidence",
        "",
        "`cargo fmt --check` refuses to parse the file:",
        "",
        "```",
        "error: unexpected closing delimiter: `}`",
        "    --> src/lib.rs:3091:1",
        "     |",
        " 378 | impl MarketPayContract {",
        "     |                        - this delimiter might not be properly closed...",
        "```",
        "",
        "Counting braces directly (comments and string literals stripped) agrees — final",
        "depth is **-2**, and depth first goes negative at line **3072**:",
        "",
        "```",
        "line 3071: depth -> 0     <- impl MarketPayContract closes here (too early)",
        "line 3072: depth -> -1    <- extra brace",
        "```",
        "",
        "## Consequence",
        "",
        "Functions defined after 3072 — including `get_evidence_cids` at line 3085 — sit",
        "**outside** `impl MarketPayContract` and are not part of the contract at all.",
        "",
        "## Task",
        "",
        "Work out which brace is spurious around 3071–3072, restore the intended nesting,",
        "and confirm:",
        "",
        "```bash",
        "cd contracts/marketpay-contract",
        "cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test",
        "cargo build --target wasm32v1-none --release",
        "```",
        "",
        "Nothing else in the contract can be verified until this lands.",
    ]),
    [BUG, SC, HARD],
)

add(
    "[Contract] Add `rlib` to `crate-type` so integration tests can link",
    ctx([
        "`contracts/marketpay-contract/Cargo.toml` declares:",
        "",
        "```toml",
        "[lib]",
        'crate-type = ["cdylib"]',
        "```",
        "",
        "With `cdylib` alone the crate cannot be linked by an external test target, so",
        "`tests/` integration tests are impossible and everything has to live in-module.",
        "",
        "## Task",
        "",
        'Change to `crate-type = ["cdylib", "rlib"]` — the standard Soroban layout — and',
        "verify the release WASM size is unchanged.",
    ]),
    [SC, TEST, EASY],
)

add(
    "[Contract] Split the 4,641-line `lib.rs` into modules",
    ctx([
        "`src/lib.rs` is 4,641 lines holding the entire contract: storage keys, data",
        "structures, escrow lifecycle, milestones, disputes, governance, sealed-bid",
        "auctions and admin controls.",
        "",
        "The section banners already mark the seams:",
        "",
        "```",
        "// ─── Storage keys ───",
        "// ─── Data structures ───",
        "// ─── Escrow lifecycle ───",
        "// ─── Upgrade & versioning ───",
        "```",
        "",
        "## Task",
        "",
        "Split into `storage.rs`, `types.rs`, `escrow.rs`, `milestones.rs`, `disputes.rs`,",
        "`governance.rs`, `auction.rs`, `admin.rs`, keeping the `#[contractimpl]` surface",
        "identical. The brace bug above is a direct symptom of a file this size.",
        "",
        "Blocked by the compile fix.",
    ]),
    [SC, ENH, HARD],
)

add(
    "[Contract] Fuzz targets exist but nothing runs them",
    ctx([
        "`contracts/marketpay-contract/fuzz/fuzz_targets/` contains three targets:",
        "",
        "- `fuzz_create_escrow.rs`",
        "- `fuzz_release_escrow.rs`",
        "- `fuzz_timeout_refund.rs`",
        "",
        "No workflow invokes them, so they have never guarded a PR.",
        "",
        "## Task",
        "",
        "Add a `fuzz.yml` workflow running each target for ~60s on PRs that touch",
        "`contracts/**`, with `fail-fast: false` so one crash does not hide the others.",
        "For a contract custodying escrowed funds this is high-value coverage.",
    ]),
    [SC, TEST, DEVOPS, MED],
)

CONTRACT_AREAS = [
    ("sealed-bid auction", "commit_budget / reveal_budget / submit_bid_commitment / close_bidding / reveal_bid",
     "a bid revealed with a mismatched nonce, reveal before close, and double-reveal"),
    ("milestone release", "release_milestone / reject_milestone / disputeMilestone",
     "releasing the same milestone twice, releasing out of order, and percentages that do not sum to 100"),
    ("dispute bond", "set_dispute_bond / raise_dispute / resolve_dispute",
     "raising a dispute without posting the bond, and bond refund on a favourable ruling"),
    ("freeze / unfreeze", "freeze_contract / unfreeze_contract / set_unfreeze_threshold",
     "unfreezing below the M-of-N threshold and duplicate admin signatures"),
    ("timeout refund", "timeout_refund / get_timeout_ledger / set_default_timeout_seconds",
     "refunding before the timeout, and refunding after work has started"),
    ("platform fee & referrals", "set_platform_fee_bps / set_max_referrer_bonus_xlm",
     "fee plus referrer bonus exceeding the escrow amount, and the admin bonus cap"),
    ("governance", "create_proposal / cast_vote / resolve_proposal",
     "double voting, voting after resolution, and tie-breaking"),
    ("upgrade path", "upgrade / get_version",
     "upgrade by a non-admin, and state surviving a WASM swap"),
]
for area, fns, cases in CONTRACT_AREAS:
    add(
        f"[Contract] Expand test coverage for {area}",
        ctx([
            f"The {area} logic (`{fns}`) needs adversarial test coverage.",
            "",
            "## Cases to add",
            "",
            f"At minimum: {cases}.",
            "",
            "## Where",
            "",
            "Add to `src/test.rs` (or a dedicated module once `lib.rs` is split). Snapshot",
            "output lands in `test_snapshots/` automatically.",
            "",
            "```bash",
            "cd contracts/marketpay-contract && cargo test",
            "```",
            "",
            "Blocked by the `lib.rs` compile fix.",
        ]),
        [SC, TEST, MED],
    )

add(
    "[Contract] Wire the Certora specification into CI",
    ctx([
        "`contracts/certora/escrow.spec` and `config.conf` exist but no workflow runs the",
        "prover, so the formal properties are never checked.",
        "",
        "## Task",
        "",
        "Add a job (nightly or on `contracts/**` changes) that runs Certora and fails on a",
        "violated rule. Document how to get a prover key in `docs/formal-verification.md`.",
    ]),
    [SC, SEC, DEVOPS, HARD],
)

add(
    "[Contract] `arbitrator-registry` has only 11 tests and no fuzzing",
    ctx([
        "`contracts/arbitrator-registry/src/lib.rs` carries 11 `#[test]` functions and no",
        "fuzz targets, despite gating **who may resolve disputes** — and therefore who can",
        "move escrowed funds.",
        "",
        "## Task",
        "",
        "Cover registration, removal, DAO-authorised updates, and unauthorised-caller",
        "rejection. Add the crate to the `cargo audit` and clippy matrix in CI.",
    ]),
    [SC, TEST, SEC, MED],
)

# ─────────────────────────────────────────────────────────────────────────────
# 8. Dead wiring surfaced by eslint (56 warnings, several are real gaps)
# ─────────────────────────────────────────────────────────────────────────────
DEAD = [
    ("src/services/priceAlertService.js", "cleanupTriggeredAlerts",
     "defined and never called, so triggered alerts are never pruned and the table grows without bound"),
    ("src/routes/admin.js", "getApiKeyUsageStats",
     "imported but never used — the admin API-key usage view appears to be unreachable"),
    ("src/graphql/schema.js", "createLoaders",
     "imported but never used, so GraphQL resolvers likely run without DataLoader batching (N+1 queries)"),
    ("src/graphql/index.js", "validateSchema / parse / validate",
     "imported from graphql but unused — query validation may not be running"),
    ("src/services/recurringEscrowService.js", "logContractInteraction",
     "imported but never called, so recurring-escrow actions are missing from the contract audit log"),
    ("src/routes/assessments.js", "correctAnswer",
     "destructured and never used — check the grading path actually compares against it"),
]
for path, sym, why in DEAD:
    add(
        f"[Backend] Dead wiring: `{sym}` unused in `{path}`",
        ctx([
            f"`npm run lint` reports `{sym}` as unused in `{path}`.",
            "",
            f"This looks like a real gap rather than tidy-up: {why}.",
            "",
            "## Precedent",
            "",
            "The same signal already caught three genuine bugs in this codebase — `nftRoutes`",
            "was imported but never mounted (so every `/api/nft/*` call 404'd while the",
            "frontend was calling it), `jsonDepthLimitMiddleware` was never applied, and",
            "`startApiKeyRotationFinalizer` was never started.",
            "",
            "## Task",
            "",
            f"Determine whether `{sym}` should be wired up or deleted. If wired, add a test",
            "that would fail if it were disconnected again.",
        ]),
        [BUG, BE, MED],
    )

# ─────────────────────────────────────────────────────────────────────────────
# 9. CI / DevOps
# ─────────────────────────────────────────────────────────────────────────────
add(
    "[CI] Frontend job is red — `type-check` and `build` fail",
    ctx([
        "The `frontend` job in `.github/workflows/ci.yml` fails at `npm run type-check`",
        "with **263 errors across 26 files**, and `npm run build` fails for the same reason.",
        "",
        "Per-file issues are filed separately. This tracks the CI gate itself: until the",
        "count reaches zero, decide whether to",
        "",
        "1. fix all 263 (preferred), or",
        "2. temporarily mark the step `continue-on-error: true` with a link to this issue,",
        "   so the rest of the job still provides signal.",
        "",
        "Do not delete the step — losing the gate is how the codebase reached 263 errors.",
    ]),
    [DEVOPS, FE, BUG, MED],
)

add(
    "[CI] Backend job is red — 113 unit tests failing",
    ctx([
        "The `backend` job in `.github/workflows/ci.yml` runs",
        "`npx jest --selectProjects unit`, which currently reports:",
        "",
        "```",
        "Test Suites: 23 failed, 32 passed, 55 total",
        "Tests:       113 failed, 629 passed, 742 total",
        "```",
        "",
        "Per-suite issues are filed separately; the shared CSRF helper should clear a large",
        "share at once. This issue tracks getting the gate green.",
    ]),
    [DEVOPS, BE, TEST, MED],
)

add(
    "[CI] Add an integration-test job with a real Postgres",
    ctx([
        "`backend/package.json` defines a second jest project:",
        "",
        "```json",
        '"testMatch": ["**/src/tests/integration/**/*.test.js"], "runInBand": true',
        "```",
        "",
        "CI runs only `--selectProjects unit`, so integration tests never execute.",
        "",
        "## Task",
        "",
        "Add a job that starts the Postgres service, runs `npm run migrate`, then",
        "`npm run test:integration`. This is the only layer that would have caught the",
        "migration-numbering problem.",
    ]),
    [DEVOPS, TEST, BE, MED],
)

add(
    "[CI] Restore end-to-end and accessibility checks",
    ctx([
        "`frontend/tests/e2e/` and `playwright.config.ts` (with `chromium` and",
        "`chromium-dark` projects) exist, but no workflow runs them.",
        "",
        "## Task",
        "",
        "Add an `e2e.yml` running Playwright plus the axe-core accessibility specs in both",
        "colour schemes, uploading `playwright-report/` on failure.",
        "",
        "Blocked by the frontend build — Playwright starts the dev server via `webServer`.",
    ]),
    [DEVOPS, FE, TEST, MED],
)

add(
    "[CI] Document the secrets each workflow needs",
    ctx([
        "`.github/workflows/deploy.yml` depends on secrets that are documented nowhere:",
        "",
        "- `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `APP_DIR`",
        "- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL`, `AWS_REGION`, `S3_BUCKET`",
        "- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`",
        "",
        "A missing secret produces a confusing mid-deploy failure rather than a clear error.",
        "",
        "## Task",
        "",
        "Add `docs/ci-secrets.md` listing each secret, which job uses it, and how to obtain",
        "it. Consider a preflight step that fails fast with a readable message.",
    ]),
    [DOC, DEVOPS, EASY],
)

add(
    "[CI] Re-enable Dependabot with a sane grouping policy",
    ctx([
        "`.github/dependabot.yml` was removed. Without it nothing tracks upstream security",
        "releases, and this repo has already accumulated version drift that broke installs:",
        "",
        "- `react-dom@19` alongside `react@18` (peer conflict — forced `--legacy-peer-deps` everywhere)",
        "- `@storybook/react-vite@10` alongside Storybook `8.6.x`",
        "",
        "## Task",
        "",
        "Reintroduce Dependabot scoped to **security updates only**, or weekly grouped",
        "minor/patch with a cap on open PRs, so it does not flood the queue.",
    ]),
    [DEVOPS, SEC, EASY],
)

# ─────────────────────────────────────────────────────────────────────────────
# 10. Documentation
# ─────────────────────────────────────────────────────────────────────────────
DOCS = [
    ("docs/architecture.md",
     "The system diagram shows only `create_escrow`, `start_work`, `release_escrow` and "
     "`refund_escrow`. The contract actually exposes 60+ entry points including milestones, "
     "disputes, sealed-bid auctions and governance.",
     "Redraw the diagram and the job-lifecycle section against the real contract surface."),
    ("README.md",
     "The Project Structure block omits `packages/`, `infra/`, `monitoring/`, `k6/` and "
     "`deploy/`, and the feature list stops at v1 while USDC, milestones, disputes, DAO "
     "governance and messaging are all merged.",
     "Refresh both sections so a newcomer sees the real shape of the repo."),
    ("docs/api.md",
     "The API reference predates several route groups. `server.js` mounts 34 route groups "
     "including `/api/nft`, `/api/dao`, `/api/price-alerts`, `/api/proposal-templates` and "
     "`/api/ai`.",
     "Regenerate from the OpenAPI spec (`npm run generate-openapi`) and add the missing groups."),
    ("docs/contract-api-reference.md",
     "Out of date against `lib.rs` — missing the sealed-bid auction, dispute-bond and "
     "arbitration-case entry points.",
     "Regenerate the reference once the contract compiles again."),
    ("docs/deployment.md",
     "References the old per-environment workflows (`deploy-staging.yml`, "
     "`deploy-production.yml`), which have been consolidated into `deploy.yml`.",
     "Update to describe the single workflow, its `workflow_dispatch` inputs, and the "
     "blue-green health gate."),
    ("docs/troubleshooting.md",
     "No entries for the failure modes contributors actually hit: `npm ci` peer-dependency "
     "errors, migration version collisions, or CSRF 403s when calling the API from a script.",
     "Add a section for each with the exact error text and the fix."),
    ("CONTRIBUTING.md",
     "Does not explain how to run the test suites, that the backend needs Postgres for "
     "integration tests, or that mutating API calls require a CSRF token.",
     "Add a 'Running the tests' section covering backend unit/integration, frontend jest, "
     "Playwright, and cargo."),
    ("docs/environment-variables.md",
     "`CSRF_SECRET` is required in production — `middleware/csrf.js` calls `process.exit(1)` "
     "without it — but it is not documented alongside the other required variables.",
     "Document `CSRF_SECRET`, and audit the file against every `requireEnv()` call in the code."),
]
for path, problem, task in DOCS:
    add(
        f"[Docs] Update `{path}`",
        ctx(["## Problem", "", problem, "", "## Task", "", task]),
        [DOC, EASY],
    )

add(
    "[Docs] Record an ADR for the CI/CD consolidation",
    ctx([
        "The workflows went from 14 files to 3 (`ci.yml`, `deploy.yml`, `security.yml`).",
        "Checks that were dropped — Storybook deploy, Playwright visual regression, ZAP",
        "scanning, cargo-fuzz — are not recorded anywhere.",
        "",
        "## Task",
        "",
        "Add `docs/ADR-011-ci-consolidation.md` in the style of the existing ADRs, covering",
        "what was merged, what was dropped and why, and what should come back.",
    ]),
    [DOC, DEVOPS, EASY],
)

add(
    "[Docs] `docs/INDEX.md` lists files that no longer exist",
    ctx([
        "`docs/INDEX.md` is the entry point to the documentation set. Several linked",
        "documents have since been renamed, and the root-level `PULL_REQUEST_*.md` write-ups",
        "it may reference have been deleted.",
        "",
        "## Task",
        "",
        "Verify every link resolves and add a CI link-checker step so it cannot rot again.",
    ]),
    [DOC, EASY],
)

# ─────────────────────────────────────────────────────────────────────────────
# 11. Frontend quality
# ─────────────────────────────────────────────────────────────────────────────
add(
    "[Frontend] `pages/dashboard.tsx` is 1,066 lines — split it",
    ctx([
        "`pages/dashboard.tsx` renders **14 tabs** through one long ternary chain",
        "(`posted`, `applied`, `proposals`, `analytics`, `earnings`, `spending`, `send`,",
        "`templates`, `price_alerts`, `withdrawals`, `saved_searches`, `referrals`, …) and",
        "holds 128 of the repo's 263 type errors.",
        "",
        "Two structural bugs came directly from its size: a JSX fragment opened at the",
        "templates branch was never closed, and the saved-searches branch returned two",
        "sibling roots.",
        "",
        "## Task",
        "",
        "Extract each tab into `components/dashboard-tabs/` (the directory already exists)",
        "and replace the ternary chain with a lookup map.",
    ]),
    [FE, ENH, MED],
)

add(
    "[Frontend] `WalletAddressDisplay` was referenced but never committed",
    ctx([
        "`components/Navbar.tsx` rendered `<WalletAddressDisplay …>` closed by `</button>`.",
        "The component exists nowhere in the repo and was never imported — introduced by",
        "PR #936, which added the usage and the import but not the file.",
        "",
        "**The frontend has not compiled since.** It has been reverted to the plain",
        "`<button onClick={() => router.push('/dashboard/transactions')}>` it replaced.",
        "",
        "## Task",
        "",
        "Decide whether the component was intended. If so, build it properly (address +",
        "balance + copy affordance) and reuse it wherever addresses are shown. Otherwise",
        "close this.",
        "",
        "Either way, keeping `type-check` in CI is what stops a repeat.",
    ]),
    [FE, ENH, MED],
)

add(
    "[Frontend] Restore visual regression testing",
    ctx([
        "`frontend/tests/e2e/visual-regression.spec.ts` exists and `playwright.config.ts`",
        "sets `snapshotDir: \"./test-results/snapshots\"`, but no baselines are committed and",
        "no workflow runs the spec.",
        "",
        "## Task",
        "",
        "Generate baselines for light and dark, commit them, and add a CI job that uploads",
        "diffs on failure. Note `frontend/test-results/` is now gitignored — the snapshot",
        "directory needs a path that is not ignored.",
    ]),
    [FE, TEST, DEVOPS, MED],
)

add(
    "[Frontend] Publish Storybook again",
    ctx([
        "The `deploy-storybook.yml` workflow was removed during the CI consolidation (it",
        "referenced `actions/checkout@v7` and `upload-pages-artifact@v4`, neither of which",
        "exists, so it had never run successfully).",
        "",
        "`.storybook/` and `stories/` are still maintained and the Storybook 8 toolchain is",
        "now version-aligned.",
        "",
        "## Task",
        "",
        "Add a working GitHub Pages deploy using `upload-pages-artifact@v3`, or drop",
        "Storybook from the project and delete the config.",
    ]),
    [FE, DEVOPS, DOC, EASY],
)

add(
    "[Frontend] Audit `dangerouslySetInnerHTML` and sanitiser usage",
    ctx([
        "The frontend depends on `dompurify` (which currently carries a moderate advisory)",
        "and ships `lib/sanitize.ts`.",
        "",
        "## Task",
        "",
        "Enumerate every `dangerouslySetInnerHTML` call site and confirm each passes through",
        "the shared sanitiser. Job descriptions and proposals are attacker-controlled and",
        "rendered to other users, so a gap here is stored XSS.",
        "",
        "Add a lint rule banning raw usage outside an approved wrapper.",
    ]),
    [SEC, FE, MED],
)

# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────
def existing_titles() -> set[str]:
    """Titles of all open+closed issues, so re-runs don't duplicate."""
    try:
        out = subprocess.run(
            ["gh", "issue", "list", "--repo", REPO, "--state", "all",
             "--limit", "1000", "--json", "title"],
            capture_output=True, text=True, timeout=120, check=True).stdout
        return {i["title"] for i in json.loads(out)}
    except Exception as exc:                      # noqa: BLE001
        print(f"  ! could not list existing issues ({exc}); duplicate check off")
        return set()


def create(issue: dict) -> tuple[bool, str]:
    cmd = ["gh", "issue", "create", "--repo", REPO,
           "--title", issue["title"], "--body", issue["body"]]
    for lb in issue["labels"]:
        cmd += ["--label", lb]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if res.returncode == 0:
        return True, res.stdout.strip().splitlines()[-1]
    return False, (res.stderr or res.stdout).strip().replace("\n", " ")[:200]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true", help="actually create the issues")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delay", type=float, default=2.0,
                    help="seconds between creates (secondary rate limit)")
    ap.add_argument("--start", type=int, default=0, help="resume from this index")
    args = ap.parse_args()

    print(f"{len(issues)} issues prepared for {REPO}")
    counts: dict[str, int] = {}
    for i in issues:
        counts[i["labels"][0]] = counts.get(i["labels"][0], 0) + 1
    print("  by primary label: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    dupes = [i["title"] for i in issues if issues.count(i) > 1]
    if dupes:
        print(f"  ! duplicate titles within batch: {dupes[:3]}")

    if not args.push:
        for n, i in enumerate(issues[:5], 1):
            print(f"\n--- sample {n} ---\n{i['title']}\nlabels: {i['labels']}\n")
            print(i["body"][:400] + ("…" if len(i["body"]) > 400 else ""))
        print(f"\n(dry run — nothing created. Re-run with --push)")
        return 0

    seen = existing_titles()
    created = skipped = failed = 0
    for n, issue in enumerate(issues):
        if n < args.start:
            continue
        if issue["title"] in seen:
            print(f"[{n+1:3}/{len(issues)}] skip (exists): {issue['title'][:70]}")
            skipped += 1
            continue
        ok, info = create(issue)
        if ok:
            created += 1
            print(f"[{n+1:3}/{len(issues)}] {info}")
        else:
            failed += 1
            print(f"[{n+1:3}/{len(issues)}] FAILED: {issue['title'][:60]} :: {info}")
            if "rate limit" in info.lower() or "abuse" in info.lower():
                print("      rate limited — backing off 60s")
                time.sleep(60)
        time.sleep(args.delay)

    print(f"\ncreated={created} skipped={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
