import { api } from "./client";
import type { TokenInfo, TokenBalance } from "@/utils/types";

export async function getPopularTokens() {
  const { data } = await api.get<{
    success: boolean;
    data: TokenInfo[];
  }>("/api/tokens/popular");

  return data.data;
}

export async function searchTokens(query: string) {
  const { data } = await api.get<{
    success: boolean;
    data: TokenInfo[];
  }>("/api/tokens/search", { params: { q: query } });

  return data.data;
}

export async function getTokenMetadata(contractId: string) {
  const { data } = await api.get<{
    success: boolean;
    data: TokenInfo;
  }>(`/api/tokens/${contractId}/metadata`);

  return data.data;
}

export async function getTokenBalance(contractId: string, publicKey: string) {
  const { data } = await api.get<{
    success: boolean;
    data: TokenBalance;
  }>(`/api/tokens/${contractId}/balance/${publicKey}`);

  return data.data;
}

export async function validateTokenContract(contractId: string) {
  const { data } = await api.post<{
    success: boolean;
    data: {
      valid: boolean;
      error?: string;
    };
  }>("/api/tokens/validate", { contractId });

  return data.data;
}
