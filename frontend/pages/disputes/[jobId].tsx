/**
 * pages/disputes/[jobId].tsx
 * Dispute detail page — evidence upload and review (Issue #223)
 *
 * Both client and freelancer can upload up to 10 files (images, PDFs, text).
 * Files are stored on IPFS via Pinata. Admin can view all evidence here.
 */
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import {
  fetchDisputeDetail,
  uploadDisputeEvidence,
  DisputeDetail,
  DisputeEvidence,
} from "@/lib/api";
import { useToast } from "@/components/Toast";
import { shortenAddress, timeAgo } from "@/utils/format";
import clsx from "clsx";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"];
const MAX_SIZE_MB   = 5;

function EvidenceCard({ ev, isOwn }: { ev: DisputeEvidence; isOwn: boolean }) {
  const isImage = ev.mimeType.startsWith("image/");
  return (
    <div className={clsx("card flex items-start justify-between gap-4", isOwn && "border-market-500/30")}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isOwn && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-market-500/10 text-market-400 border border-market-500/20 font-medium">
              Your file
            </span>
          )}
          <span className="text-xs text-amber-800">{ev.mimeType}</span>
        </div>
        <p className="text-amber-100 font-medium text-sm truncate">{ev.fileName}</p>
        <p className="text-xs text-amber-800 mt-0.5">
          {(ev.fileSize / 1024).toFixed(1)} KB · {shortenAddress(ev.uploaderAddress)} · {timeAgo(ev.createdAt)}
        </p>
        <p className="text-xs text-amber-700/70 mt-0.5 font-mono truncate">{ev.ipfsCid}</p>
      </div>
      <div className="flex-shrink-0 flex flex-col gap-2 items-end">
        {isImage && (
          <img
            src={ev.gatewayUrl}
            alt={ev.fileName}
            width={80}
            height={64}
            className="w-20 h-16 object-cover rounded-lg border border-market-500/20"
            loading="lazy"
            decoding="async"
          />
        )}
        <a
          href={ev.gatewayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-xs px-3 py-1.5"
        >
          View ↗
        </a>
      </div>
    </div>
  );
}

interface PageProps {
  publicKey: string | null;
}

export default function DisputePage({ publicKey }: PageProps) {
  const router    = useRouter();
  const jobId     = Array.isArray(router.query.jobId) ? router.query.jobId[0] : router.query.jobId;
  const fileRef   = useRef<HTMLInputElement>(null);
  const { success, info } = useToast();

  const [detail, setDetail]       = useState<DisputeDetail | null>(null);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    if (!jobId) return;
    fetchDisputeDetail(jobId)
      .then(setDetail)
      .catch(() => info("Could not load dispute details."))
      .finally(() => setLoading(false));
  }, [jobId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError("");

    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError("Only images, PDFs, and plain text files are allowed.");
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setFileError(`File must be smaller than ${MAX_SIZE_MB} MB.`);
      return;
    }

    setUploading(true);
    try {
      const ev = await uploadDisputeEvidence(jobId!, file);
      setDetail((prev) =>
        prev ? { ...prev, evidence: [...prev.evidence, ev] } : prev
      );
      success("Evidence uploaded to IPFS.");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: any) {
      info(err?.response?.data?.error || err?.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="card animate-pulse h-20" />)}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center">
        <p className="font-display text-2xl text-amber-100 mb-3">Dispute not found</p>
        <Link href="/jobs" className="btn-primary text-sm">Browse Jobs</Link>
      </div>
    );
  }

  const { job, evidence } = detail;
  const isParty = publicKey === job.client_address || publicKey === job.freelancer_address;
  const myEvidence = evidence.filter((ev) => ev.uploaderAddress === publicKey);
  const clientEvidence     = evidence.filter((ev) => ev.uploaderAddress === job.client_address);
  const freelancerEvidence = evidence.filter((ev) => ev.uploaderAddress === job.freelancer_address);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in space-y-8">
      {/* Header */}
      <div>
        <Link href={`/jobs/${job.id}`} className="text-sm text-amber-700 hover:text-amber-400 transition-colors">
          ← Back to job
        </Link>
        <h1 className="font-display text-3xl font-bold text-amber-100 mt-3">Dispute</h1>
        <p className="text-amber-800 mt-1">{job.title}</p>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs px-2.5 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20">
            {job.status}
          </span>
          <span className="text-xs text-amber-800">Job ID: {job.id.slice(0, 8)}…</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="card space-y-3">
        <p className="text-xs uppercase tracking-wider text-amber-800/70">Timeline</p>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-market-400 flex-shrink-0" />
            <span className="text-amber-800">Job created · {new Date(job.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
            <span className="text-amber-800">Dispute opened</span>
          </div>
        </div>
      </div>

      {/* Upload evidence */}
      {isParty && (
        <div className="card space-y-3 max-w-lg">
          <p className="font-medium text-amber-100 text-sm">
            Upload evidence ({myEvidence.length}/10 files)
          </p>
          <p className="text-xs text-amber-800">
            Images, PDFs, or plain text · Max {MAX_SIZE_MB} MB per file
          </p>
          {fileError && <p className="text-sm text-red-400">{fileError}</p>}
          <div className="flex gap-3 items-center">
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_TYPES.join(",")}
              className="hidden"
              id="evidence-upload"
              onChange={handleUpload}
              disabled={uploading || myEvidence.length >= 10}
            />
            <label
              htmlFor="evidence-upload"
              className={clsx(
                "btn-primary text-sm cursor-pointer",
                (uploading || myEvidence.length >= 10) && "opacity-50 pointer-events-none"
              )}
            >
              {uploading ? "Uploading to IPFS…" : "Choose file"}
            </label>
            {myEvidence.length >= 10 && (
              <p className="text-xs text-amber-800">Maximum files reached.</p>
            )}
          </div>
        </div>
      )}

      {/* Evidence sections */}
      <div className="grid sm:grid-cols-2 gap-6">
        <section className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-amber-800/70">
            Client evidence ({clientEvidence.length})
          </p>
          {clientEvidence.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-amber-800 text-sm">No evidence submitted by client.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {clientEvidence.map((ev) => (
                <EvidenceCard key={ev.id} ev={ev} isOwn={publicKey === ev.uploaderAddress} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-amber-800/70">
            Freelancer evidence ({freelancerEvidence.length})
          </p>
          {freelancerEvidence.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-amber-800 text-sm">No evidence submitted by freelancer.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {freelancerEvidence.map((ev) => (
                <EvidenceCard key={ev.id} ev={ev} isOwn={publicKey === ev.uploaderAddress} />
              ))}
            </div>
          )}
        </section>
      </div>

      {!isParty && !publicKey && (
        <div className="card text-center py-8">
          <p className="text-amber-800 text-sm">Connect your wallet to submit evidence.</p>
        </div>
      )}
    </div>
  );
}
