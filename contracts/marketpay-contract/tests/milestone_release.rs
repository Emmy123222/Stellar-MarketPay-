//! Adversarial test coverage for milestone release logic (Issue #1176).
//!
//! Exercises `release_milestone` / `reject_milestone` edge cases:
//!   - releasing the same milestone twice
//!   - rejecting milestone releases out of order
//!   - milestone percentages that do not sum to 100
//!   - releasing / rejecting a milestone that was already rejected
//!   - rejecting the same milestone twice
//!   - caller and state guard rails (non-client, invalid id, missing escrow)
//!
//! This is an integration test target: it links the crate as an rlib, which
//! `crate-type = ["cdylib", "rlib"]` (Issue #1172) enables. Snapshots land in
//! `test_snapshots/tests/` automatically.

#![allow(clippy::too_many_arguments)]

mod tests {
    use marketpay_contract::{
        CreateEscrowParams, EscrowStatus, MarketPayContract, MarketPayContractClient,
        MilestoneInput,
    };
    use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Vec};

    /// Register the contract, initialize it and fund the client with `amount`
    /// tokens. The default platform fee (100 bps = 1 %) applies.
    fn setup(
        env: &Env,
        amount: i128,
    ) -> (
        MarketPayContractClient<'_>,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        contract.initialize(&admin, &admin);

        let client = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&client, &amount);

        (contract, admin, client, freelancer, token_id)
    }

    fn milestone_inputs(env: &Env, percentages: &[u32]) -> soroban_sdk::Vec<MilestoneInput> {
        let mut ms = Vec::new(env);
        for (i, pct) in percentages.iter().enumerate() {
            ms.push_back(MilestoneInput {
                description: String::from_str(env, &format!("Milestone {i}")),
                percentage: *pct,
            });
        }
        ms
    }

    fn create_milestone_escrow(
        contract: &MarketPayContractClient,
        env: &Env,
        job_id: &String,
        client: &Address,
        freelancer: &Address,
        token_id: &Address,
        amount: i128,
        percentages: &[u32],
    ) {
        contract.create_escrow(
            job_id,
            client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount,
                milestones: Some(milestone_inputs(env, percentages)),
                timeout_ledgers: None,
                referrer: None,
            },
        );
    }

    #[test]
    #[should_panic(expected = "Milestone already released")]
    fn test_releasing_same_milestone_twice_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-double-release");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        contract.release_milestone(&job_id, &0u32, &client);
        // Second release of the same milestone must be rejected.
        contract.release_milestone(&job_id, &0u32, &client);
    }

    #[test]
    #[should_panic(expected = "Previous milestone not approved")]
    fn test_releasing_milestones_out_of_order_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-out-of-order");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        // Milestone 2 cannot be released while milestone 1 is pending.
        contract.release_milestone(&job_id, &1u32, &client);
    }

    #[test]
    #[should_panic(expected = "Milestone percentages must sum to 100")]
    fn test_percentages_summing_over_100_rejected() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-pct-over-100");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[60, 60],
        );
    }

    #[test]
    #[should_panic(expected = "Milestone percentages must sum to 100")]
    fn test_percentages_summing_under_100_rejected() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-pct-under-100");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 40],
        );
    }

    #[test]
    #[should_panic(expected = "Milestone percentages must sum to 100")]
    fn test_single_milestone_not_100_rejected() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-pct-single");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[50],
        );
    }

    #[test]
    #[should_panic(expected = "Milestone already rejected")]
    fn test_releasing_rejected_milestone_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-release-rejected");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        contract.reject_milestone(&job_id, &0u32, &client);
        // A rejected milestone can no longer be released.
        contract.release_milestone(&job_id, &0u32, &client);
    }

    #[test]
    #[should_panic(expected = "Milestone already rejected")]
    fn test_rejecting_same_milestone_twice_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-double-reject");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        contract.reject_milestone(&job_id, &0u32, &client);
        contract.reject_milestone(&job_id, &0u32, &client);
    }

    #[test]
    #[should_panic(expected = "Only the client can release a milestone")]
    fn test_release_milestone_unauthorized_caller_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-unauthorized");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        // The freelancer is not the escrow client and must not release milestones.
        contract.release_milestone(&job_id, &0u32, &freelancer);
    }

    #[test]
    #[should_panic(expected = "Invalid milestone id")]
    fn test_release_milestone_invalid_id_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-invalid-id");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        // Milestones are ids 0..=1 — id 2 does not exist.
        contract.release_milestone(&job_id, &2u32, &client);
    }

    #[test]
    #[should_panic(expected = "Escrow not found")]
    fn test_release_milestone_unknown_escrow_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, _token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-no-escrow");

        contract.release_milestone(&job_id, &0u32, &client);
        let _ = &freelancer; // freelancer unused in this path
    }

    #[test]
    #[should_panic(expected = "Cannot release milestone in current status")]
    fn test_release_milestone_after_escrow_released_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-after-release");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        contract.release_milestone(&job_id, &0u32, &client);
        contract.release_milestone(&job_id, &1u32, &client);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);

        // Everything is already released — the escrow is closed.
        contract.release_milestone(&job_id, &0u32, &client);
    }

    // ─── release_all_milestones (Issue #1480) ─────────────────────────────

    #[test]
    fn test_release_all_milestones_transfers_all_balances() {
        let env = Env::default();
        let (contract, admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-batch-release-all");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[20, 30, 50],
        );
        contract.start_work(&job_id, &freelancer);

        contract.release_all_milestones(&job_id, &client);

        // Every milestone is released and the escrow closes itself.
        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        assert_eq!(escrow.milestones.len(), 3);
        for i in 0..escrow.milestones.len() {
            let ms = escrow.milestones.get(i).unwrap();
            assert!(ms.released, "milestone {i} should be released");
            assert!(!ms.rejected);
        }

        // 1000 total: 1 % platform fee = 10 → freelancer 990, treasury 10,
        // and the contract keeps nothing.
        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 990);
        assert_eq!(token_client.balance(&admin), 10);
        assert_eq!(token_client.balance(&contract.address), 0);
    }

    #[test]
    fn test_release_all_milestones_skips_already_released() {
        let env = Env::default();
        let (contract, admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-batch-partial");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[20, 30, 50],
        );
        contract.start_work(&job_id, &freelancer);

        // 20 % of 1000 = 200; fee = 2 → freelancer gets 198.
        contract.release_milestone(&job_id, &0u32, &client);
        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 198);

        // The batch mops up the two outstanding milestones.
        contract.release_all_milestones(&job_id, &client);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&freelancer), 990);
        assert_eq!(token_client.balance(&admin), 10);
    }

    #[test]
    fn test_release_all_milestones_equivalent_to_sequential_release() {
        let env = Env::default();
        let (contract, _admin, batch_client, batch_freelancer, token_id) = setup(&env, 1_000);

        // Second escrow with its own client/freelancer so balances don't mix.
        let seq_client = Address::generate(&env);
        let seq_freelancer = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token_id).mint(&seq_client, &1_000);

        let batch_job = String::from_str(&env, "ms-batch-equivalent-a");
        let seq_job = String::from_str(&env, "ms-batch-equivalent-b");
        let percentages = [20, 30, 50];

        create_milestone_escrow(
            &contract,
            &env,
            &batch_job,
            &batch_client,
            &batch_freelancer,
            &token_id,
            1_000,
            &percentages,
        );
        create_milestone_escrow(
            &contract,
            &env,
            &seq_job,
            &seq_client,
            &seq_freelancer,
            &token_id,
            1_000,
            &percentages,
        );

        contract.start_work(&batch_job, &batch_freelancer);
        contract.start_work(&seq_job, &seq_freelancer);

        // One batch call vs. three sequential single-milestone calls.
        contract.release_all_milestones(&batch_job, &batch_client);
        contract.release_milestone(&seq_job, &0u32, &seq_client);
        contract.release_milestone(&seq_job, &1u32, &seq_client);
        contract.release_milestone(&seq_job, &2u32, &seq_client);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&batch_freelancer), 990);
        assert_eq!(
            token_client.balance(&batch_freelancer),
            token_client.balance(&seq_freelancer)
        );

        let batch_escrow = contract.get_escrow(&batch_job);
        let seq_escrow = contract.get_escrow(&seq_job);
        assert_eq!(batch_escrow.status, EscrowStatus::Released);
        assert_eq!(batch_escrow.status, seq_escrow.status);
        for i in 0..batch_escrow.milestones.len() {
            assert_eq!(
                batch_escrow.milestones.get(i).unwrap().released,
                seq_escrow.milestones.get(i).unwrap().released
            );
        }
    }

    #[test]
    #[should_panic(expected = "Cannot batch release: a milestone was rejected")]
    fn test_release_all_milestones_panics_when_milestone_rejected() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-batch-rejected");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        // A single rejected milestone blocks the whole batch.
        contract.reject_milestone(&job_id, &1u32, &client);
        contract.release_all_milestones(&job_id, &client);
    }

    #[test]
    #[should_panic(expected = "Only the client can release a milestone")]
    fn test_release_all_milestones_unauthorized_caller_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-batch-unauthorized");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);

        contract.release_all_milestones(&job_id, &freelancer);
    }

    #[test]
    #[should_panic(expected = "Escrow has no milestones")]
    fn test_release_all_milestones_without_milestones_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-batch-no-milestones");

        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
            },
        );
        contract.start_work(&job_id, &freelancer);

        contract.release_all_milestones(&job_id, &client);
    }

    #[test]
    #[should_panic(expected = "Cannot release milestone in current status")]
    fn test_release_all_milestones_after_escrow_released_panics() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env, 1_000);
        let job_id = String::from_str(&env, "ms-batch-after-release");

        create_milestone_escrow(
            &contract,
            &env,
            &job_id,
            &client,
            &freelancer,
            &token_id,
            1_000,
            &[40, 60],
        );
        contract.start_work(&job_id, &freelancer);
        contract.release_all_milestones(&job_id, &client);

        // The escrow is already Released — a second batch must be rejected.
        contract.release_all_milestones(&job_id, &client);
    }
}
