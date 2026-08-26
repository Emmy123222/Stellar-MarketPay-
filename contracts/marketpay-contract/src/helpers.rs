use soroban_sdk::Env;

pub(crate) fn check_not_frozen(env: &Env) {
    let frozen: bool = env
        .storage()
        .instance()
        .get(&crate::types::DataKey::Frozen)
        .unwrap_or(false);
    if frozen {
        panic!("Contract is frozen");
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
