/**
 * lib/api/jobTemplates.ts
 * Job Template Library API client (Issue #1556)
 */
import { api } from "./client";

export interface JobTemplate {
  id: string;
  clientId: string;
  name: string;
  title?: string;
  description?: string;
  category?: string;
  budget?: string | number;
  currency?: string;
  skills?: string[] | string;
  milestones?: Array<{ description: string; amount: string | number }>;
  screeningQuestions?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateJobTemplateInput {
  name: string;
  title?: string;
  description?: string;
  category?: string;
  budget?: string | number;
  currency?: string;
  skills?: string[] | string;
  milestones?: Array<{ description: string; amount: string | number }>;
  screeningQuestions?: string[];
  clientId?: string;
}

export async function fetchJobTemplates(clientId?: string): Promise<JobTemplate[]> {
  const params = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  const { data } = await api.get<{ success: boolean; data: JobTemplate[] }>(
    `/api/job-templates${params}`
  );
  return data.data;
}

export async function createJobTemplate(
  payload: CreateJobTemplateInput
): Promise<JobTemplate> {
  const { data } = await api.post<{ success: boolean; data: JobTemplate }>(
    "/api/job-templates",
    payload
  );
  return data.data;
}
