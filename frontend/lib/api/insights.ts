import { api } from "./client";

export interface InsightCategory {
  category: string;
  totalJobs: number;
  avgBudget: number;
  avgApplicationsPerJob: number;
  acceptanceRate: number;
  lowCompetitionJobs: number;
  uniqueClients: number;
}

export interface InsightClientMix {
  newClients: number;
  returningClients: number;
  totalClients: number;
}

export interface InsightSkill {
  skill: string;
  demandCount: number;
  avgApplicationsPerJob: number;
  lowCompetitionJobs: number;
}

export interface InsightCompetitiveJob {
  id: string;
  title: string;
  category: string;
  budget: number;
  currency: string;
  clientAddress: string;
  createdAt: string;
  applicationCount: number;
  competitionLevel: "uncontested" | "light" | "active";
}

export interface InsightPayTrend {
  date: string;
  category: string;
  avgBudget: number;
  jobCount: number;
}

export async function fetchInsightCategories(limit = 20) {
  const { data } = await api.get<{
    success: boolean;
    data: {
      categories: InsightCategory[];
      clientMix: InsightClientMix;
    };
  }>("/api/insights/categories", { params: { limit } });
  return data.data;
}

export async function fetchInsightSkills(limit = 20) {
  const { data } = await api.get<{ success: boolean; data: InsightSkill[] }>(
    "/api/insights/skills",
    { params: { limit } },
  );
  return data.data;
}

export async function fetchInsightCompetitive(limit = 20) {
  const { data } = await api.get<{ success: boolean; data: InsightCompetitiveJob[] }>(
    "/api/insights/competitive",
    { params: { limit } },
  );
  return data.data;
}

export async function fetchInsightPayTrends(days = 30) {
  const { data } = await api.get<{ success: boolean; data: InsightPayTrend[] }>(
    "/api/insights/trends/pay",
    { params: { days } },
  );
  return data.data;
}
