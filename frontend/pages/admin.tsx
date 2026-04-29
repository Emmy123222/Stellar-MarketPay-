/**
 * pages/admin.tsx
 * Admin moderation dashboard — gated to admin wallet addresses only.
 * Non-admin wallets are immediately redirected to /jobs.
 */
import { useEffect, useState, useCallback } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  fetchAdminJobReports,
  fetchAdminDisputes,
  fetchAdminLogs,
  fetchFrozenWallets,
  resolveDispute,
  adminCancelJob,
  freezeWallet,
  unfreezeWallet,
} from "@/lib/api";
import { shortenAddress, timeAgo } from "@/utils/format";

// Wallet addresses with admin access — can also be overridden by env var
const ADMIN_ADDRESSES = (
  process.env.NEXT_PUBLIC_ADMIN_ADDRESSES || ""
).split(",").map((a) => a.trim()).filter(Boolean);

interface AdminPageProps {
  publicKey: string | null;
}

type ActiveTab = "disputes" | "reports" | "wallets" | "logs";

function Badge({ label, color }: { label: string; color: "red" | "amber" | "emerald" | "blue" | "gray" }) {
  const colorMap = {
    red:     "bg-red-500/10 text-red-400 border-red-500/20",
    amber:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    blue:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
    gray:    "bg-white/5 text-amber-800 border-white/10",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colorMap[color]}`}>
      {label}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-display text-xl font-bold text-amber-100">{title}</h2>
        {count !== undefined && (
          <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2.5 py-1 rounded-full font-semibold">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="border border-dashed border-market-500/20 rounded-xl p-8 text-center">
      <p className="text-amber-800 text-sm">{message}</p>
    </div>
  );
}

export default function AdminDashboard({ publicKey }: AdminPageProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>("disputes");
  const [disputes, setDisputes] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [frozenWallets, setFrozenWallets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Per-row modal state
  const [resolveModal, setResolveModal] = useState<{ jobId: string; title: string } | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [releaseTo, setReleaseTo] = useState<"client" | "freelancer">("freelancer");

  const [cancelModal, setCancelModal] = useState<{ jobId: string; title: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [freezeModal, setFreezeModal] = useState<{ address: string } | null>(null);
  const [freezeReason, setFreezeReason] = useState("");

  const isAdmin = Boolean(publicKey && ADMIN_ADDRESSES.includes(publicKey));

  useEffect(() => {
    if (!publicKey) return;
    if (!isAdmin) {
      router.replace("/jobs");
    }
  }, [publicKey, isAdmin, router]);

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [d, r, l, fw] = await Promise.allSettled([
        fetchAdminDisputes(),
        fetchAdminJobReports(),
        fetchAdminLogs(),
        fetchFrozenWallets(),
      ]);
      if (d.status === "fulfilled") setDisputes(d.value);
      if (r.status === "fulfilled") setReports(r.value);
      if (l.status === "fulfilled") setLogs(l.value);
      if (fw.status === "fulfilled") setFrozenWallets(fw.value);
    } catch {
      // Silently handle network errors — show empty state
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function showSuccess(msg: string) {
    setActionMessage(msg);
    setActionError(null);
    setTimeout(() => setActionMessage(null), 4000);
  }

  function showError(msg: string) {
    setActionError(msg);
    setActionMessage(null);
    setTimeout(() => setActionError(null), 5000);
  }

  async function handleResolveDispute() {
    if (!resolveModal || !resolveNote.trim()) return;
    try {
      await resolveDispute(resolveModal.jobId, resolveNote, releaseTo);
      showSuccess(`Dispute resolved — funds released to ${releaseTo}.`);
      setResolveModal(null);
      setResolveNote("");
      await loadData();
    } catch {
      showError("Failed to resolve dispute. Please try again.");
    }
  }

  async function handleCancelJob() {
    if (!cancelModal || !cancelReason.trim()) return;
    try {
      await adminCancelJob(cancelModal.jobId, cancelReason);
      showSuccess("Job cancelled successfully.");
      setCancelModal(null);
      setCancelReason("");
      await loadData();
    } catch {
      showError("Failed to cancel job. Please try again.");
    }
  }

  async function handleFreezeWallet() {
    if (!freezeModal) return;
    try {
      await freezeWallet(freezeModal.address, freezeReason || "Admin action");
      showSuccess(`Wallet ${freezeModal.address} frozen.`);
      setFreezeModal(null);
      setFreezeReason("");
      await loadData();
    } catch {
      showError("Failed to freeze wallet. Please try again.");
    }
  }

  async function handleUnfreezeWallet(address: string) {
    try {
      await unfreezeWallet(address);
      showSuccess(`Wallet ${shortenAddress(address)} unfrozen.`);
      await loadData();
    } catch {
      showError("Failed to unfreeze wallet.");
    }
  }

  // Guard — non-admin or not connected
  if (!publicKey) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-amber-800">Connect your wallet to continue.</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-400">Access denied. Admin wallets only.</p>
      </div>
    );
  }

  const tabs: { id: ActiveTab; label: string; count?: number }[] = [
    { id: "disputes", label: "Open Disputes", count: disputes.length },
    { id: "reports",  label: "Flagged Jobs",  count: reports.length },
    { id: "wallets",  label: "Frozen Wallets", count: frozenWallets.length },
    { id: "logs",     label: "Audit Log",      count: logs.length },
  ];

  return (
    <>
      <Head>
        <title>Admin — Stellar MarketPay</title>
        <meta name="description" content="Platform moderation and admin dashboard." />
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🛡️</span>
            <h1 className="font-display text-3xl font-bold text-amber-100">Admin Dashboard</h1>
            <Badge label="Admin" color="amber" />
          </div>
          <p className="text-amber-800 text-sm mt-1">
            Platform moderation center — flagged jobs, open disputes, and wallet controls.
          </p>
          <p className="text-amber-900 text-xs mt-1 font-mono">
            Logged in as: {publicKey}
          </p>
        </div>

        {/* ── Action feedback ────────────────────────────────────────────────── */}
        {actionMessage && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            ✓ {actionMessage}
          </div>
        )}
        {actionError && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            ✗ {actionError}
          </div>
        )}

        {/* ── Tab Navigation ─────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-8 p-1 bg-ink-800/60 rounded-xl border border-market-500/10 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`admin-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-max flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-market-500/20 text-market-400 border border-market-500/30"
                  : "text-amber-800 hover:text-amber-400"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-20 bg-market-500/5 rounded-xl border border-market-500/10" />
            ))}
          </div>
        ) : (
          <>
            {/* ── Disputes Tab ──────────────────────────────────────────────── */}
            {activeTab === "disputes" && (
              <Section title="Open Disputes" count={disputes.length}>
                {disputes.length === 0 ? (
                  <EmptyState message="No open disputes. All clear!" />
                ) : (
                  <div className="space-y-4">
                    {disputes.map((d) => (
                      <article
                        key={d.job_id}
                        className="card border-red-500/20 bg-red-500/5"
                        aria-label={`Dispute: ${d.job_title}`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <Badge label="Disputed" color="red" />
                              <Badge label={d.job_status} color="amber" />
                            </div>
                            <h3 className="font-display font-semibold text-amber-100 text-lg mb-1">
                              {d.job_title || d.job_id}
                            </h3>
                            <div className="text-sm text-amber-800 space-y-0.5">
                              <p>
                                <span className="text-amber-700">Client:</span>{" "}
                                <span className="font-mono">{shortenAddress(d.client_address)}</span>
                              </p>
                              <p>
                                <span className="text-amber-700">Freelancer:</span>{" "}
                                <span className="font-mono">{d.freelancer_address ? shortenAddress(d.freelancer_address) : "—"}</span>
                              </p>
                              <p>
                                <span className="text-amber-700">Budget:</span> {d.budget} {d.currency}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              id={`resolve-dispute-${d.job_id}`}
                              onClick={() => setResolveModal({ jobId: d.job_id, title: d.job_title || d.job_id })}
                              className="btn-primary text-sm py-2 px-4"
                            >
                              Resolve
                            </button>
                            <button
                              id={`cancel-job-dispute-${d.job_id}`}
                              onClick={() => setCancelModal({ jobId: d.job_id, title: d.job_title || d.job_id })}
                              className="btn-ghost text-sm py-2 px-4 text-red-400/80 hover:text-red-400"
                            >
                              Cancel Job
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* ── Flagged Jobs Tab ───────────────────────────────────────────── */}
            {activeTab === "reports" && (
              <Section title="Flagged / Reported Jobs" count={reports.length}>
                {reports.length === 0 ? (
                  <EmptyState message="No flagged jobs at this time." />
                ) : (
                  <div className="space-y-4">
                    {reports.map((r) => (
                      <article
                        key={r.id}
                        className="card border-amber-500/20"
                        aria-label={`Report: ${r.job_title}`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <Badge label={r.category} color="amber" />
                              <Badge label={r.job_status || "unknown"} color="gray" />
                            </div>
                            <h3 className="font-semibold text-amber-100 mb-1">
                              {r.job_title || r.job_id}
                            </h3>
                            {r.description && (
                              <p className="text-sm text-amber-800 mb-2 line-clamp-2">{r.description}</p>
                            )}
                            <p className="text-xs text-amber-900">
                              Reported by <span className="font-mono">{shortenAddress(r.reporter_address)}</span>{" "}
                              · {timeAgo(r.created_at)}
                            </p>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              id={`admin-cancel-job-${r.job_id}`}
                              onClick={() => setCancelModal({ jobId: r.job_id, title: r.job_title || r.job_id })}
                              className="btn-ghost text-sm py-2 px-4 text-red-400/80 hover:text-red-400"
                            >
                              Cancel Job
                            </button>
                            <button
                              id={`admin-freeze-reporter-${r.job_id}`}
                              onClick={() => setFreezeModal({ address: r.reporter_address })}
                              className="btn-ghost text-sm py-2 px-4 text-amber-700 hover:text-amber-400"
                            >
                              Freeze Reporter
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* ── Frozen Wallets Tab ─────────────────────────────────────────── */}
            {activeTab === "wallets" && (
              <Section title="Frozen Wallets" count={frozenWallets.length}>
                <div className="mb-4">
                  <button
                    id="admin-freeze-new-wallet"
                    onClick={() => setFreezeModal({ address: "" })}
                    className="btn-primary text-sm py-2 px-5"
                  >
                    + Freeze Wallet
                  </button>
                </div>

                {frozenWallets.length === 0 ? (
                  <EmptyState message="No wallets are currently frozen." />
                ) : (
                  <div className="space-y-3">
                    {frozenWallets.map((fw) => (
                      <div
                        key={fw.address}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5"
                      >
                        <div>
                          <p className="font-mono text-amber-100 text-sm break-all">{fw.address}</p>
                          {fw.reason && (
                            <p className="text-xs text-amber-800 mt-1">Reason: {fw.reason}</p>
                          )}
                          {fw.created_at && (
                            <p className="text-xs text-amber-900 mt-0.5">Frozen {timeAgo(fw.created_at)}</p>
                          )}
                        </div>
                        <button
                          id={`unfreeze-${fw.address}`}
                          onClick={() => handleUnfreezeWallet(fw.address)}
                          className="btn-ghost text-sm py-2 px-4 text-emerald-400/80 hover:text-emerald-400 whitespace-nowrap"
                        >
                          Unfreeze
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* ── Audit Log Tab ──────────────────────────────────────────────── */}
            {activeTab === "logs" && (
              <Section title="Admin Action Log" count={logs.length}>
                {logs.length === 0 ? (
                  <EmptyState message="No admin actions recorded yet." />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-market-500/10">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-market-500/10 text-xs text-amber-800 uppercase tracking-wider">
                          <th className="text-left px-4 py-3">Action</th>
                          <th className="text-left px-4 py-3">Admin</th>
                          <th className="text-left px-4 py-3">Target</th>
                          <th className="text-left px-4 py-3">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-market-500/8">
                        {logs.map((log) => (
                          <tr key={log.id} className="hover:bg-market-500/5 transition-colors">
                            <td className="px-4 py-3 text-amber-100 font-mono text-xs">{log.action}</td>
                            <td className="px-4 py-3 text-amber-800 font-mono text-xs">
                              {shortenAddress(log.admin_address)}
                            </td>
                            <td className="px-4 py-3 text-amber-800 font-mono text-xs">
                              {log.target_id ? shortenAddress(log.target_id) : "—"}
                            </td>
                            <td className="px-4 py-3 text-amber-900 text-xs whitespace-nowrap">
                              {timeAgo(log.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            )}
          </>
        )}
      </div>

      {/* ── Resolve Dispute Modal ──────────────────────────────────────────────── */}
      {resolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="card max-w-md w-full border-market-500/30">
            <h3 className="font-display text-lg font-bold text-amber-100 mb-1">Resolve Dispute</h3>
            <p className="text-amber-800 text-sm mb-4">{resolveModal.title}</p>

            <label className="block text-xs text-amber-800 mb-1">Release funds to</label>
            <div className="flex gap-2 mb-4">
              {(["freelancer", "client"] as const).map((side) => (
                <button
                  key={side}
                  id={`release-to-${side}`}
                  onClick={() => setReleaseTo(side)}
                  className={`flex-1 py-2 rounded-lg border text-sm capitalize transition-all ${
                    releaseTo === side
                      ? "border-market-500/50 bg-market-500/15 text-market-400"
                      : "border-market-500/15 text-amber-800 hover:border-market-500/30"
                  }`}
                >
                  {side}
                </button>
              ))}
            </div>

            <label className="block text-xs text-amber-800 mb-1">Resolution note *</label>
            <textarea
              id="resolve-note"
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              className="input-field w-full h-24 resize-none mb-4"
              placeholder="Explain the resolution decision..."
            />

            <div className="flex gap-3">
              <button
                id="confirm-resolve"
                onClick={handleResolveDispute}
                disabled={!resolveNote.trim()}
                className="btn-primary text-sm flex-1 disabled:opacity-50"
              >
                Confirm Resolution
              </button>
              <button
                onClick={() => { setResolveModal(null); setResolveNote(""); }}
                className="btn-ghost text-sm px-4"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Job Modal ───────────────────────────────────────────────────── */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="card max-w-md w-full border-red-500/30">
            <h3 className="font-display text-lg font-bold text-amber-100 mb-1">Cancel Job</h3>
            <p className="text-amber-800 text-sm mb-4">{cancelModal.title}</p>

            <label className="block text-xs text-amber-800 mb-1">Reason *</label>
            <textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="input-field w-full h-20 resize-none mb-4"
              placeholder="Reason for cancellation..."
            />

            <div className="flex gap-3">
              <button
                id="confirm-cancel-job"
                onClick={handleCancelJob}
                disabled={!cancelReason.trim()}
                className="text-sm flex-1 py-2.5 px-4 rounded-xl bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-all disabled:opacity-50"
              >
                Cancel Job
              </button>
              <button
                onClick={() => { setCancelModal(null); setCancelReason(""); }}
                className="btn-ghost text-sm px-4"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Freeze Wallet Modal ────────────────────────────────────────────────── */}
      {freezeModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="card max-w-md w-full border-amber-500/30">
            <h3 className="font-display text-lg font-bold text-amber-100 mb-4">Freeze Wallet</h3>

            <label className="block text-xs text-amber-800 mb-1">Wallet Address *</label>
            <input
              id="freeze-address"
              type="text"
              value={freezeModal.address}
              onChange={(e) => setFreezeModal({ address: e.target.value })}
              className="input-field w-full mb-4 font-mono text-sm"
              placeholder="G..."
            />

            <label className="block text-xs text-amber-800 mb-1">Reason</label>
            <input
              id="freeze-reason"
              type="text"
              value={freezeReason}
              onChange={(e) => setFreezeReason(e.target.value)}
              className="input-field w-full mb-4"
              placeholder="Reason for freezing (optional)"
            />

            <div className="flex gap-3">
              <button
                id="confirm-freeze-wallet"
                onClick={handleFreezeWallet}
                disabled={!freezeModal.address.trim()}
                className="text-sm flex-1 py-2.5 px-4 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all disabled:opacity-50"
              >
                Freeze
              </button>
              <button
                onClick={() => { setFreezeModal(null); setFreezeReason(""); }}
                className="btn-ghost text-sm px-4"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
