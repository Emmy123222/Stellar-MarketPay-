/**
 * lib/contractErrors.ts
 *
 * Maps Soroban contract error codes to human-readable, translated messages.
 * Used by the frontend error handler to display localized contract errors.
 *
 * Error codes mirror the canonical list in contracts/marketpay-contract/src/errors.rs
 * and are documented in docs/contract-errors.md.
 */

// ─── Error code constants (mirrors ContractError enum in errors.rs) ──────────

export const CONTRACT_ERROR_CODES = {
  /** Generic/unknown contract error. Returned when the Soroban error format
   * doesn't include the specific panic message (e.g., "Error(Contract, #1)"). */
  UNKNOWN: 0 as const,

  // 1xxx: Initialization & admin
  ALREADY_INITIALIZED: 1001,
  NOT_INITIALIZED: 1002,
  CONTRACT_FROZEN: 1003,
  CONTRACT_NOT_FROZEN: 1004,
  ONLY_ADMIN_SET_TREASURY: 1010,
  ONLY_ADMIN_SET_FEE: 1011,
  PLATFORM_FEE_EXCEEDS_MAX: 1012,
  ONLY_ADMIN_CAN_FREEZE: 1013,
  INSUFFICIENT_SIGNATURES: 1014,
  NOT_AN_ADMIN: 1015,
  DUPLICATE_ADMIN_SIGNATURE: 1016,
  ONLY_ADMIN_CAN_ADD_ADMIN: 1017,
  ALREADY_ADMIN: 1018,
  ONLY_ADMIN_UPDATE_THRESHOLD: 1019,
  INVALID_THRESHOLD: 1020,
  ONLY_ADMIN_SET_REFERRER_CAP: 1021,
  REFERRER_CAP_NEGATIVE: 1022,
  ONLY_ADMIN_UPDATE_TIMEOUT: 1023,
  TIMEOUT_MUST_BE_POSITIVE: 1024,

  // 2xxx: Escrow lifecycle
  AMOUNT_MUST_BE_POSITIVE: 2001,
  INVALID_REFERRER: 2002,
  ESCROW_ALREADY_EXISTS: 2003,
  ESCROW_NOT_FOUND: 2004,
  ONLY_FREELANCER_CAN_START_WORK: 2005,
  ESCROW_NOT_LOCKED: 2006,
  ONLY_CLIENT_CAN_RELEASE: 2007,
  CANNOT_RELEASE_STATUS: 2008,
  DELIVERABLE_HASH_MISMATCH: 2009,
  ONLY_CLIENT_CAN_REFUND: 2010,
  CAN_ONLY_REFUND_LOCKED: 2011,
  ONLY_CLIENT_CAN_TIMEOUT_REFUND: 2012,
  TIMEOUT_NOT_EXPIRED: 2013,

  // 3xxx: Milestones
  MAX_MILESTONES: 3001,
  MILESTONE_PERCENTAGE_POSITIVE: 3002,
  MILESTONE_PERCENTAGES_SUM: 3003,
  ONLY_CLIENT_CAN_RELEASE_MILESTONE: 3004,
  CANNOT_RELEASE_MILESTONE_STATUS: 3005,
  INVALID_MILESTONE_INDEX: 3006,
  MILESTONE_ALREADY_COMPLETED: 3007,

  // 4xxx: Bidding & sealed-bid auction
  BUDGET_POSITIVE: 4001,
  BUDGET_COMMITMENT_NOT_FOUND: 4002,
  ONLY_CLIENT_CAN_REVEAL_BUDGET: 4003,
  BUDGET_ALREADY_REVEALED: 4004,
  BIDDING_CLOSED: 4005,
  BID_COMMITMENT_ALREADY_SUBMITTED: 4006,
  BIDDING_NOT_CLOSED: 4007,
  REVEAL_WINDOW_CLOSED: 4008,
  BID_ALREADY_REVEALED: 4009,
  COMMITMENT_VERIFICATION_FAILED: 4010,

  // 5xxx: Ratings & certificates
  INVALID_SCORE: 5001,
  RATINGS_ONLY_AFTER_RELEASE: 5002,
  RATING_ALREADY_SUBMITTED: 5003,
  FREELANCER_RATING_ALREADY_SUBMITTED: 5004,
  ESCROW_MUST_BE_RELEASED: 5005,
  CERTIFICATE_ALREADY_MINTED: 5006,

  // 6xxx: Governance (DAO) & proposals
  DURATION_POSITIVE: 6001,
  PROPOSAL_NOT_FOUND: 6002,
  PROPOSAL_ALREADY_RESOLVED: 6003,
  VOTING_PERIOD_ENDED: 6004,
  ONLY_COMPLETED_JOBS_CAN_VOTE: 6005,
  ALREADY_VOTED: 6006,
  VOTING_NOT_OVER: 6007,

  // 7xxx: Disputes & arbitration
  ONLY_PARTICIPANTS_CAN_DISPUTE: 7001,
  CANNOT_DISPUTE_RESOLVED: 7002,
  ONLY_ADMIN_CAN_RESOLVE_DISPUTE: 7003,
  ESCROW_NOT_DISPUTED: 7004,
  ONLY_ADMIN_UPDATE_DISPUTE_BOND: 7005,
  BOND_AMOUNT_POSITIVE: 7006,
  ONLY_ADMIN_REGISTER_ARBITRATORS: 7007,
  NEED_3_ARBITRATORS: 7008,
  ONLY_ADMIN_OPEN_ARBITRATION: 7009,
  ARBITRATION_CASE_NOT_FOUND: 7010,
  ARBITRATION_CASE_NOT_OPEN: 7011,
  ONLY_SELECTED_ARBITRATORS: 7012,
  ALL_VOTES_SUBMITTED: 7013,
  EXACTLY_3_VOTES_REQUIRED: 7014,

  // 8xxx: Deliverable oracle & messaging
  ONLY_FREELANCER_OR_ORACLE: 8001,
  NO_DELIVERABLE_HASH: 8002,
  IPFS_CID_EMPTY: 8003,

  // 9xxx: Job boost & extensions
  MINIMUM_BOOST_5_XLM: 9001,
  BOOST_AMOUNT_POSITIVE: 9002,
  ONLY_PARTICIPANTS_CAN_EXTEND: 9003,
  CANNOT_EXTEND_STATUS: 9004,
  NEW_TIMEOUT_MUST_BE_LATER: 9005,
  EXTENSION_ALREADY_PENDING: 9006,
  NO_PENDING_EXTENSION: 9007,
  CANNOT_APPROVE_OWN_EXTENSION: 9008,
  ONLY_PARTICIPANTS_CAN_APPROVE: 9009,

  // 99xx: Arithmetic & system
  ARITHMETIC_OVERFLOW: 9901,
  COUNTER_OVERFLOW: 9902,
  TIMEOUT_LEDGER_OVERFLOW: 9903,
  TIMEOUT_TIMESTAMP_OVERFLOW: 9904,
} as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[keyof typeof CONTRACT_ERROR_CODES];

// ─── English messages (fallback) ──────────────────────────────────────────────

const GENERIC_CONTRACT_ERROR_EN = "The contract rejected this operation. Please check your inputs and try again.";

const CONTRACT_ERROR_MESSAGES_EN: Record<ContractErrorCode, string> = {
  [CONTRACT_ERROR_CODES.UNKNOWN]: GENERIC_CONTRACT_ERROR_EN,
  // 1xxx
  [CONTRACT_ERROR_CODES.ALREADY_INITIALIZED]: "Contract has already been initialized.",
  [CONTRACT_ERROR_CODES.NOT_INITIALIZED]: "Contract has not been initialized yet.",
  [CONTRACT_ERROR_CODES.CONTRACT_FROZEN]: "The contract is currently frozen. No operations are allowed.",
  [CONTRACT_ERROR_CODES.CONTRACT_NOT_FROZEN]: "The contract is not frozen.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_TREASURY]: "Only the admin can update the treasury address.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_FEE]: "Only the admin can update the platform fee.",
  [CONTRACT_ERROR_CODES.PLATFORM_FEE_EXCEEDS_MAX]: "Platform fee cannot exceed 10%.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_FREEZE]: "Only an admin can freeze the contract.",
  [CONTRACT_ERROR_CODES.INSUFFICIENT_SIGNATURES]: "Not enough admin signatures to unfreeze the contract.",
  [CONTRACT_ERROR_CODES.NOT_AN_ADMIN]: "The provided address is not an admin.",
  [CONTRACT_ERROR_CODES.DUPLICATE_ADMIN_SIGNATURE]: "Duplicate admin signature detected.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_ADD_ADMIN]: "Only an admin can add new admins.",
  [CONTRACT_ERROR_CODES.ALREADY_ADMIN]: "This address is already an admin.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_THRESHOLD]: "Only an admin can update the threshold.",
  [CONTRACT_ERROR_CODES.INVALID_THRESHOLD]: "Threshold must be between 1 and the number of admins.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_REFERRER_CAP]: "Only the admin can set the referrer bonus cap.",
  [CONTRACT_ERROR_CODES.REFERRER_CAP_NEGATIVE]: "Referrer bonus cap cannot be negative.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_TIMEOUT]: "Only the admin can update the timeout.",
  [CONTRACT_ERROR_CODES.TIMEOUT_MUST_BE_POSITIVE]: "Timeout must be a positive value.",

  // 2xxx
  [CONTRACT_ERROR_CODES.AMOUNT_MUST_BE_POSITIVE]: "The escrow amount must be greater than zero.",
  [CONTRACT_ERROR_CODES.INVALID_REFERRER]: "The referrer cannot be the client or freelancer.",
  [CONTRACT_ERROR_CODES.ESCROW_ALREADY_EXISTS]: "An escrow already exists for this job.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_FOUND]: "No escrow was found for this job.",
  [CONTRACT_ERROR_CODES.ONLY_FREELANCER_CAN_START_WORK]: "Only the freelancer can start work on this escrow.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_LOCKED]: "The escrow is not in a locked state.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_RELEASE]: "Only the client can release escrow funds.",
  [CONTRACT_ERROR_CODES.CANNOT_RELEASE_STATUS]: "The escrow cannot be released in its current state.",
  [CONTRACT_ERROR_CODES.DELIVERABLE_HASH_MISMATCH]: "The freelancer's deliverable hash does not match the expected hash.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_REFUND]: "Only the client can request a refund.",
  [CONTRACT_ERROR_CODES.CAN_ONLY_REFUND_LOCKED]: "Refunds are only available before work has started.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_TIMEOUT_REFUND]: "Only the client can request a timeout refund.",
  [CONTRACT_ERROR_CODES.TIMEOUT_NOT_EXPIRED]: "The timeout period has not elapsed yet.",

  // 3xxx
  [CONTRACT_ERROR_CODES.MAX_MILESTONES]: "A maximum of 5 milestones is allowed.",
  [CONTRACT_ERROR_CODES.MILESTONE_PERCENTAGE_POSITIVE]: "Each milestone percentage must be greater than zero.",
  [CONTRACT_ERROR_CODES.MILESTONE_PERCENTAGES_SUM]: "Milestone percentages must add up to 100%.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_RELEASE_MILESTONE]: "Only the client can release a milestone.",
  [CONTRACT_ERROR_CODES.CANNOT_RELEASE_MILESTONE_STATUS]: "Cannot release this milestone in the current escrow state.",
  [CONTRACT_ERROR_CODES.INVALID_MILESTONE_INDEX]: "The milestone index is invalid or out of bounds.",
  [CONTRACT_ERROR_CODES.MILESTONE_ALREADY_COMPLETED]: "This milestone has already been completed.",

  // 4xxx
  [CONTRACT_ERROR_CODES.BUDGET_POSITIVE]: "The budget must be a positive amount.",
  [CONTRACT_ERROR_CODES.BUDGET_COMMITMENT_NOT_FOUND]: "No budget commitment was found for this job.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_REVEAL_BUDGET]: "Only the client can reveal the budget.",
  [CONTRACT_ERROR_CODES.BUDGET_ALREADY_REVEALED]: "The budget has already been revealed.",
  [CONTRACT_ERROR_CODES.BIDDING_CLOSED]: "Bidding is closed for this job.",
  [CONTRACT_ERROR_CODES.BID_COMMITMENT_ALREADY_SUBMITTED]: "A bid commitment has already been submitted.",
  [CONTRACT_ERROR_CODES.BIDDING_NOT_CLOSED]: "Bidding has not been closed yet.",
  [CONTRACT_ERROR_CODES.REVEAL_WINDOW_CLOSED]: "The bid reveal window has closed.",
  [CONTRACT_ERROR_CODES.BID_ALREADY_REVEALED]: "This bid has already been revealed.",
  [CONTRACT_ERROR_CODES.COMMITMENT_VERIFICATION_FAILED]: "Bid commitment verification failed. The amount or nonce may be incorrect.",

  // 5xxx
  [CONTRACT_ERROR_CODES.INVALID_SCORE]: "Score must be between 1 and 5.",
  [CONTRACT_ERROR_CODES.RATINGS_ONLY_AFTER_RELEASE]: "Ratings can only be submitted after the escrow is released.",
  [CONTRACT_ERROR_CODES.RATING_ALREADY_SUBMITTED]: "A client rating has already been submitted for this job.",
  [CONTRACT_ERROR_CODES.FREELANCER_RATING_ALREADY_SUBMITTED]: "A freelancer rating has already been submitted for this job.",
  [CONTRACT_ERROR_CODES.ESCROW_MUST_BE_RELEASED]: "The escrow must be released before minting a certificate.",
  [CONTRACT_ERROR_CODES.CERTIFICATE_ALREADY_MINTED]: "A certificate has already been minted for this job.",

  // 6xxx
  [CONTRACT_ERROR_CODES.DURATION_POSITIVE]: "Duration must be a positive number of ledgers.",
  [CONTRACT_ERROR_CODES.PROPOSAL_NOT_FOUND]: "No proposal was found with this ID.",
  [CONTRACT_ERROR_CODES.PROPOSAL_ALREADY_RESOLVED]: "This proposal has already been resolved.",
  [CONTRACT_ERROR_CODES.VOTING_PERIOD_ENDED]: "The voting period has ended.",
  [CONTRACT_ERROR_CODES.ONLY_COMPLETED_JOBS_CAN_VOTE]: "Only users with completed jobs can vote on proposals.",
  [CONTRACT_ERROR_CODES.ALREADY_VOTED]: "You have already cast a vote on this proposal.",
  [CONTRACT_ERROR_CODES.VOTING_NOT_OVER]: "The voting period is not over yet.",

  // 7xxx
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_DISPUTE]: "Only the client or freelancer can raise a dispute.",
  [CONTRACT_ERROR_CODES.CANNOT_DISPUTE_RESOLVED]: "Cannot dispute an escrow that is already resolved or frozen.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_RESOLVE_DISPUTE]: "Only the admin can resolve a dispute.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_DISPUTED]: "The escrow is not currently in a disputed state.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_DISPUTE_BOND]: "Only the admin can update the dispute bond.",
  [CONTRACT_ERROR_CODES.BOND_AMOUNT_POSITIVE]: "The dispute bond amount must be positive.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_REGISTER_ARBITRATORS]: "Only the admin can register arbitrators.",
  [CONTRACT_ERROR_CODES.NEED_3_ARBITRATORS]: "At least 3 registered arbitrators are required.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_OPEN_ARBITRATION]: "Only the admin can open an arbitration case.",
  [CONTRACT_ERROR_CODES.ARBITRATION_CASE_NOT_FOUND]: "Arbitration case not found.",
  [CONTRACT_ERROR_CODES.ARBITRATION_CASE_NOT_OPEN]: "The arbitration case is not open for voting.",
  [CONTRACT_ERROR_CODES.ONLY_SELECTED_ARBITRATORS]: "Only the selected arbitrators can vote on this case.",
  [CONTRACT_ERROR_CODES.ALL_VOTES_SUBMITTED]: "All votes have already been submitted.",
  [CONTRACT_ERROR_CODES.EXACTLY_3_VOTES_REQUIRED]: "Exactly 3 votes are required to resolve the case.",

  // 8xxx
  [CONTRACT_ERROR_CODES.ONLY_FREELANCER_OR_ORACLE]: "Only the freelancer or oracle can submit a deliverable.",
  [CONTRACT_ERROR_CODES.NO_DELIVERABLE_HASH]: "This escrow was not created with a deliverable hash.",
  [CONTRACT_ERROR_CODES.IPFS_CID_EMPTY]: "The IPFS CID cannot be empty.",

  // 9xxx
  [CONTRACT_ERROR_CODES.MINIMUM_BOOST_5_XLM]: "The minimum boost amount is 5 XLM.",
  [CONTRACT_ERROR_CODES.BOOST_AMOUNT_POSITIVE]: "The boost amount must be positive.",
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_EXTEND]: "Only the client or freelancer can request a timeout extension.",
  [CONTRACT_ERROR_CODES.CANNOT_EXTEND_STATUS]: "Cannot extend the timeout in the current escrow state.",
  [CONTRACT_ERROR_CODES.NEW_TIMEOUT_MUST_BE_LATER]: "The new timeout must be later than the current one.",
  [CONTRACT_ERROR_CODES.EXTENSION_ALREADY_PENDING]: "An extension request is already pending for this job.",
  [CONTRACT_ERROR_CODES.NO_PENDING_EXTENSION]: "No extension request is pending for this job.",
  [CONTRACT_ERROR_CODES.CANNOT_APPROVE_OWN_EXTENSION]: "You cannot approve your own extension request.",
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_APPROVE]: "Only the client or freelancer can approve an extension.",

  // 99xx
  [CONTRACT_ERROR_CODES.ARITHMETIC_OVERFLOW]: "A calculation error occurred. Please try with different values.",
  [CONTRACT_ERROR_CODES.COUNTER_OVERFLOW]: "A system counter overflow occurred.",
  [CONTRACT_ERROR_CODES.TIMEOUT_LEDGER_OVERFLOW]: "The timeout ledger value is too large.",
  [CONTRACT_ERROR_CODES.TIMEOUT_TIMESTAMP_OVERFLOW]: "The timeout timestamp value is too large.",
};

// ─── Spanish messages ─────────────────────────────────────────────────────────

const CONTRACT_ERROR_MESSAGES_ES: Record<ContractErrorCode, string> = {
  [CONTRACT_ERROR_CODES.UNKNOWN]: GENERIC_CONTRACT_ERROR_EN,
  // 1xxx
  [CONTRACT_ERROR_CODES.ALREADY_INITIALIZED]: "El contrato ya ha sido inicializado.",
  [CONTRACT_ERROR_CODES.NOT_INITIALIZED]: "El contrato aún no ha sido inicializado.",
  [CONTRACT_ERROR_CODES.CONTRACT_FROZEN]: "El contrato está congelado. No se permiten operaciones.",
  [CONTRACT_ERROR_CODES.CONTRACT_NOT_FROZEN]: "El contrato no está congelado.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_TREASURY]: "Solo el administrador puede actualizar la dirección del tesoro.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_FEE]: "Solo el administrador puede actualizar la tarifa de la plataforma.",
  [CONTRACT_ERROR_CODES.PLATFORM_FEE_EXCEEDS_MAX]: "La tarifa de la plataforma no puede exceder el 10%.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_FREEZE]: "Solo un administrador puede congelar el contrato.",
  [CONTRACT_ERROR_CODES.INSUFFICIENT_SIGNATURES]: "No hay suficientes firmas de administrador para descongelar el contrato.",
  [CONTRACT_ERROR_CODES.NOT_AN_ADMIN]: "La dirección proporcionada no es un administrador.",
  [CONTRACT_ERROR_CODES.DUPLICATE_ADMIN_SIGNATURE]: "Se detectó una firma de administrador duplicada.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_ADD_ADMIN]: "Solo un administrador puede agregar nuevos administradores.",
  [CONTRACT_ERROR_CODES.ALREADY_ADMIN]: "Esta dirección ya es administrador.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_THRESHOLD]: "Solo un administrador puede actualizar el umbral.",
  [CONTRACT_ERROR_CODES.INVALID_THRESHOLD]: "El umbral debe estar entre 1 y el número de administradores.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_REFERRER_CAP]: "Solo el administrador puede establecer el límite de bonificación por referencia.",
  [CONTRACT_ERROR_CODES.REFERRER_CAP_NEGATIVE]: "El límite de bonificación por referencia no puede ser negativo.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_TIMEOUT]: "Solo el administrador puede actualizar el tiempo de espera.",
  [CONTRACT_ERROR_CODES.TIMEOUT_MUST_BE_POSITIVE]: "El tiempo de espera debe ser un valor positivo.",

  // 2xxx
  [CONTRACT_ERROR_CODES.AMOUNT_MUST_BE_POSITIVE]: "El monto del depósito debe ser mayor que cero.",
  [CONTRACT_ERROR_CODES.INVALID_REFERRER]: "El referente no puede ser el cliente ni el freelancer.",
  [CONTRACT_ERROR_CODES.ESCROW_ALREADY_EXISTS]: "Ya existe un depósito para este trabajo.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_FOUND]: "No se encontró un depósito para este trabajo.",
  [CONTRACT_ERROR_CODES.ONLY_FREELANCER_CAN_START_WORK]: "Solo el freelancer puede comenzar el trabajo en este depósito.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_LOCKED]: "El depósito no está en estado bloqueado.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_RELEASE]: "Solo el cliente puede liberar los fondos del depósito.",
  [CONTRACT_ERROR_CODES.CANNOT_RELEASE_STATUS]: "El depósito no puede liberarse en su estado actual.",
  [CONTRACT_ERROR_CODES.DELIVERABLE_HASH_MISMATCH]: "El hash del entregable del freelancer no coincide con el hash esperado.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_REFUND]: "Solo el cliente puede solicitar un reembolso.",
  [CONTRACT_ERROR_CODES.CAN_ONLY_REFUND_LOCKED]: "Los reembolsos solo están disponibles antes de que comience el trabajo.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_TIMEOUT_REFUND]: "Solo el cliente puede solicitar un reembolso por tiempo de espera.",
  [CONTRACT_ERROR_CODES.TIMEOUT_NOT_EXPIRED]: "El período de tiempo de espera aún no ha transcurrido.",

  // 3xxx
  [CONTRACT_ERROR_CODES.MAX_MILESTONES]: "Se permite un máximo de 5 hitos.",
  [CONTRACT_ERROR_CODES.MILESTONE_PERCENTAGE_POSITIVE]: "Cada porcentaje de hito debe ser mayor que cero.",
  [CONTRACT_ERROR_CODES.MILESTONE_PERCENTAGES_SUM]: "Los porcentajes de los hitos deben sumar 100%.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_RELEASE_MILESTONE]: "Solo el cliente puede liberar un hito.",
  [CONTRACT_ERROR_CODES.CANNOT_RELEASE_MILESTONE_STATUS]: "No se puede liberar este hito en el estado actual del depósito.",
  [CONTRACT_ERROR_CODES.INVALID_MILESTONE_INDEX]: "El índice del hito no es válido o está fuera de rango.",
  [CONTRACT_ERROR_CODES.MILESTONE_ALREADY_COMPLETED]: "Este hito ya ha sido completado.",

  // 4xxx
  [CONTRACT_ERROR_CODES.BUDGET_POSITIVE]: "El presupuesto debe ser un monto positivo.",
  [CONTRACT_ERROR_CODES.BUDGET_COMMITMENT_NOT_FOUND]: "No se encontró un compromiso de presupuesto para este trabajo.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_REVEAL_BUDGET]: "Solo el cliente puede revelar el presupuesto.",
  [CONTRACT_ERROR_CODES.BUDGET_ALREADY_REVEALED]: "El presupuesto ya ha sido revelado.",
  [CONTRACT_ERROR_CODES.BIDDING_CLOSED]: "La licitación está cerrada para este trabajo.",
  [CONTRACT_ERROR_CODES.BID_COMMITMENT_ALREADY_SUBMITTED]: "Ya se ha enviado un compromiso de oferta.",
  [CONTRACT_ERROR_CODES.BIDDING_NOT_CLOSED]: "La licitación aún no se ha cerrado.",
  [CONTRACT_ERROR_CODES.REVEAL_WINDOW_CLOSED]: "La ventana de revelación de ofertas ha cerrado.",
  [CONTRACT_ERROR_CODES.BID_ALREADY_REVEALED]: "Esta oferta ya ha sido revelada.",
  [CONTRACT_ERROR_CODES.COMMITMENT_VERIFICATION_FAILED]: "La verificación del compromiso de oferta falló. El monto o nonce puede ser incorrecto.",

  // 5xxx
  [CONTRACT_ERROR_CODES.INVALID_SCORE]: "La puntuación debe estar entre 1 y 5.",
  [CONTRACT_ERROR_CODES.RATINGS_ONLY_AFTER_RELEASE]: "Las calificaciones solo pueden enviarse después de liberar el depósito.",
  [CONTRACT_ERROR_CODES.RATING_ALREADY_SUBMITTED]: "Ya se ha enviado una calificación de cliente para este trabajo.",
  [CONTRACT_ERROR_CODES.FREELANCER_RATING_ALREADY_SUBMITTED]: "Ya se ha enviado una calificación de freelancer para este trabajo.",
  [CONTRACT_ERROR_CODES.ESCROW_MUST_BE_RELEASED]: "El depósito debe liberarse antes de emitir un certificado.",
  [CONTRACT_ERROR_CODES.CERTIFICATE_ALREADY_MINTED]: "Ya se ha emitido un certificado para este trabajo.",

  // 6xxx
  [CONTRACT_ERROR_CODES.DURATION_POSITIVE]: "La duración debe ser un número positivo de ledgers.",
  [CONTRACT_ERROR_CODES.PROPOSAL_NOT_FOUND]: "No se encontró una propuesta con este ID.",
  [CONTRACT_ERROR_CODES.PROPOSAL_ALREADY_RESOLVED]: "Esta propuesta ya ha sido resuelta.",
  [CONTRACT_ERROR_CODES.VOTING_PERIOD_ENDED]: "El período de votación ha terminado.",
  [CONTRACT_ERROR_CODES.ONLY_COMPLETED_JOBS_CAN_VOTE]: "Solo los usuarios con trabajos completados pueden votar.",
  [CONTRACT_ERROR_CODES.ALREADY_VOTED]: "Ya has votado en esta propuesta.",
  [CONTRACT_ERROR_CODES.VOTING_NOT_OVER]: "El período de votación aún no ha terminado.",

  // 7xxx
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_DISPUTE]: "Solo el cliente o freelancer pueden iniciar una disputa.",
  [CONTRACT_ERROR_CODES.CANNOT_DISPUTE_RESOLVED]: "No se puede disputar un depósito ya resuelto o congelado.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_RESOLVE_DISPUTE]: "Solo el administrador puede resolver una disputa.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_DISPUTED]: "El depósito no está actualmente en estado de disputa.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_DISPUTE_BOND]: "Solo el administrador puede actualizar la fianza de disputa.",
  [CONTRACT_ERROR_CODES.BOND_AMOUNT_POSITIVE]: "El monto de la fianza de disputa debe ser positivo.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_REGISTER_ARBITRATORS]: "Solo el administrador puede registrar árbitros.",
  [CONTRACT_ERROR_CODES.NEED_3_ARBITRATORS]: "Se requieren al menos 3 árbitros registrados.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_OPEN_ARBITRATION]: "Solo el administrador puede abrir un caso de arbitraje.",
  [CONTRACT_ERROR_CODES.ARBITRATION_CASE_NOT_FOUND]: "Caso de arbitraje no encontrado.",
  [CONTRACT_ERROR_CODES.ARBITRATION_CASE_NOT_OPEN]: "El caso de arbitraje no está abierto para votación.",
  [CONTRACT_ERROR_CODES.ONLY_SELECTED_ARBITRATORS]: "Solo los árbitros seleccionados pueden votar en este caso.",
  [CONTRACT_ERROR_CODES.ALL_VOTES_SUBMITTED]: "Ya se han enviado todos los votos.",
  [CONTRACT_ERROR_CODES.EXACTLY_3_VOTES_REQUIRED]: "Se requieren exactamente 3 votos para resolver el caso.",

  // 8xxx
  [CONTRACT_ERROR_CODES.ONLY_FREELANCER_OR_ORACLE]: "Solo el freelancer o el oráculo pueden enviar un entregable.",
  [CONTRACT_ERROR_CODES.NO_DELIVERABLE_HASH]: "Este depósito no fue creado con un hash de entregable.",
  [CONTRACT_ERROR_CODES.IPFS_CID_EMPTY]: "El CID de IPFS no puede estar vacío.",

  // 9xxx
  [CONTRACT_ERROR_CODES.MINIMUM_BOOST_5_XLM]: "El monto mínimo de impulso es 5 XLM.",
  [CONTRACT_ERROR_CODES.BOOST_AMOUNT_POSITIVE]: "El monto de impulso debe ser positivo.",
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_EXTEND]: "Solo el cliente o freelancer pueden solicitar una extensión del tiempo de espera.",
  [CONTRACT_ERROR_CODES.CANNOT_EXTEND_STATUS]: "No se puede extender el tiempo de espera en el estado actual del depósito.",
  [CONTRACT_ERROR_CODES.NEW_TIMEOUT_MUST_BE_LATER]: "El nuevo tiempo de espera debe ser posterior al actual.",
  [CONTRACT_ERROR_CODES.EXTENSION_ALREADY_PENDING]: "Ya hay una solicitud de extensión pendiente para este trabajo.",
  [CONTRACT_ERROR_CODES.NO_PENDING_EXTENSION]: "No hay una solicitud de extensión pendiente para este trabajo.",
  [CONTRACT_ERROR_CODES.CANNOT_APPROVE_OWN_EXTENSION]: "No puedes aprobar tu propia solicitud de extensión.",
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_APPROVE]: "Solo el cliente o freelancer pueden aprobar una extensión.",

  // 99xx
  [CONTRACT_ERROR_CODES.ARITHMETIC_OVERFLOW]: "Ocurrió un error de cálculo. Intenta con valores diferentes.",
  [CONTRACT_ERROR_CODES.COUNTER_OVERFLOW]: "Ocurrió un desbordamiento del contador del sistema.",
  [CONTRACT_ERROR_CODES.TIMEOUT_LEDGER_OVERFLOW]: "El valor del ledger de tiempo de espera es demasiado grande.",
  [CONTRACT_ERROR_CODES.TIMEOUT_TIMESTAMP_OVERFLOW]: "El valor de la marca de tiempo de espera es demasiado grande.",
};

// ─── French messages ──────────────────────────────────────────────────────────

const CONTRACT_ERROR_MESSAGES_FR: Record<ContractErrorCode, string> = {
  [CONTRACT_ERROR_CODES.UNKNOWN]: GENERIC_CONTRACT_ERROR_EN,
  // 1xxx
  [CONTRACT_ERROR_CODES.ALREADY_INITIALIZED]: "Le contrat a déjà été initialisé.",
  [CONTRACT_ERROR_CODES.NOT_INITIALIZED]: "Le contrat n'a pas encore été initialisé.",
  [CONTRACT_ERROR_CODES.CONTRACT_FROZEN]: "Le contrat est gelé. Aucune opération n'est autorisée.",
  [CONTRACT_ERROR_CODES.CONTRACT_NOT_FROZEN]: "Le contrat n'est pas gelé.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_TREASURY]: "Seul l'administrateur peut modifier l'adresse de trésorerie.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_FEE]: "Seul l'administrateur peut modifier les frais de plateforme.",
  [CONTRACT_ERROR_CODES.PLATFORM_FEE_EXCEEDS_MAX]: "Les frais de plateforme ne peuvent pas dépasser 10 %.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_FREEZE]: "Seul un administrateur peut geler le contrat.",
  [CONTRACT_ERROR_CODES.INSUFFICIENT_SIGNATURES]: "Signatures d'administrateur insuffisantes pour dégeler le contrat.",
  [CONTRACT_ERROR_CODES.NOT_AN_ADMIN]: "L'adresse fournie n'est pas un administrateur.",
  [CONTRACT_ERROR_CODES.DUPLICATE_ADMIN_SIGNATURE]: "Signature d'administrateur en double détectée.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_ADD_ADMIN]: "Seul un administrateur peut ajouter de nouveaux administrateurs.",
  [CONTRACT_ERROR_CODES.ALREADY_ADMIN]: "Cette adresse est déjà administrateur.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_THRESHOLD]: "Seul un administrateur peut modifier le seuil.",
  [CONTRACT_ERROR_CODES.INVALID_THRESHOLD]: "Le seuil doit être compris entre 1 et le nombre d'administrateurs.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_REFERRER_CAP]: "Seul l'administrateur peut définir le plafond de bonus de parrainage.",
  [CONTRACT_ERROR_CODES.REFERRER_CAP_NEGATIVE]: "Le plafond de bonus de parrainage ne peut pas être négatif.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_TIMEOUT]: "Seul l'administrateur peut modifier le délai d'expiration.",
  [CONTRACT_ERROR_CODES.TIMEOUT_MUST_BE_POSITIVE]: "Le délai d'expiration doit être une valeur positive.",

  // 2xxx
  [CONTRACT_ERROR_CODES.AMOUNT_MUST_BE_POSITIVE]: "Le montant du séquestre doit être supérieur à zéro.",
  [CONTRACT_ERROR_CODES.INVALID_REFERRER]: "Le parrain ne peut pas être le client ou le freelance.",
  [CONTRACT_ERROR_CODES.ESCROW_ALREADY_EXISTS]: "Un séquestre existe déjà pour cette mission.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_FOUND]: "Aucun séquestre trouvé pour cette mission.",
  [CONTRACT_ERROR_CODES.ONLY_FREELANCER_CAN_START_WORK]: "Seul le freelance peut commencer le travail sur ce séquestre.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_LOCKED]: "Le séquestre n'est pas à l'état verrouillé.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_RELEASE]: "Seul le client peut libérer les fonds du séquestre.",
  [CONTRACT_ERROR_CODES.CANNOT_RELEASE_STATUS]: "Le séquestre ne peut pas être libéré dans son état actuel.",
  [CONTRACT_ERROR_CODES.DELIVERABLE_HASH_MISMATCH]: "Le hachage du livrable du freelance ne correspond pas au hachage attendu.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_REFUND]: "Seul le client peut demander un remboursement.",
  [CONTRACT_ERROR_CODES.CAN_ONLY_REFUND_LOCKED]: "Les remboursements ne sont disponibles qu'avant le début du travail.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_TIMEOUT_REFUND]: "Seul le client peut demander un remboursement pour expiration.",
  [CONTRACT_ERROR_CODES.TIMEOUT_NOT_EXPIRED]: "Le délai d'expiration n'est pas encore écoulé.",

  // 3xxx
  [CONTRACT_ERROR_CODES.MAX_MILESTONES]: "Un maximum de 5 jalons est autorisé.",
  [CONTRACT_ERROR_CODES.MILESTONE_PERCENTAGE_POSITIVE]: "Chaque pourcentage de jalon doit être supérieur à zéro.",
  [CONTRACT_ERROR_CODES.MILESTONE_PERCENTAGES_SUM]: "Les pourcentages des jalons doivent totaliser 100 %.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_RELEASE_MILESTONE]: "Seul le client peut libérer un jalon.",
  [CONTRACT_ERROR_CODES.CANNOT_RELEASE_MILESTONE_STATUS]: "Impossible de libérer ce jalon dans l'état actuel du séquestre.",
  [CONTRACT_ERROR_CODES.INVALID_MILESTONE_INDEX]: "L'index du jalon est invalide ou hors limites.",
  [CONTRACT_ERROR_CODES.MILESTONE_ALREADY_COMPLETED]: "Ce jalon a déjà été complété.",

  // 4xxx
  [CONTRACT_ERROR_CODES.BUDGET_POSITIVE]: "Le budget doit être un montant positif.",
  [CONTRACT_ERROR_CODES.BUDGET_COMMITMENT_NOT_FOUND]: "Aucun engagement budgétaire trouvé pour cette mission.",
  [CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_REVEAL_BUDGET]: "Seul le client peut révéler le budget.",
  [CONTRACT_ERROR_CODES.BUDGET_ALREADY_REVEALED]: "Le budget a déjà été révélé.",
  [CONTRACT_ERROR_CODES.BIDDING_CLOSED]: "Les enchères sont fermées pour cette mission.",
  [CONTRACT_ERROR_CODES.BID_COMMITMENT_ALREADY_SUBMITTED]: "Un engagement d'enchère a déjà été soumis.",
  [CONTRACT_ERROR_CODES.BIDDING_NOT_CLOSED]: "Les enchères n'ont pas encore été fermées.",
  [CONTRACT_ERROR_CODES.REVEAL_WINDOW_CLOSED]: "La fenêtre de révélation des enchères est fermée.",
  [CONTRACT_ERROR_CODES.BID_ALREADY_REVEALED]: "Cette enchère a déjà été révélée.",
  [CONTRACT_ERROR_CODES.COMMITMENT_VERIFICATION_FAILED]: "La vérification de l'engagement d'enchère a échoué. Le montant ou le nonce est peut-être incorrect.",

  // 5xxx
  [CONTRACT_ERROR_CODES.INVALID_SCORE]: "La note doit être comprise entre 1 et 5.",
  [CONTRACT_ERROR_CODES.RATINGS_ONLY_AFTER_RELEASE]: "Les évaluations ne peuvent être soumises qu'après la libération du séquestre.",
  [CONTRACT_ERROR_CODES.RATING_ALREADY_SUBMITTED]: "Une évaluation client a déjà été soumise pour cette mission.",
  [CONTRACT_ERROR_CODES.FREELANCER_RATING_ALREADY_SUBMITTED]: "Une évaluation freelance a déjà été soumise pour cette mission.",
  [CONTRACT_ERROR_CODES.ESCROW_MUST_BE_RELEASED]: "Le séquestre doit être libéré avant d'émettre un certificat.",
  [CONTRACT_ERROR_CODES.CERTIFICATE_ALREADY_MINTED]: "Un certificat a déjà été émis pour cette mission.",

  // 6xxx
  [CONTRACT_ERROR_CODES.DURATION_POSITIVE]: "La durée doit être un nombre positif de registres.",
  [CONTRACT_ERROR_CODES.PROPOSAL_NOT_FOUND]: "Aucune proposition trouvée avec cet ID.",
  [CONTRACT_ERROR_CODES.PROPOSAL_ALREADY_RESOLVED]: "Cette proposition a déjà été résolue.",
  [CONTRACT_ERROR_CODES.VOTING_PERIOD_ENDED]: "La période de vote est terminée.",
  [CONTRACT_ERROR_CODES.ONLY_COMPLETED_JOBS_CAN_VOTE]: "Seuls les utilisateurs ayant des missions terminées peuvent voter.",
  [CONTRACT_ERROR_CODES.ALREADY_VOTED]: "Vous avez déjà voté sur cette proposition.",
  [CONTRACT_ERROR_CODES.VOTING_NOT_OVER]: "La période de vote n'est pas encore terminée.",

  // 7xxx
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_DISPUTE]: "Seuls le client ou le freelance peuvent ouvrir un litige.",
  [CONTRACT_ERROR_CODES.CANNOT_DISPUTE_RESOLVED]: "Impossible de contester un séquestre déjà résolu ou gelé.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_RESOLVE_DISPUTE]: "Seul l'administrateur peut résoudre un litige.",
  [CONTRACT_ERROR_CODES.ESCROW_NOT_DISPUTED]: "Le séquestre n'est pas actuellement en état de litige.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_DISPUTE_BOND]: "Seul l'administrateur peut modifier la caution de litige.",
  [CONTRACT_ERROR_CODES.BOND_AMOUNT_POSITIVE]: "Le montant de la caution de litige doit être positif.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_REGISTER_ARBITRATORS]: "Seul l'administrateur peut enregistrer des arbitres.",
  [CONTRACT_ERROR_CODES.NEED_3_ARBITRATORS]: "Au moins 3 arbitres enregistrés sont requis.",
  [CONTRACT_ERROR_CODES.ONLY_ADMIN_OPEN_ARBITRATION]: "Seul l'administrateur peut ouvrir un dossier d'arbitrage.",
  [CONTRACT_ERROR_CODES.ARBITRATION_CASE_NOT_FOUND]: "Dossier d'arbitrage introuvable.",
  [CONTRACT_ERROR_CODES.ARBITRATION_CASE_NOT_OPEN]: "Le dossier d'arbitrage n'est pas ouvert au vote.",
  [CONTRACT_ERROR_CODES.ONLY_SELECTED_ARBITRATORS]: "Seuls les arbitres sélectionnés peuvent voter sur ce dossier.",
  [CONTRACT_ERROR_CODES.ALL_VOTES_SUBMITTED]: "Tous les votes ont déjà été soumis.",
  [CONTRACT_ERROR_CODES.EXACTLY_3_VOTES_REQUIRED]: "Exactement 3 votes sont requis pour résoudre le dossier.",

  // 8xxx
  [CONTRACT_ERROR_CODES.ONLY_FREELANCER_OR_ORACLE]: "Seul le freelance ou l'oracle peut soumettre un livrable.",
  [CONTRACT_ERROR_CODES.NO_DELIVERABLE_HASH]: "Ce séquestre n'a pas été créé avec un hachage de livrable.",
  [CONTRACT_ERROR_CODES.IPFS_CID_EMPTY]: "Le CID IPFS ne peut pas être vide.",

  // 9xxx
  [CONTRACT_ERROR_CODES.MINIMUM_BOOST_5_XLM]: "Le montant minimum de boost est de 5 XLM.",
  [CONTRACT_ERROR_CODES.BOOST_AMOUNT_POSITIVE]: "Le montant du boost doit être positif.",
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_EXTEND]: "Seuls le client ou le freelance peuvent demander une prolongation du délai.",
  [CONTRACT_ERROR_CODES.CANNOT_EXTEND_STATUS]: "Impossible de prolonger le délai dans l'état actuel du séquestre.",
  [CONTRACT_ERROR_CODES.NEW_TIMEOUT_MUST_BE_LATER]: "Le nouveau délai doit être postérieur au délai actuel.",
  [CONTRACT_ERROR_CODES.EXTENSION_ALREADY_PENDING]: "Une demande de prolongation est déjà en attente pour cette mission.",
  [CONTRACT_ERROR_CODES.NO_PENDING_EXTENSION]: "Aucune demande de prolongation en attente pour cette mission.",
  [CONTRACT_ERROR_CODES.CANNOT_APPROVE_OWN_EXTENSION]: "Vous ne pouvez pas approuver votre propre demande de prolongation.",
  [CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_APPROVE]: "Seuls le client ou le freelance peuvent approuver une prolongation.",

  // 99xx
  [CONTRACT_ERROR_CODES.ARITHMETIC_OVERFLOW]: "Une erreur de calcul s'est produite. Veuillez essayer avec des valeurs différentes.",
  [CONTRACT_ERROR_CODES.COUNTER_OVERFLOW]: "Un débordement du compteur système s'est produit.",
  [CONTRACT_ERROR_CODES.TIMEOUT_LEDGER_OVERFLOW]: "La valeur du registre de délai d'expiration est trop grande.",
  [CONTRACT_ERROR_CODES.TIMEOUT_TIMESTAMP_OVERFLOW]: "La valeur du horodatage de délai d'expiration est trop grande.",
};

// ─── Language-specific message maps ───────────────────────────────────────────

const GENERIC_CONTRACT_ERROR_ES = "El contrato rechazó esta operación. Verifica tus datos e intenta de nuevo.";
const GENERIC_CONTRACT_ERROR_FR = "Le contrat a rejeté cette opération. Veuillez vérifier vos données et réessayer.";

const MESSAGES_BY_LOCALE: Record<string, Record<ContractErrorCode | (typeof CONTRACT_ERROR_CODES.UNKNOWN), string>> = {
  en: CONTRACT_ERROR_MESSAGES_EN,
  es: CONTRACT_ERROR_MESSAGES_ES,
  fr: CONTRACT_ERROR_MESSAGES_FR,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Map a Soroban contract panic string to a numeric error code.
 * Returns the error code, or undefined if the message doesn't match.
 *
 * Handles multiple Soroban error formats:
 * - Raw panic strings: "Escrow not found"
 * - HostError wrapper: "HostError: Error(Contract, #1)"
 * - Diagnostic strings containing panic messages
 */
export function getContractErrorCode(panicMessage: string): ContractErrorCode | undefined {
  let msg = panicMessage.trim();

  // Strip "Error: " prefix
  if (msg.startsWith("Error: ")) {
    msg = msg.slice("Error: ".length).trim();
  }

  // Strip "HostError: " prefix
  if (msg.startsWith("HostError: ")) {
    msg = msg.slice("HostError: ".length).trim();
  }

  // Handle Soroban's "Error(Contract, #N)" format.
  // The #N is a WASM error-table index; the actual panic string may
  // be embedded in diagnostic events. If we only have the code, return
  // a special code that maps to a generic contract error message.
  const sorobanContractMatch = msg.match(/^Error\(Contract,\s*#?(\d+)\)$/);
  if (sorobanContractMatch) {
    // Map to a generic contract error — we know it's a contract error
    // but not which specific one.
    return CONTRACT_ERROR_CODES.UNKNOWN;
  }

  // Also handle "Error(Contract, #N): <message>" format where the message
  // is appended after the Soroban error identifier.
  const sorobanWithMsgMatch = msg.match(/^Error\(Contract,\s*#?\d+\):\s*(.+)$/);
  if (sorobanWithMsgMatch) {
    msg = sorobanWithMsgMatch[1].trim();
  }

  // Map known panic strings to codes
  const PANIC_TO_CODE: Record<string, ContractErrorCode> = {
    // 1xxx
    "Already initialized": CONTRACT_ERROR_CODES.ALREADY_INITIALIZED,
    "Not initialized": CONTRACT_ERROR_CODES.NOT_INITIALIZED,
    "Contract is frozen": CONTRACT_ERROR_CODES.CONTRACT_FROZEN,
    "Contract is not frozen": CONTRACT_ERROR_CODES.CONTRACT_NOT_FROZEN,
    "Only admin can set treasury address": CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_TREASURY,
    "Only admin can set platform fee": CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_FEE,
    "Platform fee cannot exceed 10% (1000 bps)": CONTRACT_ERROR_CODES.PLATFORM_FEE_EXCEEDS_MAX,
    "Only an admin can freeze the contract": CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_FREEZE,
    "Insufficient admin signatures to unfreeze": CONTRACT_ERROR_CODES.INSUFFICIENT_SIGNATURES,
    "One of the provided addresses is not an admin": CONTRACT_ERROR_CODES.NOT_AN_ADMIN,
    "Duplicate admin in unfreeze signatures": CONTRACT_ERROR_CODES.DUPLICATE_ADMIN_SIGNATURE,
    "Only an admin can add new admins": CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_ADD_ADMIN,
    "Address is already an admin": CONTRACT_ERROR_CODES.ALREADY_ADMIN,
    "Only an admin can update the threshold": CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_THRESHOLD,
    "Threshold must be between 1 and the number of admins": CONTRACT_ERROR_CODES.INVALID_THRESHOLD,
    "Only admin can set the referrer bonus cap": CONTRACT_ERROR_CODES.ONLY_ADMIN_SET_REFERRER_CAP,
    "Referrer bonus cap must be non-negative": CONTRACT_ERROR_CODES.REFERRER_CAP_NEGATIVE,
    "Only admin can update the timeout": CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_TIMEOUT,
    "Timeout must be positive": CONTRACT_ERROR_CODES.TIMEOUT_MUST_BE_POSITIVE,
    // 2xxx
    "Amount must be positive": CONTRACT_ERROR_CODES.AMOUNT_MUST_BE_POSITIVE,
    "Referrer cannot be the client or freelancer": CONTRACT_ERROR_CODES.INVALID_REFERRER,
    "Escrow already exists for this job": CONTRACT_ERROR_CODES.ESCROW_ALREADY_EXISTS,
    "Escrow not found": CONTRACT_ERROR_CODES.ESCROW_NOT_FOUND,
    "Only the freelancer can start work": CONTRACT_ERROR_CODES.ONLY_FREELANCER_CAN_START_WORK,
    "Escrow is not in Locked state": CONTRACT_ERROR_CODES.ESCROW_NOT_LOCKED,
    "Only the client can release escrow": CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_RELEASE,
    "Cannot release escrow in current status": CONTRACT_ERROR_CODES.CANNOT_RELEASE_STATUS,
    "Freelancer deliverable hash does not match or not submitted": CONTRACT_ERROR_CODES.DELIVERABLE_HASH_MISMATCH,
    "Only the client can request a refund": CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_REFUND,
    "Can only refund before work has started": CONTRACT_ERROR_CODES.CAN_ONLY_REFUND_LOCKED,
    "Only the client can request a timeout refund": CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_TIMEOUT_REFUND,
    "Timeout period has not expired yet": CONTRACT_ERROR_CODES.TIMEOUT_NOT_EXPIRED,
    // 3xxx
    "Maximum 5 milestones allowed": CONTRACT_ERROR_CODES.MAX_MILESTONES,
    "Milestone percentage must be positive": CONTRACT_ERROR_CODES.MILESTONE_PERCENTAGE_POSITIVE,
    "Milestone percentages must sum to 100": CONTRACT_ERROR_CODES.MILESTONE_PERCENTAGES_SUM,
    "Only the client can release a milestone": CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_RELEASE_MILESTONE,
    "Cannot release milestone in current status": CONTRACT_ERROR_CODES.CANNOT_RELEASE_MILESTONE_STATUS,
    "Milestone index out of bounds": CONTRACT_ERROR_CODES.INVALID_MILESTONE_INDEX,
    "Invalid milestone index": CONTRACT_ERROR_CODES.INVALID_MILESTONE_INDEX,
    "Milestone already completed": CONTRACT_ERROR_CODES.MILESTONE_ALREADY_COMPLETED,
    // 4xxx
    "Budget must be positive": CONTRACT_ERROR_CODES.BUDGET_POSITIVE,
    "Budget commitment not found": CONTRACT_ERROR_CODES.BUDGET_COMMITMENT_NOT_FOUND,
    "Only the client can reveal the budget": CONTRACT_ERROR_CODES.ONLY_CLIENT_CAN_REVEAL_BUDGET,
    "Budget already revealed": CONTRACT_ERROR_CODES.BUDGET_ALREADY_REVEALED,
    "Bidding is closed": CONTRACT_ERROR_CODES.BIDDING_CLOSED,
    "Bid commitment already submitted": CONTRACT_ERROR_CODES.BID_COMMITMENT_ALREADY_SUBMITTED,
    "Bidding not closed": CONTRACT_ERROR_CODES.BIDDING_NOT_CLOSED,
    "Reveal window has closed": CONTRACT_ERROR_CODES.REVEAL_WINDOW_CLOSED,
    "Bid already revealed": CONTRACT_ERROR_CODES.BID_ALREADY_REVEALED,
    "Commitment verification failed": CONTRACT_ERROR_CODES.COMMITMENT_VERIFICATION_FAILED,
    // 5xxx
    "Score must be between 1 and 5": CONTRACT_ERROR_CODES.INVALID_SCORE,
    "Ratings are allowed only after escrow release": CONTRACT_ERROR_CODES.RATINGS_ONLY_AFTER_RELEASE,
    "Client rating already submitted for this job": CONTRACT_ERROR_CODES.RATING_ALREADY_SUBMITTED,
    "Freelancer rating already submitted for this job": CONTRACT_ERROR_CODES.FREELANCER_RATING_ALREADY_SUBMITTED,
    "Escrow must be released to mint certificate": CONTRACT_ERROR_CODES.ESCROW_MUST_BE_RELEASED,
    "Certificate already minted": CONTRACT_ERROR_CODES.CERTIFICATE_ALREADY_MINTED,
    // 6xxx
    "Duration must be positive": CONTRACT_ERROR_CODES.DURATION_POSITIVE,
    "Proposal not found": CONTRACT_ERROR_CODES.PROPOSAL_NOT_FOUND,
    "Proposal already resolved": CONTRACT_ERROR_CODES.PROPOSAL_ALREADY_RESOLVED,
    "Voting period has ended": CONTRACT_ERROR_CODES.VOTING_PERIOD_ENDED,
    "Only users with completed jobs can vote": CONTRACT_ERROR_CODES.ONLY_COMPLETED_JOBS_CAN_VOTE,
    "Voter has already cast a vote": CONTRACT_ERROR_CODES.ALREADY_VOTED,
    "Voting period is not over yet": CONTRACT_ERROR_CODES.VOTING_NOT_OVER,
    // 7xxx
    "Only participants can raise a dispute": CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_DISPUTE,
    "Cannot dispute a resolved, frozen, or already-disputed escrow": CONTRACT_ERROR_CODES.CANNOT_DISPUTE_RESOLVED,
    "Only admin can resolve a dispute": CONTRACT_ERROR_CODES.ONLY_ADMIN_CAN_RESOLVE_DISPUTE,
    "Escrow is not in Disputed state": CONTRACT_ERROR_CODES.ESCROW_NOT_DISPUTED,
    "Only admin can update the dispute bond": CONTRACT_ERROR_CODES.ONLY_ADMIN_UPDATE_DISPUTE_BOND,
    "Bond amount must be positive": CONTRACT_ERROR_CODES.BOND_AMOUNT_POSITIVE,
    "Only admin can register arbitrators": CONTRACT_ERROR_CODES.ONLY_ADMIN_REGISTER_ARBITRATORS,
    "Need at least 3 registered arbitrators": CONTRACT_ERROR_CODES.NEED_3_ARBITRATORS,
    "Only admin can open arbitration": CONTRACT_ERROR_CODES.ONLY_ADMIN_OPEN_ARBITRATION,
    "Arbitration case not found": CONTRACT_ERROR_CODES.ARBITRATION_CASE_NOT_FOUND,
    "Arbitration case is not open": CONTRACT_ERROR_CODES.ARBITRATION_CASE_NOT_OPEN,
    "Only selected arbitrators can vote": CONTRACT_ERROR_CODES.ONLY_SELECTED_ARBITRATORS,
    "All votes already submitted": CONTRACT_ERROR_CODES.ALL_VOTES_SUBMITTED,
    "Exactly 3 votes required": CONTRACT_ERROR_CODES.EXACTLY_3_VOTES_REQUIRED,
    // 8xxx
    "Only freelancer or oracle can submit deliverable": CONTRACT_ERROR_CODES.ONLY_FREELANCER_OR_ORACLE,
    "Escrow has no deliverable hash": CONTRACT_ERROR_CODES.NO_DELIVERABLE_HASH,
    "IPFS CID cannot be empty": CONTRACT_ERROR_CODES.IPFS_CID_EMPTY,
    // 9xxx
    "Minimum boost is 5 XLM": CONTRACT_ERROR_CODES.MINIMUM_BOOST_5_XLM,
    "Boost amount must be positive": CONTRACT_ERROR_CODES.BOOST_AMOUNT_POSITIVE,
    "Only the client or freelancer can request an extension": CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_EXTEND,
    "Cannot extend timeout in current status": CONTRACT_ERROR_CODES.CANNOT_EXTEND_STATUS,
    "New timeout must be later than current timeout": CONTRACT_ERROR_CODES.NEW_TIMEOUT_MUST_BE_LATER,
    "An extension request is already pending for this job": CONTRACT_ERROR_CODES.EXTENSION_ALREADY_PENDING,
    "No pending extension request": CONTRACT_ERROR_CODES.NO_PENDING_EXTENSION,
    "Cannot approve your own extension request": CONTRACT_ERROR_CODES.CANNOT_APPROVE_OWN_EXTENSION,
    "Only the client or freelancer can approve an extension": CONTRACT_ERROR_CODES.ONLY_PARTICIPANTS_CAN_APPROVE,
    // 99xx
    "Arithmetic overflow": CONTRACT_ERROR_CODES.ARITHMETIC_OVERFLOW,
    "Counter overflow": CONTRACT_ERROR_CODES.COUNTER_OVERFLOW,
    "Timeout ledger overflow": CONTRACT_ERROR_CODES.TIMEOUT_LEDGER_OVERFLOW,
    "Timeout timestamp overflow": CONTRACT_ERROR_CODES.TIMEOUT_TIMESTAMP_OVERFLOW,
  };

  return PANIC_TO_CODE[msg];
}

/**
 * Get a human-readable error message for a contract error code in the given locale.
 * Falls back to English if the locale is not supported.
 *
 * @param code  The contract error code (from CONTRACT_ERROR_CODES or getContractErrorCode)
 * @param locale  The desired locale (e.g., "en", "es", "fr")
 * @returns A human-readable error message string.
 */
export function getContractErrorMessage(code: ContractErrorCode, locale = "en"): string {
  const messages = MESSAGES_BY_LOCALE[locale] ?? MESSAGES_BY_LOCALE["en"];
  if (code === CONTRACT_ERROR_CODES.UNKNOWN) {
    if (locale === "es") return GENERIC_CONTRACT_ERROR_ES;
    if (locale === "fr") return GENERIC_CONTRACT_ERROR_FR;
    return GENERIC_CONTRACT_ERROR_EN;
  }
  return messages[code] ?? `Unknown contract error (code: ${code})`;
}

/**
 * Try to extract a contract error from a Soroban error string and return a
 * localized human-readable message. If the error cannot be identified as a
 * known contract error, returns the original error message.
 *
 * @param rawError  The raw error string (e.g., from simResponse.error or an Error.message)
 * @param locale  The desired locale for the translated message (default "en")
 * @returns A human-readable, optionally translated error message.
 */
export function parseContractError(rawError: string, locale = "en"): string {
  // Try to match "Simulation failed: ..." prefix from stellar.ts
  const simFailedMatch = rawError.match(/^(?:Soroban |)simulat(?:ion|e) failed:\s*(.+)/is);
  const inner = simFailedMatch ? simFailedMatch[1] : rawError;

  const code = getContractErrorCode(inner);
  if (code !== undefined) {
    return getContractErrorMessage(code, locale);
  }

  // Also try the full raw error in case the simulation prefix was different
  if (inner !== rawError) {
    const fullCode = getContractErrorCode(rawError);
    if (fullCode !== undefined) {
      return getContractErrorMessage(fullCode, locale);
    }
  }

  // Return the original error if we couldn't map it
  return rawError;
}

export default CONTRACT_ERROR_CODES;
