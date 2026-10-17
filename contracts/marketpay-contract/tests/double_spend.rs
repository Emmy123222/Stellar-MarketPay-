#![allow(clippy::too_many_arguments)]

mod tests {
    use marketpay_contract::{
        CreateEscrowParams, EscrowStatus, MarketPayContract, MarketPayContractClient,
        ContractError,
    };
    use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

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
        contract.initialize(&admin, &admin, &String::from_str(&env, "1.0.0"));

        let client = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&client, &amount);

        (contract, admin, client, freelancer, token_id)
    }

    #[test]
    fn test_concurrent_release_and_refund_guards_against_double_spend() {
        let env = Env::default();
        let amount = 1000;
        let (contract, _admin, client, freelancer, token_id) = setup(&env, amount);
        let token_client = token::Client::new(&env, &token_id);

        let job_id = String::from_str(&env, "job1");
        contract.create_escrow(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
            },
        );

        // Before work starts, the contract has 1000 tokens
        assert_eq!(token_client.balance(&contract.address), 1000);

        // First, refund the escrow
        contract.refund_escrow(&job_id, &client);

        // Verify status
        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);

        // Now, attempt to release the escrow. It should fail with AlreadySettled
        let result = contract.try_release_escrow(&job_id, &client);
        assert!(result.is_err());

        // We could also do it the other way: release then refund
        let job_id2 = String::from_str(&env, "job2");
        token::StellarAssetClient::new(&env, &token_id).mint(&client, &amount);
        contract.create_escrow(
            &job_id2,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
            },
        );
        contract.start_work(&job_id2, &freelancer);
        contract.release_escrow(&job_id2, &client);
        
        let escrow2 = contract.get_escrow(&job_id2);
        assert_eq!(escrow2.status, EscrowStatus::Released);

        // Attempting to refund now should fail with AlreadySettled
        let refund_result = contract.try_refund_escrow(&job_id2, &client);
        assert!(refund_result.is_err());
    }
}
