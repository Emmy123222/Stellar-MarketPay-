//! Issue #437 — Dispute bond mechanism tests for the MarketPay contract.
//!
//! Included from `lib.rs` via `#[cfg(test)] mod dispute_bond_tests;`
//! at the bottom of the crate root.  All test helpers use the same naming
//! convention as the existing `event_tests` / `timeout_tests` modules so
//! their setup helpers can be lifted in the future.

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

fn setup(
    env: &Env,
) -> (
    MarketPayContractClient,
    Address, // admin
    Address, // buyer (escrow client)
    Address, // freelancer
    Address, // token (XLM SAC)
) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    contract.initialize(&admin);

    let buyer = Address::generate(env);
    let freelancer = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    // Seed the buyer with enough XLM to cover the escrow amount.
    token_admin.mint(&buyer, &10_000);

    (contract, admin, buyer, freelancer, token_id)
}

fn create_basic_escrow(
    contract: &MarketPayContractClient,
    buyer: &Address,
    freelancer: &Address,
    token_id: &Address,
    env: &Env,
    job_suffix: &str,
    amount: i128,
) -> String {
    let job_id = String::from_str(env, job_suffix);
    contract.create_escrow(
        &job_id,
        buyer,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );
    job_id
}

fn mint_extra(env: &Env, token_id: &Address, to: &Address, amount: i128) {
    let token_admin = token::StellarAssetClient::new(env, token_id);
    token_admin.mint(to, &amount);
}

// ─── 1. Legacy backward compat ───────────────────────────────────────────────

/// When no `DisputeBondConfig` is configured, `raise_dispute` operates as
/// the pre-#437 zero-cost placeholder.  No bond is locked, no record
/// exists, and resolve_dispute settlements still work even though there
/// is nothing to slash/return.
#[test]
fn test_dispute_bond_legacy_zero_cost_mode_works() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);

    let job_id = create_basic_escrow(
        &contract,
        &buyer,
        &freelancer,
        &token_id,
        &env,
        "legacy_dispute",
        1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer);

    assert_eq!(contract.get_status(&job_id), EscrowStatus::Disputed);
    assert_eq!(contract.get_dispute_bond_config(), (None, 0i128));
    assert!(contract.get_dispute_bond(&job_id).is_none());

    // Admin can still resolve in legacy mode — there's just nothing to settle.
    contract.resolve_dispute(&admin, &job_id, &true);
    assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Refunded);
}

// ─── 2. set_dispute_bond admin-only ──────────────────────────────────────────

#[test]
#[should_panic(expected = "Only admin can update the dispute bond")]
fn test_set_dispute_bond_unauthorized_panics() {
    let env = Env::default();
    let (contract, _admin, _buyer, _freelancer, token_id) = setup(&env);
    let impostor = Address::generate(&env);
    contract.set_dispute_bond(&impostor, &token_id, &100);
}

#[test]
fn test_set_dispute_bond_stores_config() {
    let env = Env::default();
    let (contract, admin, _buyer, _freelancer, token_id) = setup(&env);
    contract.set_dispute_bond(&admin, &token_id, &200);
    let cfg = contract.get_dispute_bond_config();
    assert_eq!(cfg.0, Some(token_id));
    assert_eq!(cfg.1, 200i128);
}

// ─── 3. raise_dispute locks the bond ─────────────────────────────────────────

#[test]
fn test_raise_dispute_locks_bond() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);

    let escrow_amount = 1_000i128;
    let bond = 500i128;
    contract.set_dispute_bond(&admin, &token_id, &bond);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env, "locked_bond", escrow_amount,
    );
    contract.start_work(&job_id, &freelancer);

    let buyer_before = token::Client::new(&env, &token_id).balance(&buyer);
    contract.raise_dispute(&job_id, &buyer);
    let buyer_after = token::Client::new(&env, &token_id).balance(&buyer);

    assert_eq!(buyer_before - buyer_after, bond);
    assert_eq!(contract.get_status(&job_id), EscrowStatus::Disputed);

    let recorded = contract.get_dispute_bond(&job_id).unwrap();
    assert_eq!(recorded.caller, buyer);
    assert_eq!(recorded.amount, bond);
    assert_eq!(recorded.token, token_id);
}

// ─── 4. raise_dispute without sufficient balance panics ──────────────────────

#[test]
#[should_panic]
fn test_raise_dispute_insufficient_balance_panics() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);

    // Escrow of 1_000 leaves the buyer with 9_000 — bond of 5_000 is fine,
    // but raising the bond to 10_000 minus 1_000 escrowed = 9_000 remaining
    // is insufficient.  We pick a bond larger than the buyer's full balance
    // to trigger a clean panic.
    contract.set_dispute_bond(&admin, &token_id, &50_000);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env, "no_balance_dispute", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer);
}

// ─── 5. raise_dispute twice panics (already disputed) ────────────────────────

#[test]
#[should_panic]
fn test_raise_dispute_twice_panics() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);
    contract.set_dispute_bond(&admin, &token_id, &500);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env, "twice_dispute", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer);
    contract.raise_dispute(&job_id, &buyer);
}

// ─── 6. resolve_dispute 4-cell matrix ────────────────────────────────────────
//
// Settlement table (from the design):
//   caller = CLIENT,   client_wins = TRUE  → return bond to client, refund escrow
//   caller = CLIENT,   client_wins = FALSE → slash bond to freelancer, release escrow
//   caller = FREELANCER, client_wins = TRUE  → slash bond to client, refund escrow
//   caller = FREELANCER, client_wins = FALSE → return bond to freelancer, release escrow

#[test]
fn test_resolve_dispute_client_wins_when_caller_is_client() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);
    let bond = 500i128;
    contract.set_dispute_bond(&admin, &token_id, &bond);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env,
        "c1_client_wins_caller_is_client", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer);
    contract.resolve_dispute(&admin, &job_id, &true);

    assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Refunded);
    assert!(contract.get_dispute_bond(&job_id).is_none());

    let tc = token::Client::new(&env, &token_id);
    // Buyer: 10_000 − 1_000 escrow − 500 bond + 1_000 refund + 500 returned bond = 10_000
    assert_eq!(tc.balance(&buyer), 10_000);
    assert_eq!(tc.balance(&freelancer), 0);
}

#[test]
fn test_resolve_dispute_freelancer_wins_when_caller_is_client() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);
    let bond = 500i128;
    contract.set_dispute_bond(&admin, &token_id, &bond);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env,
        "c2_freelancer_wins_caller_is_client", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer); // client raises then loses
    contract.resolve_dispute(&admin, &job_id, &false);

    assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
    assert!(contract.get_dispute_bond(&job_id).is_none());

    let tc = token::Client::new(&env, &token_id);
    // Freelancer: 0 + 1_000 escrow + 500 slashed bond = 1_500
    // Buyer: 10_000 − 1_000 escrow − 500 bond (slashed) = 8_500
    assert_eq!(tc.balance(&freelancer), 1_500);
    assert_eq!(tc.balance(&buyer), 8_500);
}

#[test]
fn test_resolve_dispute_freelancer_wins_when_caller_is_freelancer() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);
    let bond = 500i128;
    contract.set_dispute_bond(&admin, &token_id, &bond);
    // Freelancer needs balance to pay the bond.
    mint_extra(&env, &token_id, &freelancer, 1_500);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env,
        "c3_freelancer_wins_caller_is_freelancer", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &freelancer);
    contract.resolve_dispute(&admin, &job_id, &false);

    assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
    assert!(contract.get_dispute_bond(&job_id).is_none());

    let tc = token::Client::new(&env, &token_id);
    // Freelancer: 1_500 mint − 500 bond (locked) + 1_000 escrow + 500 returned bond = 2_500
    // Buyer: 10_000 − 1_000 escrow = 9_000
    assert_eq!(tc.balance(&freelancer), 2_500);
    assert_eq!(tc.balance(&buyer), 9_000);
}

#[test]
fn test_resolve_dispute_client_wins_when_caller_is_freelancer() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);
    let bond = 500i128;
    contract.set_dispute_bond(&admin, &token_id, &bond);
    mint_extra(&env, &token_id, &freelancer, 1_500);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env,
        "c4_client_wins_caller_is_freelancer", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &freelancer); // freelancer raises then loses
    contract.resolve_dispute(&admin, &job_id, &true);

    assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Refunded);
    assert!(contract.get_dispute_bond(&job_id).is_none());

    let tc = token::Client::new(&env, &token_id);
    // Buyer: 10_000 − 1_000 escrow + 1_000 refund + 500 slashed bond = 10_500
    // Freelancer: 1_500 mint − 500 bond (slashed) = 1_000
    assert_eq!(tc.balance(&buyer), 10_500);
    assert_eq!(tc.balance(&freelancer), 1_000);
}

// ─── 7. Admin authorization & state guards ───────────────────────────────────

#[test]
#[should_panic(expected = "Only admin can resolve a dispute")]
fn test_resolve_dispute_unauthorized_panics() {
    let env = Env::default();
    let (contract, _admin, buyer, freelancer, token_id) = setup(&env);
    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env, "unauth_resolve", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer);
    let impostor = Address::generate(&env);
    contract.resolve_dispute(&impostor, &job_id, &true);
}

#[test]
#[should_panic(expected = "Escrow is not in Disputed state")]
fn test_resolve_dispute_not_disputed_panics() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);
    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env, "not_disputed", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.resolve_dispute(&admin, &job_id, &true);
}

#[test]
#[should_panic]
fn test_resolve_dispute_twice_panics() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);
    contract.set_dispute_bond(&admin, &token_id, &500);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env, "twice_resolve", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer);
    contract.resolve_dispute(&admin, &job_id, &true);
    contract.resolve_dispute(&admin, &job_id, &true);
}

// ─── 8. Bond snapshot is preserved across admin reconfiguration ─────────────

/// Admin bumps the bond amount AFTER the dispute is raised and BEFORE
/// resolution.  The locked bond is snapshotted at raise-time, so the
/// payout still uses the OLD amount — protecting the bond-caller from
/// retroactive rule changes.
#[test]
fn test_bond_snapshot_preserved_after_admin_reconfig() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);

    contract.set_dispute_bond(&admin, &token_id, &500);
    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env, "snapshot_bond", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer);

    // Admin raises bond AFTER dispute is raised.
    contract.set_dispute_bond(&admin, &token_id, &9_999);

    // Client wins → escrow refund + SNAPSHOT bond refund (500, not 9_999).
    contract.resolve_dispute(&admin, &job_id, &true);

    let tc = token::Client::new(&env, &token_id);
    assert_eq!(tc.balance(&buyer), 10_000); // 10k − escrow − bond + escrow + snapshot bond
}

// ─── 9. Zero bond amount explicitly rejected ─────────────────────────────────

/// Defensive: a non-zero `token` but `amount == 0` would degenerate into
/// "lock nothing but still require admin migration", so it panics with a
/// descriptive message.
#[test]
#[should_panic(expected = "Dispute bond misconfigured")]
fn test_set_dispute_bond_zero_amount_with_raise_panics() {
    let env = Env::default();
    let (contract, admin, buyer, freelancer, token_id) = setup(&env);
    contract.set_dispute_bond(&admin, &token_id, &0);

    let job_id = create_basic_escrow(
        &contract, &buyer, &freelancer, &token_id, &env, "zero_bond_amount", 1_000,
    );
    contract.start_work(&job_id, &freelancer);
    contract.raise_dispute(&job_id, &buyer);
}
