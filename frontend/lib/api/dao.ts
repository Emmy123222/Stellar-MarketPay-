import { api } from "./client";

export interface DaoProposal {
  id: string;
  title: string;
  description: string;
  type: "treasury" | "platform" | "parameter" | "arbitration";
  proposer: string;
  amount?: string;
  recipient?: string;
  votesFor: number;
  votesAgainst: number;
  status: "active" | "passed" | "rejected" | "executed";
  createdAt: string;
  votingEndsAt: string;
  quorumPercent?: number;
  quorumReached?: boolean;
}

export interface DaoArbitrator {
  publicKey: string;
  displayName?: string | null;
  bio?: string | null;
  votesReceived: number;
  disputesResolved: number;
  electedAt?: string | null;
}

export async function fetchDaoProposals(status?: string): Promise<DaoProposal[]> {
  const { data } = await api.get<{ success: boolean; data: DaoProposal[] }>(
    "/api/dao/proposals",
    { params: status ? { status } : {} },
  );
  return data.data;
}

export async function createDaoProposal(body: {
  title: string;
  description: string;
  type: DaoProposal["type"];
  amount?: string;
  recipient?: string;
  votingDays?: number;
}): Promise<DaoProposal> {
  const { data } = await api.post<{ success: boolean; data: DaoProposal }>(
    "/api/dao/proposals",
    body,
  );
  return data.data;
}

export async function voteDaoProposal(
  proposalId: string,
  support: boolean,
  weight: number,
  txHash?: string,
): Promise<DaoProposal> {
  const { data } = await api.post<{ success: boolean; data: DaoProposal }>(
    `/api/dao/proposals/${proposalId}/vote`,
    { support, weight, txHash },
  );
  return data.data;
}

export async function fetchDaoTreasury(): Promise<{
  allocatedXlm: string;
  activeProposals: number;
  quorumPercent: number;
}> {
  const { data } = await api.get<{
    success: boolean;
    data: { allocatedXlm: string; activeProposals: number; quorumPercent: number };
  }>("/api/dao/treasury");
  return data.data;
}

export async function fetchDaoArbitrators(): Promise<{
  arbitrators: DaoArbitrator[];
  disputePanel: DaoArbitrator[];
}> {
  const { data } = await api.get<{
    success: boolean;
    data: { arbitrators: DaoArbitrator[]; disputePanel: DaoArbitrator[] };
  }>("/api/dao/arbitrators");
  return data.data;
}

export async function registerDaoArbitrator(body: {
  displayName?: string;
  bio?: string;
}): Promise<DaoArbitrator> {
  const { data } = await api.post<{ success: boolean; data: DaoArbitrator }>(
    "/api/dao/arbitrators",
    body,
  );
  return data.data;
}

export async function voteDaoArbitrator(
  arbitratorKey: string,
  weight: number,
): Promise<DaoArbitrator[]> {
  const { data } = await api.post<{ success: boolean; data: DaoArbitrator[] }>(
    `/api/dao/arbitrators/${arbitratorKey}/vote`,
    { weight },
  );
  return data.data;
}
