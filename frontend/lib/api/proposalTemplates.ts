import { api } from "./client";
import type { ProposalTemplate } from "@/utils/types";

export async function fetchProposalTemplates() {
  const { data } = await api.get<{
    success: boolean;
    data: ProposalTemplate[];
  }>("/api/proposal-templates");
  return data.data;
}

export async function createProposalTemplate(payload: {
  name: string;
  content: string;
}) {
  const { data } = await api.post<{ success: boolean; data: ProposalTemplate }>(
    "/api/proposal-templates",
    payload,
  );
  return data.data;
}

export async function updateProposalTemplate(
  id: string,
  payload: { name?: string; content?: string },
) {
  const { data } = await api.patch<{
    success: boolean;
    data: ProposalTemplate;
  }>(`/api/proposal-templates/${id}`, payload);
  return data.data;
}

export async function deleteProposalTemplate(id: string) {
  await api.delete(`/api/proposal-templates/${id}`);
}
