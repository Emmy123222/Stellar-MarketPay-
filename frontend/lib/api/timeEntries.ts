import { api } from "./client";
import type { TimeEntry, TimeInvoice } from "@/utils/types";

export async function logTimeEntry(payload: {
  jobId: string;
  durationMinutes: number;
  description?: string;
  milestoneIndex?: number;
  startedAt?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: TimeEntry }>(
    "/api/time-entries",
    payload,
  );
  return data.data;
}

export async function fetchTimeEntries(jobId: string): Promise<TimeEntry[]> {
  const { data } = await api.get<{ success: boolean; data: TimeEntry[] }>(
    `/api/time-entries/job/${jobId}`,
  );
  return data.data;
}

export async function fetchTimeInvoices(jobId: string): Promise<TimeInvoice[]> {
  const { data } = await api.get<{ success: boolean; data: TimeInvoice[] }>(
    `/api/time-entries/job/${jobId}/invoices`,
  );
  return data.data;
}

export async function generateTimeInvoice(payload: {
  jobId: string;
  hourlyRateXlm: number;
}) {
  const { data } = await api.post<{ success: boolean; data: TimeInvoice }>(
    "/api/time-entries/invoice",
    payload,
  );
  return data.data;
}

export async function reviewTimeInvoice(
  invoiceId: string,
  decision: "approved" | "rejected",
) {
  const { data } = await api.patch<{ success: boolean; data: TimeInvoice }>(
    `/api/time-entries/invoice/${invoiceId}/review`,
    { decision },
  );
  return data.data;
}
