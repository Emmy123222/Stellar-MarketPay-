# 🚀 Load Testing Guide — Stellar MarketPay

An end-to-end, production-like load testing guide for the Stellar MarketPay API using `docker-compose.loadtest.yml`, [k6](https://k6.io/), automated baseline trend reporting, and infrastructure cost tracking.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Load-Testing Stack (`docker-compose.loadtest.yml`)](#2-the-load-testing-stack-docker-composeloadtestyml)
3. [End-to-End Walkthrough: Clean Checkout to Report](#3-end-to-end-walkthrough-clean-checkout-to-report)
   - [Step 1: Clean checkout & prerequisites](#step-1-clean-checkout--prerequisites)
   - [Step 2: Spin up the load-test stack](#step-2-spin-up-the-load-test-stack)
   - [Step 3: Two-phase database seeding](#step-3-two-phase-database-seeding)
   - [Step 4: Executing load scenarios](#step-4-executing-load-scenarios)
   - [Step 5: SLA thresholds & verification](#step-5-sla-thresholds--verification)
   - [Step 6: Trend reporting & baseline comparison](#step-6-trend-reporting--baseline-comparison)
   - [Step 7: Infrastructure cost & rightsizing report](#step-7-infrastructure-cost--rightsizing-report)
   - [Step 8: Teardown](#step-8-teardown)
4. [SLA Targets & `k6/config.js` Thresholds Deep-Dive](#4-sla-targets--k6configjs-thresholds-deep-dive)
5. [Scenario Scripts Reference](#5-scenario-scripts-reference)
6. [Baseline Management (`k6/previous-results/`)](#6-baseline-management-k6previous-results)
7. [Infrastructure Cost Optimization](#7-infrastructure-cost-optimization)
8. [Troubleshooting & FAQs](#8-troubleshooting--faqs)

---

## 1. Architecture Overview

Stellar MarketPay provides a complete load-testing ecosystem designed to benchmark critical read and write pathways under production-like concurrency. The architecture connects the containerized application stack, deterministic synthetic data generation, k6 load scenarios, automated regression diffing, and cost tracking:

```mermaid
flowchart TD
    subgraph S1["1. Stack Provisioning"]
        DC["docker-compose.loadtest.yml"] --> PG[("PostgreSQL 16 (tmpfs)")]
        DC --> RD[("Redis 7")]
        DC --> BE["Backend API (Port 4000)"]
        DC --> K6C["k6 Runner Container"]
    end

    subgraph S2["2. Two-Phase Seeding"]
        SDB["scripts/seed-db.js"] -.->|"Phase 1: DB Schema & Baseline"| PG
        SDATA["k6/seed-data.js"] -->|"Phase 2: REST Seeding (JWT)"| BE
        SDATA --> FIX["k6/test-fixtures.json"]
    end

    subgraph S3["3. Load Execution (k6)"]
        K6C -->|"Run scenarios"| BE
        FIX -.->|"SharedArray"| K6C
        K6C --> RES["k6/results/*-summary.json"]
    end

    subgraph S4["4. Trend & SLA Analysis"]
        RES --> TR["k6/lib/trend-report.js"]
        PREV["k6/previous-results/"] --> TR
        TR --> MD["k6/results/trend-report.md"]
        TR --> JSON["k6/results/trend-report.json"]
    end

    subgraph S5["5. Infrastructure Spend"]
        COST["scripts/infrastructure-cost-report.sh"] --> CR["Cost Report & Rightsizing"]
    end
```

---

## 2. The Load-Testing Stack (`docker-compose.loadtest.yml`)

The repo ships `docker-compose.loadtest.yml` as a self-contained, tuned stack. It differs fundamentally from the standard development `docker-compose.yml` to prevent testing bottlenecks:

| Parameter / Service      | Standard Dev            | Load-Test Stack                                           | Rationale                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`RATE_LIMIT_SCALE`**   | `1`                     | `1000`                                                    | In production and dev, endpoints enforce strict per-IP rate limits (e.g. 5 req/min on applications). With 50–100 VUs hitting from one host IP, rate limits would trigger `429 Too Many Requests` and mask actual API capacity. Scaling by 1000 relaxes thresholds for load generation without modifying route code. |
| **`DB_POOL_MAX`**        | `10`                    | `50`                                                      | Widens PostgreSQL connection pool from 10 to 50 concurrent connections, preventing connection pool starvation when 100 concurrent VUs query the database simultaneously.                                                                                                                                            |
| **`PostgreSQL Storage`** | Persistent Volume       | `tmpfs: /var/lib/postgresql/data`                         | Runs PostgreSQL data directory in memory (`tmpfs`). This eliminates disk I/O bottlenecks during heavy read/write bursts and ensures zero residual disk state between runs.                                                                                                                                          |
| **`NODE_ENV`**           | `development`           | `development` (with `command: ["node", "src/server.js"]`) | Runs production server entrypoint (`src/server.js`), but keeps `NODE_ENV=development` because `NODE_ENV=production` triggers SSL certificate enforcement (`rejectUnauthorized: true`), which fails against containerized Postgres with no TLS.                                                                      |
| **`ALLOWED_ORIGINS`**    | `http://localhost:3000` | `*`                                                       | Synthetic traffic from k6 runners does not originate from a browser origin header.                                                                                                                                                                                                                                  |
| **`k6 Service`**         | None                    | `grafana/k6:latest`                                       | Bundled runner with `./k6` mounted to `/work`, default `K6_BASE_URL=http://backend:4000`, and matching `JWT_SECRET`.                                                                                                                                                                                                |

---

## 3. End-to-End Walkthrough: Clean Checkout to Report

Follow this step-by-step workflow from a fresh clone to a completed benchmark report.

### Step 1: Clean checkout & prerequisites

Ensure you have [Docker](https://docs.docker.com/get-docker/) (v2+ with Docker Compose) and [Node.js](https://nodejs.org/) (v18+) installed:

```bash
# Clone the repository
git clone https://github.com/Emmy123222/Stellar-MarketPay-.git
cd Stellar-MarketPay-

# Install root dependencies
npm install
```

### Step 2: Spin up the load-test stack

Start the isolated PostgreSQL, Redis, and backend API containers:

```bash
docker compose -f docker-compose.loadtest.yml up -d --build
```

Verify that all services are healthy and running:

```bash
docker compose -f docker-compose.loadtest.yml ps
```

You should see `postgres` (healthy), `redis` (healthy), and `backend` (running on port 4000).

### Step 3: Two-phase database seeding

The API requires existing data to query and write against. A fresh database starts empty, which causes read queries to return empty lists and write endpoints (e.g., job applications) to fail due to foreign key constraints. Seeding happens in two distinct phases:

#### Phase 1: Database structure and base entities (`seed-db`)

Populates initial database schema and baseline records directly via SQL:

```bash
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork npm run seed-db
```

This seeds:

- 5 baseline users (2 clients, 3 freelancers)
- 20 open jobs
- 10 applications
- 3 in-progress jobs with escrow

#### Phase 2: High-volume synthetic data (`seed-data.js`)

Populates high-volume entities via the REST API to give k6 enough unique combinations for concurrency testing:

```bash
JWT_SECRET=loadtest-jwt-secret-with-sufficient-length-for-signing \
K6_BASE_URL=http://localhost:4000 \
node k6/seed-data.js
```

What `k6/seed-data.js` does:

1. Waits for `GET /health` to respond.
2. Generates a synthetic Stellar client public key (`G...`), creates its profile via `POST /api/profiles`, and mints an HS256 JWT.
3. Seeds **30 open public jobs** owned by that client via `POST /api/jobs`.
4. Seeds **5,000 freelancer profiles** via `POST /api/profiles` using concurrent batched workers.
5. Writes `k6/test-fixtures.json` containing `{ clientKey, jobIds, profileKeys }`.

> **Why 5,000 freelancers?** The endpoint `POST /api/applications` enforces `UNIQUE(job_id, freelancer_address)`. Generating 5,000 freelancers with 30 jobs provides a unique capacity of `lcm(30, 5000) = 15,000` distinct combinations, ensuring 0% duplicate collision errors during ramping tests.

### Step 4: Executing load scenarios

Run scenarios using the bundled `k6` container service in `docker-compose.loadtest.yml`:

```bash
# 1. Test job listing read path (GET /api/jobs)
docker compose -f docker-compose.loadtest.yml run --rm k6 run get-jobs.js

# 2. Test profile read path and cache (GET /api/profiles/:key)
docker compose -f docker-compose.loadtest.yml run --rm k6 run get-profiles.js

# 3. Test application write path (POST /api/applications)
docker compose -f docker-compose.loadtest.yml run --rm k6 run post-applications.js

# 4. Test authenticated critical flow (create -> apply -> accept -> release)
docker compose -f docker-compose.loadtest.yml run --rm k6 run scripts/authenticated-flow.js

# 5. Test concurrent escrow creation burst (#1488)
docker compose -f docker-compose.loadtest.yml run --rm k6 run scripts/create-escrow.js
```

_(Optional)_ If you have the `k6` CLI installed locally on your host:

```bash
cd k6
K6_BASE_URL=http://localhost:4000 \
JWT_SECRET=loadtest-jwt-secret-with-sufficient-length-for-signing \
k6 run get-jobs.js
cd ..
```

### Step 5: SLA thresholds & verification

Each script exports `handleSummary(data)` which writes summary statistics to `k6/results/<script-name>-summary.json`.

During execution, k6 validates every request against the SLA thresholds defined in `k6/config.js`:

- `http_req_duration`: `p(95) < 200 ms`
- `http_req_failed`: `rate < 0.001` (effectively 0% errors)
- `checks`: `rate > 0.99` (>99% business assertions pass)

If any SLA threshold is broken, the k6 process exits with a non-zero exit code.

### Step 6: Trend reporting & baseline comparison

Compare current test summaries against previous baseline benchmarks:

```bash
node k6/lib/trend-report.js --current k6/results --previous k6/previous-results
```

This generates:

- `k6/results/trend-report.md` (Markdown table with emoji badges)
- `k6/results/trend-report.json` (Machine-readable latency and error deltas)

If a metric regresses beyond tolerance (p(95) worsens > 25% or error rate > 1%), `trend-report.js` prints `REGRESSION DETECTED` and exits with code `2`.

To promote the current run as the new baseline:

```bash
cp k6/results/*-summary.json k6/previous-results/
```

### Step 7: Infrastructure cost & rightsizing report

Performance testing directly informs cloud resource allocation. Generate the infrastructure spend and rightsizing report:

```bash
./scripts/infrastructure-cost-report.sh
```

This outputs a summary of compute (ECS/EKS), database (RDS PostgreSQL), and cache (Redis ElastiCache) costs, checks budget alert limits, and prints actionable rightsizing recommendations (e.g., downsizing over-provisioned ECS or RDS instances when p95 thresholds have substantial headroom).

### Step 8: Teardown

Tear down the containers and clean up the tmpfs volume:

```bash
docker compose -f docker-compose.loadtest.yml down -v
```

---

## 4. SLA Targets & `k6/config.js` Thresholds Deep-Dive

The SLA targets enforce strict latency and reliability guarantees.

```javascript
// k6/config.js
export const SLA = Object.freeze({
  P95_MS: 200, // 95th percentile latency must be under 200ms
  STRESS_VUS: 100, // ...under sustained peak load of 100 virtual users
  ERROR_RATE_GATE_VUS: 50, // 0% error rate at 50 VUs
  MAX_ERROR_RATE: 0.0, // strict 0% threshold
});

export const thresholds = {
  http_req_failed: ["rate<0.001"], // allows < 0.1% for transient network blips
  http_req_duration: [`p(95)<${SLA.P95_MS}`], // p(95) < 200 ms
  checks: ["rate>0.99"], // > 99% of business assertions pass
};
```

### Ramping Stage Lifecycle

Every scenario utilizes `rampingStages()` from `k6/config.js` to evaluate both reliability and latency gates in a single pass:

```
VUs
100 ┼───────────────────────╭──────────╮
    │                       │          │
 50 ┼────────────╭──────────╯          │
    │            │                     │
 10 ┼─╭──────────╯                     ╰─────
    └─┴──────────┴──────────┴──────────┴─────► Time
     0-15s      15-45s     45-75s    75-105s  105-120s
    Warm-up    50 VU Hold 100 VU Ramp Peak    Ramp-down
               (0% Error) (p95 <200ms) Hold
```

1. **Stage 1 (0–15s)**: Warm-up to 10 VUs to prime connection pools and caches.
2. **Stage 2 (15–45s)**: Ramp to and sustain 50 VUs (validates 0% error rate gate).
3. **Stage 3 (45–75s)**: Ramp up to 100 VUs.
4. **Stage 4 (75–105s)**: Hold at 100 VUs peak (validates p(95) < 200 ms gate).
5. **Stage 5 (105–120s)**: Graceful ramp-down to 0 VUs.

---

## 5. Scenario Scripts Reference

| Script                                                      | Method & Path                                                                                                      | Auth        | Purpose & Mechanics                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `k6/get-jobs.js` (or `k6/scripts/jobs-listing.js`)          | `GET /api/jobs`                                                                                                    | Public      | Exercises query-parameter parsing, SQL filtering, pagination, and caching layer. Randomly samples categories and search terms.                                            |
| `k6/get-profiles.js`                                        | `GET /api/profiles/:publicKey`                                                                                     | Public      | Tests Redis profile caching. Loads synthetic public keys from `test-fixtures.json` into a k6 `SharedArray` (shared across all VUs without memory duplication).            |
| `k6/post-applications.js` (or `k6/scripts/apply-to-job.js`) | `POST /api/applications`                                                                                           | Public      | Tests high-volume write throughput. Uses injective pairing formula `idx = uniqueIndex(__VU, __ITER, MAX_VUS)` to ensure no duplicate `(job, freelancer)` pairs occur.     |
| `k6/scripts/authenticated-flow.js`                          | `POST /api/jobs`, `POST /api/applications`, `POST /api/applications/:id/accept`, `POST /api/escrow/:jobId/release` | JWT (HS256) | Complete end-to-end lifecycle. Each VU mints an HS256 JWT using `JWT_SECRET` via `k6/crypto`, submits a job, applies, accepts the freelancer, and invokes escrow release. |
| `k6/scripts/create-escrow.js`                               | `PATCH /api/jobs/:id/escrow`                                                                                       | JWT (HS256) | Escrow creation concurrency test (#1488). 50 concurrent VUs simultaneously authenticate and lock escrow funds. Gates: `p(95) < 2000 ms`, `error rate < 1%`.               |

---

## 6. Baseline Management (`k6/previous-results/`)

Trend reporting prevents performance degradation across code revisions:

1. **Local Baselines**:
   Run the test suite on your stable branch, then copy summaries to the baseline directory:
   ```bash
   cp k6/results/*-summary.json k6/previous-results/
   ```
2. **Automated Diffing**:
   When `k6/lib/trend-report.js` runs, it reads both `k6/results/` and `k6/previous-results/`.
   - Latency improvement: `p95 Delta < -5%` (🟢)
   - Neutral: `±5%` (➖)
   - Regression: `p95 Delta > +25%` or `Error Rate > 1%` (🔴)
3. **CI Pipeline Integration**:
   In GitHub Actions, the previous run's `load-test-results` artifact is downloaded into `k6/previous-results/` before executing tests, and the generated `trend-report.md` is appended directly to the GitHub Step Summary.

---

## 7. Infrastructure Cost Optimization

Load testing and cloud infrastructure cost are interdependent. High performance must be balanced against over-provisioning costs.

The included cost tracking tool (`scripts/infrastructure-cost-report.sh`) monitors the top 3 infrastructure cost drivers:

1. **PostgreSQL (RDS)**: Typical base spend ~$49.56/mo (38% of total).
2. **Compute (ECS/EKS)**: Typical base spend ~$35.20/mo (27% of total).
3. **Redis (ElastiCache)**: Typical base spend ~$18.72/mo (14% of total).

### How to use load-test results for rightsizing:

- **Low latency headroom (p95 < 50ms at 100 VUs)**: If the API easily exceeds the 200ms SLA, compute or database tiers can be downsized according to the report's recommendations (e.g. backend ECS `t3.large` → `t3.medium`, saving ~$17.60/mo; RDS `db.t3.medium` → `db.t3.small`, saving ~$19.82/mo).
- **Latency regressions (p95 > 200ms)**: Inspect query execution plans before immediately upscaling instances.

---

## 8. Troubleshooting & FAQs

### 1. `429 Too Many Requests` errors during load test

- **Cause**: The API's per-IP rate limiter is active.
- **Fix**: Ensure `RATE_LIMIT_SCALE=1000` is set in `docker-compose.loadtest.yml` environment variables.

### 2. `test-fixtures.json not found`

- **Cause**: k6 scenarios require fixtures generated by `seed-data.js`.
- **Fix**: Run `node k6/seed-data.js` against the running backend before executing `k6 run`.

### 3. Database connection errors / pool exhaustion

- **Cause**: High VU counts overwhelming standard pool limits.
- **Fix**: Verify `DB_POOL_MAX=50` is present in the `backend` environment in `docker-compose.loadtest.yml`.

### 4. JWT verification failure in authenticated scenarios

- **Cause**: The JWT secret used to sign synthetic tokens does not match the backend's secret.
- **Fix**: Set `JWT_SECRET=loadtest-jwt-secret-with-sufficient-length-for-signing` identically on both the seed script / k6 runner and the backend container.

### 5. Port conflicts on 4000, 5432, or 6379

- **Cause**: Another local PostgreSQL, Redis, or Node.js server is already bound to the host ports.
- **Fix**: Stop local services with `sudo systemctl stop postgresql redis` or terminate conflicting processes before running `docker compose up`.
