/**
 * components/post-job-steps/ReviewStep.tsx
 * Step 4: Review & Publish - summary and submit
 */
import { JobFormData } from "@/components/PostJobFormtypes";

interface Props {
  form: JobFormData;
  isSubmitting: boolean;
  submitStep: "idle" | "posting" | "signing" | "complete" | "error";
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-amber-700 flex-shrink-0 w-24">{label}</span>
      <span className="text-gray-900 dark:text-amber-100 break-words flex-1">{value}</span>
    </div>
  );
}

export default function ReviewStep({ form, isSubmitting, submitStep }: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gray-50 dark:bg-ink-700 border border-gray-200 dark:border-market-500/15 p-4 space-y-3 text-sm">
        <ReviewRow label="Title" value={form.title || "—"} />
        <ReviewRow label="Category" value={form.category} />
        <ReviewRow label="Description" value={form.description.slice(0, 120) + (form.description.length > 120 ? "…" : "")} />
        <ReviewRow label="Budget" value={`${form.budget} ${form.currency}`} />
        <ReviewRow label="Milestones" value={`${form.milestones.length} milestone${form.milestones.length !== 1 ? "s" : ""}`} />
        <ReviewRow label="Skills" value={form.skills || "None specified"} />
        <ReviewRow label="Deadline" value={form.deadline || "No deadline"} />
        <ReviewRow label="Visibility" value={form.visibility.replace("_", " ")} />
        {form.screeningQuestions.filter(Boolean).length > 0 && (
          <ReviewRow label="Screening Qs" value={`${form.screeningQuestions.filter(Boolean).length} question${form.screeningQuestions.filter(Boolean).length !== 1 ? "s" : ""}`} />
        )}
      </div>

      <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-3">
        <p className="text-xs text-amber-700">
          Clicking &quot;Publish Job&quot; will create a backend record and lock{" "}
          <strong className="text-amber-300">{form.budget} {form.currency}</strong> in a Soroban escrow contract. You&apos;ll need to approve this in Freighter.
        </p>
      </div>

      {isSubmitting && (
        <div className="flex items-center gap-3 rounded-xl bg-market-500/8 border border-market-500/20 p-3">
          <span className="inline-block w-4 h-4 border-2 border-market-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-xs text-market-300">
            {submitStep === "posting" ? "Creating job record…" : "Waiting for Freighter signature…"}
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn-primary w-full py-3"
      >
        {isSubmitting ? "Publishing…" : "Publish Job"}
      </button>
    </div>
  );
}
