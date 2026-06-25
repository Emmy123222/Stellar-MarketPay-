/**
 * components/PostJobFormtypes.ts
 * Shared types for PostJobForm and its step components
 */

export interface Milestone {
  description: string;
  amount: string;
}

export interface JobFormData {
  title: string;
  description: string;
  budget: string;
  currency: "XLM" | "USDC";
  category: string;
  skills: string;
  deadline: string;
  milestones: Milestone[];
  visibility: "public" | "private" | "invite_only";
  screeningQuestions: string[];
}

export type FormStep = 1 | 2 | 3 | 4;
export type SubmitStep = "idle" | "posting" | "signing" | "complete" | "error";
