/*
 * contracts/marketpay-contract/src/errors.rs
 *
 * Stellar MarketPay — Soroban Contract Error Codes
 *
 * Canonical error codes that map 1:1 to contract panic messages.
 * These codes are consumed by the frontend to display human-readable,
 * translated error messages to end users.
 *
 * NOTE: This module is #![no_std] compatible and designed for
 * soroban_sdk environments. Error codes are u32 for compact
 * on-chain event emission and frontend mapping.
 */

#![allow(dead_code)]

/// Unique error code for every contract panic message.
///
/// Codes are grouped by functional area:
/// - 1xxx : Initialization & admin
/// - 2xxx : Escrow lifecycle
/// - 3xxx : Milestones
/// - 4xxx : Bidding & sealed-bid auction
/// - 5xxx : Ratings & certificates
/// - 6xxx : Governance (DAO) & proposals
/// - 7xxx : Disputes & arbitration
/// - 8xxx : Deliverable oracle & messaging
/// - 9xxx : Job boost & extensions
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ContractError {
    // ── 1xxx: Initialization & admin ──────────────────────────────────────
    /// "Already initialized"
    AlreadyInitialized = 1001,
    /// "Not initialized"
    NotInitialized = 1002,
    /// "Contract is frozen"
    ContractFrozen = 1003,
    /// "Contract is not frozen"
    ContractNotFrozen = 1004,
    /// "Only admin can set treasury address"
    OnlyAdminSetTreasury = 1010,
    /// "Only admin can set platform fee"
    OnlyAdminSetFee = 1011,
    /// "Platform fee cannot exceed 10% (1000 bps)"
    PlatformFeeExceedsMax = 1012,
    /// "Only an admin can freeze the contract"
    OnlyAdminCanFreeze = 1013,
    /// "Insufficient admin signatures to unfreeze"
    InsufficientSignatures = 1014,
    /// "One of the provided addresses is not an admin"
    NotAnAdmin = 1015,
    /// "Duplicate admin in unfreeze signatures"
    DuplicateAdminSignature = 1016,
    /// "Only an admin can add new admins"
    OnlyAdminCanAddAdmin = 1017,
    /// "Address is already an admin"
    AlreadyAdmin = 1018,
    /// "Only an admin can update the threshold"
    OnlyAdminUpdateThreshold = 1019,
    /// "Threshold must be between 1 and the number of admins"
    InvalidThreshold = 1020,
    /// "Only admin can set the referrer bonus cap"
    OnlyAdminSetReferrerCap = 1021,
    /// "Referrer bonus cap must be non-negative"
    ReferrerCapNegative = 1022,
    /// "Only admin can update the timeout"
    OnlyAdminUpdateTimeout = 1023,
    /// "Timeout must be positive"
    TimeoutMustBePositive = 1024,

    // ── 2xxx: Escrow lifecycle ────────────────────────────────────────────
    /// "Amount must be positive"
    AmountMustBePositive = 2001,
    /// "Referrer cannot be the client or freelancer"
    InvalidReferrer = 2002,
    /// "Escrow already exists for this job"
    EscrowAlreadyExists = 2003,
    /// "Escrow not found"
    EscrowNotFound = 2004,
    /// "Only the freelancer can start work"
    OnlyFreelancerCanStartWork = 2005,
    /// "Escrow is not in Locked state"
    EscrowNotLocked = 2006,
    /// "Only the client can release escrow"
    OnlyClientCanRelease = 2007,
    /// "Cannot release escrow in current status"
    CannotReleaseStatus = 2008,
    /// "Freelancer deliverable hash does not match or not submitted"
    DeliverableHashMismatch = 2009,
    /// "Only the client can request a refund"
    OnlyClientCanRefund = 2010,
    /// "Can only refund before work has started"
    CanOnlyRefundLocked = 2011,
    /// "Only the client can request a timeout refund"
    OnlyClientCanTimeoutRefund = 2012,
    /// "Timeout period has not expired yet"
    TimeoutNotExpired = 2013,

    // ── 3xxx: Milestones ──────────────────────────────────────────────────
    /// "Maximum 5 milestones allowed"
    MaxMilestones = 3001,
    /// "Milestone percentage must be positive"
    MilestonePercentagePositive = 3002,
    /// "Milestone percentages must sum to 100"
    MilestonePercentagesSum = 3003,
    /// "Only the client can release a milestone"
    OnlyClientCanReleaseMilestone = 3004,
    /// "Cannot release milestone in current status"
    CannotReleaseMilestoneStatus = 3005,
    /// "Invalid milestone index" / "Milestone index out of bounds"
    InvalidMilestoneIndex = 3006,
    /// "Milestone already completed"
    MilestoneAlreadyCompleted = 3007,

    // ── 4xxx: Bidding & sealed-bid auction ────────────────────────────────
    /// "Budget must be positive"
    BudgetPositive = 4001,
    /// "Budget commitment not found"
    BudgetCommitmentNotFound = 4002,
    /// "Only the client can reveal the budget"
    OnlyClientCanRevealBudget = 4003,
    /// "Budget already revealed"
    BudgetAlreadyRevealed = 4004,
    /// "Bidding is closed"
    BiddingClosed = 4005,
    /// "Bid commitment already submitted"
    BidCommitmentAlreadySubmitted = 4006,
    /// "Bidding not closed"
    BiddingNotClosed = 4007,
    /// "Reveal window has closed"
    RevealWindowClosed = 4008,
    /// "Bid already revealed"
    BidAlreadyRevealed = 4009,
    /// "Commitment verification failed"
    CommitmentVerificationFailed = 4010,

    // ── 5xxx: Ratings & certificates ──────────────────────────────────────
    /// "Score must be between 1 and 5"
    InvalidScore = 5001,
    /// "Ratings are allowed only after escrow release"
    RatingsOnlyAfterRelease = 5002,
    /// "Client rating already submitted for this job"
    RatingAlreadySubmitted = 5003,
    /// "Freelancer rating already submitted for this job"
    FreelancerRatingAlreadySubmitted = 5004,
    /// "Escrow must be released to mint certificate"
    EscrowMustBeReleased = 5005,
    /// "Certificate already minted"
    CertificateAlreadyMinted = 5006,

    // ── 6xxx: Governance (DAO) & proposals ────────────────────────────────
    /// "Duration must be positive"
    DurationPositive = 6001,
    /// "Proposal not found"
    ProposalNotFound = 6002,
    /// "Proposal already resolved"
    ProposalAlreadyResolved = 6003,
    /// "Voting period has ended"
    VotingPeriodEnded = 6004,
    /// "Only users with completed jobs can vote"
    OnlyCompletedJobsCanVote = 6005,
    /// "Voter has already cast a vote"
    AlreadyVoted = 6006,
    /// "Voting period is not over yet"
    VotingNotOver = 6007,

    // ── 7xxx: Disputes & arbitration ──────────────────────────────────────
    /// "Only participants can raise a dispute"
    OnlyParticipantsCanDispute = 7001,
    /// "Cannot dispute a resolved, frozen, or already-disputed escrow"
    CannotDisputeResolved = 7002,
    /// "Only admin can resolve a dispute"
    OnlyAdminCanResolveDispute = 7003,
    /// "Escrow is not in Disputed state"
    EscrowNotDisputed = 7004,
    /// "Only admin can update the dispute bond"
    OnlyAdminUpdateDisputeBond = 7005,
    /// "Bond amount must be positive"
    BondAmountPositive = 7006,
    /// "Only admin can register arbitrators"
    OnlyAdminRegisterArbitrators = 7007,
    /// "Need at least 3 registered arbitrators"
    Need3Arbitrators = 7008,
    /// "Only admin can open arbitration"
    OnlyAdminOpenArbitration = 7009,
    /// "Arbitration case not found"
    ArbitrationCaseNotFound = 7010,
    /// "Arbitration case is not open"
    ArbitrationCaseNotOpen = 7011,
    /// "Only selected arbitrators can vote"
    OnlySelectedArbitrators = 7012,
    /// "All votes already submitted"
    AllVotesSubmitted = 7013,
    /// "Exactly 3 votes required"
    Exactly3VotesRequired = 7014,

    // ── 8xxx: Deliverable oracle & messaging ──────────────────────────────
    /// "Only freelancer or oracle can submit deliverable"
    OnlyFreelancerOrOracle = 8001,
    /// "Escrow has no deliverable hash"
    NoDeliverableHash = 8002,
    /// "IPFS CID cannot be empty"
    IpfsCidEmpty = 8003,

    // ── 9xxx: Job boost & extensions ──────────────────────────────────────
    /// "Minimum boost is 5 XLM"
    MinimumBoost5Xlm = 9001,
    /// "Boost amount must be positive"
    BoostAmountPositive = 9002,
    /// "Only the client or freelancer can request an extension"
    OnlyParticipantsCanExtend = 9003,
    /// "Cannot extend timeout in current status"
    CannotExtendStatus = 9004,
    /// "New timeout must be later than current timeout"
    NewTimeoutMustBeLater = 9005,
    /// "An extension request is already pending for this job"
    ExtensionAlreadyPending = 9006,
    /// "No pending extension request"
    NoPendingExtension = 9007,
    /// "Cannot approve your own extension request"
    CannotApproveOwnExtension = 9008,
    /// "Only the client or freelancer can approve an extension"
    OnlyParticipantsCanApprove = 9009,

    // ── 99xx: Arithmetic & system ─────────────────────────────────────────
    /// "Arithmetic overflow"
    ArithmeticOverflow = 9901,
    /// "Counter overflow"
    CounterOverflow = 9902,
    /// "Timeout ledger overflow"
    TimeoutLedgerOverflow = 9903,
    /// "Timeout timestamp overflow"
    TimeoutTimestampOverflow = 9904,
}

impl ContractError {
    /// Map an error code to its canonical panic message string.
    /// Used by the frontend to reverse-map Soroban error output.
    pub const fn panic_message(&self) -> &'static str {
        match self {
            // 1xxx
            Self::AlreadyInitialized => "Already initialized",
            Self::NotInitialized => "Not initialized",
            Self::ContractFrozen => "Contract is frozen",
            Self::ContractNotFrozen => "Contract is not frozen",
            Self::OnlyAdminSetTreasury => "Only admin can set treasury address",
            Self::OnlyAdminSetFee => "Only admin can set platform fee",
            Self::PlatformFeeExceedsMax => "Platform fee cannot exceed 10% (1000 bps)",
            Self::OnlyAdminCanFreeze => "Only an admin can freeze the contract",
            Self::InsufficientSignatures => "Insufficient admin signatures to unfreeze",
            Self::NotAnAdmin => "One of the provided addresses is not an admin",
            Self::DuplicateAdminSignature => "Duplicate admin in unfreeze signatures",
            Self::OnlyAdminCanAddAdmin => "Only an admin can add new admins",
            Self::AlreadyAdmin => "Address is already an admin",
            Self::OnlyAdminUpdateThreshold => "Only an admin can update the threshold",
            Self::InvalidThreshold => "Threshold must be between 1 and the number of admins",
            Self::OnlyAdminSetReferrerCap => "Only admin can set the referrer bonus cap",
            Self::ReferrerCapNegative => "Referrer bonus cap must be non-negative",
            Self::OnlyAdminUpdateTimeout => "Only admin can update the timeout",
            Self::TimeoutMustBePositive => "Timeout must be positive",
            // 2xxx
            Self::AmountMustBePositive => "Amount must be positive",
            Self::InvalidReferrer => "Referrer cannot be the client or freelancer",
            Self::EscrowAlreadyExists => "Escrow already exists for this job",
            Self::EscrowNotFound => "Escrow not found",
            Self::OnlyFreelancerCanStartWork => "Only the freelancer can start work",
            Self::EscrowNotLocked => "Escrow is not in Locked state",
            Self::OnlyClientCanRelease => "Only the client can release escrow",
            Self::CannotReleaseStatus => "Cannot release escrow in current status",
            Self::DeliverableHashMismatch => {
                "Freelancer deliverable hash does not match or not submitted"
            }
            Self::OnlyClientCanRefund => "Only the client can request a refund",
            Self::CanOnlyRefundLocked => "Can only refund before work has started",
            Self::OnlyClientCanTimeoutRefund => "Only the client can request a timeout refund",
            Self::TimeoutNotExpired => "Timeout period has not expired yet",
            // 3xxx
            Self::MaxMilestones => "Maximum 5 milestones allowed",
            Self::MilestonePercentagePositive => "Milestone percentage must be positive",
            Self::MilestonePercentagesSum => "Milestone percentages must sum to 100",
            Self::OnlyClientCanReleaseMilestone => "Only the client can release a milestone",
            Self::CannotReleaseMilestoneStatus => "Cannot release milestone in current status",
            Self::InvalidMilestoneIndex => "Milestone index out of bounds",
            Self::MilestoneAlreadyCompleted => "Milestone already completed",
            // 4xxx
            Self::BudgetPositive => "Budget must be positive",
            Self::BudgetCommitmentNotFound => "Budget commitment not found",
            Self::OnlyClientCanRevealBudget => "Only the client can reveal the budget",
            Self::BudgetAlreadyRevealed => "Budget already revealed",
            Self::BiddingClosed => "Bidding is closed",
            Self::BidCommitmentAlreadySubmitted => "Bid commitment already submitted",
            Self::BiddingNotClosed => "Bidding not closed",
            Self::RevealWindowClosed => "Reveal window has closed",
            Self::BidAlreadyRevealed => "Bid already revealed",
            Self::CommitmentVerificationFailed => "Commitment verification failed",
            // 5xxx
            Self::InvalidScore => "Score must be between 1 and 5",
            Self::RatingsOnlyAfterRelease => "Ratings are allowed only after escrow release",
            Self::RatingAlreadySubmitted => "Client rating already submitted for this job",
            Self::FreelancerRatingAlreadySubmitted => {
                "Freelancer rating already submitted for this job"
            }
            Self::EscrowMustBeReleased => "Escrow must be released to mint certificate",
            Self::CertificateAlreadyMinted => "Certificate already minted",
            // 6xxx
            Self::DurationPositive => "Duration must be positive",
            Self::ProposalNotFound => "Proposal not found",
            Self::ProposalAlreadyResolved => "Proposal already resolved",
            Self::VotingPeriodEnded => "Voting period has ended",
            Self::OnlyCompletedJobsCanVote => "Only users with completed jobs can vote",
            Self::AlreadyVoted => "Voter has already cast a vote",
            Self::VotingNotOver => "Voting period is not over yet",
            // 7xxx
            Self::OnlyParticipantsCanDispute => "Only participants can raise a dispute",
            Self::CannotDisputeResolved => {
                "Cannot dispute a resolved, frozen, or already-disputed escrow"
            }
            Self::OnlyAdminCanResolveDispute => "Only admin can resolve a dispute",
            Self::EscrowNotDisputed => "Escrow is not in Disputed state",
            Self::OnlyAdminUpdateDisputeBond => "Only admin can update the dispute bond",
            Self::BondAmountPositive => "Bond amount must be positive",
            Self::OnlyAdminRegisterArbitrators => "Only admin can register arbitrators",
            Self::Need3Arbitrators => "Need at least 3 registered arbitrators",
            Self::OnlyAdminOpenArbitration => "Only admin can open arbitration",
            Self::ArbitrationCaseNotFound => "Arbitration case not found",
            Self::ArbitrationCaseNotOpen => "Arbitration case is not open",
            Self::OnlySelectedArbitrators => "Only selected arbitrators can vote",
            Self::AllVotesSubmitted => "All votes already submitted",
            Self::Exactly3VotesRequired => "Exactly 3 votes required",
            // 8xxx
            Self::OnlyFreelancerOrOracle => "Only freelancer or oracle can submit deliverable",
            Self::NoDeliverableHash => "Escrow has no deliverable hash",
            Self::IpfsCidEmpty => "IPFS CID cannot be empty",
            // 9xxx
            Self::MinimumBoost5Xlm => "Minimum boost is 5 XLM",
            Self::BoostAmountPositive => "Boost amount must be positive",
            Self::OnlyParticipantsCanExtend => {
                "Only the client or freelancer can request an extension"
            }
            Self::CannotExtendStatus => "Cannot extend timeout in current status",
            Self::NewTimeoutMustBeLater => "New timeout must be later than current timeout",
            Self::ExtensionAlreadyPending => "An extension request is already pending for this job",
            Self::NoPendingExtension => "No pending extension request",
            Self::CannotApproveOwnExtension => "Cannot approve your own extension request",
            Self::OnlyParticipantsCanApprove => {
                "Only the client or freelancer can approve an extension"
            }
            // 99xx
            Self::ArithmeticOverflow => "Arithmetic overflow",
            Self::CounterOverflow => "Counter overflow",
            Self::TimeoutLedgerOverflow => "Timeout ledger overflow",
            Self::TimeoutTimestampOverflow => "Timeout timestamp overflow",
        }
    }

    /// Returns the numeric error code as u32.
    pub const fn code(&self) -> u32 {
        *self as u32
    }
}

/// Map a panic message string to its error code.
/// Returns None if the message does not match any known contract error.
pub fn error_code_from_panic(msg: &str) -> Option<u32> {
    let msg = msg.trim();

    // Strip "Error: " prefix
    let msg = msg.strip_prefix("Error: ").unwrap_or(msg);

    // Strip "HostError: " prefix
    let msg = msg.strip_prefix("HostError: ").unwrap_or(msg);

    // Handle Soroban's "Error(Contract, #N)" format — the #N is a WASM
    // error-table index. We can't map it to a specific code, but we know
    // it's a contract error.
    if msg.starts_with("Error(Contract,") {
        // Check if there's a diagnostic message appended: "Error(Contract, #N): <msg>"
        if let Some(rest) = msg.strip_prefix("Error(Contract,") {
            if let Some(close_paren) = rest.find(')') {
                let after = &rest[close_paren + 1..];
                let after = after.strip_prefix(": ").unwrap_or(after).trim();
                if !after.is_empty() && after.len() > 1 {
                    // Try to map the appended message
                    return error_code_from_panic(after);
                }
            }
        }
        // Bare Error(Contract, #N) — known contract error, unknown type
        return Some(0); // Generic contract error
    }

    match msg {
        // 1xxx
        "Already initialized" => Some(1001),
        "Not initialized" => Some(1002),
        "Contract is frozen" => Some(1003),
        "Contract is not frozen" => Some(1004),
        "Only admin can set treasury address" => Some(1010),
        "Only admin can set platform fee" => Some(1011),
        "Platform fee cannot exceed 10% (1000 bps)" => Some(1012),
        "Only an admin can freeze the contract" => Some(1013),
        "Insufficient admin signatures to unfreeze" => Some(1014),
        "One of the provided addresses is not an admin" => Some(1015),
        "Duplicate admin in unfreeze signatures" => Some(1016),
        "Only an admin can add new admins" => Some(1017),
        "Address is already an admin" => Some(1018),
        "Only an admin can update the threshold" => Some(1019),
        "Threshold must be between 1 and the number of admins" => Some(1020),
        "Only admin can set the referrer bonus cap" => Some(1021),
        "Referrer bonus cap must be non-negative" => Some(1022),
        "Only admin can update the timeout" => Some(1023),
        "Timeout must be positive" => Some(1024),
        // 2xxx
        "Amount must be positive" => Some(2001),
        "Referrer cannot be the client or freelancer" => Some(2002),
        "Escrow already exists for this job" => Some(2003),
        "Escrow not found" => Some(2004),
        "Only the freelancer can start work" => Some(2005),
        "Escrow is not in Locked state" => Some(2006),
        "Only the client can release escrow" => Some(2007),
        "Cannot release escrow in current status" => Some(2008),
        "Freelancer deliverable hash does not match or not submitted" => Some(2009),
        "Only the client can request a refund" => Some(2010),
        "Can only refund before work has started" => Some(2011),
        "Only the client can request a timeout refund" => Some(2012),
        "Timeout period has not expired yet" => Some(2013),
        // 3xxx
        "Maximum 5 milestones allowed" => Some(3001),
        "Milestone percentage must be positive" => Some(3002),
        "Milestone percentages must sum to 100" => Some(3003),
        "Only the client can release a milestone" => Some(3004),
        "Cannot release milestone in current status" => Some(3005),
        "Milestone index out of bounds" | "Invalid milestone index" => Some(3006),
        "Milestone already completed" => Some(3007),
        // 4xxx
        "Budget must be positive" => Some(4001),
        "Budget commitment not found" => Some(4002),
        "Only the client can reveal the budget" => Some(4003),
        "Budget already revealed" => Some(4004),
        "Bidding is closed" => Some(4005),
        "Bid commitment already submitted" => Some(4006),
        "Bidding not closed" => Some(4007),
        "Reveal window has closed" => Some(4008),
        "Bid already revealed" => Some(4009),
        "Commitment verification failed" => Some(4010),
        // 5xxx
        "Score must be between 1 and 5" => Some(5001),
        "Ratings are allowed only after escrow release" => Some(5002),
        "Client rating already submitted for this job" => Some(5003),
        "Freelancer rating already submitted for this job" => Some(5004),
        "Escrow must be released to mint certificate" => Some(5005),
        "Certificate already minted" => Some(5006),
        // 6xxx
        "Duration must be positive" => Some(6001),
        "Proposal not found" => Some(6002),
        "Proposal already resolved" => Some(6003),
        "Voting period has ended" => Some(6004),
        "Only users with completed jobs can vote" => Some(6005),
        "Voter has already cast a vote" => Some(6006),
        "Voting period is not over yet" => Some(6007),
        // 7xxx
        "Only participants can raise a dispute" => Some(7001),
        "Cannot dispute a resolved, frozen, or already-disputed escrow" => Some(7002),
        "Only admin can resolve a dispute" => Some(7003),
        "Escrow is not in Disputed state" => Some(7004),
        "Only admin can update the dispute bond" => Some(7005),
        "Bond amount must be positive" => Some(7006),
        "Only admin can register arbitrators" => Some(7007),
        "Need at least 3 registered arbitrators" => Some(7008),
        "Only admin can open arbitration" => Some(7009),
        "Arbitration case not found" => Some(7010),
        "Arbitration case is not open" => Some(7011),
        "Only selected arbitrators can vote" => Some(7012),
        "All votes already submitted" => Some(7013),
        "Exactly 3 votes required" => Some(7014),
        // 8xxx
        "Only freelancer or oracle can submit deliverable" => Some(8001),
        "Escrow has no deliverable hash" => Some(8002),
        "IPFS CID cannot be empty" => Some(8003),
        // 9xxx
        "Minimum boost is 5 XLM" => Some(9001),
        "Boost amount must be positive" => Some(9002),
        "Only the client or freelancer can request an extension" => Some(9003),
        "Cannot extend timeout in current status" => Some(9004),
        "New timeout must be later than current timeout" => Some(9005),
        "An extension request is already pending for this job" => Some(9006),
        "No pending extension request" => Some(9007),
        "Cannot approve your own extension request" => Some(9008),
        "Only the client or freelancer can approve an extension" => Some(9009),
        // 99xx
        "Arithmetic overflow" => Some(9901),
        "Counter overflow" => Some(9902),
        "Timeout ledger overflow" => Some(9903),
        "Timeout timestamp overflow" => Some(9904),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_error_has_unique_code() {
        let mut codes: Vec<u32> = vec![];
        let variants = [
            ContractError::AlreadyInitialized,
            ContractError::NotInitialized,
            ContractError::ContractFrozen,
            ContractError::ContractNotFrozen,
        ];
        for v in &variants {
            assert!(!codes.contains(&v.code()), "Duplicate code {}", v.code());
            codes.push(v.code());
        }
    }

    #[test]
    fn panic_message_round_trips() {
        let err = ContractError::EscrowNotFound;
        let msg = err.panic_message();
        let parsed = error_code_from_panic(msg);
        assert_eq!(parsed, Some(err.code()));
    }

    #[test]
    fn soroban_wrapped_error_parsed() {
        // Simulate Soroban's "Error(Contract, #N)" wrapping
        // Unknown contract errors return the generic code 0
        assert_eq!(error_code_from_panic("Error(Contract, #1)"), Some(0));
    }

    #[test]
    fn soroban_wrapped_error_with_diagnostic() {
        // "Error(Contract, #N): <message>" with a known message
        assert_eq!(
            error_code_from_panic("Error(Contract, #1): Escrow not found"),
            Some(2004)
        );
    }

    #[test]
    fn host_error_format_parsed() {
        // HostError wrapping a known message
        assert_eq!(
            error_code_from_panic("HostError: Escrow not found"),
            Some(2004)
        );
    }

    #[test]
    fn unknown_message_returns_none() {
        assert_eq!(error_code_from_panic("Some random unknown error"), None);
    }

    #[test]
    fn error_prefix_stripped() {
        assert_eq!(error_code_from_panic("Error: Escrow not found"), Some(2004));
    }
}
