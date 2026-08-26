use crate::*;
use soroban_sdk::{
    testutils::Address as _, testutils::Ledger, Address, Bytes, BytesN, Env, String,
};

fn bid_commitment(env: &Env, amount: i128, nonce: BytesN<32>) -> BytesN<32> {
    let mut payload = Bytes::new(env);
    for byte in amount.to_be_bytes().iter() {
        payload.push_back(*byte);
    }
    for byte in nonce.to_array().iter() {
        payload.push_back(*byte);
    }
    env.crypto().sha256(&payload).into()
}

fn setup(env: &Env) -> (Address, MarketPayContractClient, Address, Address, String) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let owner = Address::generate(env);
    client.initialize(&admin, &treasury);
    let job_id = String::from_str(env, "sealed-bid-job-1");
    client.commit_budget(&job_id, &1_000, &owner);
    (id, client, owner, admin, job_id)
}

#[test]
fn test_reveal_bid_verifies_commitment() {
    let env = Env::default();

    let (_id, client, owner, _admin, job_id) = setup(&env);
    let freelancer = Address::generate(&env);
    let nonce = BytesN::from_array(&env, &[7u8; 32]);
    let amount = 450i128;
    let commitment = bid_commitment(&env, amount, nonce.clone());

    client.submit_bid_commitment(&job_id, &freelancer, &commitment);
    client.close_bidding(&job_id, &owner);
    client.reveal_bid(&job_id, &freelancer, &amount, &nonce);

    let reveals = client.get_revealed_bids(&job_id);
    assert_eq!(reveals.len(), 1);
    let revealed = reveals.get(0).unwrap();
    assert_eq!(revealed.amount, amount);
    assert_eq!(revealed.freelancer, freelancer);
}

#[test]
#[should_panic(expected = "Commitment verification failed")]
fn test_reveal_bid_with_invalid_nonce_rejected() {
    let env = Env::default();
    let (_id, client, owner, _admin, job_id) = setup(&env);
    let freelancer = Address::generate(&env);
    let amount = 500i128;
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    let bad_nonce = BytesN::from_array(&env, &[2u8; 32]);
    let commitment = bid_commitment(&env, amount, nonce);

    client.submit_bid_commitment(&job_id, &freelancer, &commitment);
    client.close_bidding(&job_id, &owner);
    client.reveal_bid(&job_id, &freelancer, &amount, &bad_nonce);
}

#[test]
#[should_panic(expected = "Reveal window has closed")]
fn test_late_reveal_rejected() {
    let env = Env::default();
    let (id, client, owner, _admin, job_id) = setup(&env);
    let freelancer = Address::generate(&env);
    let nonce = BytesN::from_array(&env, &[3u8; 32]);
    let amount = 525i128;
    let commitment = bid_commitment(&env, amount, nonce.clone());

    client.submit_bid_commitment(&job_id, &freelancer, &commitment);
    client.close_bidding(&job_id, &owner);

    // Extend instance storage TTL so it survives the ledger jump below.
    env.as_contract(&id, || {
        env.storage().instance().extend_ttl(20_000, 20_000);
    });

    let mut ledger = env.ledger().get();
    ledger.sequence_number += REVEAL_WINDOW_LEDGERS + 1;
    env.ledger().set(ledger);

    client.reveal_bid(&job_id, &freelancer, &amount, &nonce);
}
