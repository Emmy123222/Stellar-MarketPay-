/**
 * pages/disputes/[jobId].tsx
 * Dispute detail page — evidence upload and review (Issues #223, #289)
 *
 * Both client and freelancer can upload up to 10 files (images, PDFs, text)
 * via drag-and-drop or file picker. Files are stored on IPFS via Pinata.
 */
import { useState, useEffect, useRef, useCallback, DragEvent } from "react";
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

// Per-file upload tracking
interface PendingFile {
  id: string;
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  errorMsg?: string;
}

function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return "Only images, PDFs, and plain text files are allowed.";
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return `File exceeds ${MAX_SIZE_MB} MB limit.`;
  return null;
}

interface PageProps {
  publicKey: string | null;
}

export default function DisputePage({ publicKey }: PageProps) {
  const router    = useRouter();
  const jobId     = Array.isArray(router.query.jobId) ? router.query.jobId[0] : router.query.jobId;
  const fileRef   = useRef<HTMLInputElement>(null);
  const dropRef   = useRef<HTMLDivElement>(null);
  const { success, info } = useToast();

  const [detail, setDetail]         = useState<DisputeDetail | null>(null);
  const [loading, setLoading]       = useState(true);
  const [pendingFiles, setPending]  = useState<PendingFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError]   = useState("");

  useEffect(() => {
    if (!jobId) return;
    fetchDisputeDetail(jobId)
      .then(setDetail)
      .catch(() => info("Could not load dispute details."))
      .finally(() => setLoading(false));
  }, [jobId]);

  const myEvidentCount = (detail?.evidence ?? []).filter((ev) => ev.uploaderAddress === publicKey).length;
  const slotsLeft = 10 - myEvidentCount - pendingFiles.filter((f) => f.status !== "error").length;

  const enqueueFiles = useCallback((files: File[]) => {
    setDropError("");
    const toAdd: PendingFile[] = [];
    for (const file of files) {
      const err = validateFile(file);
      if (err) { setDropError(err); continue; }
      if (slotsLeft - toAdd.length <= 0) { setDropError("Maximum 10 files per party."); break; }
      toAdd.push({ id: `${file.name}-${file.size}-${Date.now()}`, file, progress: 0, status: "pending" });
    }
    if (toAdd.length) setPending((prev) => [...prev, ...toAdd]);
  }, [slotsLeft]);

  const uploadPending = useCallback(async () => {
    if (!jobId) return;
    const queue = pendingFiles.filter((f) => f.status === "pending");
    for (const pf of queue) {
      setPending((prev) => prev.map((f) => f.id === pf.id ? { ...f, status: "uploading" } : f));
      try {
        const ev = await uploadDisputeEvidence(jobId, pf.file, (pct) =>
          setPending((prev) => prev.map((f) => f.id === pf.id ? { ...f, progress: pct } : f))
        );
        setDetail((prev) => prev ? { ...prev, evidence: [...prev.evidence, ev] } : prev);
        setPending((prev) => prev.map((f) => f.id === pf.id ? { ...f, status: "done", progress: 100 } : f));
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
          ?? (err instanceof Error ? err.message : "Upload failed.");
        setPending((prev) => prev.map((f) => f.id === pf.id ? { ...f, status: "error", errorMsg: msg } : f));
      }
    }
    const doneCount = pendingFiles.filter((f) => f.status === "done").length + queue.length;
    if (doneCount > 0) success(`${doneCount} file(s) uploaded to IPFS.`);
    // Remove done files from queue after a short delay
    setTimeout(() => setPending((prev) => prev.filter((f) => f.status !== "done")), 1500);
  }, [jobId, pendingFiles, success]);

  const removeFile = (id: string) => setPending((prev) => prev.filter((f) => f.id !== id));

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    enqueueFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    enqueueFiles(Array.from(e.target.files ?? []));
    if (fileRef.current) fileRef.current.value = "";
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
  const myEvidence         = evidence.filter((ev) => ev.uploaderAddress === publicKey);
  const clientEvidence     = evidence.filter((ev) => ev.uploaderAddress === job.client_address);
  const freelancerEvidence = evidence.filter((ev) => ev.uploaderAddress === job.freelancer_address);
  const pendingCount = pendingFiles.filter((f) => f.status !== "error").length;
  const totalCount = myEvidence.length + pendingCount;

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

      {/* Upload evidence — drag-and-drop (#289) */}
      {isParty && (
        <div className="card space-y-4 max-w-lg">
          <p className="font-medium text-amber-100 text-sm">
            Upload evidence ({totalCount}/10 files)
          </p>
          <p className="text-xs text-amber-800">
            Images, PDFs, or plain text · Max {MAX_SIZE_MB} MB per file · Max 10 files
          </p>

          {/* Drop zone */}
          <div
            ref={dropRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            role="button"
            aria-label="Upload evidence files — click or drag and drop"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            className={clsx(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 cursor-pointer transition-colors",
              isDragOver ? "border-market-400 bg-market-500/10" : "border-amber-900/40 hover:border-market-500/50",
              totalCount >= 10 && "pointer-events-none opacity-50"
            )}
          >
            <svg className="w-8 h-8 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0L8 8m4-4l4 4" />
            </svg>
            <p className="text-sm text-amber-700">
              {isDragOver ? "Drop files here" : "Drag files here, or click to browse"}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_TYPES.join(",")}
              multiple
              className="hidden"
              id="evidence-upload"
              onChange={handleFileInput}
              aria-label="Choose evidence files"
            />
          </div>

          {(dropError) && <p className="text-sm text-red-400">{dropError}</p>}

          {/* Pending file list */}
          {pendingFiles.length > 0 && (
            <ul className="space-y-2" aria-label="Files queued for upload">
              {pendingFiles.map((pf) => (
                <li key={pf.id} className="rounded-lg bg-amber-900/20 border border-amber-900/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-amber-100 truncate">{pf.file.name}</p>
                      <p className="text-[10px] text-amber-800">{(pf.file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {pf.status === "uploading" && (
                        <span className="text-[10px] text-market-400">{pf.progress}%</span>
                      )}
                      {pf.status === "done" && <span className="text-[10px] text-green-400">✓ Done</span>}
                      {pf.status === "error" && <span className="text-[10px] text-red-400" title={pf.errorMsg}>✗ Failed</span>}
                      {pf.status !== "uploading" && pf.status !== "done" && (
                        <button
                          type="button"
                          onClick={() => removeFile(pf.id)}
                          aria-label={`Remove ${pf.file.name}`}
                          className="text-amber-700 hover:text-red-400 transition-colors text-xs"
                        >✕</button>
                      )}
                    </div>
                  </div>
                  {pf.status === "uploading" && (
                    <div className="mt-1.5 h-1 rounded-full bg-amber-900/40 overflow-hidden" role="progressbar" aria-valuenow={pf.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${pf.file.name}`}>
                      <div className="h-full bg-market-400 transition-all" style={{ width: `${pf.progress}%` }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {pendingFiles.some((f) => f.status === "pending") && (
            <button
              type="button"
              onClick={uploadPending}
              className="btn-primary text-sm w-full"
            >
              Upload {pendingFiles.filter((f) => f.status === "pending").length} file(s) to IPFS
            </button>
          )}
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
