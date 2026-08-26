use soroban_sdk::{contracttype, Address, BytesN, String, Vec};

// ─── Storage keys ─────────────────────────────────────────────────────────────

/// Default timeout: 7 days in seconds.
pub(crate) const DEFAULT_TIMEOUT_SECONDS: u32 = 7 * 24 * 60 * 60;
/// Legacy fallback used by the older ledger-sequence timeout path.
pub(crate) const DEFAULT_TIMEOUT_LEDGERS: u32 = 120_960;

// ─── Data structures ──────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug)]
pub struct CreateEscrowParams {
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    pub milestones: Option<soroban_sdk::Vec<MilestoneInput>>,
    pub timeout_ledgers: Option<u32>,
    pub referrer: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MilestoneInput {
    pub description: String,
    pub percentage: u32,
}

/// Status of an escrow agreement.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    /// Funds locked, work not yet started
    Locked,
    /// Freelancer accepted, work in progress
    InProgress,
    /// Client approved work, funds released to freelancer
    Released,
    /// Client cancelled before work started, funds refunded
    Refunded,
    /// Disputed — requires admin resolution (future feature)
    Disputed,
    /// Admin-frozen — no operations allowed until unfrozen
    Frozen,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Milestone {
    pub id: u32,
    pub description: String,
    pub percentage: u32,
    pub released: bool,
    /// Set to true when the client rejects this milestone and its share is refunded
    pub rejected: bool,
}

/// An escrow record stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    /// Unique job identifier (from backend)
    pub job_id: String,
    /// Client who locked the funds
    pub client: Address,
    /// Freelancer who will receive the funds
    pub freelancer: Address,
    /// Token contract address (XLM SAC or USDC)
    pub token: Address,
    /// Amount in token's smallest unit (stroops for XLM)
    pub amount: i128,
    /// Current escrow status
    pub status: EscrowStatus,
    /// Ledger when escrow was created
    pub created_at: u32,
    /// Ledger after which client can call timeout_refund()
    pub timeout_ledger: u32,
    /// Optional milestones for partial releases
    pub milestones: soroban_sdk::Vec<Milestone>,
    /// Optional referrer address — receives 2% bonus on release
    pub referrer: Option<Address>,
    /// Optional expected SHA-256 deliverable hash agreed by both parties
    pub deliverable_hash: Option<BytesN<32>>,
}

/// Budget commitment for sealed-bid system (Issue #108)
#[contracttype]
#[derive(Clone, Debug)]
pub struct BudgetCommitment {
    pub job_id: String,
    pub client: Address,
    pub budget_amount: i128,
    pub is_revealed: bool,
}

/// Deliverable hash for oracle verification (Issue #105)
#[contracttype]
#[derive(Clone, Debug)]
pub struct DeliverableSubmission {
    pub job_id: String,
    pub client_hash_submitted: bool,
    pub freelancer_hash_submitted: bool,
    pub hashes_match: bool,
}

// On-chain dispute-evidence IPFS CID audit trail (Issue #448 --- AC #2).
//
// Per the AC, the contract stores a bare `Vec<Bytes>` of CIDs under
// `DataKey::EvidenceCids(job_id)`. Each entry is the raw ASCII bytes of
// an IPFS CID string (e.g. bytes of `bafy...`). The per-record
// struct (with `kind` and `submitter` fields) has been retired.

/// Freelancer sealed-bid commitment entry.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BidCommitment {
    pub job_id: String,
    pub freelancer: Address,
    pub commitment: BytesN<32>,
    pub submitted_at_ledger: u32,
    pub bid_revealed: bool,
}

/// Bidding lifecycle state for a job.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BiddingState {
    pub job_id: String,
    pub client: Address,
    pub is_closed: bool,
    pub closed_at_ledger: u32,
    pub reveal_deadline_ledger: u32,
}

/// A successfully revealed bid.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RevealedBid {
    pub freelancer: Address,
    pub amount: i128,
    pub revealed_at_ledger: u32,
}

/// A pending request to extend the escrow timeout, initiated by one party.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ExtensionRequest {
    pub requested_by: Address,
    pub new_timeout_ledger: u32,
    pub created_at: u32,
}

/// Job completion certificate (Issue #102)
///
/// Acts as a proof-of-work NFT minted to the freelancer once the escrow is
/// released. On-chain metadata captures the job title, client address,
/// freelancer address, escrow amount and the ledger at mint time.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Certificate {
    pub job_id: String,
    pub title: String,
    pub client: Address,
    pub freelancer: Address,
    pub amount: i128,
    pub created_at: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Rating {
    pub job_id: String,
    pub rater: Address,
    pub rated: Address,
    pub score_out_of_5: u32,
    pub submitted_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FreelancerRatingStats {
    pub total_score: u32,
    pub count: u32,
}

/// Global dispute bond configuration (Issue #437).
/// When present, callers must lock this amount before a dispute is accepted.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeBondConfig {
    pub token: Address,
    pub amount: i128,
}

/// Per-job locked bond snapshot taken at dispute-raise time.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeBond {
    pub caller: Address,
    pub token: Address,
    pub amount: i128,
    pub raised_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ArbitrationCase {
    pub job_id: String,
    pub arbitrators: Vec<Address>,
    pub votes: Vec<u32>,
    pub resolution: u32,
    pub status: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeCase {
    pub job_id: String,
    pub arbitrators: Vec<Address>,
    pub votes: Vec<u32>,
    pub voters: Vec<Address>,
    pub resolution: u32,
    pub status: u32,
}

/// Recurring escrow for retainer contracts (Issue #450)
#[contracttype]
#[derive(Clone, Debug)]
pub struct RecurringEscrow {
    pub job_id: String,
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub amount_per_release: i128,
    pub interval_ledgers: u32,
    pub releases_remaining: u32,
    pub last_release_ledger: u32,
    pub status: EscrowStatus,
}

/// Storage key per job
#[contracttype]
pub enum DataKey {
    Admin,
    /// List of admin addresses for multi-sig operations
    Admins,
    /// M-of-N threshold for unfreeze (default 2)
    UnfreezeThreshold,
    /// Whether the contract is globally frozen
    Frozen,
    Escrow(String),
    EscrowCount,
    Proposal(u32),
    ProposalCount,
    HasVoted(Address, u32),
    CompletedJobs(Address),
    DefaultTimeoutSeconds,
    TimeoutTimestamp(String),
    BudgetCommitment(String),
    DeliverableSubmission(String),
    /// Per-job append-only audit log of deliverable IPFS CIDs (Issue #448).
    /// Stores a Vec<Bytes> of dispute-evidence CIDs under the job_id key.
    EvidenceCids(String),
    BidCommitment(String, Address),
    BiddingState(String),
    RevealedBids(String),
    Certificate(String),
    FreelancerCertificates(Address),
    ClientRating(String),
    FreelancerRating(String),
    FreelancerRatingStats(Address),
    Arbitrator(Address),
    ArbitratorPool,
    /// Single admin-designated arbitrator (set_arbitrator / get_arbitrator)
    ArbitratorAddress,
    ArbitrationCase(u32),
    ArbitrationCaseCount,
    DisputeCase(String),
    Version,
    /// Stores list of IPFS CIDs for messages in a job thread
    MessageCid(String),
    /// Freelancer-submitted deliverable SHA-256 hash for release verification
    FreelancerDeliverableHash(String),
    /// Address that receives platform fees on every escrow release
    TreasuryAddress,
    /// Platform fee in basis points (e.g. 100 = 1%)
    PlatformFeeBps,
    /// Maximum referrer bonus cap in token stroops
    MaxReferrerBonusXlm,
    /// Pending escrow timeout extension request
    ExtensionRequest(String),
    /// Global dispute bond configuration
    DisputeBondConfig,
    /// Per-job locked dispute bond record
    DisputeBond(String),
}

/// Reveal phase is open for roughly 24 hours after client closes bidding.
pub(crate) const REVEAL_WINDOW_LEDGERS: u32 = 17_280;

/// A governance proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u32,
    pub title: String,
    pub description: String,
    pub votes_for: u32,
    pub votes_against: u32,
    pub deadline_ledger: u32,
    pub resolved: bool,
    pub result: bool,
}
