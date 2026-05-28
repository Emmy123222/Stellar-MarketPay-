/**
 * components/TimeTracker.tsx
 * Issue #346 — Time tracking integration with billing calculation.
 *
 * Features:
 *  - Live timer per job with start / stop
 *  - Manual time entry for offline work
 *  - Accumulated hours → billable XLM amount (hours × rate)
 *  - Submit time entries as an invoice
 *  - Client approve / reject invoice panel
 *  - Export time log as CSV
 */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { TimeEntry, TimeInvoice } from "@/utils/types";
import {
  logTimeEntry,
  fetchTimeEntries,
  fetchTimeInvoices,
  generateTimeInvoice,
  reviewTimeInvoice,
} from "@/lib/api";

// ─── helpers ──────────────────────────────────────────────────────────────────

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function secondsToHHMMSS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => v.toString().padStart(2, "0")).join(":");
}

function xlmAmount(totalMinutes: number, rateXlm: number): string {
  return ((totalMinutes / 60) * rateXlm).toFixed(4);
}

function exportCsv(entries: TimeEntry[], jobId: string) {
  const header = "id,started_at,duration_minutes,description,created_at\n";
  const rows = entries
    .map(
      (e) =>
        `${e.id},${e.startedAt ?? ""},${e.durationMinutes},"${(e.description ?? "").replace(/"/g, '""')}",${e.createdAt}`,
    )
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `time-log-${jobId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── props ────────────────────────────────────────────────────────────────────

interface TimeTrackerProps {
  /** UUID of the job being tracked. */
  jobId: string;
  /** Whether the current user is the client (shows invoice review panel). */
  isClient?: boolean;
  /** Whether the current user is the freelancer (shows timer + submit). */
  isFreelancer?: boolean;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function TimeTracker({
  jobId,
  isClient = false,
  isFreelancer = false,
}: TimeTrackerProps) {
  // ── timer state ──────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── data state ───────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [invoices, setInvoices] = useState<TimeInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── form state ───────────────────────────────────────────────────────────
  const [hourlyRate, setHourlyRate] = useState<number>(0);
  const [timerDesc, setTimerDesc] = useState("");

  // manual entry
  const [showManual, setShowManual] = useState(false);
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualStartedAt, setManualStartedAt] = useState("");
  const [submittingManual, setSubmittingManual] = useState(false);

  // invoice
  const [submittingInvoice, setSubmittingInvoice] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // ── load data ────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const [e, i] = await Promise.all([
        fetchTimeEntries(jobId),
        fetchTimeInvoices(jobId),
      ]);
      setEntries(e);
      setInvoices(i);
    } catch {
      // silently ignore — user may not be authenticated yet
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── timer tick ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  // ── timer controls ───────────────────────────────────────────────────────
  const handleStart = () => {
    startRef.current = Date.now();
    setElapsed(0);
    setRunning(true);
    setError(null);
  };

  const handleStop = async () => {
    if (!startRef.current) return;
    setRunning(false);
    const durationMinutes = Math.max(1, Math.round(elapsed / 60));
    const startedAt = new Date(startRef.current).toISOString();
    startRef.current = null;
    setElapsed(0);

    try {
      await logTimeEntry({
        jobId,
        durationMinutes,
        description: timerDesc.trim() || undefined,
        startedAt,
      });
      setTimerDesc("");
      flash("Time entry saved.");
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save time entry.");
    }
  };

  // ── manual entry ─────────────────────────────────────────────────────────
  const handleManualSubmit = async () => {
    const mins = parseInt(manualMinutes, 10);
    if (!mins || mins <= 0) {
      setError("Duration must be a positive number of minutes.");
      return;
    }
    setSubmittingManual(true);
    setError(null);
    try {
      await logTimeEntry({
        jobId,
        durationMinutes: mins,
        description: manualDesc.trim() || undefined,
        startedAt: manualStartedAt || undefined,
      });
      setManualMinutes("");
      setManualDesc("");
      setManualStartedAt("");
      setShowManual(false);
      flash("Manual entry saved.");
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save manual entry.");
    } finally {
      setSubmittingManual(false);
    }
  };

  // ── invoice ──────────────────────────────────────────────────────────────
  const handleGenerateInvoice = async () => {
    if (!hourlyRate || hourlyRate <= 0) {
      setError("Set a positive hourly rate before generating an invoice.");
      return;
    }
    setSubmittingInvoice(true);
    setError(null);
    try {
      await generateTimeInvoice({ jobId, hourlyRateXlm: hourlyRate });
      flash("Invoice submitted to client.");
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate invoice.");
    } finally {
      setSubmittingInvoice(false);
    }
  };

  const handleReview = async (invoiceId: string, decision: "approved" | "rejected") => {
    setReviewingId(invoiceId);
    setError(null);
    try {
      await reviewTimeInvoice(invoiceId, decision);
      flash(`Invoice ${decision}.`);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update invoice.");
    } finally {
      setReviewingId(null);
    }
  };

  // ── derived totals ───────────────────────────────────────────────────────
  const totalMinutes = entries.reduce((s, e) => s + e.durationMinutes, 0);
  const pendingInvoice = invoices.find((i) => i.status === "pending");
  const hasPendingInvoice = Boolean(pendingInvoice);

  // ── flash helper ─────────────────────────────────────────────────────────
  function flash(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  // ── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="card mt-6 animate-pulse">
        <div className="h-5 bg-market-500/10 rounded w-1/3 mb-3" />
        <div className="h-4 bg-market-500/8 rounded w-2/3" />
      </div>
    );
  }

  return (
    <div className="card mt-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-amber-100">⏱ Time Tracker</h2>
        {entries.length > 0 && (
          <button
            onClick={() => exportCsv(entries, jobId)}
            className="text-xs text-market-400 hover:text-market-300 underline"
          >
            Export CSV
          </button>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {successMsg && (
        <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          {successMsg}
        </p>
      )}

      {/* Freelancer panel */}
      {isFreelancer && (
        <>
          {/* Hourly rate */}
          <div>
            <label className="text-xs text-amber-700 block mb-1">
              Hourly Rate (XLM)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={hourlyRate || ""}
              onChange={(e) => setHourlyRate(parseFloat(e.target.value) || 0)}
              placeholder="e.g. 25"
              className="w-full p-2 rounded-lg bg-ink-800 border border-market-500/20 text-amber-100 text-sm focus:outline-none focus:border-market-500/50"
            />
          </div>

          {/* Live timer */}
          <div className="bg-ink-800 rounded-xl p-4 border border-market-500/15">
            <div className="font-mono text-3xl text-market-400 mb-3 text-center">
              {secondsToHHMMSS(elapsed)}
            </div>

            <input
              type="text"
              value={timerDesc}
              onChange={(e) => setTimerDesc(e.target.value)}
              placeholder="What are you working on? (optional)"
              className="w-full mb-3 p-2 rounded-lg bg-ink-700 border border-market-500/15 text-amber-100 text-sm focus:outline-none focus:border-market-500/40"
            />

            <div className="flex gap-2">
              {!running ? (
                <button
                  onClick={handleStart}
                  className="flex-1 btn-primary py-2 text-sm"
                >
                  ▶ Start
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="flex-1 btn-secondary py-2 text-sm"
                >
                  ■ Stop &amp; Save
                </button>
              )}
            </div>
          </div>

          {/* Manual entry toggle */}
          <div>
            <button
              onClick={() => setShowManual((v) => !v)}
              className="text-xs text-market-400 hover:text-market-300 underline"
            >
              {showManual ? "Hide manual entry" : "+ Add manual entry"}
            </button>

            {showManual && (
              <div className="mt-3 space-y-2 bg-ink-800 rounded-xl p-4 border border-market-500/15">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-amber-700 block mb-1">
                      Duration (minutes)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={manualMinutes}
                      onChange={(e) => setManualMinutes(e.target.value)}
                      placeholder="e.g. 90"
                      className="w-full p-2 rounded-lg bg-ink-700 border border-market-500/15 text-amber-100 text-sm focus:outline-none focus:border-market-500/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-amber-700 block mb-1">
                      Started at (optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={manualStartedAt}
                      onChange={(e) => setManualStartedAt(e.target.value)}
                      className="w-full p-2 rounded-lg bg-ink-700 border border-market-500/15 text-amber-100 text-sm focus:outline-none focus:border-market-500/40"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-amber-700 block mb-1">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={manualDesc}
                    onChange={(e) => setManualDesc(e.target.value)}
                    placeholder="What did you work on?"
                    className="w-full p-2 rounded-lg bg-ink-700 border border-market-500/15 text-amber-100 text-sm focus:outline-none focus:border-market-500/40"
                  />
                </div>
                <button
                  onClick={handleManualSubmit}
                  disabled={submittingManual}
                  className="btn-primary py-2 text-sm w-full"
                >
                  {submittingManual ? "Saving…" : "Save Entry"}
                </button>
              </div>
            )}
          </div>

          {/* Totals */}
          {entries.length > 0 && (
            <div className="bg-ink-800 rounded-xl p-4 border border-market-500/15 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-amber-700">Total tracked</span>
                <span className="text-amber-100 font-mono">
                  {minutesToHHMM(totalMinutes)}
                </span>
              </div>
              {hourlyRate > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-amber-700">Billable amount</span>
                  <span className="text-market-400 font-mono font-semibold">
                    {xlmAmount(totalMinutes, hourlyRate)} XLM
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Submit invoice */}
          {entries.length > 0 && !hasPendingInvoice && (
            <button
              onClick={handleGenerateInvoice}
              disabled={submittingInvoice || hourlyRate <= 0}
              className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
            >
              {submittingInvoice ? "Submitting…" : "Submit Invoice to Client"}
            </button>
          )}

          {hasPendingInvoice && (
            <p className="text-xs text-amber-700 text-center">
              Invoice pending client review.
            </p>
          )}
        </>
      )}

      {/* Client invoice review panel */}
      {isClient && invoices.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-amber-300">Invoices</h3>
          {invoices.map((inv) => (
            <div
              key={inv.id}
              className="bg-ink-800 rounded-xl p-4 border border-market-500/15 space-y-2"
            >
              <div className="flex justify-between text-sm">
                <span className="text-amber-700">Time billed</span>
                <span className="text-amber-100 font-mono">
                  {minutesToHHMM(inv.totalMinutes)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-amber-700">Rate</span>
                <span className="text-amber-100 font-mono">
                  {parseFloat(inv.hourlyRateXlm).toFixed(2)} XLM/hr
                </span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-amber-300">Total</span>
                <span className="text-market-400 font-mono">
                  {parseFloat(inv.totalAmountXlm).toFixed(4)} XLM
                </span>
              </div>

              <div className="flex items-center justify-between pt-1">
                {inv.status === "pending" ? (
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => handleReview(inv.id, "approved")}
                      disabled={reviewingId === inv.id}
                      className="flex-1 btn-primary py-2 text-xs"
                    >
                      {reviewingId === inv.id ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => handleReview(inv.id, "rejected")}
                      disabled={reviewingId === inv.id}
                      className="flex-1 btn-secondary py-2 text-xs"
                    >
                      {reviewingId === inv.id ? "…" : "Reject"}
                    </button>
                  </div>
                ) : (
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                      inv.status === "approved"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-red-500/10 text-red-400 border-red-500/20"
                    }`}
                  >
                    {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Shared time log */}
      {(isFreelancer || isClient) && entries.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
            Time Log
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between text-xs text-amber-700 bg-ink-800/50 rounded-lg px-3 py-2"
              >
                <span className="flex-1 mr-2 truncate">
                  {entry.description ?? <em className="opacity-50">No description</em>}
                </span>
                <span className="font-mono shrink-0 text-amber-500">
                  {minutesToHHMM(entry.durationMinutes)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && !isFreelancer && (
        <p className="text-sm text-amber-800 text-center py-2">
          No time entries yet.
        </p>
      )}
    </div>
  );
}
