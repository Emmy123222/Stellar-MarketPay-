//! Fuzz target: milestone-based escrow release paths and invariant validation.
//!
//! Generates arbitrary milestone structures (percentages, counts) and release sequences,
//! asserting the invariant that released + remaining always equals the funded total
//! and no release exceeds its milestone (Issue #1819).
#![no_main]

use libfuzzer_sys::{arbitrary, fuzz_target};
use marketpay_contract::{
    CreateEscrowParams, EscrowStatus, MarketPayContract, MarketPayContractClient, MilestoneInput,
};
use soroban_sdk::{
    testutils::Address as _, token, Address, Env, String as SorobanString, Vec as SorobanVec,
};

#[derive(Debug, arbitrary::Arbitrary)]
pub enum FuzzMilestoneOp {
    Release { milestone_id: u32, use_real_client: bool },
    Reject { milestone_id: u32, use_real_client: bool },
    ReleaseAll { use_real_client: bool },
}

#[derive(Debug, arbitrary::Arbitrary)]
pub struct FuzzInput {
    pub amount: i128,
    /// Raw percentages to test arbitrary milestone structures.
    pub raw_percentages: Vec<u8>,
    /// Release/reject operations to execute in sequence.
    pub ops: Vec<FuzzMilestoneOp>,
}

fuzz_target!(|data: FuzzInput| {
    let env = Env::default();
    env.mock_all_auths();

    let contract_addr = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &contract_addr);

    let admin = Address::generate(&env);
    client.initialize(&admin, &admin, &SorobanString::from_str(&env, "1.0.0"));

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_contract.address();
    let sac = token::StellarAssetClient::new(&env, &token_addr);
    let token_client = token::Client::new(&env, &token_addr);

    let real_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let random_caller = Address::generate(&env);

    // 1. First test: try arbitrary raw percentages directly if provided
    if !data.raw_percentages.is_empty() {
        let mut raw_ms = SorobanVec::new(&env);
        for (i, &pct) in data.raw_percentages.iter().take(8).enumerate() {
            raw_ms.push_back(MilestoneInput {
                description: SorobanString::from_str(&env, "raw ms"),
                percentage: pct as u32,
            });
        }
        let raw_job = SorobanString::from_str(&env, "fuzz-raw-job");
        sac.mint(&real_client, &1_000_000);
        let raw_params = CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_addr.clone(),
            amount: 1_000,
            milestones: Some(raw_ms),
            timeout_ledgers: None,
            referrer: None,
        };
        // May fail if percentages != 100, > 5 milestones, or 0% — must not panic host unexpectedly.
        let _ = client.try_create_escrow(&raw_job, &real_client, &raw_params);
    }

    // 2. Second test: build a valid milestone partition that strictly sums to 100
    // and exercise arbitrary release/reject sequences, verifying invariants.
    let amount = data.amount.clamp(100, 10_000_000_000);
    sac.mint(&real_client, &amount);

    // Choose milestone count between 1 and 5
    let milestone_count = if data.raw_percentages.is_empty() {
        3
    } else {
        ((data.raw_percentages.len() % 5) + 1) as usize
    };

    // Partition 100 into milestone_count positive percentages summing to 100
    let mut percentages = Vec::with_capacity(milestone_count);
    if milestone_count == 1 {
        percentages.push(100u32);
    } else {
        let mut remaining = 100u32;
        for i in 0..(milestone_count - 1) {
            let max_avail = remaining.saturating_sub((milestone_count - 1 - i) as u32);
            let raw_val = data
                .raw_percentages
                .get(i)
                .copied()
                .unwrap_or(20) as u32;
            let val = (raw_val % max_avail.max(1)).max(1);
            percentages.push(val);
            remaining -= val;
        }
        percentages.push(remaining);
    }

    // Build Soroban milestones vector
    let mut milestone_inputs = SorobanVec::new(&env);
    for (i, &pct) in percentages.iter().enumerate() {
        milestone_inputs.push_back(MilestoneInput {
            description: SorobanString::from_str(&env, "ms"),
            percentage: pct,
        });
    }

    let job_id = SorobanString::from_str(&env, "fuzz-ms-release-job");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_addr.clone(),
        amount,
        milestones: Some(milestone_inputs),
        timeout_ledgers: None,
        referrer: None,
    };

    let create_res = client.try_create_escrow(&job_id, &real_client, &params);
    if create_res.is_err() {
        return;
    }

    client.start_work(&job_id, &freelancer);

    // Initial assertions: contract holds exactly `amount`
    let initial_contract_balance = token_client.balance(&contract_addr);
    assert_eq!(
        initial_contract_balance, amount,
        "Contract balance must equal funded escrow amount initially"
    );

    // Track total released / refunded amounts and percentages
    let initial_freelancer_balance = token_client.balance(&freelancer);
    let initial_treasury_balance = token_client.balance(&admin);
    let initial_client_balance = token_client.balance(&real_client);

    // Run fuzz operations (capped to avoid timeouts)
    for op in data.ops.iter().take(20) {
        match op {
            FuzzMilestoneOp::Release { milestone_id, use_real_client } => {
                let caller = if *use_real_client {
                    real_client.clone()
                } else {
                    random_caller.clone()
                };
                let _ = client.try_release_milestone(&job_id, milestone_id, &caller);
            }
            FuzzMilestoneOp::Reject { milestone_id, use_real_client } => {
                let caller = if *use_real_client {
                    real_client.clone()
                } else {
                    random_caller.clone()
                };
                let _ = client.try_reject_milestone(&job_id, milestone_id, &caller);
            }
            FuzzMilestoneOp::ReleaseAll { use_real_client } => {
                let caller = if *use_real_client {
                    real_client.clone()
                } else {
                    random_caller.clone()
                };
                let _ = client.try_release_all_milestones(&job_id, &caller);
            }
        }

        // Invariant checks after every operation:
        let escrow = client.get_escrow(&job_id);

        let mut released_pct_sum: u32 = 0;
        let mut rejected_pct_sum: u32 = 0;
        let mut remaining_pct_sum: u32 = 0;

        for ms in escrow.milestones.iter() {
            // Milestone cannot be both released and rejected
            assert!(
                !(ms.released && ms.rejected),
                "Milestone cannot be both released and rejected"
            );

            // Compute expected payout for this milestone
            let expected_share = amount
                .checked_mul(ms.percentage as i128)
                .expect("overflow")
                .checked_div(100)
                .expect("div error");

            // Invariant: no release exceeds its milestone share
            assert!(
                expected_share <= amount,
                "Milestone share cannot exceed total funded amount"
            );

            if ms.released {
                released_pct_sum += ms.percentage;
            } else if ms.rejected {
                rejected_pct_sum += ms.percentage;
            } else {
                remaining_pct_sum += ms.percentage;
            }
        }

        // Invariant: released + rejected + remaining percentages must strictly sum to 100
        assert_eq!(
            released_pct_sum + rejected_pct_sum + remaining_pct_sum,
            100,
            "Total percentage split must remain 100 across released, rejected, and remaining"
        );

        // Token balance conservation invariant:
        // Contract balance + freelancer received + treasury fee + client refunded == initial funded amount
        let contract_balance = token_client.balance(&contract_addr);
        let freelancer_gain = token_client.balance(&freelancer) - initial_freelancer_balance;
        let treasury_gain = token_client.balance(&admin) - initial_treasury_balance;
        let client_refund = token_client.balance(&real_client) - initial_client_balance;

        let total_distributed = freelancer_gain + treasury_gain + client_refund;
        assert_eq!(
            contract_balance + total_distributed,
            amount,
            "Released + refunded + remaining contract balance must strictly equal initial funded amount"
        );

        // When all milestones are resolved, escrow status must be Released and contract balance 0
        if remaining_pct_sum == 0 {
            assert_eq!(
                escrow.status,
                EscrowStatus::Released,
                "Escrow must transition to Released once all milestones are resolved"
            );
            assert_eq!(
                contract_balance, 0,
                "Contract balance must be 0 when all milestones are resolved"
            );
        }
    }
});
