# 🗺 Stellar MarketPay — Roadmap

This roadmap reflects the current state of the codebase on `main`. Features that are already merged are marked as shipped so new contributors do not pick up work that has already been completed.

> **Tracking:** Roadmap work is organised with GitHub Milestones and every item links to the corresponding [GitHub Issue](https://github.com/Emmy123222/Stellar-MarketPay-/issues). The v2.0 scope is tracked by the [v2.0 — Multi-Currency & Milestones](https://github.com/Seunfunmi-319509/Stellar-MarketPay-/milestone/3) milestone.
>
> | Milestone | Target date | Status |
> | --- | --- | --- |
> | [v2.0 — Multi-Currency & Milestones](https://github.com/Seunfunmi-319509/Stellar-MarketPay-/milestone/3) | 2026-09-30 | Shipped |

---

## ✅ Current state on main

The platform already includes the core foundation and a substantial set of production-facing capabilities:

- [x] Freighter wallet connection
- [x] Job posting, browsing, applications, and acceptance flows
- [x] Soroban escrow contract foundation with dispute and release logic
- [x] Multi-currency payment support for XLM and USDC
- [x] In-app messaging between clients and freelancers
- [x] Rating and reputation surfaces across profiles and jobs
- [x] Search, recommendation, and discovery features
- [x] DAO-governed arbitrator registry and governance-ready infrastructure
- [x] Backend, frontend, CI, and operational tooling for a full product workflow

---

## 🧩 v1.2 — Escrow Contract (Shipped)

- [x] Soroban escrow contract support integrated across the product ([#164](https://github.com/Emmy123222/Stellar-MarketPay-/issues/164))
- [x] Client funds locked on job creation and escrowed for release
- [x] Funds released to freelancers after approval and delivery verification
- [x] Refund and timeout handling for cancelled or expired flows
- [x] Escrow dispute bond, arbitration, and governance hooks ([#1012](https://github.com/Emmy123222/Stellar-MarketPay-/issues/1012))

---

## 💬 v1.3 — Messaging (Shipped)

- [x] Real-time in-app messaging between clients and freelancers (#920)
- [x] Job lifecycle and participant communication flows
- [x] Notification-ready messaging paths for collaboration and updates
- [x] Messaging integrated with the broader marketplace experience

---

## ⭐ v1.4 — Reputation System (Shipped)

- [x] Rating and review flows after job completion ([#23](https://github.com/Emmy123222/Stellar-MarketPay-/issues/23))
- [x] Freelancer and client reputation signals surfaced in profiles ([#355](https://github.com/Emmy123222/Stellar-MarketPay-/issues/355))
- [x] Trust data used across job discovery and recommendations ([#1561](https://github.com/Emmy123222/Stellar-MarketPay-/issues/1561))
- [x] Profile pages and marketplace surfaces that display rating history

---

## 🔍 v1.5 — Search & Discovery (Shipped)

- [x] Full-text search and indexing for jobs and related data
- [x] Filtering and query support for marketplace discovery
- [x] Recommendation and matching logic informed by skills and profile data
- [x] Search-driven discovery flows for jobs and talent

---

## 💰 v2.0 — Multi-Currency & Milestones (Shipped)

> **Milestone:** [v2.0 — Multi-Currency & Milestones](https://github.com/Seunfunmi-319509/Stellar-MarketPay-/milestone/3) (target date: 2026-09-30)

- [x] USDC support alongside XLM ([#947](https://github.com/Emmy123222/Stellar-MarketPay-/issues/947))
- [x] Milestone-based escrow releases and tracking ([#790](https://github.com/Emmy123222/Stellar-MarketPay-/issues/790))
- [x] Partial payment and milestone approval flows ([#276](https://github.com/Emmy123222/Stellar-MarketPay-/issues/276))
- [x] Multi-currency payment handling in contract and application logic ([#431](https://github.com/Emmy123222/Stellar-MarketPay-/issues/431))
- [x] Payment and release logic aligned with dispute and escrow workflows ([#308](https://github.com/Emmy123222/Stellar-MarketPay-/issues/308))

---

## 🌍 v2.1 — DAO Governance (Foundational work shipped)

- [x] DAO-governed on-chain arbitrator registry ([#447](https://github.com/Emmy123222/Stellar-MarketPay-/issues/447))
- [x] Governance-ready arbitration and dispute infrastructure ([#278](https://github.com/Emmy123222/Stellar-MarketPay-/issues/278))
- [x] Platform workflows designed for community-driven dispute resolution ([#812](https://github.com/Emmy123222/Stellar-MarketPay-/issues/812))
- [x] Governance primitives integrated with the contract layer ([#101](https://github.com/Emmy123222/Stellar-MarketPay-/issues/101))

> The current implementation establishes the governance foundation. Full governance token mechanics, broader community voting, and ecosystem-wide treasury policy are future follow-on work rather than placeholder tasks.

---

## 🔭 Forward-looking roadmap

The next phase is focused on improving trust, scale, and operability rather than re-building features that are already live.

### Near-term priorities

- [ ] Operational polish: deploy-time hardening, monitoring improvements, and rollback/incident readiness
- [ ] Trust & safety: stronger moderation, evidence handling, dispute escalation, and admin tooling
- [ ] AI-assisted marketplace intelligence: better job-to-freelancer matching, pricing guidance, and discovery quality
- [ ] Onboarding and mobile UX: faster setup for new users and improved experience on smaller screens
- [ ] Reporting and analytics: richer admin reporting, payout insights, and market-level dashboards

### Medium-term strategic themes

- [ ] Expand governance beyond the arbitrator registry into broader policy and platform decision flows ([#812](https://github.com/Emmy123222/Stellar-MarketPay-/issues/812))
- [ ] Mature multi-asset commerce with additional token support and deeper treasury controls ([#431](https://github.com/Emmy123222/Stellar-MarketPay-/issues/431))
- [ ] Improve reliability and workflow automation for large marketplace operations and recurring engagements
- [ ] Extend the collaboration layer with stronger workflow tooling for complex jobs and teams

### Long-term direction

- [ ] Broader ecosystem integrations and payment rails
- [ ] More advanced trust and fraud prevention systems
- [ ] Deeper community governance and policy tooling
- [ ] Platform scalability improvements for larger transaction and job volumes

This roadmap intentionally focuses on work that is still strategically valuable. The project has already shipped the core marketplace, escrow, messaging, reputation, search, and governance foundations; ongoing work should build on that foundation rather than recreate it.
