/**
 * lib/contractMock.ts
 * Local Soroban contract mock for frontend development.
 * 
 * Enables offline development without a deployed testnet contract.
 * Toggle via NEXT_PUBLIC_USE_CONTRACT_MOCK=true
 */

export type EscrowStatus = "Locked" | "InProgress" | "Released" | "Refunded" | "Disputed";

export interface MockEscrow {
  jobId: string;
  client: string;
  freelancer: string;
  token: string;
  amount: string; // in stroops
  status: EscrowStatus;
  createdAt: number;
}

// In-memory escrow storage
const escrows = new Map<string, MockEscrow>();
let escrowCount = 0;

/**
 * Simulates network delay for realistic behavior
 */
async function delay(ms: number = 800): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a mock transaction hash
 */
function generateMockTxHash(): string {
  const chars = "abcdef0123456789";
  let hash = "";
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

/**
 * Mock: create_escrow
 * Creates an escrow by locking funds in the contract.
 */
export async function mockCreateEscrow(params: {
  jobId: string;
  client: string;
  freelancer: string;
  token: string;
  amount: string; // in stroops
}): Promise<string> {
  console.log("[CONTRACT MOCK] create_escrow called:", params);
  
  await delay(1200); // Simulate signing + submission

  if (escrows.has(params.jobId)) {
    throw new Error(`Mock contract error: Escrow already exists for job ${params.jobId}`);
  }

  if (BigInt(params.amount) <= 0) {
    throw new Error("Mock contract error: Amount must be positive");
  }

  const escrow: MockEscrow = {
    jobId: params.jobId,
    client: params.client,
    freelancer: params.freelancer,
    token: params.token,
    amount: params.amount,
    status: "Locked",
    createdAt: Date.now(),
  };

  escrows.set(params.jobId, escrow);
  escrowCount++;

  const txHash = generateMockTxHash();
  console.log("[CONTRACT MOCK] ✓ Escrow created. Tx hash:", txHash);
  console.log("[CONTRACT MOCK] Escrow state:", escrow);

  return txHash;
}

/**
 * Mock: start_work
 * Client accepts a freelancer and marks work as in-progress.
 */
export async function mockStartWork(params: {
  jobId: string;
  client: string;
}): Promise<string> {
  console.log("[CONTRACT MOCK] start_work called:", params);
  
  await delay(1000);

  const escrow = escrows.get(params.jobId);
  if (!escrow) {
    throw new Error(`Mock contract error: Escrow not found for job ${params.jobId}`);
  }

  if (escrow.client !== params.client) {
    throw new Error("Mock contract error: Only the client can start work");
  }

  if (escrow.status !== "Locked") {
    throw new Error("Mock contract error: Escrow is not in Locked state");
  }

  escrow.status = "InProgress";
  escrows.set(params.jobId, escrow);

  const txHash = generateMockTxHash();
  console.log("[CONTRACT MOCK] ✓ Work started. Tx hash:", txHash);
  console.log("[CONTRACT MOCK] Escrow state:", escrow);

  return txHash;
}

/**
 * Mock: release_escrow
 * Client approves completed work and releases funds to the freelancer.
 */
export async function mockReleaseEscrow(params: {
  jobId: string;
  client: string;
}): Promise<string> {
  console.log("[CONTRACT MOCK] release_escrow called:", params);
  
  await delay(1000);

  const escrow = escrows.get(params.jobId);
  if (!escrow) {
    throw new Error(`Mock contract error: Escrow not found for job ${params.jobId}`);
  }

  if (escrow.client !== params.client) {
    throw new Error("Mock contract error: Only the client can release escrow");
  }

  if (escrow.status !== "InProgress" && escrow.status !== "Locked") {
    throw new Error("Mock contract error: Cannot release escrow in current status");
  }

  escrow.status = "Released";
  escrows.set(params.jobId, escrow);

  const txHash = generateMockTxHash();
  console.log("[CONTRACT MOCK] ✓ Escrow released. Tx hash:", txHash);
  console.log("[CONTRACT MOCK] Funds transferred to:", escrow.freelancer);
  console.log("[CONTRACT MOCK] Escrow state:", escrow);

  return txHash;
}

/**
 * Mock: refund_escrow
 * Client cancels and gets a refund (only before work starts).
 */
export async function mockRefundEscrow(params: {
  jobId: string;
  client: string;
}): Promise<string> {
  console.log("[CONTRACT MOCK] refund_escrow called:", params);
  
  await delay(1000);

  const escrow = escrows.get(params.jobId);
  if (!escrow) {
    throw new Error(`Mock contract error: Escrow not found for job ${params.jobId}`);
  }

  if (escrow.client !== params.client) {
    throw new Error("Mock contract error: Only the client can request a refund");
  }

  if (escrow.status !== "Locked") {
    throw new Error("Mock contract error: Can only refund before work has started");
  }

  escrow.status = "Refunded";
  escrows.set(params.jobId, escrow);

  const txHash = generateMockTxHash();
  console.log("[CONTRACT MOCK] ✓ Escrow refunded. Tx hash:", txHash);
  console.log("[CONTRACT MOCK] Funds returned to:", escrow.client);
  console.log("[CONTRACT MOCK] Escrow state:", escrow);

  return txHash;
}

/**
 * Mock: get_escrow
 * Retrieves the full escrow record for a job.
 */
export async function mockGetEscrow(jobId: string): Promise<MockEscrow> {
  console.log("[CONTRACT MOCK] get_escrow called:", jobId);
  
  await delay(300);

  const escrow = escrows.get(jobId);
  if (!escrow) {
    throw new Error(`Mock contract error: Escrow not found for job ${jobId}`);
  }

  console.log("[CONTRACT MOCK] ✓ Escrow retrieved:", escrow);
  return escrow;
}

/**
 * Mock: get_status
 * Retrieves the escrow status for a job.
 */
export async function mockGetStatus(jobId: string): Promise<EscrowStatus> {
  console.log("[CONTRACT MOCK] get_status called:", jobId);
  
  await delay(300);

  const escrow = escrows.get(jobId);
  if (!escrow) {
    throw new Error(`Mock contract error: Escrow not found for job ${jobId}`);
  }

  console.log("[CONTRACT MOCK] ✓ Status retrieved:", escrow.status);
  return escrow.status;
}

/**
 * Mock: get_escrow_count
 * Returns the total number of escrows created.
 */
export async function mockGetEscrowCount(): Promise<number> {
  console.log("[CONTRACT MOCK] get_escrow_count called");
  
  await delay(300);

  console.log("[CONTRACT MOCK] ✓ Escrow count:", escrowCount);
  return escrowCount;
}

/**
 * Utility: Clear all mock data (useful for testing)
 */
export function clearMockData(): void {
  console.log("[CONTRACT MOCK] Clearing all mock data");
  escrows.clear();
  escrowCount = 0;
}

/**
 * Utility: Get all escrows (for debugging)
 */
export function getAllMockEscrows(): MockEscrow[] {
  return Array.from(escrows.values());
}
