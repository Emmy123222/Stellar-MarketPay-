import { api } from "./client";
import { signTransaction } from "@stellar/freighter-api";
import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";

export interface MilestoneProof {
  milestoneIndex: number;
  cid: string;
  gatewayUrl: string;
}

export async function uploadMilestoneProof(
  jobId: string,
  milestoneIndex: number,
  freelancerAddress: string,
  file: File,
): Promise<MilestoneProof> {
  const body = new FormData();
  body.append("proof", file);
  body.append("freelancerAddress", freelancerAddress);
  const { data } = await api.post<{ success: boolean; data: MilestoneProof }>(
    `/api/escrow/${encodeURIComponent(jobId)}/milestones/${milestoneIndex}/proof`,
    body,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data.data;
}

export interface ProofAnchorTransaction {
  xdr: string;
  networkPassphrase: string;
  rpcUrl: string;
}

export async function prepareMilestoneProofAnchor(
  jobId: string,
  milestoneIndex: number,
  freelancerAddress: string,
  cid: string,
): Promise<ProofAnchorTransaction> {
  const { data } = await api.post<{ success: boolean; data: ProofAnchorTransaction }>(
    `/api/escrow/${encodeURIComponent(jobId)}/milestones/${milestoneIndex}/proof/anchor`,
    { cid, freelancerAddress },
  );
  return data.data;
}

export async function anchorMilestoneProof(
  jobId: string,
  milestoneIndex: number,
  freelancerAddress: string,
  cid: string,
): Promise<string> {
  const prepared = await prepareMilestoneProofAnchor(jobId, milestoneIndex, freelancerAddress, cid);
  const signed = await signTransaction(prepared.xdr, {
    networkPassphrase: prepared.networkPassphrase,
  });
  const server = new rpc.Server(prepared.rpcUrl);
  const response = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed, prepared.networkPassphrase),
  );
  if (response.status === "ERROR") throw new Error("Soroban proof anchoring transaction failed");
  return response.hash;
}