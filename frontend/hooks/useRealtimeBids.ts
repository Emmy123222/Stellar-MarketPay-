/**
 * hooks/useRealtimeBids.ts
 *
 * Manages real-time application updates for a job via WebSocket, with:
 *  - application:new   → append card
 *  - application:withdrawn → fade-out then remove card
 *  - application:accepted / rejected → optimistic status update
 *  - 30-second fallback polling when WebSocket is disconnected
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Application } from "@/utils/types";
import { refreshAccessToken } from "@/lib/api";

/** Initial reconnect delay (ms). Doubles each attempt up to 30 s. */
const WS_INITIAL_RECONNECT_DELAY = 1_000;
/** Maximum reconnect delay (ms). */
const WS_MAX_RECONNECT_DELAY = 30_000;
const POLL_INTERVAL = 30_000;
const WITHDRAW_FADE_MS = 400;

export type WsStatus = "connecting" | "open" | "closed";

interface UseRealtimeBidsOptions {
  jobId: string;
  initialApplications: Application[];
  /** Fetches the latest list from the API — used for fallback polling */
  fetchApplications: () => Promise<Application[]>;
  /** Called whenever a new bid arrives via WebSocket. */
  onNewBid?: (application: Application) => void;
}

interface UseRealtimeBidsResult {
  applications: Application[];
  /** IDs currently highlighted (new arrival) */
  highlightedIds: Set<string>;
  /** IDs currently fading out (withdrawn) */
  fadingIds: Set<string>;
  wsStatus: WsStatus;
  /** Count of new proposals that arrived while the tab was hidden */
  newProposalsCount: number;
  resetNewProposalsCount: () => void;
  /** Optimistically mark an application as accepted */
  optimisticAccept: (applicationId: string) => void;
  /** Optimistically mark an application as rejected */
  optimisticReject: (applicationId: string) => void;
  /** Ref to the newest card so the "scroll to new" button works */
  newestCardRef: React.MutableRefObject<HTMLDivElement | null>;
}

export function useRealtimeBids({
  jobId,
  initialApplications,
  fetchApplications,
  onNewBid,
}: UseRealtimeBidsOptions): UseRealtimeBidsResult {
  const [applications, setApplications] = useState<Application[]>(initialApplications);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [newProposalsCount, setNewProposalsCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tabVisibleRef = useRef(!document.hidden);
  const newestCardRef = useRef<HTMLDivElement | null>(null);
  const initialSyncedRef = useRef(false);

  // ── helpers ────────────────────────────────────────────────────────────────

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPoll = useCallback(() => {
    clearPoll();
    pollTimerRef.current = setInterval(async () => {
      try {
        const fresh = await fetchApplications();
        setApplications(fresh);
      } catch {
        // ignore — will retry next interval
      }
    }, POLL_INTERVAL);
  }, [clearPoll, fetchApplications]);

  const highlight = useCallback((id: string) => {
    setHighlightedIds((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setHighlightedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 3_000);
  }, []);

  const fadeRemove = useCallback((id: string) => {
    setFadingIds((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setApplications((prev) => prev.filter((a) => a.id !== id));
      setFadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, WITHDRAW_FADE_MS);
  }, []);

  // ── Sync initialApplications when they arrive async (e.g., page data fetch) ─
  useEffect(() => {
    if (initialApplications.length > 0 && !initialSyncedRef.current) {
      setApplications(initialApplications);
      initialSyncedRef.current = true;
    }
  }, [initialApplications]);

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current) return; // already open or connecting

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/realtime`);
    wsRef.current = ws;
    setWsStatus("connecting");

    // React Strict Mode mounts, cleans up, then mounts again — the cleanup
    // below closes `ws` and clears `wsRef.current`, but `WebSocket.close()`
    // is asynchronous, so this socket's own `onclose` (and any in-flight
    // `onmessage`) can still fire *after* the second mount has already
    // created a brand-new socket and reassigned `wsRef.current` to it.
    // Without this guard, the stale socket's `onclose` would null out the
    // ref to the current, live socket and schedule a spurious reconnect —
    // exactly the duplicate-connection bug this fixes. Every handler below
    // checks it is still the connection `wsRef` currently points to before
    // acting, so a superseded socket's late events are inert no-ops.
    const isCurrent = () => wsRef.current === ws;

    ws.onopen = () => {
      if (!isCurrent()) return;
      setWsStatus("open");
      reconnectAttemptRef.current = 0; // reset back-off on successful connection
      clearPoll(); // WebSocket is up — stop polling
    };

    ws.onmessage = (event) => {
      if (!isCurrent()) return;
      try {
        const { event: evtName, payload } = JSON.parse(event.data as string);

        if (evtName !== `job:${jobId}:bids`) return;

        if (payload.type === "new_bid") {
          const incoming: Application = payload.application;
          setApplications((prev) => {
            if (prev.some((a) => a.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          highlight(incoming.id);
          if (!tabVisibleRef.current) {
            setNewProposalsCount((n) => n + 1);
          }
          // Fire the onNewBid callback so consumers can show toasts, etc.
          onNewBid?.(incoming);
        } else if (payload.type === "application:withdrawn") {
          fadeRemove(payload.applicationId);
        } else if (payload.type === "application:accepted") {
          setApplications((prev) =>
            prev.map((a) =>
              a.id === payload.applicationId ? { ...a, status: "accepted" as const } : a,
            ),
          );
        }
      } catch {
        // malformed frame — ignore
      }
    };

    ws.onclose = (event) => {
      if (!isCurrent()) return;
      wsRef.current = null;
      setWsStatus("closed");
      startPoll();

      const isAuthError = event.code === 4001;

      reconnectTimerRef.current = setTimeout(async () => {
        if (isAuthError) {
          try {
            await refreshAccessToken();
          } catch {
            // Refresh failed — user likely needs to re-login.
            // Polling fallback is already active so the UI stays alive.
          }
        }
      startPoll(); // start polling until we reconnect
      // Exponential back-off: double each attempt, cap at 30 s
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(
        WS_INITIAL_RECONNECT_DELAY * Math.pow(2, attempt),
        WS_MAX_RECONNECT_DELAY,
      );
      reconnectAttemptRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      if (!isCurrent()) return;
      ws.close(); // triggers onclose → reconnect + poll
    };
  }, [jobId, clearPoll, startPoll, highlight, fadeRemove, onNewBid]);

  useEffect(() => {
    reconnectAttemptRef.current = 0; // reset back-off on mount
    connect();

    const onVisibility = () => {
      tabVisibleRef.current = !document.hidden;
      if (!document.hidden) setNewProposalsCount(0);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      // Clear the reconnect timer *before* closing the socket: closing
      // triggers `onclose`, but that handler now checks `isCurrent()` and
      // is a no-op for a ref that's about to be nulled below anyway — this
      // ordering just avoids scheduling a reconnect that would immediately
      // be orphaned by the unmount.
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      clearPoll();
    };
  }, [connect, clearPoll]);

  // ── optimistic mutations ───────────────────────────────────────────────────

  const optimisticAccept = useCallback((applicationId: string) => {
    setApplications((prev) =>
      prev.map((a) =>
        a.id === applicationId ? { ...a, status: "accepted" as const } : a,
      ),
    );
  }, []);

  const optimisticReject = useCallback((applicationId: string) => {
    setApplications((prev) =>
      prev.map((a) =>
        a.id === applicationId ? { ...a, status: "rejected" as const } : a,
      ),
    );
  }, []);

  const resetNewProposalsCount = useCallback(() => setNewProposalsCount(0), []);

  return {
    applications,
    highlightedIds,
    fadingIds,
    wsStatus,
    newProposalsCount,
    resetNewProposalsCount,
    optimisticAccept,
    optimisticReject,
    newestCardRef,
  };
}
