import { api } from "./client";

export async function fundTestnetWallet(publicKey: string) {
  const { data } = await api.post<{
    success: boolean;
    data: {
      success: boolean;
      message: string;
      fundedAmount: string;
      newBalance?: string;
      transactionHash?: string;
      ledger?: number;
    };
  }>("/api/faucet/fund", { publicKey });

  return data.data;
}

export async function checkAccountNeedsFunding(publicKey: string) {
  const { data } = await api.get<{
    success: boolean;
    data: {
      needsFunding: boolean;
      currentBalance: string;
      exists: boolean;
    };
  }>(`/api/faucet/check/${encodeURIComponent(publicKey)}`);

  return data.data;
}

export async function getFaucetStatus() {
  const { data } = await api.get<{
    success: boolean;
    data: {
      enabled: boolean;
      network: string;
      amount: string;
      asset: string;
    };
  }>("/api/faucet/status");

  return data.data;
}
