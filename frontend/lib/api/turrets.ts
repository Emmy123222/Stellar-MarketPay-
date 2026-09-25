import { api } from "./client";

export async function submitViaTurrets(
  transactionXDR: string,
  useTurret?: boolean,
) {
  const { data } = await api.post<{
    success: boolean;
    data: {
      success: boolean;
      hash: string;
      ledger: number;
      feeCharged: string;
      turretUsed: boolean;
      message: string;
    };
  }>("/api/turrets/submit", { transactionXDR, useTurret });

  return data.data;
}

export async function getTurretsStatus() {
  const { data } = await api.get<{
    success: boolean;
    data: {
      available: boolean;
      url?: string;
      network?: string;
      version?: string;
      feeSponsorship?: boolean;
      message: string;
      error?: string;
    };
  }>("/api/turrets/status");

  return data.data;
}

export async function estimateTurretsFee(transactionXDR: string) {
  const { data } = await api.post<{
    success: boolean;
    data: {
      success: boolean;
      baseFee: string;
      turretFee: string;
      totalFee: string;
      feeSponsored: boolean;
      message?: string;
    };
  }>("/api/turrets/estimate", { transactionXDR });

  return data.data;
}

export async function getTurretsConfig() {
  const { data } = await api.get<{
    success: boolean;
    data: {
      configured: boolean;
      url: string | null;
      hasApiKey: boolean;
      shouldUseByDefault: boolean;
    };
  }>("/api/turrets/config");

  return data.data;
}
