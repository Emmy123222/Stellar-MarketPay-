/*
 * contracts/marketpay-contract/src/lib.rs
 *
 * Stellar MarketPay — Soroban Escrow Contract
 *
 * This contract manages trustless escrow between a client and freelancer:
 *
 *   1. Client calls create_escrow() — locks XLM in the contract
 *   2. Freelancer does the work
 *   3. Client calls release_escrow() — funds sent to freelancer
 *      OR client calls refund_escrow() before work starts — funds returned
 *
 * Build:
 *   cargo build --target wasm32-unknown-unknown --release
 *
 * Deploy:
 *   stellar contract deploy \
 *     --wasm target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
 *     --source alice --network testnet
 */

#![no_std]
#![allow(
    clippy::too_many_arguments,
    clippy::manual_range_contains,
    unused_variables,
    // soroban-sdk 27 deprecates Events::publish in favour of #[contractevent].
    // Migrating changes the emitted event ABI that the backend indexer parses,
    // so it is tracked as its own task rather than bundled here.
    deprecated,
    // Test helpers take `&Env` where the signature elides the lifetime;
    // cosmetic, and changing every helper signature is churn for no benefit.
    mismatched_lifetime_syntaxes
)]

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, String, Vec};

mod admin;
mod auction;
mod certificates;
mod deliverable;
mod disputes;
mod errors;
mod escrow;
mod governance;
mod helpers;
mod messages;
mod milestones;
mod types;

pub use types::*;

#[contract]
pub struct MarketPayContract;

#[allow(clippy::too_many_arguments)]
#[contractimpl]
impl MarketPayContract {
    // ─── Initialization ──────────────────────────────────────────────────────

    /// Initialize with an admin address and treasury (called once after deployment).
    ///
    /// `treasury_address` receives a configurable platform fee on every escrow
    /// release. The initial platform fee defaults to 100 bps (1 %).
    pub fn initialize(env: Env, admin: Address, treasury_address: Address) {
        admin::initialize(env, admin, treasury_address)
    }

    // ─── Upgrade & versioning ─────────────────────────────────────────────────

    /// Upgrade the contract WASM. Restricted to admin.
    ///
    /// `new_wasm_hash` is the 32-byte hash of the new WASM blob already
    /// uploaded to the network via `stellar contract install`.
    /// All existing storage (escrows, proposals, ratings, …) is preserved
    /// because Soroban upgrades only replace the executable, not the state.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        admin::upgrade(env, new_wasm_hash)
    }

    /// Return the current contract version (starts at 1, increments on each upgrade).
    pub fn get_version(env: Env) -> u32 {
        admin::get_version(env)
    }

    // ─── Escrow lifecycle ─────────────────────────────────────────────────────

    /// Client creates an escrow by transferring funds into the contract.
    pub fn create_escrow(
        env: Env,
        job_id: String,
        client: Address,
        params: types::CreateEscrowParams,
    ) {
        escrow::create_escrow(env, job_id, client, params)
    }

    /// Client creates an escrow that includes an expected deliverable hash.
    pub fn create_escrow_with_deliverable(
        env: Env,
        job_id: String,
        client: Address,
        params: types::CreateEscrowParams,
        deliverable_hash: BytesN<32>,
    ) {
        escrow::create_escrow_with_deliverable(env, job_id, client, params, deliverable_hash)
    }

    /// Client creates an escrow with percentage-based milestones.
    /// milestone percentages must sum to 100.
    pub fn create_escrow_with_milestones(
        env: Env,
        job_id: String,
        client: Address,
        params: types::CreateEscrowParams,
    ) {
        escrow::create_escrow_with_milestones(env, job_id, client, params)
    }

    /// Freelancer signals that they have started work.
    pub fn start_work(env: Env, job_id: String, freelancer: Address) {
        escrow::start_work(env, job_id, freelancer)
    }

    /// Client approves completed work and releases funds to the freelancer.
    pub fn release_escrow(env: Env, job_id: String, client: Address) {
        escrow::release_escrow(env, job_id, client)
    }

    /// Client approves work and releases funds WITH conversion through DEX.
    pub fn release_with_conversion(
        env: Env,
        job_id: String,
        client: Address,
        _target_token: Address,
        _min_amount_out: i128,
    ) {
        escrow::release_with_conversion(env, job_id, client, _target_token, _min_amount_out)
    }

    /// Client cancels and gets a refund (only before work starts).
    pub fn refund_escrow(env: Env, job_id: String, client: Address) {
        escrow::refund_escrow(env, job_id, client)
    }

    /// Client claims a refund if the freelancer never started work before the timeout.
    pub fn timeout_refund(env: Env, job_id: String, client: Address) {
        escrow::timeout_refund(env, job_id, client)
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /// Get the full escrow record for a job.
    pub fn get_escrow(env: Env, job_id: String) -> types::Escrow {
        admin::get_escrow(env, job_id)
    }

    /// Get escrow status for a job.
    pub fn get_status(env: Env, job_id: String) -> types::EscrowStatus {
        admin::get_status(env, job_id)
    }

    /// Get timeout ledger for a job.
    pub fn get_timeout_ledger(env: Env, job_id: String) -> u32 {
        admin::get_timeout_ledger(env, job_id)
    }

    /// Get the timestamp after which `timeout_refund()` becomes available.
    pub fn get_timeout_timestamp(env: Env, job_id: String) -> u32 {
        admin::get_timeout_timestamp(env, job_id)
    }

    /// Get a single milestone from an escrow by index.
    pub fn get_milestone(env: Env, job_id: String, index: u32) -> types::Milestone {
        admin::get_milestone(env, job_id, index)
    }

    /// Check whether the contract is globally frozen.
    pub fn is_frozen(env: Env) -> bool {
        admin::is_frozen(env)
    }

    /// Get the referrer address for a job's escrow, if one was set.
    pub fn get_referrer(env: Env, job_id: String) -> Option<Address> {
        admin::get_referrer(env, job_id)
    }

    /// Get total number of escrows created.
    pub fn get_escrow_count(env: Env) -> u32 {
        admin::get_escrow_count(env)
    }

    /// Get the contract admin.
    pub fn get_admin(env: Env) -> Address {
        admin::get_admin(env)
    }

    /// Get the treasury address that receives platform fees.
    pub fn get_treasury_address(env: Env) -> Address {
        admin::get_treasury_address(env)
    }

    /// Get the platform fee in basis points (e.g. 100 = 1%).
    pub fn get_platform_fee_bps(env: Env) -> u32 {
        admin::get_platform_fee_bps(env)
    }

    // ─── Arbitrator Management ────────────────────────────────────────────

    /// Set the arbitrator address that can resolve disputes.
    pub fn set_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin::set_arbitrator(env, admin, arbitrator)
    }

    /// Get the current arbitrator address. Returns `None` if not set.
    pub fn get_arbitrator(env: Env) -> Option<Address> {
        admin::get_arbitrator(env)
    }

    /// Update the treasury address. Only callable by admin.
    pub fn set_treasury_address(env: Env, admin: Address, treasury_address: Address) {
        admin::set_treasury_address(env, admin, treasury_address)
    }

    /// Update the platform fee in basis points. Only callable by admin.
    pub fn set_platform_fee_bps(env: Env, admin: Address, bps: u32) {
        admin::set_platform_fee_bps(env, admin, bps)
    }

    /// Get the current global timeout in seconds.
    pub fn get_default_timeout_seconds(env: Env) -> u32 {
        admin::get_default_timeout_seconds(env)
    }

    /// Look up the admin-set cap on referrer bonus payouts.
    pub fn get_max_referrer_bonus_xlm(env: Env) -> Option<i128> {
        admin::get_max_referrer_bonus_xlm(env)
    }

    /// Admin sets the maximum referrer bonus (in token stroops).
    pub fn set_max_referrer_bonus_xlm(env: Env, admin: Address, cap: i128) {
        admin::set_max_referrer_bonus_xlm(env, admin, cap)
    }

    /// Update the global timeout in seconds.
    pub fn set_default_timeout_seconds(env: Env, admin: Address, timeout_seconds: u32) {
        admin::set_default_timeout_seconds(env, admin, timeout_seconds)
    }

    /// Admin freezes the entire contract.
    pub fn freeze_contract(env: Env, admin: Address) {
        admin::freeze_contract(env, admin)
    }

    /// Unfreeze the contract — requires M-of-N admin signatures.
    pub fn unfreeze_contract(env: Env, admins: Vec<Address>) {
        admin::unfreeze_contract(env, admins)
    }

    /// Add a new admin address to the multi-sig admin list.
    pub fn add_admin(env: Env, admin: Address, new_admin: Address) {
        admin::add_admin(env, admin, new_admin)
    }

    /// Update the unfreeze threshold (the M in M-of-N).
    pub fn set_unfreeze_threshold(env: Env, admin: Address, threshold: u32) {
        admin::set_unfreeze_threshold(env, admin, threshold)
    }

    /// Return the list of admin addresses.
    pub fn get_admins(env: Env) -> Vec<Address> {
        admin::get_admins(env)
    }

    /// Return the unfreeze threshold.
    pub fn get_unfreeze_threshold(env: Env) -> u32 {
        admin::get_unfreeze_threshold(env)
    }

    // ─── Escrow Timeout Extension by Mutual Consent ────────────────────────

    /// Either party may request to extend the escrow timeout.
    pub fn request_extension(env: Env, job_id: String, caller: Address, new_timeout_ledger: u32) {
        escrow::request_extension(env, job_id, caller, new_timeout_ledger)
    }

    /// The other party approves the pending extension.
    pub fn approve_extension(env: Env, job_id: String, caller: Address) {
        escrow::approve_extension(env, job_id, caller)
    }

    /// Return the pending extension request for a job, if any.
    pub fn get_extension_request(env: Env, job_id: String) -> Option<types::ExtensionRequest> {
        escrow::get_extension_request(env, job_id)
    }

    // ─── On-chain Message Notarization ─────────────────────────────────────

    /// Publish a message CID to the ledger.
    pub fn publish_message(
        env: Env,
        job_id: String,
        sender: Address,
        recipient: Address,
        ipfs_cid: String,
    ) {
        messages::publish_message(env, job_id, sender, recipient, ipfs_cid)
    }

    /// Retrieve all message CIDs stored on-chain for a job.
    pub fn get_message_cids(env: Env, job_id: String) -> soroban_sdk::Vec<String> {
        messages::get_message_cids(env, job_id)
    }

    // ─── Governance (DAO) ───────────────────────────────────────────────────

    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        duration_ledgers: u32,
    ) -> u32 {
        governance::create_proposal(env, proposer, title, description, duration_ledgers)
    }

    pub fn cast_vote(env: Env, voter: Address, proposal_id: u32, approve: bool) {
        governance::cast_vote(env, voter, proposal_id, approve)
    }

    pub fn resolve_proposal(env: Env, proposal_id: u32) {
        governance::resolve_proposal(env, proposal_id)
    }

    pub fn get_proposal(env: Env, id: u32) -> types::Proposal {
        governance::get_proposal(env, id)
    }

    pub fn list_active_proposals(env: Env) -> Vec<types::Proposal> {
        governance::list_active_proposals(env)
    }

    // ─── Disputes ──────────────────────────────────────────────────────────

    /// Raise a dispute — requires admin resolution.
    pub fn raise_dispute(env: Env, job_id: String, caller: Address) {
        disputes::raise_dispute(env, job_id, caller)
    }

    /// Resolve a disputed escrow with a split-percentage payout.
    pub fn resolve_dispute(
        env: Env,
        job_id: String,
        arbitrator: Address,
        winner: Address,
        split_percentage: u32,
    ) {
        disputes::resolve_dispute(env, job_id, arbitrator, winner, split_percentage)
    }

    /// Admin sets the global dispute bond configuration.
    pub fn set_dispute_bond(env: Env, admin: Address, token: Address, amount: i128) {
        disputes::set_dispute_bond(env, admin, token, amount)
    }

    /// Read the global dispute bond configuration.
    pub fn get_dispute_bond_config(env: Env) -> (Option<Address>, i128) {
        disputes::get_dispute_bond_config(env)
    }

    /// Read the per-job locked bond record.
    pub fn get_dispute_bond(env: Env, job_id: String) -> Option<types::DisputeBond> {
        disputes::get_dispute_bond(env, job_id)
    }

    // ─── Milestones ────────────────────────────────────────────────────────

    /// Milestone-based partial release.
    pub fn release_milestone(env: Env, job_id: String, milestone_id: u32, client: Address) {
        milestones::release_milestone(env, job_id, milestone_id, client)
    }

    /// Partial milestone refund — the client rejects a single milestone.
    pub fn reject_milestone(env: Env, job_id: String, milestone_index: u32, client: Address) {
        milestones::reject_milestone(env, job_id, milestone_index, client)
    }

    // ─── Job Boost ─────────────────────────────────────────────────────────

    /// Client pays XLM to the platform treasury to boost a job listing.
    pub fn boost_job(
        env: Env,
        job_id: String,
        client: Address,
        treasury: Address,
        token: Address,
        amount: i128,
    ) {
        escrow::boost_job(env, job_id, client, treasury, token, amount)
    }

    // ─── Sealed-Bid Budget Commitment ──────────────────────────────────────

    /// Client commits to a budget amount (sealed-bid).
    pub fn commit_budget(env: Env, job_id: String, budget_amount: i128, client: Address) {
        auction::commit_budget(env, job_id, budget_amount, client)
    }

    /// Reveal the budget. Auto-rejects bids over 150% of budget.
    pub fn reveal_budget(env: Env, job_id: String, client: Address) {
        auction::reveal_budget(env, job_id, client)
    }

    /// Get budget commitment.
    pub fn get_budget_commitment(env: Env, job_id: String) -> types::BudgetCommitment {
        auction::get_budget_commitment(env, job_id)
    }

    // ─── Sealed-Bid Commitment Scheme ──────────────────────────────────────

    /// Freelancer submits a sealed commitment hash for their bid amount.
    pub fn submit_bid_commitment(
        env: Env,
        job_id: String,
        freelancer: Address,
        commitment: BytesN<32>,
    ) {
        auction::submit_bid_commitment(env, job_id, freelancer, commitment)
    }

    /// Client closes bidding and opens a reveal window.
    pub fn close_bidding(env: Env, job_id: String, client: Address) {
        auction::close_bidding(env, job_id, client)
    }

    /// Freelancer reveals their sealed bid: amount + nonce.
    pub fn reveal_bid(
        env: Env,
        job_id: String,
        freelancer: Address,
        amount: i128,
        nonce: BytesN<32>,
    ) {
        auction::reveal_bid(env, job_id, freelancer, amount, nonce)
    }

    /// Read a freelancer's sealed bid commitment.
    pub fn get_bid_commitment(
        env: Env,
        job_id: String,
        freelancer: Address,
    ) -> types::BidCommitment {
        auction::get_bid_commitment(env, job_id, freelancer)
    }

    /// Read all bids that were revealed during reveal phase.
    pub fn get_revealed_bids(env: Env, job_id: String) -> Vec<types::RevealedBid> {
        auction::get_revealed_bids(env, job_id)
    }

    // ─── Deliverable Hash Oracle ───────────────────────────────────────────

    /// Client submits deliverable hash.
    pub fn submit_client_deliverable(env: Env, job_id: String, client: Address) {
        deliverable::submit_client_deliverable(env, job_id, client)
    }

    /// Freelancer submits deliverable hash.
    pub fn submit_freelancer_deliverable(env: Env, job_id: String, freelancer: Address) {
        deliverable::submit_freelancer_deliverable(env, job_id, freelancer)
    }

    /// Oracle/freelancer submits the deliverable hash.
    pub fn submit_deliverable(env: Env, job_id: String, actual_hash: BytesN<32>, caller: Address) {
        deliverable::submit_deliverable(env, job_id, actual_hash, caller)
    }

    /// Auto-release if both hashes match.
    pub fn check_deliverable_match(env: Env, job_id: String) -> bool {
        deliverable::check_deliverable_match(env, job_id)
    }

    /// Get deliverable submission status.
    pub fn get_deliverable_submission(env: Env, job_id: String) -> types::DeliverableSubmission {
        deliverable::get_deliverable_submission(env, job_id)
    }

    /// Freelancer submits the SHA-256 hash of the completed deliverable.
    pub fn submit_deliverable_hash(
        env: Env,
        job_id: String,
        freelancer: Address,
        hash: BytesN<32>,
    ) {
        deliverable::submit_deliverable_hash(env, job_id, freelancer, hash)
    }

    /// Get the freelancer-submitted deliverable hash, if any.
    pub fn get_freelancer_deliverable_hash(env: Env, job_id: String) -> Option<BytesN<32>> {
        deliverable::get_freelancer_deliverable_hash(env, job_id)
    }

    /// Verify that the freelancer-submitted hash matches the expected hash.
    pub fn verify_deliverable_hash(env: Env, job_id: String) -> bool {
        deliverable::verify_deliverable_hash(env, job_id)
    }

    // ─── Certificates, Evidence & Ratings ──────────────────────────────────

    /// Mint a certificate when job is completed.
    pub fn mint_certificate(env: Env, job_id: String, title: String, client: Address) {
        certificates::mint_certificate(env, job_id, title, client)
    }

    /// Append an IPFS CID to a job's on-chain dispute-evidence audit trail.
    pub fn submit_evidence_cid(env: Env, job_id: String, cid: Bytes, caller: Address) {
        certificates::submit_evidence_cid(env, job_id, cid, caller)
    }

    /// Get a certificate.
    pub fn get_certificate(env: Env, job_id: String) -> types::Certificate {
        certificates::get_certificate(env, job_id)
    }

    /// Get all certificates for a freelancer.
    pub fn get_freelancer_certificates(env: Env, freelancer: Address) -> Vec<String> {
        certificates::get_freelancer_certificates(env, freelancer)
    }

    pub fn submit_client_rating(env: Env, job_id: String, client: Address, score: u32) {
        certificates::submit_client_rating(env, job_id, client, score)
    }

    pub fn submit_freelancer_rating(env: Env, job_id: String, freelancer: Address, score: u32) {
        certificates::submit_freelancer_rating(env, job_id, freelancer, score)
    }

    pub fn resolve_arbitration(env: Env, case_id: u32) {
        certificates::resolve_arbitration(env, case_id)
    }

    /// Read the IPFS CIDs anchoring dispute evidence on-chain for a job.
    pub fn get_evidence_cids(env: Env, job_id: String) -> soroban_sdk::Vec<Bytes> {
        certificates::get_evidence_cids(env, job_id)
    }
}

#[cfg(test)]
mod tests;
