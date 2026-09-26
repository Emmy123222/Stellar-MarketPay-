/**
 * components/DisputeTimeline.tsx
 * Vertical timeline of dispute events in chronological order (Issue #1429).
 *
 * Data comes from GET /api/disputes/:jobId/events (ordered oldest-first by
 * the backend). Each row shows the event label, the acting party, the
 * timestamp, and — for evidence_submitted events — a link to the attached
 * evidence file on the IPFS gateway.
 */
import { DisputeTimelineEvent } from "@/lib/api";
import { formatDate, shortenAddress, timeAgo } from "@/utils/format";
import clsx from "clsx";

const EVENT_META: Record<
  DisputeTimelineEvent["eventType"],
  { label: string; dotClass: string }
> = {
  opened: { label: "Dispute opened", dotClass: "bg-red-400" },
  evidence_submitted: { label: "Evidence submitted", dotClass: "bg-market-400" },
  arbitrator_assigned: { label: "Arbitrator assigned", dotClass: "bg-blue-400" },
  resolved: { label: "Dispute resolved", dotClass: "bg-emerald-400" },
};

function eventLabel(event: DisputeTimelineEvent): string {
  const meta = EVENT_META[event.eventType];
  if (!meta) return event.eventType;
  if (
    event.eventType === "resolved" &&
    typeof event.payload?.resolution === "string"
  ) {
    return event.payload.resolution === "release_funds"
      ? "Dispute resolved — funds released to freelancer"
      : "Dispute resolved — funds refunded to client";
  }
  return meta.label;
}

function eventDotClass(event: DisputeTimelineEvent): string {
  return EVENT_META[event.eventType]?.dotClass ?? "bg-ink-500";
}

export default function DisputeTimeline({
  events,
  loading = false,
}: {
  events: DisputeTimelineEvent[];
  loading?: boolean;
}) {
  return (
    <div className="card space-y-3" aria-label="Dispute timeline">
      <p className="text-xs uppercase tracking-wider text-amber-800/70">Timeline</p>

      {loading ? (
        <div className="space-y-2 text-sm animate-pulse" data-testid="timeline-loading">
          <div className="h-4 w-3/4 bg-market-500/10 rounded" />
          <div className="h-4 w-1/2 bg-market-500/10 rounded" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-amber-800" data-testid="timeline-empty">
          No timeline events recorded for this dispute yet.
        </p>
      ) : (
        <ol className="relative space-y-4" data-testid="timeline-events">
          {events.map((event, idx) => (
            <li key={event.id} className="relative pl-6">
              {/* Connector line between dots */}
              {idx < events.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-[5px] top-3 h-full w-px bg-amber-900/40"
                />
              )}
              <span
                aria-hidden="true"
                className={clsx(
                  "absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0",
                  eventDotClass(event)
                )}
              />
              <div className="space-y-0.5">
                <p className="text-sm text-amber-100 font-medium">{eventLabel(event)}</p>
                <p className="text-xs text-amber-800">
                  {shortenAddress(event.actorAddress)} · {formatDate(event.createdAt)} ·{" "}
                  {timeAgo(event.createdAt)}
                </p>
                {event.evidence && (
                  <a
                    href={event.evidence.gatewayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-market-400 hover:text-market-300 underline"
                    title="View evidence on IPFS gateway"
                  >
                    📎 {event.evidence.fileName} ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
