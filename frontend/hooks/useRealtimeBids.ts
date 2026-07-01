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

const WS_RECONNECT_DELAY = 3_000;
const POLL_INTERVAL = 30_000;
const WITHDRAW_FADE_MS = 400;

export type WsStatus = "connecting" | "open" | "closed";

interface UseRealtimeBidsOptions {
  jobId: string;
  initialApplications: Application[];
  /** Fetches the latest list from the API — used for fallback polling */
  fetchApplications: () => Promise<Application[]>;
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
}: UseRealtimeBidsOptions): UseRealtimeBidsResult {
  const [applications, setApplications] = useState<Application[]>(initialApplications);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [newProposalsCount, setNewProposalsCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tabVisibleRef = useRef(!document.hidden);
  const newestCardRef = useRef<HTMLDivElement | null>(null);

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

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current) return; // already open or connecting

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/realtime`);
    wsRef.current = ws;
    setWsStatus("connecting");

    ws.onopen = () => {
      setWsStatus("open");
      clearPoll(); // WebSocket is up — stop polling
    };

    ws.onmessage = (event) => {
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

    ws.onclose = () => {
      wsRef.current = null;
      setWsStatus("closed");
      startPoll(); // start polling until we reconnect
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, WS_RECONNECT_DELAY);
    };

    ws.onerror = () => {
      ws.close(); // triggers onclose → reconnect + poll
    };
  }, [jobId, clearPoll, startPoll, highlight, fadeRemove]);

  useEffect(() => {
    connect();

    const onVisibility = () => {
      tabVisibleRef.current = !document.hidden;
      if (!document.hidden) setNewProposalsCount(0);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      wsRef.current?.close();
      wsRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
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
