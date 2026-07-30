# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **In-App Messaging**: Introduced real-time in-app messaging between clients and freelancers. (#810, #920)
- **Job Invitation System**: Clients can now directly invite specific freelancers to apply for jobs. (#903)
- **Insights & Registry APIs**: Added a summary insights endpoint (`GET /api/insights`), a token registry endpoint (`GET /api/tokens`), and a background job digest service. (#863, #864, #865, #866, #889)
- **Accessibility**: Added ARIA progress bar accessibility features. (#889)

### Changed
- **Mobile Design**: Improved responsiveness across dashboard views on mobile screens. (#894)

### Fixed
- **WebSocket Double-Connect**: Fixed an issue causing duplicate WebSocket connection attempts. (#894)
- **Pagination Cursor**: Resolved a bug causing pagination cursors to become stale. (#894)
- **Earnings Chart**: Addressed display and rendering bugs in the freelancer earnings chart. (#894)


## [1.0.0] - 2026-07-01

### Added
- **Escrow Contracts**: 
  - Implemented milestone-based escrow release functionality. (#26, #578)
  - Added support for recurring/subscription escrow for retainer contracts. (#450, #661)
  - Implemented a dispute bond mechanism to deter frivolous dispute filings. (#437, #647)
  - Added on-chain anchoring for dispute-evidence IPFS CID hashes. (#448, #649)
  - Implemented deliverable hash verification before escrow fund release. (#659)
  - Added escrow timeout extensions by mutual consent. (#656)
  - Introduced a DAO-governed on-chain arbitrator registry. (#655)
  - Added platform treasury fee collection for escrow releases. (#654)
  - Added admin-settable cap on referrer bonuses to prevent referral abuse. (#440, #652)
  - Implemented automated escrow timeout refunds and contract concurrency tests. (#615)
  - Added escrow security upgrades covering issues #1-4. (#660)
- **Backend & APIs**:
  - Implemented a dynamic gas price estimator for Soroban contracts. (#430)
  - Added per-endpoint Redis sliding-window rate limiting for authenticated API keys. (#452, #651)
  - Implemented request tracing with correlation IDs mapped across all backend logs. (#453, #644)
  - Added search features including full-text search with tsvector/GIN indexes, idempotency keys, and a GraphQL API layer. (#636)
  - Created a job recommendation engine using TF-IDF skill matching. (#454, #662)
  - Added a weekly admin PDF report generator with S3 storage and email delivery. (#657)
  - Added live dashboard notifications. (#57)
  - Introduced observability, webhook retry logic, and soft-delete capabilities. (#458, #459, #466, #469, #634)
  - Normalised job category taxonomy with parent/child relationships. (#635)
- **Frontend & UX**:
  - Added real-time transaction history page with cursor-based pagination and filter tabs. (#638)
  - Wired real-time bid comparison components to WebSockets with fallback polling and toast notifications. (#665)
  - Added multi-timeframe XLM price chart with gradient styling, tooltips, loading skeletons, and ARIA attributes. (#664)
  - Added mobile bottom tab bar navigation. (#663)
  - Added an interactive onboarding wizard and command palette. (#645, #646)
  - Added skeleton loading states and infinite scroll. (#621)
  - Integrated animated JobStatusTimeline component, public status page, end-to-end file encryption, and PWA hardening. (#496, #498, #500, #501, #619)
  - Added Open Graph and Twitter Card tags with dynamic branded preview images. (#648)
- **Infrastructure & Tooling**:
  - Implemented WASM-opt post-build step for smart contract build optimizations. (#666)
  - Implemented CI/CD deployment pipelines, ELK stack logging, and Helm chart setup. (#598)
  - Added blue-green deployment strategies. (#614)
  - Added V12 database migration, cost tracking, composite indexes, and time-series metrics. (#599)
  - Set up a data archiving strategy for old completed jobs. (#596)
- **Testing & Verification**:
  - Added property-based tests for escrow calculations using `fast-check` and `proptest`. (#582)
  - Added Stryker mutation testing for backend services. (#584)
  - Added Playwright visual regression tests with main-only CI integration. (#585)
  - Developed a mock Soroban contract for offline local development. (#179, #383)
  - Implemented E2E dispute arbitration testing suite and admin payload propagation. (#624)
  - Added WebSocket integration tests for notification delivery. (#520, #626)
  - Added database migration tests to verify each database migration is reversible. (#513, #595)
  - Added unit test coverage for weekly email digest services. (#601)
  - Added snapshot tests for all frontend components. (#511, #592)
  - Added contract security tests for all access control functions. (#510, #593)
  - Added load tests for API endpoints using k6. (#509, #594)

### Changed
- **Asset Delivery**: Set up a CDN for asset hosting and delivery. (#629)
- **Performance**: Integrated read/write database pools, resolved N+1 query patterns, added SWR caching, and deferred non-critical script tags. (#628)
- **Connection Optimization**: Integrated Horizon client connection pooling. (#631)
- **Compression**: Implemented Brotli compression. (#546, #632)
- **Schedules**: Added Bull MQ for notifications and draft autosaves. (#633)
- **Documentation**: Wrote a comprehensive contributor guide with local setup instructions. (#620)
- **Upgrades**: Bumped action and packaging dependencies (including `@stellar/stellar-sdk` and `express`). (#362, #363, #423, #424, #602, #603, #613)

### Deprecated
- *None.*

### Removed
- **Workflows**: Removed staging environment deployment steps from the rollback workflows, focusing strictly on production.
- **Dependencies**: Removed `shrink-ray-current` and replaced it with standard `compression` middleware to resolve Node.js v20 compilation errors.
- **Automation**: Disabled automated Dependabot pull requests by setting `open-pull-requests-limit` to 0.

### Fixed
- **Performance & Cache**: Fixed indexing issues, optimized XLM cache, and fixed service key signing. (#503, #536, #539, #540, #650)
- **General Bugs**: Resolved issue bundles and code cleanups. (#456, #461, #467, #474, #494, #495, #497, #499, #617, #625, #641)
- **Code Health**: Resolved all ESLint warnings and TypeScript compilation errors across the frontend and backend. (#627)

### Security
- **API Protection**: Gated all state-mutating API endpoints with CSRF protection. (#451, #643)
- **Authentication Security**: Moved JWT token storage to HttpOnly cookies. (#581)
- **Headers & CDNs**: Implemented Content Security Policy (CSP) headers with nonces (#622, #623) and Subresource Integrity (SRI) hashes for CDN scripts (#531, #630).
- **Hardening**: Added automated security scanners to the CI pipeline (#580), configured DDoS protection, and added secrets scanning (#616, #618).
- **WebAuthn**: Added WebAuthn registration limits. (#589)

---

[Unreleased]: https://github.com/Emmy123222/Stellar-MarketPay-/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Emmy123222/Stellar-MarketPay-/releases/tag/v1.0.0
