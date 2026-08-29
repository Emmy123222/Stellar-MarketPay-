# 🗺 Stellar MarketPay — Roadmap

This roadmap reflects the current state of the project on `main`, not aspirational work that has already landed. The items below are intentionally organized to show what has been shipped and what is still worth building next.

---

## ✅ Current platform status

The following capabilities are already implemented and merged on `main`:

- [x] Freighter wallet integration
- [x] Job posting and discovery workflows
- [x] Proposal submission and application flow
- [x] Escrow-based payouts, milestone logic, and dispute support
- [x] USDC support alongside XLM
- [x] In-app messaging between clients and freelancers
- [x] Ratings and reputation flows
- [x] Search and discovery for jobs and talent
- [x] DAO-governed arbitrator registry integration
- [x] Core backend, frontend, contracts, CI, and deployment foundations

---

## 🧩 v1.2 — Escrow Contract (Shipped)

Status: Completed on `main`.

- [x] Soroban escrow contract deployed and integrated
- [x] Lock client funds when a job is created
- [x] Release funds after approval or milestone completion
- [x] Refund workflow for cancelled jobs before acceptance
- [x] Dispute-ready escrow logic and administrative controls

---

## 💬 v1.3 — Messaging (Shipped)

Status: Completed on `main`.

- [x] Real-time in-app messaging between clients and freelancers
- [x] Job update communication flows
- [x] Milestone and collaboration messaging support
- [x] Messaging surfaces integrated into the product experience

---

## ⭐ v1.4 — Reputation System (Shipped)

Status: Completed on `main`.

- [x] Post-job ratings and feedback flow
- [x] Freelancer reputation signals
- [x] Client reliability indicators
- [x] Profile visibility for completed work and trust history

---

## 🔍 v1.5 — Search & Discovery (Shipped)

Status: Completed on `main`.

- [x] Job search by keyword and filters
- [x] Category, budget, and duration filtering
- [x] Skill-based matching and discovery support
- [x] Search UX integrated into the marketplace experience

---

## 💰 v2.0 — Multi-Currency & Milestones (Shipped)

Status: Completed on `main`.

- [x] USDC payments alongside XLM
- [x] Milestone-based escrow releases
- [x] Partial payment approval on milestone completion
- [x] Payment flow and dispute preparation for more complex work

---

## 🌍 v2.1 — DAO Governance (Shipped)

Status: Completed on `main` via the arbitrator registry and governance-aligned escrow tooling.

- [x] DAO-governed arbitrator registry
- [x] Community-aligned dispute infrastructure
- [x] Governance-ready contract and platform controls
- [x] Foundation for future governance mechanisms and policy evolution

---

## 🚀 Next priorities for the next wave

The next phase is focused on product maturity, trust, and scale rather than re-building features that are already shipped.

### v2.2 — Platform maturity and trust

- [ ] Improve dispute workflows and clarity for users under review
- [ ] Harden wallet, payout, and escrow UX for less technical users
- [ ] Add analytics and reporting for clients, freelancers, and admins
- [ ] Strengthen fraud prevention, moderation, and compliance controls
- [ ] Reduce onboarding friction and improve first-run success

### v2.3 — Market expansion and quality

- [ ] Expand job discovery quality with ranking and recommendation improvements
- [ ] Add better talent matching, saved searches, and personalized discovery
- [ ] Improve notifications, reminders, and lifecycle messaging
- [ ] Support additional token and payment flows beyond the current core set
- [ ] Expand admin tooling for operational oversight and platform health

### v2.4 — Governance and ecosystem growth

- [ ] Define a broader DAO governance model for platform policy and treasury decisions
- [ ] Add formal proposal, vote, and execution flows where policy requires them
- [ ] Expand grant and ecosystem support around community-led work
- [ ] Align protocol upgrades with risk management and contributor incentives

---

## Contribution guidance

If you are looking for a contribution area, please start with the next priorities above instead of re-implementing functionality that is already in `main`.

Good entry points include:

- UX and onboarding improvements
- Dispute flow and trust-signal refinement
- Admin reporting and operational tooling
- Search ranking and personalization
- Governance process design and policy tooling

If a feature is already listed as shipped above, assume it is in active production and treat it as a completed implementation unless a bug or missing follow-up explicitly remains open.
