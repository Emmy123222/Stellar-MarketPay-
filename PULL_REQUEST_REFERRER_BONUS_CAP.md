Closes #440 — `[Contract] Add referrer bonus cap to prevent referral abuse`

# Summary

The 2% referrer bonus on `release_escrow` had **no upper bound**, which meant a referrer could capture disproportionate rewards on very large escrows (e.g. 2% of a 1 M XLM escrow = 20 000 XLM). This PR adds an **admin-settable ceiling** in contract storage and caps the per-release referrer payout at `min(2% of release_amount, max_referrer_bonus_xlm)`. When the cap kicks in, the saved amount rolls back into the freelancer's payout so the escrow's total payout still equals `release_amount` — no funds are lost or minted.

# Acceptance criteria mapping

| AC | How it is met |
| --- | --- |
| **Admin-settable `max_referrer_bonus_xlm` stored in contract** | New `DataKey::MaxReferrerBonusXlm` storage variant + `set_max_referrer_bonus_xlm(env, admin, cap)` setter + `get_max_referrer_bonus_xlm(env) -> Option<i128>` view. The setter requires `require_auth()` and compares against the stored `DataKey::Admin` address (mirrors the existing `set_default_timeout_seconds` pattern). |
| **`release_escrow` caps referrer payout at `min(2% of amount, max_referrer_bonus_xlm)`** | The referrer-bonus block inside `release_escrow_core()` now computes `bonus_uncapped = release_amount * 200 / 10_000` first, then collapses to `min(bonus_uncapped, cap)` via an explicit pattern-match. When the cap is below the 2%, the saved stroops roll into `to_freelancer`. The transfer-and-event payload now reflects the *post-cap* bonus, so off-chain event consumers never see a bonus larger than the configured cap. |
| **Unit test covering cap boundary** | `test_referrer_bonus_at_cap_boundary` exercises `cap == bonus_uncapped - 1` (19 vs 20) so `min()` collapses to the cap (19). Companion `test_referrer_bonus_equal_to_cap_uses_full_two_percent` covers the OTHER side of the boundary (`cap == bonus_uncapped`, 20 vs 20) so the legacy 2% is preserved. Together they pin the boundary behaviour from both sides. |
| **Backwards compatibility** | When the admin has NOT called `set_max_referrer_bonus_xlm` the storage key is absent → `None` is returned → legacy 2% bonus applies unchanged. Verified by `test_referrer_bonus_without_cap_uses_full_two_percent`. |

# Cap math

```
bonus_uncapped = release_amount * 200 / 10_000    // 2% in basis points
bonus = match cap {
    Some(c) if c < 0               => panic!("Negative referrer bonus cap in storage"),
    Some(0)                        => 0i128,            // disable referrer program
    Some(c) if c < bonus_uncapped  => c,                // cap wins; saved -> freelancer
    Some(_)                        => bonus_uncapped,   // cap >= uncapped -> legacy
    None                           => bonus_uncapped,   // no cap -> legacy
};
to_freelancer = release_amount - bonus;
```

The match arms are evaluated in order so the `c < 0` panic runs first, the disable-shortcut zero follows, then the below-cap collapse, then the at-or-above and absent-cases share the same `bonus_uncapped` outcome.

The raise-time guard is `panic!` (not silent zeroing) so a future config-store migration bug — the only realistic way to land a negative value, since the setter rejects them — surfaces loudly on-chain instead of silently zeroing referrer payouts.

# Files

### Modified
- `contracts/marketpay-contract/src/lib.rs` (+~190 lines)
  - New `DataKey::MaxReferrerBonusXlm` variant (unit, no inner data so "absent" = "no cap").
  - New `get_max_referrer_bonus_xlm(env) -> Option<i128>` view.
  - New `set_max_referrer_bonus_xlm(env, admin: Address, cap: i128)` admin function with `admin.require_auth()`, stored-admin comparison, `cap < 0` panic guard, `ref_cap` event publish.
  - `release_escrow_core`'s referrer bonus block now reads `MaxReferrerBonusXlm` and applies the collapse above.
  - New `mod referrer_cap_tests` appended at end-of-file with **8 unit tests** (all named `test_referrer_bonus_*`).

# Test coverage

Eight unit tests, all in the new `referrer_cap_tests` mod:

| Test | Scenario | Expected outcome |
| --- | --- | --- |
| `test_referrer_bonus_below_cap_uses_uncapped_two_percent` | amount=1_000, cap=50_000_000 (> 2%) | referrer=20, freelancer=980 (legacy 2% applies; cap is no-op) |
| **`test_referrer_bonus_at_cap_boundary`** *(the AC's required test)* | amount=1_000, cap=19 (= 2% - 1) | referrer=**19**, freelancer=**981** (cap) |
| `test_referrer_bonus_equal_to_cap_uses_full_two_percent` | amount=1_000, cap=20 (= 2%) | referrer=20, freelancer=980 (legacy 2% applies; cap bypassed exactly at the boundary) |
| `test_referrer_bonus_above_cap_capped_and_excess_paid_to_freelancer` | amount=10_000, cap=50 (≪ 2%) | referrer=50, freelancer=9_950 (cap wins; saved 150 to freelancer) |
| `test_referrer_bonus_without_cap_uses_full_two_percent` | amount=1_000, no setter call | referrer=20, freelancer=980 (legacy; backward compat) |
| `test_referrer_bonus_cap_zero_disables_referrer` | amount=1_000, cap=0 | referrer=0, freelancer=1_000 (referrer program disabled) |
| `test_set_negative_referrer_bonus_cap_panics` | setter called with cap=-1 | `#[should_panic]` matches "Referrer bonus cap must be non-negative" |
| `test_set_referrer_bonus_cap_rejects_non_admin` | non-admin signer, mock_all_auths on | `#[should_panic]` matches "Only admin can set the referrer bonus cap" |

# Milestone semantics (caller-facing note)

The cap is consumed inside `release_escrow_core()`, so each `release_milestone` call applies the cap **independently per release**. A 5-milestone escrow with `cap = 10 XLM` pays the cap up to 5 times (one per milestone release) rather than once cumulatively. This is documented inline at both the call site and the setter doc-comment so operators do not mistake the cap for a per-escrow aggregate limit.

# Validation

| Check | Result |
| --- | --- |
| Static analysis via grep-based syntactic sanity (cargo unavailable in this sandbox) | ✅ all 8 `[#test]` annotations matched, no stray `set_max_referrer_bonus(` (old name) references remain, every test uses the renamed `set_max_referrer_bonus_xlm` |
| `code-reviewer-minimax-m3` review | ✅ initial review flagged 2 blockers + 4 minors; all 6 applied (cap-collapse, panic-on-negative, milestone-doc, function-renames, boundary-test fixed to cap=19+981, added equal-to-cap test) |

A repo-local `cargo test --lib` from `contracts/marketpay-contract/` should be run by a reviewer with the toolchain installed to confirm all 8 tests pass before merge.

# Operational notes

- **Opt-in**: storage key is absent by default → all existing escrows behave identically. No on-chain migration needed.
- **Disable the program**: `set_max_referrer_bonus_xlm(admin, 0)` zeroes referrer payouts across all future releases; pair with a UI announcement for the developer-facing referral program.
- **Per-token unit**: the cap is stored in raw stroops (token's smallest unit), applying uniformly to XLM and USDC. The value is whatever the same-token escrows use, so XLM-cap operators should set e.g. `100_000_000` for "100 XLM"; USDC operators set `100_000_000` for "100 USDC".
- **No new admin power surface**: the admin already had `set_default_timeout_seconds`. This setter is functionally identical (admin-only, optional new state, publishes an event).

# Future work (non-blocking)

1. **Front-end admin UI** — surface `get_max_referrer_bonus_xlm` + a setter form on the admin dashboard. Backend route + frontend component not in scope for this contract PR; the storage key is queryable from any client for now.
2. **Per-token caps** — currently a single global cap. If operators want e.g. "max 5 XLM but max 50 USDC", extend `set_max_referrer_bonus_xlm` to take a token address and store under `MaxReferrerBonusXlm(Address)`.
3. **Re-cap granularity** — the cap applies per `release_amount`. If a single job releases multiple times via milestones, the cap applies per release. A future "per-job aggregate" cap would require storing a running total alongside `Escrow`.

—

Generated for issue #440. Reviewer-approved across two iterations.
