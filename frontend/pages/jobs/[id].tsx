/**
 * pages/jobs/[id].tsx
 * Single job detail page — view description, apply, manage as client, and see related jobs.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import clsx from "clsx";

import ApplicationForm from "@/components/ApplicationForm";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";

import {
  fetchJob,
  fetchJobs,
  fetchApplications,
  fetchProfile,
  acceptApplication,
  releaseEscrow,
} from "@/lib/api";

import {
  formatXLM,
  formatDate,
  shortenAddress,
  statusLabel,
  statusClass,
} from "@/utils/format";

import {
  accountUrl,
  buildReleaseEscrowTransaction,
  submitSignedSorobanTransaction,
} from "@/lib/stellar";

import { signTransactionWithWallet } from "@/lib/wallet";
import type { Application, AvailabilityStatus, Job, UserProfile } from "@/utils/types";

interface JobDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

function getAvailabilityBadgeClass(status?: AvailabilityStatus | null) {
  if (status === "available") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (status === "busy") return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (status === "unavailable") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-market-500/10 text-market-400 border-market-500/20";
}

function availabilityStatusLabel(status?: AvailabilityStatus | null) {
  if (status === "available") return "Available";
  if (status === "busy") return "Busy";
  if (status === "unavailable") return "Unavailable";
  return "Not set";
}

function availabilitySummary(availability?: UserProfile["availability"]) {
  if (!availability) return "";
  return availability.note || availability.hoursPerWeek ? `${availability.hoursPerWeek || 0} hrs/week` : "";
}

export default function JobDetail({ publicKey, onConnect }: JobDetailProps) {
  const router = useRouter();
  const { id } = router.query;

  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicantProfiles, setApplicantProfiles] = useState<Record<string, UserProfile>>({});
  const [relatedJobs, setRelatedJobs] = useState<Job[]>([]);

  const [loading, setLoading] = useState(true);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [releasingEscrow, setReleasingEscrow] = useState(false);
  const [releaseSuccess, setReleaseSuccess] = useState(false);
  const [releaseTxHash, setReleaseTxHash] = useState<string | null>(null);
  const [releaseSyncedWithBackend, setReleaseSyncedWithBackend] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = applications.some((application) => application.freelancerAddress === publicKey);

  useEffect(() => {
    if (!router.isReady || !id) return;

    const { prefill } = router.query;
    if (typeof prefill === "string") {
      try {
        const decoded = JSON.parse(Buffer.from(prefill, "base64").toString("utf8"));
        setPrefillData(decoded);
      } catch {
        setPrefillData(null);
      }
    }

    setLoading(true);

    Promise.all([fetchJob(id as string), fetchApplications(id as string)])
      .then(([jobData, applicationData]) => {
        setJob(jobData);
        setApplications(applicationData);
      })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [id, router.isReady]);

  useEffect(() => {
    if (!job) return;

    let cancelled = false;

    fetchJobs()
      .then((jobs: Job[]) => {
        if (cancelled) return;

        const similarJobs = jobs
          .filter((item) => item.id !== job.id)
          .filter((item) => item.status === "open")
          .filter((item) => item.category === job.category)
          .slice(0, 3);

        setRelatedJobs(similarJobs);
      })
      .catch(() => setRelatedJobs([]));

    return () => {
      cancelled = true;
    };
  }, [job]);

  useEffect(() => {
    if (!isClient || applications.length === 0) {
      setApplicantProfiles({});
      return;
    }

    let cancelled = false;

    async function loadProfiles() {
      const profileEntries = await Promise.all(
        applications.map(async (application) => {
          try {
            const profile = await fetchProfile(application.freelancerAddress);
            return [application.freelancerAddress, profile] as const;
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;

      const nextProfiles = profileEntries.reduce<Record<string, UserProfile>>((acc, entry) => {
        if (entry) acc[entry[0]] = entry[1];
        return acc;
      }, {});

      setApplicantProfiles(nextProfiles);
    }

    loadProfiles();

    return () => {
      cancelled = true;
    };
  }, [applications, isClient]);

  const handleAcceptApplication = async (applicationId: string) => {
    if (!publicKey || !id) return;

    try {
      await acceptApplication(applicationId, publicKey);
      const [jobData, applicationData] = await Promise.all([
        fetchJob(id as string),
        fetchApplications(id as string),
      ]);
      setJob(jobData);
      setApplications(applicationData);
    } catch {
      setActionError("Failed to accept application.");
    }
  };

  const handleReleaseEscrow = async () => {
    if (!publicKey || !job || !id) return;

    if (!job.escrowContractId) {
      setActionError("This job has no escrow contract ID.");
      return;
    }

    setReleasingEscrow(true);
    setActionError(null);
    setReleaseTxHash(null);
    setReleaseSyncedWithBackend(false);

    try {
      const prepared = await buildReleaseEscrowTransaction(job.escrowContractId, job.id, publicKey);
      const { signedXDR, error: signError } = await signTransactionWithWallet(prepared.toXDR());

      if (signError || !signedXDR) {
        setActionError(signError || "Signing was cancelled.");
        return;
      }

      const { hash } = await submitSignedSorobanTransaction(signedXDR);
      setReleaseTxHash(hash);

      try {
        await releaseEscrow(job.id, publicKey, hash);
        const refreshedJob = await fetchJob(id as string);
        setJob(refreshedJob);
        setReleaseSuccess(true);
        setReleaseSyncedWithBackend(true);
      } catch {
        setActionError("Payment was released on-chain, but the app could not update your job status.");
        setReleaseSuccess(true);
        setReleaseSyncedWithBackend(false);
      }
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not complete the release.");
    } finally {
      setReleasingEscrow(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        <div className="h-8 bg-market-500/8 rounded w-2/3 mb-4" />
        <div className="h-4 bg-market-500/5 rounded w-1/3 mb-8" />
        <div className="card space-y-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-4 bg-market-500/8 rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!job) return null;

  return (
    <>
      <Head>
        <title>{job.title} - Stellar MarketPay</title>
        <meta name="description" content={job.description.substring(0, 160)} />
        <meta property="og:title" content={job.title} />
        <meta property="og:description" content={job.description.substring(0, 160)} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Stellar MarketPay" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={job.title} />
        <meta name="twitter:description" content={job.description.substring(0, 160)} />
      </Head>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6"
        >
          ← Back to Jobs
        </Link>

        <div className="card mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-5">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={statusClass(job.status)}>{statusLabel(job.status)}</span>
                <span className="text-xs text-amber-800 bg-ink-700 px-2.5 py-1 rounded-full border border-market-500/10">
                  {job.category}
                </span>
                {job.boosted && new Date(job.boostedUntil || "") > new Date() && (
                  <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                    Featured
                  </span>
                )}
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug">
                {job.title}
              </h1>
            </div>

            <div className="flex-shrink-0 sm:text-right">
              <p className="text-xs text-amber-800 mb-1">Budget</p>
              <p className="font-mono font-bold text-2xl text-market-400">
                {formatXLM(job.budget)} {job.currency}
              </p>

              {job.deadline && (
                <p className="text-xs text-amber-700 mt-2">Deadline: {formatDate(job.deadline)}</p>
              )}

              <a
                href={accountUrl(job.clientAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-3 text-sm text-amber-700 hover:text-market-400 transition-colors"
              >
                Client: {shortenAddress(job.clientAddress)} ↗
              </a>
            </div>
          </div>

          <div className="prose prose-sm max-w-none">
            <h3 className="font-display text-base font-semibold text-amber-300 mb-3">Description</h3>
            <p className="text-amber-700/90 leading-relaxed whitespace-pre-wrap font-body text-sm">
              {job.description}
            </p>
          </div>

          {job.skills?.length > 0 && (
            <div className="mt-5">
              <h3 className="font-display text-base font-semibold text-amber-300 mb-3">
                Required Skills
              </h3>
              <div className="flex flex-wrap gap-2">
                {job.skills.map((skill) => (
                  <span
                    key={skill}
                    className="text-sm bg-market-500/8 text-market-500/80 border border-market-500/15 px-3 py-1 rounded-full"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => setShowShareModal(true)} className="btn-secondary text-sm py-2 px-4 mt-5">
            Share Job
          </button>
        </div>

        {isClient && applications.length > 0 && (
          <div className="mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-4">
              Applications ({applications.length})
            </h2>

            <div className="space-y-4">
              {applications.map((application) => {
                const applicantProfile = applicantProfiles[application.freelancerAddress];
                const availability = applicantProfile?.availability;

                return (
                  <div key={application.id} className="card">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <a
                          href={accountUrl(application.freelancerAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="address-tag hover:border-market-500/40 transition-colors"
                        >
                          {shortenAddress(application.freelancerAddress)} ↗
                        </a>

                        <div className="mt-3">
                          <span
                            className={clsx(
                              "text-xs px-2.5 py-1 rounded-full border",
                              getAvailabilityBadgeClass(availability?.status)
                            )}
                          >
                            {availabilityStatusLabel(availability?.status)}
                          </span>

                          <p className="text-xs text-amber-800 mt-2">
                            {availabilitySummary(availability) || "Availability has not been set yet."}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono text-market-400 font-semibold text-sm">
                          {formatXLM(application.bidAmount)}
                        </span>

                        <span
                          className={clsx(
                            "text-xs px-2.5 py-1 rounded-full border",
                            application.status === "accepted"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : application.status === "rejected"
                                ? "bg-red-500/10 text-red-400 border-red-500/20"
                                : "bg-market-500/10 text-market-400 border-market-500/20"
                          )}
                        >
                          {application.status}
                        </span>
                      </div>
                    </div>

                    <p className="text-amber-700/80 text-sm leading-relaxed mb-4">
                      {application.proposal}
                    </p>

                    {application.status === "pending" && job.status === "open" && (
                      <button
                        onClick={() => handleAcceptApplication(application.id)}
                        className="btn-secondary text-sm py-2 px-4"
                      >
                        Accept Proposal
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isClient && job.status === "open" && (
          <div className="mb-6">
            {!publicKey ? (
              <div>
                <p className="text-amber-800 text-sm mb-4 text-center">
                  Connect your wallet to apply for this job
                </p>
                <WalletConnect onConnect={onConnect} />
              </div>
            ) : hasApplied ? (
              <div className="card text-center py-8 border-market-500/20">
                <p className="text-market-400 font-medium mb-1">Application submitted</p>
                <p className="text-amber-800 text-sm">The client will review your proposal shortly.</p>
              </div>
            ) : showApplyForm ? (
              <ApplicationForm
                job={job}
                publicKey={publicKey}
                prefillData={prefillData}
                onSuccess={() => {
                  setShowApplyForm(false);
                  fetchApplications(job.id).then(setApplications);
                }}
              />
            ) : (
              <div className="text-center">
                <button onClick={() => setShowApplyForm(true)} className="btn-primary text-base px-10 py-3.5">
                  Apply for this Job
                </button>
              </div>
            )}
          </div>
        )}

        {isClient && job.status === "in_progress" && (
          <div className="card mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-3">Escrow Payment</h2>

            {releaseSuccess ? (
              <div>
                <p className="text-market-400 font-medium">Payment released successfully.</p>
                {releaseTxHash && (
                  <p className="text-sm text-amber-700 mt-2 break-all">Transaction: {releaseTxHash}</p>
                )}
                {!releaseSyncedWithBackend && (
                  <p className="text-sm text-red-400 mt-2">
                    Backend sync failed. Save the transaction hash.
                  </p>
                )}
              </div>
            ) : (
              <button
                onClick={handleReleaseEscrow}
                disabled={releasingEscrow}
                className="btn-primary text-sm py-2 px-4 disabled:opacity-60"
              >
                {releasingEscrow ? "Releasing..." : "Release Escrow"}
              </button>
            )}
          </div>
        )}

        {actionError && <p className="mb-6 text-red-400 text-sm">{actionError}</p>}

        {job.status === "completed" && publicKey && !ratingSubmitted && (
          <div className="mt-6">
            {isClient && job.freelancerAddress && (
              <RatingForm
                jobId={job.id}
                ratedAddress={job.freelancerAddress}
                ratedLabel="the freelancer"
                onSuccess={() => setRatingSubmitted(true)}
              />
            )}

            {isFreelancer && (
              <RatingForm
                jobId={job.id}
                ratedAddress={job.clientAddress}
                ratedLabel="the client"
                onSuccess={() => setRatingSubmitted(true)}
              />
            )}
          </div>
        )}

        <div className="card mt-8">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="font-display text-xl font-bold text-amber-100">Similar Jobs</h2>
              <p className="text-sm text-amber-800 mt-1">More open jobs in {job.category}</p>
            </div>

            <Link
              href={`/jobs?category=${encodeURIComponent(job.category)}`}
              className="text-sm text-market-400 hover:text-market-300 transition-colors"
            >
              Browse all {job.category} jobs →
            </Link>
          </div>

          {relatedJobs.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {relatedJobs.map((relatedJob) => (
                <Link
                  key={relatedJob.id}
                  href={`/jobs/${relatedJob.id}`}
                  className="block rounded-xl border border-market-500/10 bg-ink-800/60 p-4 hover:border-market-500/30 transition-colors"
                >
                  <h3 className="font-display font-semibold text-amber-100 line-clamp-2 mb-3">
                    {relatedJob.title}
                  </h3>

                  <div className="space-y-2 text-sm">
                    <p className="text-amber-700">
                      Budget:{" "}
                      <span className="font-mono text-market-400">
                        {formatXLM(relatedJob.budget)} {relatedJob.currency}
                      </span>
                    </p>

                    <p className="text-amber-700">
                      Applicants:{" "}
                      <span className="text-amber-300">
                        {relatedJob.applicationsCount ?? relatedJob.applicantCount ?? 0}
                      </span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-market-500/10 bg-market-500/5 p-5 text-center">
              <p className="text-sm text-amber-700">No other open jobs found in this category.</p>
            </div>
          )}
        </div>
      )}

      {/* Invoice generation (for completed jobs) - Issue #83 */}
      {job.status === "completed" && isFreelancer && (
        <div className="mt-6 card">
          <h3 className="font-display text-lg font-bold text-amber-100 mb-4">Invoice</h3>
          <p className="text-amber-800 text-sm mb-4">
            Generate a professional PDF invoice for your accounting records.
          </p>
          <button
            onClick={() => {
              // Generate invoice
              const invoiceNumber = `INV-${job.id.substring(0, 8).toUpperCase()}-${Date.now()}`;
              const invoiceHTML = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Invoice</title>
                  <style>
                    body {
                      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                      padding: 40px;
                      background: #f5f5f5;
                    }
                    .invoice-container {
                      background: white;
                      padding: 40px;
                      max-width: 800px;
                      margin: 0 auto;
                      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .invoice-header {
                      display: flex;
                      justify-content: space-between;
                      margin-bottom: 40px;
                      border-bottom: 2px solid #e0e0e0;
                      padding-bottom: 20px;
                    }
                    .invoice-title {
                      font-size: 32px;
                      font-weight: bold;
                      color: #333;
                    }
                    .invoice-number {
                      text-align: right;
                      color: #666;
                    }
                    .invoice-number div {
                      margin: 5px 0;
                    }
                    .section {
                      margin-bottom: 30px;
                    }
                    .section-title {
                      font-weight: bold;
                      color: #333;
                      margin-bottom: 10px;
                    }
                    .section-content {
                      color: #666;
                      line-height: 1.6;
                    }
                    .job-details {
                      background: #f9f9f9;
                      padding: 20px;
                      border-radius: 4px;
                      margin-bottom: 30px;
                    }
                    .detail-row {
                      display: flex;
                      justify-content: space-between;
                      margin: 10px 0;
                      color: #333;
                    }
                    .detail-label {
                      font-weight: 500;
                    }
                    .amount-row {
                      display: flex;
                      justify-content: space-between;
                      font-size: 18px;
                      font-weight: bold;
                      border-top: 2px solid #e0e0e0;
                      padding-top: 15px;
                      margin-top: 15px;
                      color: #333;
                    }
                    .footer {
                      margin-top: 40px;
                      padding-top: 20px;
                      border-top: 1px solid #e0e0e0;
                      font-size: 12px;
                      color: #999;
                      text-align: center;
                    }
                    @media print {
                      body { background: white; padding: 0; }
                      .invoice-container { box-shadow: none; }
                    }
                  </style>
                </head>
                <body>
                  <div class="invoice-container">
                    <div class="invoice-header">
                      <div class="invoice-title">INVOICE</div>
                      <div class="invoice-number">
                        <div><strong>${invoiceNumber}</strong></div>
                        <div>Date: ${formatDate(new Date())}</div>
                        <div>Job ID: ${job.id}</div>
                      </div>
                    </div>

                    <div class="section">
                      <div class="section-title">Bill To (Client)</div>
                      <div class="section-content">
                        <div>${job.clientAddress}</div>
                        <div style="margin-top: 10px; font-size: 12px; color: #999;">
                          Network: Stellar Testnet
                        </div>
                      </div>
                    </div>

                    <div class="section">
                      <div class="section-title">From (Freelancer)</div>
                      <div class="section-content">
                        <div>${publicKey}</div>
                        <div style="margin-top: 10px; font-size: 12px; color: #999;">
                          Network: Stellar Testnet
                        </div>
                      </div>
                    </div>

                    <div class="job-details">
                      <div class="detail-row">
                        <span class="detail-label">Job Title:</span>
                        <span>${job.title}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">Description:</span>
                        <span>${job.description?.substring(0, 50)}...</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">Amount:</span>
                        <span>${formatXLM(job.budgetAmount || 0)}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">Completion Date:</span>
                        <span>${formatDate(new Date())}</span>
                      </div>
                      <div class="amount-row">
                        <span>Total Due:</span>
                        <span>${formatXLM(job.budgetAmount || 0)}</span>
                      </div>
                    </div>

                    <div class="footer">
                      <p>This is an automated invoice generated by Stellar MarketPay</p>
                      <p>For support, visit https://stellar-marketpay.app</p>
                    </div>
                  </div>
                </body>
                </html>
              `;

              // Open print dialog
              const printWindow = window.open('', '', 'height=600,width=800');
              if (printWindow) {
                printWindow.document.write(invoiceHTML);
                printWindow.document.close();
                printWindow.print();
              }
            }}
            className="btn-primary py-2 px-4 text-sm"
          >
            Generate Invoice & Print
          </button>
        </div>
      )}
    </div>

      {/* Share Modal */}
      {showShareModal && job && (
        <ShareJobModal
          job={job}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </>
  );
}