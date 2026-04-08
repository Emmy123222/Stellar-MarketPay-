/**
 * utils/format.ts
 * Shared formatting utilities for Stellar MarketPay.
 */

import { format, formatDistanceToNow } from "date-fns";
import type { Application, Job, JobStatus } from "./types";

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(filename: string, rows: string[][]): void {
  const lines = rows.map((row) => row.map((cell) => escapeCsvCell(String(cell))).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Client-side CSV download for dashboard "Jobs Posted" export. */
export function exportJobsToCSV(jobs: Job[]): void {
  const header = [
    "id",
    "title",
    "status",
    "category",
    "budget",
    "skills",
    "applicantCount",
    "createdAt",
  ];
  const rows: string[][] = [header];
  for (const j of jobs) {
    rows.push([
      j.id,
      j.title,
      j.status,
      j.category,
      j.budget,
      j.skills.join("; "),
      String(j.applicantCount),
      j.createdAt,
    ]);
  }
  downloadCsv(`marketpay-jobs-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

/** Client-side CSV download for dashboard applications export. */
export function exportApplicationsToCSV(applications: Application[]): void {
  const header = ["id", "jobId", "status", "bidAmount", "proposal", "createdAt"];
  const rows: string[][] = [header];
  for (const a of applications) {
    rows.push([a.id, a.jobId, a.status, a.bidAmount, a.proposal, a.createdAt]);
  }
  downloadCsv(`marketpay-applications-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

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

export function formatDeadline(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";

  try { return format(date, "MMM d, yyyy"); }
  catch { return ""; }
}

export type DeadlineState = "none" | "closing_soon" | "closed";

export function getDeadlineState(dateString?: string | null, now = Date.now()): DeadlineState {
  if (!dateString) return "none";

  const deadline = new Date(dateString);
  const deadlineTime = deadline.getTime();
  if (Number.isNaN(deadlineTime)) return "none";

  if (deadlineTime <= now) return "closed";
  if (deadlineTime - now <= 72 * 60 * 60 * 1000) return "closing_soon";

  return "none";
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

/**
 * Common Web3 and development skill suggestions for autocomplete.
 */
export const SKILL_SUGGESTIONS = [
  // Blockchain & Smart Contracts
  "Rust", "Soroban", "Stellar SDK", "Solidity", "Ethereum", "Smart Contracts",
  "Web3.js", "Ethers.js", "Hardhat", "Foundry", "Anchor", "Solana",
  "DeFi", "NFT", "Token Development", "Cryptography",
  // Frontend
  "React", "Next.js", "TypeScript", "JavaScript", "Vue.js", "Angular",
  "Tailwind CSS", "CSS", "HTML", "Redux", "Zustand", "React Query",
  // Backend
  "Node.js", "Express", "Python", "Go", "Rust", "PostgreSQL", "MongoDB",
  "GraphQL", "REST API", "Docker", "Kubernetes", "Redis", "AWS", "GCP",
  // Design
  "Figma", "UI Design", "UX Design", "Prototyping", "Wireframing",
  // DevOps & Security
  "CI/CD", "Linux", "Security Audit", "Penetration Testing", "DevOps",
  // Mobile
  "React Native", "Flutter", "iOS", "Android",
  // Other
  "Technical Writing", "Documentation", "Agile", "Scrum", "Git",
];

/**
 * Converts an XLM amount to a USD equivalent string.
 * Returns null if price is unavailable so callers can fail silently.
 */
export function formatUSDEquivalent(xlmAmount: string | number, xlmPriceUsd: number | null): string | null {
  if (xlmPriceUsd === null) return null;
  const num = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  if (isNaN(num)) return null;
  const usd = (num * xlmPriceUsd).toFixed(2);
  return `≈ $${usd} USD`;
}
