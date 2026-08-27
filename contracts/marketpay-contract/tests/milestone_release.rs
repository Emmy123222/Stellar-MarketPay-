//! Adversarial test coverage for milestone release logic (Issue #1176).
//!
//! Exercises `release_milestone` / `reject_milestone` edge cases:
//!   - releasing the same milestone twice
//!   - releasing milestones out of order
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
    fn test_releasing_milestones_out_of_order_is_safe() {
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

        // Release the 60 % milestone before the 40 % one — order must not matter.
        contract.release_milestone(&job_id, &1u32, &client);
        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::InProgress);
        assert!(!escrow.milestones.get(0).unwrap().released);
        assert!(escrow.milestones.get(1).unwrap().released);

        // 60 % of 1000 = 600; fee = 600 * 1 % = 6 → freelancer gets 594.
        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 594);

        contract.release_milestone(&job_id, &0u32, &client);
        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        assert!(escrow.milestones.get(0).unwrap().released);
        assert!(escrow.milestones.get(1).unwrap().released);

        // 40 % of 1000 = 400; fee = 400 * 1 % = 4 → freelancer gets 396.
        // Total paid out = 594 + 396 = 990 (10 kept as platform fees).
        assert_eq!(token_client.balance(&freelancer), 990);
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
}
