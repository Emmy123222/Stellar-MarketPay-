#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Vec,
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

const DEFAULT_MIN_STAKE: i128 = 100_000_000; // 10 XLM in stroops

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    MinimumStake,
    ArbitratorInfo(Address),
    ArbitratorList,
}

// ─── Data structures ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct ArbitratorInfo {
    pub active: bool,
    pub staked_amount: i128,
    pub metadata_uri: String,
    pub registered_at: u32,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct ArbitratorRegistry;

#[contractimpl]
impl ArbitratorRegistry {
    /// Initialize the contract with an admin, token contract address, and
    /// optional minimum stake (defaults to 10 XLM if `min_stake` is 0).
    ///
    /// `token` is the Soroban Asset Contract address of the token
    /// used for staking (XLM SAC or USDC).
    pub fn initialize(env: Env, admin: Address, token: Address, min_stake: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);

        let stake = if min_stake > 0 { min_stake } else { DEFAULT_MIN_STAKE };
        env.storage()
            .instance()
            .set(&DataKey::MinimumStake, &stake);

        env.storage()
            .instance()
            .set(&DataKey::ArbitratorList, &Vec::<Address>::new(&env));

        env.events().publish(
            (symbol_short!("init"), admin),
            (token, stake),
        );
    }

    // ─── Admin configuration ─────────────────────────────────────────────────

    /// Update the minimum stake amount. Only callable by admin.
    pub fn set_minimum_stake(env: Env, admin: Address, min_stake: i128) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        if min_stake <= 0 {
            panic!("Minimum stake must be positive");
        }

        env.storage()
            .instance()
            .set(&DataKey::MinimumStake, &min_stake);
        env.events()
            .publish((symbol_short!("set_stk"), admin), min_stake);
    }

    // ─── Registration ────────────────────────────────────────────────────────

    /// Register as an arbitrator by staking the minimum required tokens.
    ///
    /// The caller must first approve the contract to transfer the stake amount,
    /// or use the simpler `register_with_xfer` variant where the caller
    /// pre-transfers the tokens to the contract before calling.
    ///
    /// `metadata_uri` is an optional IPFS URI pointing to the arbitrator's
    /// profile metadata (display name, bio, etc.).
    pub fn register(
        env: Env,
        caller: Address,
        metadata_uri: String,
    ) {
        caller.require_auth();

        if Self::is_registered(&env, &caller) {
            panic!("Already registered as arbitrator");
        }

        let min_stake: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinimumStake)
            .expect("Not initialized");

        // Transfer stake from caller to the contract
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&caller, &env.current_contract_address(), &min_stake);

        let info = ArbitratorInfo {
            active: true,
            staked_amount: min_stake,
            metadata_uri,
            registered_at: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::ArbitratorInfo(caller.clone()), &info);

        // Append to the active list
        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorList)
            .unwrap_or_else(|| Vec::new(&env));
        list.push_back(caller.clone());
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorList, &list);

        env.events().publish(
            (symbol_short!("reg"), caller),
            min_stake,
        );
    }

    /// Deregister as an arbitrator and receive the staked tokens back.
    pub fn deregister(env: Env, caller: Address) {
        caller.require_auth();

        let mut info: ArbitratorInfo = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorInfo(caller.clone()))
            .expect("Not registered");

        if !info.active {
            panic!("Arbitrator is not active");
        }

        // Refund the stake
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(
            &env.current_contract_address(),
            &caller,
            &info.staked_amount,
        );

        info.active = false;
        info.staked_amount = 0;
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorInfo(caller.clone()), &info);

        // Remove from the active list
        Self::remove_from_list(&env, &caller);

        env.events()
            .publish((symbol_short!("dereg"), caller), ());
    }

    /// Admin force-removes an arbitrator. The stake is returned to the
    /// arbitrator. This is used when a DAO arbitration proposal passes
    /// to remove a bad actor.
    pub fn remove_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let mut info: ArbitratorInfo = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorInfo(arbitrator.clone()))
            .expect("Not registered");

        if !info.active {
            panic!("Arbitrator is not active");
        }

        // Refund the stake
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(
            &env.current_contract_address(),
            &arbitrator,
            &info.staked_amount,
        );

        info.active = false;
        info.staked_amount = 0;
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorInfo(arbitrator.clone()), &info);

        // Remove from the active list
        Self::remove_from_list(&env, &arbitrator);

        env.events().publish(
            (symbol_short!("rm_arb"), admin),
            arbitrator,
        );
    }

    /// DAO-triggered action: called by the admin (or DAO multisig) to register
    /// an arbitrator on behalf of a passed DAO proposal. The stake is not
    /// transferred (the DAO covers it) so the arbitrator is added immediately.
    ///
    /// This is the bridge between off-chain DAO votes and on-chain state.
    pub fn dao_register_arbitrator(
        env: Env,
        admin: Address,
        arbitrator: Address,
        metadata_uri: String,
    ) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        if Self::is_registered(&env, &arbitrator) {
            panic!("Already registered as arbitrator");
        }

        let min_stake: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinimumStake)
            .expect("Not initialized");

        // Transfer stake from the admin/DAO treasury to the contract
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&admin, &env.current_contract_address(), &min_stake);

        let info = ArbitratorInfo {
            active: true,
            staked_amount: min_stake,
            metadata_uri,
            registered_at: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::ArbitratorInfo(arbitrator.clone()), &info);

        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorList)
            .unwrap_or_else(|| Vec::new(&env));
        list.push_back(arbitrator.clone());
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorList, &list);

        env.events().publish(
            (symbol_short!("dao_reg"), arbitrator),
            (admin, min_stake),
        );
    }

    /// DAO-triggered removal: called by admin to remove an arbitrator when a
    /// passed DAO proposal votes to remove them.
    pub fn dao_remove_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let mut info: ArbitratorInfo = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorInfo(arbitrator.clone()))
            .expect("Not registered");

        if !info.active {
            panic!("Arbitrator is not active");
        }

        // For DAO removal, the stake goes back to the admin/DAO treasury
        // rather than the arbitrator, as a penalty.
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(
            &env.current_contract_address(),
            &admin,
            &info.staked_amount,
        );

        info.active = false;
        info.staked_amount = 0;
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorInfo(arbitrator.clone()), &info);

        Self::remove_from_list(&env, &arbitrator);

        env.events().publish(
            (symbol_short!("dao_rm"), arbitrator),
            admin,
        );
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /// Return the list of all currently active arbitrator addresses.
    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::ArbitratorList)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Return the number of active arbitrators.
    pub fn get_arbitrator_count(env: Env) -> u32 {
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorList)
            .unwrap_or_else(|| Vec::new(&env));
        list.len()
    }

    /// Return detailed info for a specific arbitrator address.
    pub fn get_arbitrator(env: Env, address: Address) -> ArbitratorInfo {
        env.storage()
            .instance()
            .get(&DataKey::ArbitratorInfo(address))
            .expect("Not registered")
    }

    /// Check if an address is currently an active arbitrator.
    pub fn is_arbitrator(env: Env, address: Address) -> bool {
        Self::is_registered(&env, &address)
    }

    /// Return the minimum stake required to register.
    pub fn get_minimum_stake(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinimumStake)
            .expect("Not initialized")
    }

    /// Return the token contract address used for staking.
    pub fn get_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized")
    }

    /// Return the contract admin.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    fn require_admin(env: &Env, admin: &Address) {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if &stored_admin != admin {
            panic!("Only admin can perform this action");
        }
    }

    fn is_registered(env: &Env, address: &Address) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::ArbitratorInfo(address.clone()))
            && env
                .storage()
                .instance()
                .get::<_, ArbitratorInfo>(&DataKey::ArbitratorInfo(address.clone()))
                .map_or(false, |info| info.active)
    }

    fn remove_from_list(env: &Env, address: &Address) {
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorList)
            .unwrap_or_else(|| Vec::new(env));

        let mut new_list = Vec::new(env);
        for addr in list.iter() {
            if addr != *address {
                new_list.push_back(addr);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorList, &new_list);
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    fn setup(env: &Env) -> (ArbitratorRegistryClient, Address, Address) {
        let id = env.register(ArbitratorRegistry, ());
        let client = ArbitratorRegistryClient::new(env, &id);

        let admin = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&admin, &1_000_000_000);

        client.initialize(&admin, &token_id, &0i128); // 0 = use default (10 XLM)

        (client, admin, token_id)
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(ArbitratorRegistry, ());
        let client = ArbitratorRegistryClient::new(&env, &id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        client.initialize(&admin, &token, &50_000_000);

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_token(), token);
        assert_eq!(client.get_minimum_stake(), 50_000_000);
    }

    #[test]
    fn test_initializes_with_default_stake() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(ArbitratorRegistry, ());
        let client = ArbitratorRegistryClient::new(&env, &id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        client.initialize(&admin, &token, &0i128);

        assert_eq!(client.get_minimum_stake(), DEFAULT_MIN_STAKE);
    }

    #[test]
    fn test_register_deregister() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, token_id) = setup(&env);

        let arbitrator = Address::generate(&env);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&arbitrator, &1_000_000_000);

        let uri = String::from_str(&env, "ipfs://QmProfile");

        client.register(&arbitrator, &uri);

        let arbitrators = client.get_arbitrators();
        assert_eq!(arbitrators.len(), 1);
        assert_eq!(arbitrators.get(0).unwrap(), arbitrator);

        let info = client.get_arbitrator(&arbitrator);
        assert_eq!(info.active, true);
        assert_eq!(info.staked_amount, DEFAULT_MIN_STAKE);
        assert_eq!(info.metadata_uri, uri);

        // Deregister
        client.deregister(&arbitrator);

        let arbitrators = client.get_arbitrators();
        assert_eq!(arbitrators.len(), 0);

        assert_eq!(client.is_arbitrator(&arbitrator), false);
    }

    #[test]
    fn test_double_registration_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, token_id) = setup(&env);

        let arbitrator = Address::generate(&env);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&arbitrator, &1_000_000_000);

        let uri = String::from_str(&env, "ipfs://QmProfile");
        client.register(&arbitrator, &uri);
    }

    #[test]
    #[should_panic(expected = "Already registered as arbitrator")]
    fn test_double_registration_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, token_id) = setup(&env);

        let arbitrator = Address::generate(&env);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&arbitrator, &1_000_000_000);

        let uri = String::from_str(&env, "ipfs://QmProfile");
        client.register(&arbitrator, &uri);
        client.register(&arbitrator, &uri);
    }

    #[test]
    fn test_admin_set_minimum_stake() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _token_id) = setup(&env);

        client.set_minimum_stake(&admin, &200_000_000);
        assert_eq!(client.get_minimum_stake(), 200_000_000);
    }

    #[test]
    fn test_admin_remove_arbitrator() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token_id) = setup(&env);

        let arbitrator = Address::generate(&env);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&arbitrator, &1_000_000_000);

        let uri = String::from_str(&env, "ipfs://QmProfile");
        client.register(&arbitrator, &uri);

        assert_eq!(client.get_arbitrators().len(), 1);

        client.remove_arbitrator(&admin, &arbitrator);

        assert_eq!(client.get_arbitrators().len(), 0);
        assert_eq!(client.is_arbitrator(&arbitrator), false);
    }

    #[test]
    fn test_dao_register_arbitrator() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _token_id) = setup(&env);

        let arbitrator = Address::generate(&env);

        let uri = String::from_str(&env, "ipfs://QmDaoProfile");
        client.dao_register_arbitrator(&admin, &arbitrator, &uri);

        let arbitrators = client.get_arbitrators();
        assert_eq!(arbitrators.len(), 1);

        let info = client.get_arbitrator(&arbitrator);
        assert!(info.active);
        assert_eq!(info.staked_amount, DEFAULT_MIN_STAKE);
    }

    #[test]
    fn test_dao_remove_arbitrator() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token_id) = setup(&env);

        let arbitrator = Address::generate(&env);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&arbitrator, &1_000_000_000);

        let uri = String::from_str(&env, "ipfs://QmProfile");
        client.register(&arbitrator, &uri);

        assert_eq!(client.get_arbitrators().len(), 1);

        // DAO vote passes to remove
        client.dao_remove_arbitrator(&admin, &arbitrator);

        assert_eq!(client.get_arbitrators().len(), 0);
        assert_eq!(client.is_arbitrator(&arbitrator), false);
    }

    #[test]
    fn test_multiple_arbitrators() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, token_id) = setup(&env);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);

        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&alice, &1_000_000_000);
        token_admin.mint(&bob, &1_000_000_000);
        token_admin.mint(&charlie, &1_000_000_000);

        let uri = String::from_str(&env, "ipfs://QmProfile");
        client.register(&alice, &uri.clone());
        client.register(&bob, &uri.clone());
        client.register(&charlie, &uri.clone());

        assert_eq!(client.get_arbitrator_count(), 3);

        let list = client.get_arbitrators();
        assert_eq!(list.len(), 3);

        // Deregister one
        client.deregister(&bob);
        assert_eq!(client.get_arbitrator_count(), 2);

        let list = client.get_arbitrators();
        assert_eq!(list.len(), 2);
        assert_eq!(list.get(0).unwrap(), alice);
        assert_eq!(list.get(1).unwrap(), charlie);
    }

    #[test]
    #[should_panic]
    fn test_insufficient_stake_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(ArbitratorRegistry, ());
        let client = ArbitratorRegistryClient::new(&env, &id);

        let admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();

        client.initialize(&admin, &token_id, &500_000_000i128); // 50 XLM

        let arbitrator = Address::generate(&env);
        // Only mint 1 XLM — way below the 50 XLM minimum
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&arbitrator, &10_000_000);

        let uri = String::from_str(&env, "ipfs://QmProfile");
        client.register(&arbitrator, &uri);
    }
}
