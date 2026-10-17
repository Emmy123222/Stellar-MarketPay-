//! End-to-end integration test for the complete sealed-bid auction lifecycle
//! defined in `src/auction.rs` (Issue #1485):
//!
//!   create auction → 3 distinct bids → advance/close auction → winner
//!   selected → losing bidders fully refunded,
//!
//! with **explicit token-balance verification after every step** of the
//! transaction pipeline, plus a negative assertion proving that a bid
//! submitted *after* the auction closes is rejected instead of succeeding.
//!
//! ## How the acceptance criteria map onto the sealed-bid design
//!
//! `auction.rs` implements a commit–reveal auction: bids are sealed
//! SHA-256 commitments, not token transfers, so bidder funds are never
//! escrowed by the contract. Consequently:
//!
//!   * "winner selected" = the highest *revealed* bid in
//!     `get_revealed_bids` (the client then awards the job);
//!   * "the 2 losing bidders are fully refunded" is proven by asserting,
//!     after the auction closes, that each loser's token balance is
//!     **exactly** equal to their pre-auction snapshot and that the
//!     contract itself still holds a zero token balance — i.e. no bidder
//!     funds were ever taken, locked, or retained at any pipeline step.
//!
//! This is an integration test target: it links the crate as an rlib
//! (`crate-type = ["cdylib", "rlib"]`), the same way `dispute_bond.rs`
//! and `milestone_release.rs` do.

mod tests {
    use marketpay_contract::{MarketPayContract, MarketPayContractClient};
    use marketpay_contract::CreateEscrowParams;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Address, Bytes, BytesN, Env, String,
    };

    // ─── Fixture constants ──────────────────────────────────────────────────

    const CLIENT_START: i128 = 1_000_000;
    const ALICE_START: i128 = 1_111;
    const BOB_START: i128 = 2_222;
    const CAROL_START: i128 = 3_333;
    const DAVE_START: i128 = 4_444;

    /// Client's revealed budget for the job (all bids sit under 150 % of it).
    const BUDGET: i128 = 1_000;

    /// Three distinct sealed bids: Alice < Bob < Carol.
    const ALICE_BID: i128 = 400;
    const BOB_BID: i128 = 500;
    const CAROL_BID: i128 = 600;

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// Mirror of `helpers::compute_bid_commitment` (which is `pub(crate)` and
    /// therefore not reachable from an integration test):
    /// `sha256(amount.to_be_bytes() ‖ nonce)`.
    fn bid_commitment(env: &Env, amount: i128, nonce: &BytesN<32>) -> BytesN<32> {
        let mut payload = Bytes::new(env);
        for byte in amount.to_be_bytes().iter() {
            payload.push_back(*byte);
        }
        for byte in nonce.to_array().iter() {
            payload.push_back(*byte);
        }
        env.crypto().sha256(&payload).into()
    }

    fn nonce(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    fn balance_of(env: &Env, token_id: &Address, who: &Address) -> i128 {
        token::Client::new(env, token_id).balance(who)
    }

    /// The five balances tracked at every step of the pipeline.
    #[derive(Clone)]
    struct Snapshot {
        client: i128,
        alice: i128,
        bob: i128,
        carol: i128,
        contract: i128,
    }

    impl Snapshot {
        fn take(
            env: &Env,
            token_id: &Address,
            contract_id: &Address,
            client: &Address,
            alice: &Address,
            bob: &Address,
            carol: &Address,
        ) -> Self {
            Snapshot {
                client: balance_of(env, token_id, client),
                alice: balance_of(env, token_id, alice),
                bob: balance_of(env, token_id, bob),
                carol: balance_of(env, token_id, carol),
                contract: balance_of(env, token_id, contract_id),
            }
        }

        /// Assert every balance still equals this snapshot, labelling the
        /// pipeline step that failed so regressions are easy to localise.
        fn assert_unchanged(
            &self,
            env: &Env,
            token_id: &Address,
            contract_id: &Address,
            client: &Address,
            alice: &Address,
            bob: &Address,
            carol: &Address,
            step: &str,
        ) {
            let now = Snapshot::take(env, token_id, contract_id, client, alice, bob, carol);
            assert_eq!(now.client, self.client, "client balance changed at: {step}");
            assert_eq!(now.alice, self.alice, "alice balance changed at: {step}");
            assert_eq!(now.bob, self.bob, "bob balance changed at: {step}");
            assert_eq!(now.carol, self.carol, "carol balance changed at: {step}");
            assert_eq!(
                now.contract, self.contract,
                "contract balance changed at: {step}"
            );
        }
    }

    /// Initialize the contract, create the auction token, and fund every
    /// party. Mirrors the `setup(&env)` pattern used by `dispute_bond.rs`.
    #[allow(clippy::type_complexity)]
    fn setup(
        env: &Env,
    ) -> (
        MarketPayContractClient<'_>,
        Address,
        Address,
        Address,
        Address,
        Address,
        Address,
    ) {
        env.mock_all_auths();

        let contract_id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(env, &contract_id);

        let admin = Address::generate(env);
        contract.initialize(&admin, &admin, &String::from_str(&env, "1.0.0"));

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);

        let client = Address::generate(env);
        let alice = Address::generate(env);
        let bob = Address::generate(env);
        let carol = Address::generate(env);

        token_admin.mint(&client, &CLIENT_START);
        token_admin.mint(&alice, &ALICE_START);
        token_admin.mint(&bob, &BOB_START);
        token_admin.mint(&carol, &CAROL_START);

        (contract, contract_id, token_id, client, alice, bob, carol)
    }

    // ─── The full lifecycle ─────────────────────────────────────────────────

    #[test]
    fn test_full_auction_lifecycle_create_bids_close_winner_and_refunds() {
        let env = Env::default();
        let (contract, contract_id, token_id, client, alice, bob, carol) = setup(&env);
        let job_id = String::from_str(&env, "auction-lifecycle-job");

        let initial = Snapshot::take(&env, &token_id, &contract_id, &client, &alice, &bob, &carol);
        assert_eq!(initial.contract, 0, "contract starts empty");

        // ── Step 1: create the auction (client opens bidding) ───────────────
        contract.commit_budget(&job_id, &BUDGET, &client);

        let budget = contract.get_budget_commitment(&job_id);
        assert_eq!(budget.client, client);
        assert_eq!(budget.budget_amount, BUDGET);
        assert!(!budget.is_revealed);

        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after create (commit_budget)",
        );

        // ── Step 2: three distinct sealed bids ──────────────────────────────
        let alice_nonce = nonce(&env, 1);
        let bob_nonce = nonce(&env, 2);
        let carol_nonce = nonce(&env, 3);

        contract.submit_bid_commitment(
            &job_id,
            &alice,
            &bid_commitment(&env, ALICE_BID, &alice_nonce),
        );
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after bid 1/3 (alice)",
        );

        contract.submit_bid_commitment(&job_id, &bob, &bid_commitment(&env, BOB_BID, &bob_nonce));
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after bid 2/3 (bob)",
        );

        contract.submit_bid_commitment(
            &job_id,
            &carol,
            &bid_commitment(&env, CAROL_BID, &carol_nonce),
        );
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after bid 3/3 (carol)",
        );

        // Every commitment is persisted and still sealed.
        for (bidder, amount, seed) in [
            (&alice, ALICE_BID, 1u8),
            (&bob, BOB_BID, 2u8),
            (&carol, CAROL_BID, 3u8),
        ] {
            let stored = contract.get_bid_commitment(&job_id, bidder);
            assert_eq!(stored.freelancer, *bidder);
            assert_eq!(
                stored.commitment,
                bid_commitment(&env, amount, &nonce(&env, seed)),
                "stored commitment hash must match the sealed bid"
            );
            assert!(!stored.bid_revealed, "bids stay sealed until reveal");
        }

        // ── Step 3: advance the ledger, then close the auction ──────────────
        let mut ledger = env.ledger().get();
        ledger.sequence_number += 3;
        env.ledger().set(ledger);

        contract.close_bidding(&job_id, &client);
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after close (close_bidding)",
        );

        // ── Step 4: reveal all three bids inside the reveal window ──────────
        let mut ledger = env.ledger().get();
        ledger.sequence_number += 2;
        env.ledger().set(ledger);

        contract.reveal_bid(&job_id, &alice, &ALICE_BID, &alice_nonce);
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after reveal (alice)",
        );

        contract.reveal_bid(&job_id, &bob, &BOB_BID, &bob_nonce);
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after reveal (bob)",
        );

        contract.reveal_bid(&job_id, &carol, &CAROL_BID, &carol_nonce);
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after reveal (carol)",
        );

        // Each bidder's commitment record now flips to revealed.
        for bidder in [&alice, &bob, &carol] {
            assert!(contract.get_bid_commitment(&job_id, bidder).bid_revealed);
        }

        // ── Step 5: the winner is the highest revealed bid ──────────────────
        let reveals = contract.get_revealed_bids(&job_id);
        assert_eq!(reveals.len(), 3, "all three bids were revealed");

        let mut winner: Option<Address> = None;
        let mut winner_amount: i128 = i128::MIN;
        let mut seen: Vec<(Address, i128)> = Vec::new();
        for revealed in reveals.iter() {
            seen.push((revealed.freelancer.clone(), revealed.amount));
            if revealed.amount > winner_amount {
                winner_amount = revealed.amount;
                winner = Some(revealed.freelancer.clone());
            }
        }

        // Exactly the amounts that were sealed are now public.
        for (bidder, amount) in [(&alice, ALICE_BID), (&bob, BOB_BID), (&carol, CAROL_BID)] {
            let found = seen.iter().any(|(f, a)| f == bidder && *a == amount);
            assert!(
                found,
                "revealed bid for {amount} from a expected bidder is missing"
            );
        }

        assert_eq!(
            winner.as_ref(),
            Some(&carol),
            "highest sealed bid (carol) must win the auction"
        );
        assert_eq!(winner_amount, CAROL_BID);

        // ── Step 6: the two losing bidders are fully refunded ───────────────
        //
        // Sealed bids never escrow bidder funds, so a "full refund" means
        // the losers end the auction holding exactly what they started with
        // and the contract retained nothing.
        assert_eq!(
            balance_of(&env, &token_id, &alice),
            initial.alice,
            "losing bidder alice must be fully refunded (balance intact)"
        );
        assert_eq!(
            balance_of(&env, &token_id, &bob),
            initial.bob,
            "losing bidder bob must be fully refunded (balance intact)"
        );
        assert_eq!(
            balance_of(&env, &token_id, &contract_id),
            0,
            "contract must retain none of the bidders' funds"
        );
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after winner selection / loser refunds",
        );

        // ── Step 7 (negative): a bid submitted after close is rejected ──────
        let dave = Address::generate(&env);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&dave, &DAVE_START);

        let late_result = contract.try_submit_bid_commitment(
            &job_id,
            &dave,
            &bid_commitment(&env, 900, &nonce(&env, 9)),
        );
        assert!(
            late_result.is_err(),
            "submitting a bid after the auction closes must return an error"
        );

        // The rejected bid must not move any tokens either.
        assert_eq!(
            balance_of(&env, &token_id, &dave),
            DAVE_START,
            "rejected late bidder keeps their balance"
        );
        assert_eq!(balance_of(&env, &token_id, &contract_id), 0);
        initial.assert_unchanged(
            &env,
            &token_id,
            &contract_id,
            &client,
            &alice,
            &bob,
            &carol,
            "after rejected post-close bid",
        );
    }

    // ─── Negative test: exact rejection message ─────────────────────────────

    #[test]
    #[should_panic(expected = "Bidding is closed")]
    fn test_bid_after_auction_closed_returns_error() {
        let env = Env::default();
        let (contract, _contract_id, _token_id, client, alice, _bob, _carol) = setup(&env);
        let job_id = String::from_str(&env, "auction-closed-negative");

        // Open the auction, take one bid, then close it.
        contract.commit_budget(&job_id, &BUDGET, &client);
        contract.submit_bid_commitment(
            &job_id,
            &alice,
            &bid_commitment(&env, ALICE_BID, &nonce(&env, 1)),
        );
        contract.close_bidding(&job_id, &client);

        // A brand-new bidder tries to enter after close → must error out.
        let late = Address::generate(&env);
        contract.submit_bid_commitment(
            &job_id,
            &late,
            &bid_commitment(&env, 777, &nonce(&env, 42)),
        );
    }

    // ─── Minimum Bid Increment Lifecycle Tests ─────────────────────────────

    #[test]
    fn test_place_bid_enforces_default_minimum_increment_and_boundaries() {
        let env = Env::default();
        let (contract, _contract_id, token_id, client, alice, bob, carol) = setup(&env);
        let job_id = String::from_str(&env, "job-min-inc-default");

        let params = CreateEscrowParams {
            freelancer: alice.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(1000),
            referrer: None,
        };
        contract.create_escrow(&job_id, &client, &params);

        // Default increment is 100
        assert_eq!(contract.get_min_bid_increment(&job_id), 100);

        // First bid by Alice: 500
        contract.place_bid(&job_id, &alice, &500);

        // Bob tries boundary values:
        // 500 + 100 - 1 = 599 -> must fail
        let under_bid = contract.try_place_bid(&job_id, &bob, &599);
        assert!(under_bid.is_err(), "Bid below highest + min_increment must fail");

        // Exact boundary: 500 + 100 = 600 -> must succeed
        contract.place_bid(&job_id, &bob, &600);

        // Carol tries boundary values against 600:
        // 600 + 100 - 1 = 699 -> must fail
        let carol_under = contract.try_place_bid(&job_id, &carol, &699);
        assert!(carol_under.is_err(), "Bid below highest + min_increment must fail");

        // Above boundary: 600 + 150 = 750 -> must succeed
        contract.place_bid(&job_id, &carol, &750);
    }

    #[test]
    #[should_panic(expected = "Bid does not meet the minimum increment requirement")]
    fn test_place_bid_rejects_under_minimum_increment_exact_panic() {
        let env = Env::default();
        let (contract, _contract_id, token_id, client, alice, bob, _carol) = setup(&env);
        let job_id = String::from_str(&env, "job-min-inc-panic");

        let params = CreateEscrowParams {
            freelancer: alice.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(1000),
            referrer: None,
        };
        contract.create_escrow(&job_id, &client, &params);

        contract.place_bid(&job_id, &alice, &500);
        // Under by 1 unit: 599 < 500 + 100
        contract.place_bid(&job_id, &bob, &599);
    }

    #[test]
    fn test_place_bid_custom_increment_and_boundaries() {
        let env = Env::default();
        let (contract, _contract_id, token_id, client, alice, bob, carol) = setup(&env);
        let job_id = String::from_str(&env, "job-custom-inc");

        let params = CreateEscrowParams {
            freelancer: alice.clone(),
            token: token_id.clone(),
            amount: 2000,
            milestones: None,
            timeout_ledgers: Some(1000),
            referrer: None,
        };
        contract.create_escrow(&job_id, &client, &params);

        // Configure custom increment of 250
        contract.create_auction(&job_id, &client, &Some(250));
        assert_eq!(contract.get_min_bid_increment(&job_id), 250);

        // First bid
        contract.place_bid(&job_id, &alice, &500);

        // Boundary tests for custom increment 250:
        // 500 + 250 - 1 = 749 -> fails
        let res_under = contract.try_place_bid(&job_id, &bob, &749);
        assert!(res_under.is_err(), "749 is below 500 + 250");

        // Exact: 500 + 250 = 750 -> succeeds
        contract.place_bid(&job_id, &bob, &750);

        // Next boundary for Carol: 750 + 250 - 1 = 999 -> fails
        let res_carol_under = contract.try_place_bid(&job_id, &carol, &999);
        assert!(res_carol_under.is_err(), "999 is below 750 + 250");

        // Exact boundary 1000 -> succeeds
        contract.place_bid(&job_id, &carol, &1000);
    }

}
