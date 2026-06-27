import type { ClientSpendingAnalytics } from "@/utils/types";

export const SPENDING_STATUS_ORDER: Array<keyof ClientSpendingAnalytics["jobsBreakdown"]> = [
  "completed",
  "inProgress",
  "cancelled",
];

export const SPENDING_STATUS_LABELS: Record<keyof ClientSpendingAnalytics["jobsBreakdown"], string> = {
  posted: "Posted",
  completed: "Completed",
  inProgress: "In Progress",
  cancelled: "Cancelled",
};
