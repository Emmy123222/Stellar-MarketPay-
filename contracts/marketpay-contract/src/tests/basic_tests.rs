use crate::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

#[test]
fn test_initialize() {
    let env = Env::default();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury);
    assert_eq!(client.get_admin(), admin);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_init_panics() {
    let env = Env::default();
    let id = env.register(MarketPayContract, ());
    let c = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    c.initialize(&admin, &treasury);
    c.initialize(&admin, &treasury);
}

#[test]
fn test_escrow_count_starts_zero() {
    let env = Env::default();
    let id = env.register(MarketPayContract, ());
    let c = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    c.initialize(&admin, &treasury);
    assert_eq!(c.get_escrow_count(), 0);
}

#[test]
fn test_governance_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury);

    let proposer = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);

    // Give voters completed jobs directly into storage
    env.as_contract(&id, || {
        env.storage()
            .instance()
            .set(&DataKey::CompletedJobs(voter1.clone()), &1u32);
        env.storage()
            .instance()
            .set(&DataKey::CompletedJobs(voter2.clone()), &1u32);
    });

    let title = String::from_str(&env, "Test Proposal");
    let desc = String::from_str(&env, "Description");
    let pid = client.create_proposal(&proposer, &title, &desc, &100);

    assert_eq!(pid, 1);
    let prop = client.get_proposal(&pid);
    assert_eq!(prop.title, title);

    // Vote
    client.cast_vote(&voter1, &pid, &true);
    client.cast_vote(&voter2, &pid, &false);

    // Advance ledger using internal testutils sequence setter if possible,
    // or by generating mock block.
    // We will mock sequence directly on test env.
    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += 101;
    env.ledger().set(ledger_info);

    client.resolve_proposal(&pid);

    let final_prop = client.get_proposal(&pid);
    assert!(final_prop.resolved);
    assert!(!final_prop.result); // 1 to 1 is not majority
}

#[test]
#[should_panic(expected = "Only users with completed jobs can vote")]
fn test_governance_unauthorized_voter() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury);

    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);

    let title = String::from_str(&env, "Test");
    let desc = String::from_str(&env, "Desc");
    let pid = client.create_proposal(&proposer, &title, &desc, &100);

    // Panics here
    client.cast_vote(&voter, &pid, &true);
}

#[test]
#[should_panic(expected = "Voter has already cast a vote")]
fn test_governance_rejects_double_vote() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env));
    let voter = Address::generate(&env);
    env.as_contract(&id, || {
        env.storage().instance().set(&DataKey::CompletedJobs(voter.clone()), &1u32);
    });
    let pid = client.create_proposal(&admin, &String::from_str(&env, "p"), &String::from_str(&env, "d"), &10);
    client.cast_vote(&voter, &pid, &true);
    client.cast_vote(&voter, &pid, &false);
}

#[test]
#[should_panic(expected = "Proposal already resolved")]
fn test_governance_rejects_vote_after_resolution() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env));
    let voter = Address::generate(&env);
    env.as_contract(&id, || {
        env.storage().instance().set(&DataKey::CompletedJobs(voter.clone()), &1u32);
    });
    let pid = client.create_proposal(&admin, &String::from_str(&env, "p"), &String::from_str(&env, "d"), &10);
    let mut ledger = env.ledger().get();
    ledger.sequence_number += 10;
    env.ledger().set(ledger);
    client.resolve_proposal(&pid);
    client.cast_vote(&voter, &pid, &true);
}
