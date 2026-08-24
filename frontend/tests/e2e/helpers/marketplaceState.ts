import type { Application, Job } from "@/utils/types";

export const CLIENT_ADDRESS =
  "GCLIENTADDRESS1234567890EXAMPLEABCDEFGHIJKLMNOPQRSTUV";
export const FREELANCER_ADDRESS =
  "GFREELANCER1234567890EXAMPLEABCDEFGHIJKLMNOPQRSTUVWX";

export type MarketplaceState = {
  jobs: Job[];
  applications: Application[];
  timeEntries: Array<{
    id: string;
    jobId: string;
    durationMinutes: number;
    description?: string;
    createdAt: string;
  }>;
  ratings: Array<{
    jobId: string;
    raterAddress: string;
    ratedAddress: string;
    stars: number;
  }>;
  balances: Record<string, number>;
};

export function createInitialState(): MarketplaceState {
  return {
    jobs: [],
    applications: [],
    timeEntries: [],
    ratings: [],
    balances: {
      [CLIENT_ADDRESS]: 10_000,
      [FREELANCER_ADDRESS]: 5_000,
    },
  };
}

export function getJob(state: MarketplaceState, jobId: string) {
  return state.jobs.find((job) => job.id === jobId);
}
