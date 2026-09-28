//! Property-based tests for milestone percentage validation in
//! `create_escrow_internal`. Gated behind the `proptest` feature:
//!
//!   cargo test --features proptest milestone_pct_proptests

extern crate std;

use crate::*;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig},
    token, Address, Env, String, Vec,
};

const MAX_MILESTONES: usize = 5;

fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    contract.initialize(&admin, &treasury);

    let client = Address::generate(env);
    let freelancer = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(&client, &1_000);

    (contract, client, freelancer, token_id)
}

/// Calls `create_escrow` with the given milestone percentages and reports
/// whether the contract accepted them. A contract panic surfaces as `Err`.
fn try_create(percentages: &[u32]) -> bool {
    // Inputs are random, so a per-test snapshot would churn on every run.
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "prop-job");

    let mut ms = Vec::new(&env);
    for pct in percentages {
        ms.push_back(MilestoneInput {
            description: String::from_str(&env, "Milestone"),
            percentage: *pct,
        });
    }

    let ok = contract
        .try_create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer,
                token: token_id,
                amount: 1_000,
                milestones: Some(ms),
                timeout_ledgers: None,
                referrer: None,
            },
        )
        .is_ok();

    if ok {
        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.milestones.len() as usize, percentages.len());
        for (i, pct) in percentages.iter().enumerate() {
            assert_eq!(escrow.milestones.get(i as u32).unwrap().percentage, *pct);
        }
    }
    ok
}

/// Any percentages whose (u64) sum is not 100. Mixes small values (near the
/// 100 boundary), zeros, and arbitrary u32s (overflow territory), and allows
/// empty vectors and lengths above the 5-milestone cap.
fn invalid_sum_percentages() -> impl Strategy<Value = std::vec::Vec<u32>> {
    let pct = prop_oneof![
        4 => 0u32..=100,
        1 => Just(0u32),
        1 => any::<u32>(),
    ];
    proptest::collection::vec(pct, 0..=8).prop_filter("sum must not be 100", |v| {
        v.iter().map(|p| *p as u64).sum::<u64>() != 100
    })
}

/// 1..=5 strictly positive percentages that sum to exactly 100, built by
/// cutting the interval [0, 100] at `len - 1` distinct interior points.
fn valid_percentages() -> impl Strategy<Value = std::vec::Vec<u32>> {
    (1..=MAX_MILESTONES).prop_flat_map(|len| {
        let interior: std::vec::Vec<u32> = (1..100).collect();
        proptest::sample::subsequence(interior, len - 1).prop_map(|cuts| {
            let mut bounds = std::vec![0u32];
            bounds.extend(cuts);
            bounds.push(100);
            bounds.windows(2).map(|w| w[1] - w[0]).collect()
        })
    })
}

proptest! {
    /// sum(percentages) != 100 → create_escrow rejects.
    #[test]
    fn prop_sum_not_100_rejected(pcts in invalid_sum_percentages()) {
        prop_assert!(!try_create(&pcts), "accepted percentages {:?}", pcts);
    }

    /// sum(percentages) == 100 AND len <= 5 (all entries positive)
    /// → create_escrow succeeds and stores the milestones verbatim.
    #[test]
    fn prop_sum_100_within_cap_accepted(pcts in valid_percentages()) {
        prop_assert!(try_create(&pcts), "rejected percentages {:?}", pcts);
    }

    /// A zero-percent entry is rejected even when the total is 100, so the
    /// "sum == 100" acceptance property only holds for positive entries.
    #[test]
    fn prop_zero_entry_rejected_even_if_sum_100(
        pcts in valid_percentages().prop_filter("room for a zero", |v| v.len() < MAX_MILESTONES),
        pos in any::<prop::sample::Index>(),
    ) {
        let mut pcts = pcts;
        let at = pos.index(pcts.len() + 1);
        pcts.insert(at, 0);
        prop_assert!(!try_create(&pcts), "accepted percentages {:?}", pcts);
    }

    /// More than 5 milestones summing to 100 is rejected by the cap.
    #[test]
    fn prop_sum_100_over_cap_rejected(len in (MAX_MILESTONES + 1)..=20usize) {
        let mut pcts = std::vec![1u32; len - 1];
        pcts.push(100 - (len as u32 - 1));
        prop_assert!(!try_create(&pcts), "accepted percentages {:?}", pcts);
    }
}

#[test]
fn edge_cases_from_issue() {
    assert!(!try_create(&[]));
    assert!(!try_create(&[0, 0, 0]));
    assert!(try_create(&[100]));
    assert!(try_create(&[20, 20, 20, 20, 20]));
    assert!(!try_create(&[20, 20, 20, 20, 20, 0]));
    assert!(!try_create(&[u32::MAX, 101]));
}
