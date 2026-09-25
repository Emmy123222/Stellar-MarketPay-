use soroban_sdk::{symbol_short, Address, Env, String};

use crate::helpers::check_not_frozen;
use crate::types::*;

pub(crate) fn publish_message(
    env: Env,
    job_id: String,
    sender: Address,
    recipient: Address,
    ipfs_cid: String,
) {
    sender.require_auth();
    check_not_frozen(&env);

    // Basic validation
    if ipfs_cid.is_empty() {
        panic!("IPFS CID cannot be empty");
    }

    // Store CID in contract storage for on-chain verification
    let mut cids: soroban_sdk::Vec<String> = env
        .storage()
        .instance()
        .get(&DataKey::MessageCid(job_id.clone()))
        .unwrap_or_else(|| soroban_sdk::Vec::new(&env));
    cids.push_back(ipfs_cid.clone());
    env.storage()
        .instance()
        .set(&DataKey::MessageCid(job_id.clone()), &cids);

    let ledger_seq = env.ledger().sequence();

    env.events().publish(
        (symbol_short!("msg_sent"), job_id.clone()),
        (sender.clone(), recipient.clone(), ipfs_cid, ledger_seq),
    );
}

/// Retrieve all message CIDs stored on-chain for a job.
pub(crate) fn get_message_cids(env: Env, job_id: String) -> soroban_sdk::Vec<String> {
    env.storage()
        .instance()
        .get(&DataKey::MessageCid(job_id))
        .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
}
