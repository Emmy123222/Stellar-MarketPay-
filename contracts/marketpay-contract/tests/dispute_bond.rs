//! Adversarial and functional test coverage for the dispute bond (Issue #437,
//! Issue #1177).
//!
//! Exercises the configurable dispute bond mechanics:
//!   - raising a dispute without staking the required bond fails
//!   - a favourable ruling refunds the bond to the raiser
//!   - an unfavourable ruling slashes the bond to the winner
//!   - `set_dispute_bond` rejects non-admin callers and applies new amounts
//!
//! This is an integration test target: it links the crate as an rlib, which
//! `crate-type = ["cdylib", "rlib"]` enables. Snapshots land in
//! `test_snapshots/tests/` automatically.

#![allow(clippy::too_many_arguments)]

mod tests {
    use marketpay_contract::{
        CreateEscrowParams, EscrowStatus, MarketPayContract, MarketPayContractClient,
    };
    use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

    const BOND_AMOUNT: i128 = 500;
    const ESCROW_AMOUNT: i128 = 1_000;

    /// Register the contract, initialize it, set a fixed dispute bond and an
    /// arbitrator, and fund the client with `amount` tokens.
    ///
    /// Returns the client too so callers can inspect/use per-party balances.
    fn setup(
        env: &Env,
        amount: i128,
    ) -> (
        MarketPayContractClient<'_>,
        Address,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        contract.initialize(&admin, &admin, &String::from_str(&env, "1.0.0"));

        let client = Address::generate(env);
        let freelancer = Address::generate(env);
        let arbitrator = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&client, &amount);

        (contract, admin, client, freelancer, arbitrator, token_id)
    }

    fn create_started_escrow(
        contract: &MarketPayContractClient,
        _env: &Env,
        job_id: &String,
        client: &Address,
        freelancer: &Address,
        token_id: &Address,
    ) {
        contract.create_escrow(
            job_id,
            client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: ESCROW_AMOUNT,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
            },
        );
        contract.start_work(job_id, freelancer);
    }

    #[test]
    fn test_dispute_without_bond_fails_when_bond_required() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);
        contract.set_dispute_bond(&admin, &token_id, &BOND_AMOUNT);
        contract.set_arbitrator(&admin, &arbitrator);

        let job_id = String::from_str(&env, "bond-missing");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        // The freelancer has never been minted any bond tokens, so the required
        // bond cannot be staked and `raise_dispute` must fail.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.raise_dispute(&job_id, &freelancer);
        }));
        assert!(
            result.is_err(),
            "raise_dispute should fail without the bond"
        );

        // The escrow must not have been left in a Disputed state.
        assert_eq!(
            contract.get_escrow(&job_id).status,
            EscrowStatus::InProgress
        );
        assert!(contract.get_dispute_bond(&job_id).is_none());
    }

    #[test]
    fn test_dispute_bond_refunded_on_favourable_ruling() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);

        // Give the freelancer extra tokens so they can stake the bond.
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&freelancer, &BOND_AMOUNT);
        let token_client = token::Client::new(&env, &token_id);

        contract.set_dispute_bond(&admin, &token_id, &BOND_AMOUNT);
        contract.set_arbitrator(&admin, &arbitrator);

        let job_id = String::from_str(&env, "bond-favourable");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        let freelancer_balance_before = token_client.balance(&freelancer);

        // Raise the dispute — the freelancer stakes the bond.
        contract.raise_dispute(&job_id, &freelancer);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Disputed);
        let bond = contract.get_dispute_bond(&job_id).expect("bond recorded");
        assert_eq!(bond.caller, freelancer);
        assert_eq!(bond.amount, BOND_AMOUNT);
        // The bond was locked into the contract.
        assert_eq!(
            token_client.balance(&freelancer),
            freelancer_balance_before - BOND_AMOUNT
        );
        assert_eq!(
            token_client.balance(&contract.address),
            ESCROW_AMOUNT + BOND_AMOUNT
        );

        // Rule in favour of the freelancer (the bond caller).
        contract.resolve_dispute(&job_id, &arbitrator, &freelancer, &100, &0);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
        assert!(contract.get_dispute_bond(&job_id).is_none());

        // The bond is refunded to the raiser plus the 100% escrow payout.
        assert_eq!(
            token_client.balance(&freelancer),
            freelancer_balance_before + ESCROW_AMOUNT
        );
    }

    #[test]
    fn test_dispute_bond_slashed_on_unfavourable_ruling() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);

        // Give the freelancer extra tokens so they can stake the bond.
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&freelancer, &BOND_AMOUNT);
        let token_client = token::Client::new(&env, &token_id);

        contract.set_dispute_bond(&admin, &token_id, &BOND_AMOUNT);
        contract.set_arbitrator(&admin, &arbitrator);

        let job_id = String::from_str(&env, "bond-unfavourable");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        let freelancer_balance_before = token_client.balance(&freelancer);
        contract.raise_dispute(&job_id, &freelancer);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Disputed);
        assert_eq!(
            token_client.balance(&freelancer),
            freelancer_balance_before - BOND_AMOUNT
        );

        // Rule against the freelancer (the bond caller) — the client wins the
        // whole escrow (split 100 => winner keeps 100 %).
        contract.resolve_dispute(&job_id, &arbitrator, &client, &100, &0);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
        assert!(contract.get_dispute_bond(&job_id).is_none());

        // The bond is NOT refunded to the raiser...
        assert_eq!(
            token_client.balance(&freelancer),
            freelancer_balance_before - BOND_AMOUNT
        );
        // ...and the client recovered the escrow (100 % split) plus the bond
        // slashed to them. Net effect on the client: +BOND_AMOUNT (they already
        // owned the escrow principal).
        assert_eq!(token_client.balance(&client), 1_000_000 + BOND_AMOUNT);
    }

    #[test]
    #[should_panic(expected = "Only admin can update the dispute bond")]
    fn test_set_dispute_bond_rejected_for_non_admin() {
        let env = Env::default();
        let (contract, _admin, _client, _freelancer, _arbitrator, token_id) =
            setup(&env, 1_000_000);

        // A non-admin (here an inert address that is not the stored admin) must
        // not be able to change the bond configuration.
        let impostor = Address::generate(&env);
        contract.set_dispute_bond(&impostor, &token_id, &BOND_AMOUNT);
    }

    #[test]
    #[should_panic(expected = "Bond amount must be positive")]
    fn test_set_dispute_bond_rejects_non_positive_amount() {
        let env = Env::default();
        let (contract, admin, _client, _freelancer, _arbitrator, token_id) = setup(&env, 1_000_000);

        // Zero is treated as legacy no-bond config and must be rejected here.
        contract.set_dispute_bond(&admin, &token_id, &0);
    }

    #[test]
    fn test_set_dispute_bond_applies_new_amount() {
        let env = Env::default();
        let (contract, admin, _client, _freelancer, _arbitrator, token_id) = setup(&env, 1_000_000);

        assert_eq!(
            contract.get_dispute_bond_config(),
            (None, 0),
            "no bond configured by default"
        );

        contract.set_dispute_bond(&admin, &token_id, &BOND_AMOUNT);
        let (token, amount) = contract.get_dispute_bond_config();
        assert_eq!(token.as_ref(), Some(&token_id));
        assert_eq!(amount, BOND_AMOUNT);

        // A new amount applies for subsequent disputes.
        const NEW_BOND: i128 = 250;
        contract.set_dispute_bond(&admin, &token_id, &NEW_BOND);
        let (token, amount) = contract.get_dispute_bond_config();
        assert_eq!(token.as_ref(), Some(&token_id));
        assert_eq!(amount, NEW_BOND);
    }

    #[test]
    fn test_zero_cost_dispute_when_no_bond_configured() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);

        // Legacy zero-cost mode: no bond configured, arbitrator set.
        contract.set_arbitrator(&admin, &arbitrator);
        let job_id = String::from_str(&env, "bond-legacy");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        let token_client = token::Client::new(&env, &token_id);
        let freelancer_before = token_client.balance(&freelancer);

        contract.raise_dispute(&job_id, &freelancer);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Disputed);
        assert!(contract.get_dispute_bond(&job_id).is_none());
        // No tokens were moved for a dispute in zero-cost mode.
        assert_eq!(token_client.balance(&freelancer), freelancer_before);

        contract.resolve_dispute(&job_id, &arbitrator, &freelancer, &100, &0);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
        // Freelancer receives the full escrow.
        assert_eq!(
            token_client.balance(&freelancer),
            freelancer_before + ESCROW_AMOUNT
        );
    }

    #[test]
    fn test_resolve_dispute_zero_fee_full_payout() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);
        contract.set_arbitrator(&admin, &arbitrator);

        let job_id = String::from_str(&env, "fee-0-pct");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        let token_client = token::Client::new(&env, &token_id);
        contract.raise_dispute(&job_id, &freelancer);

        // 0% arbitrator fee -> arbitrator gets 0, winner (freelancer) gets 1000
        contract.resolve_dispute(&job_id, &arbitrator, &freelancer, &100, &0);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&arbitrator), 0);
        assert_eq!(token_client.balance(&freelancer), ESCROW_AMOUNT);
        assert_eq!(token_client.balance(&contract.address), 0);
    }

    #[test]
    fn test_resolve_dispute_5_percent_fee() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);
        contract.set_arbitrator(&admin, &arbitrator);

        let job_id = String::from_str(&env, "fee-5-pct");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        let token_client = token::Client::new(&env, &token_id);
        contract.raise_dispute(&job_id, &freelancer);

        // 500 bps (5%) fee: 1000 * 500 / 10000 = 50 tokens to arbitrator
        // Remaining 950 tokens to winner (freelancer at 100% split)
        contract.resolve_dispute(&job_id, &arbitrator, &freelancer, &100, &500);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&arbitrator), 50);
        assert_eq!(token_client.balance(&freelancer), 950);
        assert_eq!(token_client.balance(&contract.address), 0);
    }

    #[test]
    fn test_resolve_dispute_100_percent_fee_boundary() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);
        contract.set_arbitrator(&admin, &arbitrator);

        let job_id = String::from_str(&env, "fee-100-pct");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        let token_client = token::Client::new(&env, &token_id);
        contract.raise_dispute(&job_id, &freelancer);

        // 10000 bps (100%) fee: 1000 tokens to arbitrator, 0 to winner
        contract.resolve_dispute(&job_id, &arbitrator, &freelancer, &100, &10_000);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&arbitrator), ESCROW_AMOUNT);
        assert_eq!(token_client.balance(&freelancer), 0);
        assert_eq!(token_client.balance(&contract.address), 0);
    }

    #[test]
    fn test_resolve_dispute_5_percent_fee_with_split_payout() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);
        contract.set_arbitrator(&admin, &arbitrator);

        let job_id = String::from_str(&env, "fee-5-pct-split");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        let token_client = token::Client::new(&env, &token_id);
        contract.raise_dispute(&job_id, &freelancer);

        // 500 bps (5%) fee = 50 tokens to arbitrator
        // Remaining 950 tokens split 60/40:
        // Winner (client): 950 * 60 / 100 = 570 tokens (+ 1_000_000 - 1000 unspent client balance)
        // Loser (freelancer): 950 - 570 = 380 tokens
        // Total funds = 50 + 570 + 380 = 1000 tokens
        contract.resolve_dispute(&job_id, &arbitrator, &client, &60, &500);
        assert_eq!(contract.get_escrow(&job_id).status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&arbitrator), 50);
        assert_eq!(
            token_client.balance(&client),
            (1_000_000 - ESCROW_AMOUNT) + 570
        );
        assert_eq!(token_client.balance(&freelancer), 380);
        assert_eq!(token_client.balance(&contract.address), 0);
    }

    #[test]
    #[should_panic(expected = "Arbitrator fee cannot exceed 100% (10000 bps)")]
    fn test_resolve_dispute_rejects_fee_exceeding_100_percent() {
        let env = Env::default();
        let (contract, admin, client, freelancer, arbitrator, token_id) = setup(&env, 1_000_000);
        contract.set_arbitrator(&admin, &arbitrator);

        let job_id = String::from_str(&env, "fee-invalid");
        create_started_escrow(&contract, &env, &job_id, &client, &freelancer, &token_id);

        contract.raise_dispute(&job_id, &freelancer);
        contract.resolve_dispute(&job_id, &arbitrator, &freelancer, &100, &10_001);
    }
}
