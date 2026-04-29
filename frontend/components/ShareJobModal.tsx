/**
 * components/ShareJobModal.tsx
 * Modal for sharing job listings with pre-filled application forms
 */
import { useState } from "react";
import type { Job } from "@/utils/types";

interface ShareJobModalProps {
  job: Job;
  onClose: () => void;
}

interface InviteData {
  jobId: string;
  bidAmount?: string;
  message?: string;
}

export default function ShareJobModal({ job, onClose }: ShareJobModalProps) {
  const [inviteData, setInviteData] = useState<InviteData>({
    jobId: job.id,
  });
  const [showQR, setShowQR] = useState(false);

  // Generate canonical job URL
  const jobUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/jobs/${job.id}`;
  
  // Generate invite link with pre-filled data
  const generateInviteLink = () => {
    const encoded =
      typeof window === "undefined"
        ? ""
        : window.btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    return `${jobUrl}?prefill=${encodeURIComponent(encoded)}`;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const handleCopyUrl = async () => {
    const success = await copyToClipboard(jobUrl);
    if (success) {
      // Could show toast notification here
    }
  };

  const handleCopyInvite = async () => {
    const success = await copyToClipboard(generateInviteLink());
    if (success) {
      // Could show toast notification here
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-ink-800 rounded-xl border border-market-500/20 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-market-500/10">
          <h3 className="font-display text-lg font-semibold text-amber-100">Share Job</h3>
          <button
            onClick={onClose}
            className="text-amber-800 hover:text-amber-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Job Info */}
          <div>
            <h4 className="font-display text-amber-100 font-medium mb-2">{job.title}</h4>
            <p className="text-amber-800 text-sm">
              {job.category} • {job.currency} {job.budget}
            </p>
          </div>

          {/* Share Options */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-amber-200 mb-2">Share Job URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={jobUrl}
                  readOnly
                  className="flex-1 px-3 py-2 bg-ink-900 border border-market-500/20 rounded-lg text-amber-100 text-sm"
                />
                <button
                  onClick={handleCopyUrl}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-amber-200 mb-2">
                Create Invite Link (Pre-filled Application)
              </label>
              
              {/* Pre-fill Options */}
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs text-amber-800 mb-1">Suggested Bid Amount ({job.currency})</label>
                  <input
                    type="text"
                    placeholder="e.g. 500"
                    value={inviteData.bidAmount || ''}
                    onChange={(e) => setInviteData(prev => ({ ...prev, bidAmount: e.target.value }))}
                    className="w-full px-3 py-2 bg-ink-900 border border-market-500/20 rounded-lg text-amber-100 text-sm"
                  />
                </div>
                
                <div>
                  <label className="block text-xs text-amber-800 mb-1">Personal Message (optional)</label>
                  <textarea
                    placeholder="Add a personal note for the freelancer..."
                    value={inviteData.message || ''}
                    onChange={(e) => setInviteData(prev => ({ ...prev, message: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 bg-ink-900 border border-market-500/20 rounded-lg text-amber-100 text-sm resize-none"
                  />
                </div>
              </div>

              {/* Invite Link Actions */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={generateInviteLink()}
                  readOnly
                  className="flex-1 px-3 py-2 bg-ink-900 border border-market-500/20 rounded-lg text-amber-100 text-xs"
                />
                <button
                  onClick={handleCopyInvite}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  Copy
                </button>
                <button
                  onClick={() => setShowQR(!showQR)}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  QR
                </button>
              </div>
            </div>
          </div>

          {/* QR Code */}
          {showQR && (
            <div className="flex flex-col items-center space-y-3 p-4 bg-ink-900 rounded-lg border border-market-500/10">
              <div className="w-full rounded-lg border border-dashed border-market-500/20 bg-ink-800/60 p-4 text-center">
                <p className="text-sm text-amber-100 mb-2">QR preview unavailable in this build</p>
                <p className="text-xs text-amber-800 break-all">{generateInviteLink()}</p>
              </div>
              <p className="text-xs text-amber-800">Copy the invite link above to share the pre-filled application.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
