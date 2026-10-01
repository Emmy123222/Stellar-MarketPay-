use soroban_sdk::Env;

pub(crate) fn check_not_frozen<T: core::fmt::Display>(env: &Env, context: T) {
    let frozen: bool = env
        .storage()
        .instance()
        .get(&crate::types::DataKey::Frozen)
        .unwrap_or(false);
    if frozen {
        panic!("contract is frozen for job ID: {}", context);
    }
}

#[cfg(test)]
mod tests {
    use super::check_not_frozen;
    use crate::types::DataKey;
    use soroban_sdk::{Env, String};

    #[test]
    #[should_panic(expected = "contract is frozen for job ID: job-42")]
    fn frozen_check_includes_job_context() {
        let env = Env::default();
        env.as_contract(&env.register(crate::MarketPayContract, ()), || {
            env.storage().instance().set(&DataKey::Frozen, &true);
            check_not_frozen(&env, String::from_str(&env, "job-42"));
        });
    }
}

/// Blocks state-changing operations on an admin-frozen escrow
/// (`EscrowStatus::Frozen`, set by `admin::freeze_escrow`).
///
/// Tolerates a missing escrow record — callers that legitimately run
/// before the escrow exists (e.g. `boost_job`) are not affected. Callers
/// that require the escrow to exist will still fail on their own
/// "Escrow not found" lookup.
pub(crate) fn check_escrow_not_frozen(env: &Env, job_id: &soroban_sdk::String) {
    if let Some(escrow) = env
        .storage()
        .instance()
        .get::<_, crate::types::Escrow>(&crate::types::DataKey::Escrow(job_id.clone()))
    {
        if escrow.status == crate::types::EscrowStatus::Frozen {
            panic!("Escrow is frozen");
        }
    }
}

pub(crate) fn compute_bid_commitment(
    env: &Env,
    amount: i128,
    nonce: soroban_sdk::BytesN<32>,
) -> soroban_sdk::BytesN<32> {
    use soroban_sdk::Bytes;
    let mut payload = Bytes::new(env);
    for byte in amount.to_be_bytes().iter() {
        payload.push_back(*byte);
    }
    for byte in nonce.to_array().iter() {
        payload.push_back(*byte);
    }
    env.crypto().sha256(&payload).into()
}
