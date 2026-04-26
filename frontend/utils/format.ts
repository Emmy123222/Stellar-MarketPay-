/**
 * utils/format.ts
 * Shared formatting utilities for Stellar MarketPay.
 */

import { format, formatDistanceToNow } from "date-fns";
import type { Application, Availability, AvailabilityStatus, Job, JobStatus } from "./types";

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

export function availabilityStatusLabel(status?: Availability["status"] | null): string {
  if (status === "available") return "Available";
  if (status === "busy") return "Busy";
  if (status === "unavailable") return "Unavailable";
  return "Unknown";
}

export function availabilitySummary(availability?: Availability | null): string {
  if (!availability) return "";

  const from = availability.availableFrom ? formatDate(availability.availableFrom) : "";
  const until = availability.availableUntil ? formatDate(availability.availableUntil) : "";

  if (from && until) return `${availabilityStatusLabel(availability.status)} from ${from} to ${until}`;
  if (from) return `${availabilityStatusLabel(availability.status)} from ${from}`;
  if (until) return `${availabilityStatusLabel(availability.status)} until ${until}`;
  return availabilityStatusLabel(availability.status);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export function statusLabel(status: JobStatus): string {
  return { open: "Open", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled", disputed: "Disputed" }[status];
}

export function statusClass(status: JobStatus): string {
  return { open: "badge-open", in_progress: "badge-progress", completed: "badge-complete", cancelled: "badge-cancelled", disputed: "badge-disputed" }[status];
}

export const JOB_CATEGORIES = [
  "Smart Contracts", "Frontend Development", "Backend Development",
  "UI/UX Design", "Technical Writing", "DevOps", "Security Audit",
  "Data Analysis", "Mobile Development", "Other",
];

export const CATEGORY_ICONS: Record<string, string> = {
  "Smart Contracts": "📜",
  "Frontend Development": "🎨",
  "Backend Development": "⚙️",
  "UI/UX Design": "🖌️",
  "Technical Writing": "✍️",
  "DevOps": "🚀",
  "Security Audit": "🔒",
  "Data Analysis": "📊",
  "Mobile Development": "📱",
  "Other": "📦",
};

export function categoryToSlug(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function slugToCategory(slug: string): string | undefined {
  return JOB_CATEGORIES.find(cat => categoryToSlug(cat) === slug);
}

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
 * Returns null if price is unavailable.
 */
export function formatUSDEquivalent(xlmAmount: string | number, xlmPriceUsd: number | null): string | null {
  if (xlmPriceUsd === null) return null;
  const num = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  if (isNaN(num)) return null;
  const usd = (num * xlmPriceUsd).toFixed(2);
  return `≈ $${usd} USD`;
}

/**
 * Calculates a monthly equivalent estimate for a given budget.
 * If no duration is provided, it assumes the budget is for a month of work.
 */
export function getMonthlyEstimate(xlmAmount: string | number, xlmPriceUsd: number | null): string | null {
  if (xlmPriceUsd === null) return null;
  const num = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  if (isNaN(num)) return null;
  const monthlyUsd = (num * xlmPriceUsd).toFixed(2);
  return `$${monthlyUsd}/mo est.`;
}

export interface ProgressData {
  percentage: number;
  daysRemaining: number;
  colorClass: string;
}

/**
 * Calculates job progress for in-progress jobs with a deadline.
 * Returns null if the job is not in progress or has no deadline.
 */
export function calculateJobProgress(job: Job): ProgressData | null {
  if (job.status !== "in_progress" || !job.deadline) return null;

  const start = new Date(job.updatedAt).getTime();
  const end = new Date(job.deadline).getTime();
  const now = Date.now();

  const total = end - start;
  if (total <= 0) {
    return {
      percentage: 100,
      daysRemaining: 0,
      colorClass: "bg-red-500",
    };
  }

  const elapsed = now - start;
  const percentage = Math.min(100, Math.max(0, (elapsed / total) * 100));

  const daysRemaining = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));

  let colorClass = "bg-emerald-500"; // green
  if (percentage > 80) {
    colorClass = "bg-red-500";
  } else if (percentage >= 50) {
    colorClass = "bg-amber-500";
  }

  return { percentage, daysRemaining, colorClass };
}
