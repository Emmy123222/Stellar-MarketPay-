/**
 * lib/api/sponsorship.ts
 * Gas fee sponsorship API client for verified freelancers (Issue #1554)
 */
import { api } from "./client";

export interface SponsorshipAccountResponse {
  sponsoringAccount: string;
  publicKey: string;
}

export interface SponsorshipEligibilityResponse {
  freelancerId: string;
  eligible: boolean;
  reason?: string;
  missing?: string;
  creditsRemaining?: number;
  totalSponsored?: number;
  sponsorAccount: string;
}

export interface SponsorshipRequestResponse {
  success: boolean;
  sponsoredEnvelope: string;
  envelopeXdr: string;
  creditsRemaining: number;
  totalSponsored: number;
  sponsorAccount: string;
}

export async function fetchSponsoringAccount(): Promise<SponsorshipAccountResponse> {
  const { data } = await api.get<{ success: boolean; data: SponsorshipAccountResponse }>(
    "/api/sponsorship/account"
  );
  return data.data;
}

export async function checkSponsorshipEligibility(
  freelancerId: string
): Promise<SponsorshipEligibilityResponse> {
  const { data } = await api.get<{ success: boolean; data: SponsorshipEligibilityResponse }>(
    `/api/sponsorship/status?freelancerId=${encodeURIComponent(freelancerId)}`
  );
  return data.data;
}

export async function requestTransactionSponsorship(
  xdr: string,
  freelancerId?: string
): Promise<SponsorshipRequestResponse> {
  const { data } = await api.post<SponsorshipRequestResponse>(
    "/api/sponsorship/request",
    {
      xdr,
      freelancerId,
    }
  );
  return data;
}
