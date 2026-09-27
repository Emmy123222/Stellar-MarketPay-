use crate::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
#[should_panic(expected = "Message too long")]
fn message_1001_bytes_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let content = String::from_str(&env, &"a".repeat(1001));

    client.publish_message(
        &String::from_str(&env, "job-1"),
        &sender,
        &recipient,
        &content,
    );
}

#[test]
fn message_1000_bytes_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let job_id = String::from_str(&env, "job-1");
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let content = String::from_str(&env, &"a".repeat(1000));

    client.publish_message(&job_id, &sender, &recipient, &content);

    let cids = client.get_message_cids(&job_id);
    assert_eq!(cids.len(), 1);
    assert_eq!(cids.get(0).unwrap(), content);
}
