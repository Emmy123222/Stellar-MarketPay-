/**
 * utils/format.ts
 * Shared formatting utilities for Stellar MarketPay.
 */

import { formatDistanceToNow, format } from "date-fns";
import type { JobStatus } from "./types";

export function formatXLM(amount: string | number, decimals = 4): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0 XLM";
  return `${num.toLocaleString("en-US", { maximumFractionDigits: decimals })} XLM`;
}

export function timeAgo(dateString: string): string {
  try { return formatDistanceToNow(new Date(dateString), { addSuffix: true }); }
  catch { return dateString; }
}

export function formatDate(dateString: string): string {
  try { return format(new Date(dateString), "MMM d, yyyy"); }
  catch { return dateString; }
}

export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export function statusLabel(status: JobStatus): string {
  return { open: "Open", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled" }[status];
}

export function statusClass(status: JobStatus): string {
  return { open: "badge-open", in_progress: "badge-progress", completed: "badge-complete", cancelled: "badge-cancelled" }[status];
}

export const JOB_CATEGORIES = [
  "Smart Contracts", "Frontend Development", "Backend Development",
  "UI/UX Design", "Technical Writing", "DevOps", "Security Audit",
  "Data Analysis", "Mobile Development", "Other",
];
