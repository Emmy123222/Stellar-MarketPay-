/**
 * components/RealtimeBidComparison.tsx
 * Real-time bid comparison with WebSocket updates
 */
import { useEffect, useState, useRef } from "react";
import { formatXLM, shortenAddress, timeAgo } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import type { Application, FreelancerTier } from "@/utils/types";

interface RealtimeBidComparisonProps {
  jobId: string;
  initialApplications: Application[];
  isClient: boolean;
  biddingPhase?: "commitment" | "reveal";
  onAcceptApplication?: (applicationId: string) => void;
  onCloseBidding?: () => void;
}

interface NewBidEvent {
  type: 'new_bid';
  application: Application;
  jobTitle: string;
}

function badgeClass(status: string) {
  if (status === "accepted") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (status === "rejected") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-market-500/10 text-market-400 border-market-500/20";
}

const tierOptions: FreelancerTier[] = ["Rising Talent", "Top Rated", "Expert"];

export default function RealtimeBidComparison({ 
  jobId, 
  initialApplications, 
  isClient, 
  biddingPhase = "commitment",
  onAcceptApplication,
  onCloseBidding,
}: RealtimeBidComparisonProps) {
  const [applications, setApplications] = useState<Application[]>(initialApplications);
  const [newBidsCount, setNewBidsCount] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [highlightedBids, setHighlightedBids] = useState<Set<string>>(new Set());
  const [tierFilter, setTierFilter] = useState<FreelancerTier | "">("");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/realtime`;
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('Connected to real-time bid updates');
        wsRef.current = ws;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Check if this is a new bid for our job
          if (data.event === `job:${jobId}:bids` && data.payload?.type === 'new_bid') {
            const newApplication = data.payload.application;
            
            setApplications(prev => {
              // Check if application already exists
              const exists = prev.some(app => app.id === newApplication.id);
              if (exists) return prev;
              
              return [...prev, newApplication];
            });
            
            // Highlight the new bid
            setHighlightedBids(prev => new Set([...prev, newApplication.id]));
            
            // Remove highlight after 3 seconds
            setTimeout(() => {
              setHighlightedBids(prev => {
                const newSet = new Set(prev);
                newSet.delete(newApplication.id);
                return newSet;
              });
            }, 3000);
            
            // If user is not currently viewing this tab, increment counter
            if (!isVisible) {
              setNewBidsCount(prev => prev + 1);
            }
            
            // Show browser notification if supported
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('New Bid Received', {
                body: biddingPhase === "commitment"
                  ? `${shortenAddress(newApplication.freelancerAddress)} submitted a sealed bid`
                  : `${shortenAddress(newApplication.freelancerAddress)} revealed ${formatXLM(newApplication.revealedBidAmount || newApplication.bidAmount)}`,
                icon: '/icon-192x192.png',
                tag: `bid-${newApplication.id}`,
              });
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed, attempting to reconnect...');
        wsRef.current = null;
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [jobId, isVisible, biddingPhase]);

  // Track visibility for new bid counter
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
      if (!document.hidden) {
        setNewBidsCount(0); // Reset counter when tab becomes visible
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const visibleApplications = tierFilter
    ? applications.filter((application) => application.freelancerTier === tierFilter)
    : applications;

  // Sort applications by bid amount (lowest first) and creation date
  const visibleBidAmount = (app: Application) =>
    app.bidRevealed && app.revealedBidAmount ? app.revealedBidAmount : app.bidAmount;

  const sortedApplications = [...applications].sort((a, b) => {
    if (biddingPhase === "commitment") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    const bidDiff = parseFloat(visibleBidAmount(a)) - parseFloat(visibleBidAmount(b));
    if (bidDiff !== 0) return bidDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const revealedApplications = applications.filter((app) => app.bidRevealed && app.revealedBidAmount);
  const averageBid = revealedApplications.length > 0 
    ? revealedApplications.reduce((sum, app) => sum + parseFloat(app.revealedBidAmount || "0"), 0) / revealedApplications.length
    : 0;

  const lowestBid = revealedApplications.length > 0 
    ? Math.min(...revealedApplications.map(app => parseFloat(app.revealedBidAmount || "0")))
    : 0;

  const highestBid = revealedApplications.length > 0 
    ? Math.max(...revealedApplications.map(app => parseFloat(app.revealedBidAmount || "0")))
    : 0;

  return (
    <div className="space-y-6">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="font-display text-xl font-bold text-amber-100">
            Applications ({applications.length})
            {newBidsCount > 0 && (
              <span className="ml-2 text-xs bg-red-500 text-white px-2 py-1 rounded-full animate-pulse">
                {newBidsCount} new
              </span>
            )}
          </h2>
          <span className="text-xs rounded-full border border-market-500/20 px-2 py-1 text-market-300">
            {biddingPhase === "commitment" ? "Sealed phase" : "Reveal phase"}
          </span>
          
          {wsRef.current?.readyState === WebSocket.OPEN && (
            <div className="flex items-center gap-1 text-xs text-green-400">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              Live
            </div>
          )}
        </div>

        {biddingPhase === "reveal" && revealedApplications.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <div className="text-amber-800">
              Avg: <span className="font-mono text-market-400">{formatXLM(averageBid.toString())}</span>
            </div>
            <div className="text-amber-800">
              Range: <span className="font-mono text-market-400">{formatXLM(lowestBid.toString())} - {formatXLM(highestBid.toString())}</span>
            </div>
          </div>
        )}
      </div>

      {isClient && biddingPhase === "commitment" && onCloseBidding && (
        <div className="flex justify-end">
          <button onClick={onCloseBidding} className="btn-secondary text-sm py-2 px-4">
            Close Bidding & Start Reveal
          </button>
        </div>
      )}

      {/* Applications list */}
      {applications.length === 0 ? (
        <div className="border border-dashed border-market-500/20 rounded-xl p-8 text-center">
          <p className="text-amber-800 text-sm">No applications yet. Waiting for freelancers to apply...</p>
          {wsRef.current?.readyState === WebSocket.OPEN && (
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
            const isHighlighted = highlightedBids.has(application.id);
            const bidValue = parseFloat(visibleBidAmount(application));
            const isLowestBid = biddingPhase === "reveal" && application.bidRevealed && bidValue === lowestBid;
            const bidPercentage = averageBid > 0 ? (bidValue / averageBid) * 100 : 100;
            
            return (
              <div
                key={application.id}
                className={`card transition-all duration-500 ${
                  isHighlighted
                    ? 'ring-2 ring-amber-400 bg-amber-500/5 animate-pulse'
                    : ''
                } ${
                  isLowestBid
                    ? 'border-green-500/30 bg-green-500/5'
                    : ''
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={accountUrl(application.freelancerAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="address-tag hover:border-market-500/40 transition-colors"
                    >
                      {shortenAddress(application.freelancerAddress)} ↗
                    </a>
                    <FreelancerTierBadge tier={application.freelancerTier} className="px-2 py-0.5" />

                    {index === 0 && (
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
                          {bidPercentage < 90 ? '🟢' : bidPercentage > 110 ? '🔴' : '🟡'}
                          {bidPercentage.toFixed(0)}% of avg
                        </div>
                      )}
                    </div>

                    <span className={`text-xs px-2.5 py-1 rounded-full border ${badgeClass(application.status)}`}>
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
                  <p className="text-xs text-amber-800">
                    Applied {timeAgo(application.createdAt)}
                  </p>

                  {isClient && application.status === "pending" && onAcceptApplication && (
                    <button
                      onClick={() => onAcceptApplication(application.id)}
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

      {/* Connection status */}
      {wsRef.current?.readyState !== WebSocket.OPEN && (
        <div className="text-center py-2">
          <p className="text-xs text-amber-800">
            {wsRef.current?.readyState === WebSocket.CONNECTING 
              ? '🟡 Connecting to live updates...' 
              : '🔴 Disconnected from live updates. Attempting to reconnect...'}
          </p>
        </div>
      )}
    </div>
  );
}
