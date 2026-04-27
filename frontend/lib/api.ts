/**
 * Frontend API client for MarketPay backend endpoints.
 *
 * This module centralizes HTTP calls used by pages and components, including
 * auth challenge verification, jobs, applications, profiles, escrow, and
 * ratings. Responses generally follow a `{ success, data }` envelope where this
 * client returns only `data` for convenience.
 *
 * JWT auth is managed in-memory via `setJwtToken`/`getJwtToken`, and attached
 * to outgoing requests through an Axios request interceptor.
 *
 * @see backend/src/routes/auth.js
 * @see backend/src/routes/jobs.js
 * @see backend/src/routes/applications.js
 * @see backend/src/routes/profiles.js
 * @see backend/src/routes/escrow.js
 * @see backend/src/routes/ratings.js
 */

import axios from "axios";
import type { Availability, Job, Application, UserProfile, Rating } from "@/utils/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
  timeout: 10000,
});

// ─── Auth (SEP-0010) ──────────────────────────────────────────────────────────
let jwtToken: string | null = null;

/**
 * Sets or clears the in-memory JWT token used for authenticated API requests.
 *
 * @param token JWT string to attach as a Bearer token, or `null` to clear auth state.
 * @returns Nothing.
 * @throws {Error} Propagates unexpected runtime errors while mutating module state.
 * @see backend/src/routes/auth.js
 */
export function setJwtToken(token: string | null) { jwtToken = token; }

/**
 * Returns the currently stored in-memory JWT token.
 *
 * @returns The active JWT token string, or `null` when the user is not authenticated.
 * @throws {Error} Propagates unexpected runtime errors while reading module state.
 * @see backend/src/routes/auth.js
 */
export function getJwtToken() { return jwtToken; }

/**
 * Requests a SEP-0010 challenge transaction for a Stellar account.
 *
 * @param publicKey Stellar public key used to generate the challenge transaction.
 * @returns The challenge transaction string returned by the backend.
 * @throws {import("axios").AxiosError} If the challenge request fails or times out.
 * @see backend/src/routes/auth.js
 */
export async function fetchAuthChallenge(publicKey: string) {
  const { data } = await api.get<{ transaction: string }>(`/api/auth?account=${publicKey}`);
  return data.transaction;
}

/**
 * Verifies a signed SEP-0010 challenge transaction and receives a JWT.
 *
 * Request payload shape:
 * - `transaction` (string): signed challenge transaction envelope.
 *
 * @param transaction Signed SEP-0010 challenge transaction submitted for verification.
 * @returns A JWT token string that can be stored via `setJwtToken`.
 * @throws {import("axios").AxiosError} If verification fails, returns 4xx/5xx, or times out.
 * @see backend/src/routes/auth.js
 */
export async function verifyAuthChallenge(transaction: string) {
  const { data } = await api.post<{ success: boolean; token: string }>("/api/auth", { transaction });
  return data.token;
}

api.interceptors.request.use((config: any) => {
  if (jwtToken) {
    config.headers.Authorization = `Bearer ${jwtToken}`;
  }
  return config;
});


// ─── Jobs ─────────────────────────────────────────────────────────────────────

export async function fetchJobs(params?: { category?: string; status?: string; limit?: number; search?: string; cursor?: string; timezone?: string }) {
  const { data } = await api.get<{ success: boolean; data: Job[]; nextCursor: string | null }>("/api/jobs", { params });
  return {
    jobs: data.data,
    nextCursor: data.nextCursor ?? null,
  };
}

/**
 * Fetches the most recently completed jobs for social proof on the home page.
 *
 * @param limit Number of completed jobs to fetch (default 3).
 * @returns Array of completed jobs, newest first.
 */
export async function fetchRecentlyCompletedJobs(limit = 3): Promise<Job[]> {
  const { jobs } = await fetchJobs({ status: "completed", limit });
  return jobs;
}

/**
 * Fetches a single job by its identifier.
 *
 * @param id Job identifier.
 * @returns The matching job record.
 * @throws {import("axios").AxiosError} If the job is not found or the request fails.
 * @see backend/src/routes/jobs.js
 */
export async function fetchJob(id: string) {
  const { data } = await api.get<{ success: boolean; data: Job }>(`/api/jobs/${id}`);
  return data.data;
}

/**
 * Creates a new job posting.
 *
 * Request payload shape:
 * - `title` (string): job title.
 * - `description` (string): job details and scope.
 * - `budget` (string): proposed budget amount.
 * - `category` (string): backend-recognized category.
 * - `skills` (string[]): required skills.
 * - `deadline` (string, optional): deadline value accepted by backend.
 * - `clientAddress` (string): posting client's Stellar public key.
 *
 * @param payload Job creation payload.
 * @param payload.title Human-readable job title.
 * @param payload.description Detailed description of the work.
 * @param payload.budget Budget amount as a string.
 * @param payload.category Job category key.
 * @param payload.skills Required skill tags.
 * @param payload.deadline Optional job deadline.
 * @param payload.clientAddress Client Stellar public key.
 * @returns The created job.
 * @throws {import("axios").AxiosError} If validation fails or the request cannot be completed.
 * @example
 * ```ts
 * const created = await createJob({
 *   title: "Stellar Wallet Integration",
 *   description: "Integrate wallet auth and SEP-0010 flow into an existing app.",
 *   budget: "500",
 *   category: "development",
 *   skills: ["stellar", "typescript", "nextjs"],
 *   deadline: "2026-04-15",
 *   clientAddress: "GCFX...CLIENT",
 * });
 * ```
 * @see backend/src/routes/jobs.js
 */
export async function createJob(payload: {
  title: string; description: string; budget: string;
  category: string; skills: string[]; deadline?: string;
  timezone?: string;
  clientAddress: string;
  screeningQuestions?: string[];
}) {
  const { data } = await api.post<{ success: boolean; data: Job }>("/api/jobs", payload);
  return data.data;
}

/**
 * Fetches jobs created by a specific client wallet address.
 *
 * @param publicKey Client Stellar public key.
 * @returns A list of jobs posted by the client.
 * @throws {import("axios").AxiosError} If the request fails or times out.
 * @see backend/src/routes/jobs.js
 */
export async function fetchMyJobs(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Job[] }>(`/api/jobs/client/${publicKey}`);
  return data.data;
}

/**
 * Evaluates application quality using AI (Claude API).
 * 
 * @param jobId Job identifier.
 * @returns Array of scores and reasonings for all applications.
 */
export async function scoreProposals(jobId: string) {
  const { data } = await api.post<{ success: boolean; data: { id: string; score: number; reasoning: string }[] }>(
    `/api/jobs/${jobId}/score-proposals`
  );
  return data.data;
}

// ─── Applications ─────────────────────────────────────────────────────────────

/**
 * Fetches all applications submitted for a given job.
 *
 * @param jobId Job identifier.
 * @returns Applications submitted against the specified job.
 * @throws {import("axios").AxiosError} If the request fails or times out.
 * @see backend/src/routes/applications.js
 */
export async function fetchApplications(jobId: string) {
  const { data } = await api.get<{ success: boolean; data: Application[] }>(`/api/applications/job/${jobId}`);
  return data.data;
}

/**
 * Submits a freelancer application for a job.
 *
 * Request payload shape:
 * - `jobId` (string): target job identifier.
 * - `freelancerAddress` (string): applicant Stellar public key.
 * - `proposal` (string): proposal message.
 * - `bidAmount` (string): quoted bid amount.
 *
 * @param payload Application submission payload.
 * @param payload.jobId Target job identifier.
 * @param payload.freelancerAddress Freelancer Stellar public key.
 * @param payload.proposal Proposal text submitted by freelancer.
 * @param payload.bidAmount Bid amount as a string.
 * @returns The created application record.
 * @throws {import("axios").AxiosError} If submission fails validation, authorization, or network checks.
 * @example
 * ```ts
 * const application = await submitApplication({
 *   jobId: "job_123",
 *   freelancerAddress: "GDQY...FREELANCER",
 *   proposal: "I can deliver this integration in 5 days with tests and docs.",
 *   bidAmount: "450",
 * });
 * ```
 * @see backend/src/routes/applications.js
 */
export async function submitApplication(payload: {
  jobId: string; freelancerAddress: string; proposal: string; bidAmount: string; currency: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Application }>("/api/applications", payload);
  return data.data;
}

/**
 * Accepts an application on behalf of a client.
 *
 * Request payload shape:
 * - `clientAddress` (string): client Stellar public key.
 *
 * @param applicationId Application identifier.
 * @param clientAddress Client Stellar public key authorizing the accept action.
 * @returns Backend acceptance result payload.
 * @throws {import("axios").AxiosError} If authorization fails or the request cannot be processed.
 * @see backend/src/routes/applications.js
 */
export async function acceptApplication(applicationId: string, clientAddress: string) {
  const { data } = await api.post(`/api/applications/${applicationId}/accept`, { clientAddress });
  return data.data;
}

/**
 * Fetches applications submitted by a freelancer wallet address.
 *
 * @param publicKey Freelancer Stellar public key.
 * @returns A list of applications created by the freelancer.
 * @throws {import("axios").AxiosError} If the request fails or times out.
 * @see backend/src/routes/applications.js
 */
export async function fetchMyApplications(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Application[] }>(`/api/applications/freelancer/${publicKey}`);
  return data.data;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

/**
 * Fetches a user's profile by Stellar public key.
 *
 * @param publicKey User Stellar public key.
 * @returns The user's profile data.
 * @throws {import("axios").AxiosError} If the profile request fails or times out.
 * @see backend/src/routes/profiles.js
 */
export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: UserProfile }>(`/api/profiles/${publicKey}`);
  return data.data;
}

/**
 * Fetches a public profile for display on shared profile pages.
 * Returns `null` when the backend responds with 404 (no profile yet).
 */
export async function fetchPublicProfile(publicKey: string): Promise<UserProfile | null> {
  try {
    const { data } = await api.get<{ success: boolean; data: UserProfile }>(
      `/api/profiles/${encodeURIComponent(publicKey)}`
    );
    return data.data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}

/**
 * Creates or updates a user profile.
 *
 * Request payload shape:
 * - `publicKey` (string): required profile owner key.
 * - Any optional `UserProfile` fields accepted by backend update logic.
 *
 * @param payload Profile upsert payload (`publicKey` plus optional profile fields).
 * @param payload.publicKey User Stellar public key.
 * @returns The saved user profile.
 * @throws {import("axios").AxiosError} If validation fails or the request fails.
 * @see backend/src/routes/profiles.js
 */
export async function upsertProfile(payload: Partial<UserProfile> & { publicKey: string }) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>("/api/profiles", payload);
  return data.data;
}

/**
 * Updates a user's availability window and status.
 *
 * @param publicKey User Stellar public key.
 * @param payload Availability payload accepted by the backend.
 * @returns The saved profile.
 */
export async function updateProfileAvailability(
  publicKey: string,
  payload: Availability
) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/availability`,
    payload
  );
  return data.data;
}

/**
 * Verifies a user's identity via a DID provider and stores the resulting credential hash.
 * 
 * @param publicKey User Stellar public key.
 * @param didHash The credential hash/DID URI returned by the provider.
 * @returns The updated profile.
 */
export async function verifyIdentity(publicKey: string, didHash: string) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/verify`,
    { didHash }
  );
  return data.data;
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

/**
 * Releases escrow for a completed job.
 *
 * Request payload shape:
 * - `clientAddress` (string): client Stellar public key authorizing release.
 *
 * @param jobId Job identifier whose escrow should be released.
 * @param clientAddress Client Stellar public key.
 * @returns Backend escrow release result payload.
 * @throws {import("axios").AxiosError} If release validation fails or the request errors.
 * @see backend/src/routes/escrow.js
 */
export async function releaseEscrow(
  jobId: string,
  clientAddress: string,
  contractTxHash?: string
) {
  const { data } = await api.post(`/api/escrow/${jobId}/release`, {
    clientAddress,
    ...(contractTxHash ? { contractTxHash } : {}),
  });
  return data.data;
}

/**
 * Stores the on-chain escrow contract ID against a job record.
 *
 * @param jobId Job identifier.
 * @param escrowContractId Soroban transaction hash returned after create_escrow().
 * @returns The updated job record.
 */
export async function updateJobEscrowId(jobId: string, escrowContractId: string) {
  const { data } = await api.patch<{ success: boolean; data: Job }>(`/api/jobs/${jobId}/escrow`, { escrowContractId });
  return data.data;
}

/**
 * Deletes a job by ID. Used to roll back an orphaned job when escrow fails.
 *
 * @param jobId Job identifier to delete.
 */
export async function deleteJob(jobId: string) {
  await api.delete(`/api/jobs/${jobId}`);
}

// ─── Ratings ──────────────────────────────────────────────────────────────────

/**
 * Submits a rating for a completed job participant.
 *
 * Request payload shape:
 * - `jobId` (string): completed job identifier.
 * - `ratedAddress` (string): recipient Stellar public key.
 * - `stars` (number): rating value.
 * - `review` (string, optional): text review.
 *
 * @param payload Rating submission payload.
 * @param payload.jobId Job identifier.
 * @param payload.ratedAddress Rated user's Stellar public key.
 * @param payload.stars Star rating value.
 * @param payload.review Optional written review.
 * @returns The created rating record.
 * @throws {import("axios").AxiosError} If authorization or validation fails.
 * @see backend/src/routes/ratings.js
 */
export async function submitRating(payload: {
  jobId: string;
  ratedAddress: string;
  stars: number;
  review?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Rating }>("/api/ratings", payload);
  return data.data;
}

/**
 * Fetches ratings associated with a wallet address.
 *
 * @param publicKey Stellar public key to fetch ratings for.
 * @returns A list of ratings tied to the provided address.
 * @throws {import("axios").AxiosError} If the ratings request fails or times out.
 * @see backend/src/routes/ratings.js
 */
export async function fetchRatings(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Rating[] }>(`/api/ratings/${publicKey}`);
  return data.data;
}
