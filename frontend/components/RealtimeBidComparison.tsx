/**
 * components/RealtimeBidComparison.tsx
 * Real-time bid comparison — wired to WebSocket via useRealtimeBids.
 *
 * Events handled:
 *   application:new        → card appended + highlighted
 *   application:withdrawn  → card fades out then removed
 *   application:accepted   → optimistic status badge update
 *   applications:bulk_update → bulk update status for applications
 * Fallback: polls every 30 s while WebSocket is disconnected.
 * Toast: "X new proposals" with scroll-to-new button shown when tab is hidden.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { formatXLM, shortenAddress, timeAgo } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { useRealtimeBids } from "@/hooks/useRealtimeBids";
import { bulkUpdateApplications } from "@/lib/api/applications";
import type { Application, FreelancerTier } from "@/utils/types";

interface RealtimeBidComparisonProps {
  jobId: string;
  initialApplications: Application[];
  isClient: boolean;
  clientAddress?: string;
  biddingPhase?: "commitment" | "reveal";
  onAcceptApplication?: (applicationId: string) => void;
  onCloseBidding?: () => void;
  /** Fetches the latest application list — used for 30 s fallback polling */
  fetchApplications?: () => Promise<Application[]>;
}

function badgeClass(status: string) {
  if (status === "accepted") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (status === "rejected") return "bg-red-500/10 text-red-400 border-red-500/20";
  if (status === "shortlisted")
    return "bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold shadow-sm shadow-amber-500/10";
  return "bg-market-500/10 text-market-400 border-market-500/20";
}

const tierOptions: FreelancerTier[] = ["Rising Talent", "Top Rated", "Expert"];

export default function RealtimeBidComparison({
  jobId,
  initialApplications,
  isClient,
  clientAddress,
  biddingPhase = "commitment",
  onAcceptApplication,
  onCloseBidding,
  fetchApplications,
}: RealtimeBidComparisonProps) {
  const toast = useToast();
  const listTopRef = useRef<HTMLDivElement | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const {
    applications,
    highlightedIds,
    fadingIds,
    wsStatus,
    newProposalsCount,
    resetNewProposalsCount,
    optimisticAccept,
    optimisticBulkUpdate,
    newestCardRef,
  } = useRealtimeBids({
    jobId,
    initialApplications,
    fetchApplications: fetchApplications ?? (() => Promise.resolve(initialApplications)),
    onNewBid: () => {
      toast.success("New bid received");
    },
  });

  // Show toast when new proposals arrive while the tab was hidden
  const prevCount = useRef(0);
  if (newProposalsCount > prevCount.current) {
    prevCount.current = newProposalsCount;
    toast.info(`${newProposalsCount} new proposal${newProposalsCount > 1 ? "s" : ""} — scroll down to view`);
  }

  const scrollToNewest = useCallback(() => {
    newestCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    resetNewProposalsCount();
  }, [newestCardRef, resetNewProposalsCount]);

  const handleAccept = useCallback(
    (applicationId: string) => {
      optimisticAccept(applicationId);
      onAcceptApplication?.(applicationId);
    },
    [optimisticAccept, onAcceptApplication],
  );

  // ── derived data ────────────────────────────────────────────────────────────

  const visibleApplications = applications;

  const selectableApplications = useMemo(
    () => applications.filter((app) => app.status !== "accepted"),
    [applications],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === selectableApplications.length) {
        return new Set();
      }
      return new Set(selectableApplications.map((a) => a.id));
    });
  }, [selectableApplications]);

  const handleBulkShortlist = async () => {
    if (selectedIds.size === 0) return;
    if (!clientAddress) {
      toast.error("Client address required to manage applications");
      return;
    }
    setBulkUpdating(true);
    try {
      const ids = Array.from(selectedIds);
      await bulkUpdateApplications({
        applicationIds: ids,
        action: "shortlist",
        clientAddress,
      });
      optimisticBulkUpdate(ids, "shortlisted");
      setSelectedIds(new Set());
      toast.success(`Successfully shortlisted ${ids.length} application${ids.length > 1 ? "s" : ""}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err.message || "Failed to shortlist applications");
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleConfirmBulkReject = async () => {
    if (selectedIds.size === 0) return;
    if (!clientAddress) {
      toast.error("Client address required to manage applications");
      return;
    }
    setBulkUpdating(true);
    try {
      const ids = Array.from(selectedIds);
      await bulkUpdateApplications({
        applicationIds: ids,
        action: "reject",
        clientAddress,
      });
      optimisticBulkUpdate(ids, "rejected");
      setSelectedIds(new Set());
      setConfirmRejectOpen(false);
      toast.success(`Successfully rejected ${ids.length} application${ids.length > 1 ? "s" : ""}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err.message || "Failed to reject applications");
    } finally {
      setBulkUpdating(false);
    }
  };

  const visibleBidAmount = (app: Application) =>
    app.bidRevealed && app.revealedBidAmount ? app.revealedBidAmount : app.bidAmount;

  // Shortlisted applications get visual highlight and appear at the top
  const sortedApplications = useMemo(() => {
    return [...visibleApplications].sort((a, b) => {
      const aShortlisted = a.status === "shortlisted" ? 1 : 0;
      const bShortlisted = b.status === "shortlisted" ? 1 : 0;
      if (aShortlisted !== bShortlisted) {
        return bShortlisted - aShortlisted;
      }

      if (biddingPhase === "commitment") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      const bidDiff = parseFloat(visibleBidAmount(a)) - parseFloat(visibleBidAmount(b));
      if (bidDiff !== 0) return bidDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [visibleApplications, biddingPhase]);

  const revealedApplications = applications.filter(
    (app) => app.bidRevealed && app.revealedBidAmount,
  );
  const averageBid =
    revealedApplications.length > 0
      ? revealedApplications.reduce(
          (sum, app) => sum + parseFloat(app.revealedBidAmount || "0"),
          0,
        ) / revealedApplications.length
      : 0;
  const lowestBid =
    revealedApplications.length > 0
      ? Math.min(...revealedApplications.map((app) => parseFloat(app.revealedBidAmount || "0")))
      : 0;
  const highestBid =
    revealedApplications.length > 0
      ? Math.max(...revealedApplications.map((app) => parseFloat(app.revealedBidAmount || "0")))
      : 0;

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" ref={listTopRef}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="font-display text-xl font-bold text-amber-100">
            Applications ({applications.length})
          </h2>
          <span className="text-xs rounded-full border border-market-500/20 px-2 py-1 text-market-300">
            {biddingPhase === "commitment" ? "Sealed phase" : "Reveal phase"}
          </span>

          {/* Live indicator */}
          {wsStatus === "open" && (
            <div className="flex items-center gap-1 text-xs text-green-400">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Live
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* "X new proposals" scroll button */}
          {newProposalsCount > 0 && (
            <button
              type="button"
              onClick={scrollToNewest}
              className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1 rounded-full hover:bg-amber-500/30 transition-colors animate-pulse"
            >
              ↓ {newProposalsCount} new proposal{newProposalsCount > 1 ? "s" : ""}
            </button>
          )}

          {biddingPhase === "reveal" && revealedApplications.length > 0 && (
            <div className="flex items-center gap-4 text-sm">
              <div className="text-amber-800">
                Avg:{" "}
                <span className="font-mono text-market-400">
                  {formatXLM(averageBid.toString())}
                </span>
              </div>
              <div className="text-amber-800">
                Range:{" "}
                <span className="font-mono text-market-400">
                  {formatXLM(lowestBid.toString())} – {formatXLM(highestBid.toString())}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bulk actions toolbar for client */}
      {isClient && selectableApplications.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-market-900/60 border border-market-500/20 rounded-xl backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-amber-200 hover:text-amber-100 select-none">
              <input
                type="checkbox"
                id="select-all-applications"
                checked={
                  selectableApplications.length > 0 &&
                  selectedIds.size === selectableApplications.length
                }
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-market-500/40 bg-market-900 text-amber-500 focus:ring-amber-500 cursor-pointer"
              />
              <span>Select All ({selectableApplications.length})</span>
            </label>
            {selectedIds.size > 0 && (
              <span className="text-xs font-semibold text-amber-300 bg-amber-500/15 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                {selectedIds.size} selected
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-bulk-shortlist"
              disabled={selectedIds.size === 0 || bulkUpdating}
              onClick={handleBulkShortlist}
              className="text-xs font-medium px-3.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-1.5 shadow-sm shadow-amber-950/20"
            >
              <span>★</span>
              <span>Shortlist Selected</span>
            </button>

            <button
              type="button"
              id="btn-bulk-reject"
              disabled={selectedIds.size === 0 || bulkUpdating}
              onClick={() => setConfirmRejectOpen(true)}
              className="text-xs font-medium px-3.5 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-1.5 shadow-sm shadow-red-950/20"
            >
              <span>✕</span>
              <span>Reject Selected</span>
            </button>
          </div>
        </div>
      )}

      {isClient && biddingPhase === "commitment" && onCloseBidding && (
        <div className="flex justify-end">
          <button onClick={onCloseBidding} className="btn-secondary text-sm py-2 px-4">
            Close Bidding &amp; Start Reveal
          </button>
        </div>
      )}

      {/* Applications list */}
      {applications.length === 0 ? (
        <div className="border border-dashed border-market-500/20 rounded-xl p-8 text-center">
          <p className="text-amber-800 text-sm">
            No applications yet. Waiting for freelancers to apply…
          </p>
          {wsStatus === "open" && (
            <p className="text-xs text-green-400 mt-2">🔴 Live updates enabled</p>
          )}
        </div>
      ) : sortedApplications.length === 0 ? (
        <div className="border border-dashed border-market-500/20 rounded-xl p-8 text-center">
          <p className="text-amber-800 text-sm">No applications match the selected tier.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedApplications.map((application, index) => {
            const isHighlighted = highlightedIds.has(application.id);
            const isFading = fadingIds.has(application.id);
            const isShortlisted = application.status === "shortlisted";
            const isSelected = selectedIds.has(application.id);
            const bidValue = parseFloat(visibleBidAmount(application));
            const isLowestBid =
              biddingPhase === "reveal" && application.bidRevealed && bidValue === lowestBid;
            const bidPercentage = averageBid > 0 ? (bidValue / averageBid) * 100 : 100;
            // Attach newestCardRef to the most recently arrived card (last in sorted list)
            const isNewest = index === sortedApplications.length - 1;

            return (
              <div
                key={application.id}
                ref={isNewest ? newestCardRef : undefined}
                className={`card transition-all duration-300 ${
                  isFading ? "opacity-0 scale-95" : "opacity-100 scale-100"
                } ${isHighlighted ? "ring-2 ring-amber-400 bg-amber-500/5" : ""} ${
                  isLowestBid ? "border-green-500/30 bg-green-500/5" : ""
                } ${
                  isShortlisted
                    ? "border-amber-500/50 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent ring-1 ring-amber-400/40 shadow-lg shadow-amber-950/20"
                    : ""
                } ${
                  isSelected ? "border-market-500/60 ring-1 ring-market-500/40 bg-market-500/5" : ""
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Checkbox for client selection */}
                    {isClient && (
                      <input
                        type="checkbox"
                        id={`checkbox-app-${application.id}`}
                        aria-label={`Select application from ${shortenAddress(application.freelancerAddress)}`}
                        checked={isSelected}
                        disabled={application.status === "accepted"}
                        onChange={() => toggleSelect(application.id)}
                        className="w-4 h-4 rounded border-market-500/40 bg-market-900 text-amber-500 focus:ring-amber-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    )}

                    <a
                      href={accountUrl(application.freelancerAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="address-tag hover:border-market-500/40 transition-colors"
                    >
                      {shortenAddress(application.freelancerAddress)} ↗
                    </a>
                    <FreelancerTierBadge tier={application.freelancerTier} className="px-2 py-0.5" />

                    {isShortlisted && (
                      <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/40 font-semibold shadow-sm shadow-amber-500/10">
                        ★ Shortlisted
                      </span>
                    )}

                    {index === 0 && biddingPhase === "reveal" && (
                      <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full border border-green-500/30">
                        Lowest Bid
                      </span>
                    )}

                    {isHighlighted && (
                      <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded-full border border-amber-500/30 animate-pulse">
                        New!
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 sm:flex-shrink-0">
                    <div className="text-left sm:text-right">
                      <div className="font-mono text-market-400 font-semibold text-sm">
                        {biddingPhase === "commitment" || !application.bidRevealed
                          ? "Sealed commitment"
                          : formatXLM(application.revealedBidAmount || application.bidAmount)}
                      </div>
                      {biddingPhase === "reveal" && application.bidRevealed && (
                        <div className="text-xs text-amber-800">
                          {bidPercentage < 90 ? "🟢" : bidPercentage > 110 ? "🔴" : "🟡"}
                          {bidPercentage.toFixed(0)}% of avg
                        </div>
                      )}
                    </div>

                    <span
                      className={`text-xs px-2.5 py-1 rounded-full border ${badgeClass(
                        application.status,
                      )}`}
                    >
                      {application.status}
                    </span>
                  </div>
                </div>

                <p className="text-amber-700/80 text-sm leading-relaxed mb-3">
                  {application.proposal}
                </p>

                {application.estimatedDuration && (
                  <p className="text-xs text-amber-800 mb-3">
                    Estimated duration: {application.estimatedDuration}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-xs text-amber-800">Applied {timeAgo(application.createdAt)}</p>

                  {isClient &&
                    (application.status === "pending" || application.status === "shortlisted") &&
                    onAcceptApplication && (
                      <button
                        onClick={() => handleAccept(application.id)}
                        className="btn-secondary text-sm py-2 px-4 min-h-[44px] min-w-[44px] hover:bg-market-500/20 transition-colors"
                      >
                        Accept Proposal
                      </button>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal for Bulk Reject */}
      <ConfirmDialog
        open={confirmRejectOpen}
        title="Reject Selected Applications"
        description={`Are you sure you want to reject ${selectedIds.size} selected application${selectedIds.size > 1 ? "s" : ""}? This will update their status to rejected and notify the applicants.`}
        confirmLabel={bulkUpdating ? "Rejecting..." : "Reject Applications"}
        cancelLabel="Cancel"
        variant="danger"
        loading={bulkUpdating}
        onConfirm={handleConfirmBulkReject}
        onCancel={() => setConfirmRejectOpen(false)}
      />

      {/* Connection status footer */}
      {wsStatus !== "open" && (
        <div className="text-center py-2">
          <p className="text-xs text-amber-800">
            {wsStatus === "connecting"
              ? "🟡 Connecting to live updates…"
              : "🔴 Disconnected — polling every 30 s"}
          </p>
        </div>
      )}
    </div>
  );
}
