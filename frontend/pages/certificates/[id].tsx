/**
 * pages/certificates/[id].tsx
 * Shareable skill certificate page with on-chain verification link.
 */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { fetchCertificate, type CertificateData } from "@/lib/api";
import { shortenAddress } from "@/utils/format";

type LoadState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "ok"; cert: CertificateData };

export default function CertificatePage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : "";

  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!router.isReady || !id) return;

    let cancelled = false;
    (async () => {
      try {
        const cert = await fetchCertificate(id);
        if (cancelled) return;
        setState({ status: "ok", cert });
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof Error && (e as any).response?.status === 404) {
          setState({ status: "not_found" });
        } else {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : "Failed to load certificate",
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [router.isReady, id]);

  const title =
    state.status === "ok"
      ? `${state.cert.skill.charAt(0).toUpperCase() + state.cert.skill.slice(1)} Certificate · MarketPay`
      : "Certificate · MarketPay";

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta
          name="description"
          content={
            state.status === "ok"
              ? `Verified ${state.cert.skill} skill certificate issued by Stellar MarketPay`
              : "Skill certificate verification"
          }
        />
      </Head>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 animate-fade-in">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6"
        >
          ← Back to Dashboard
        </Link>

        {state.status === "loading" && (
          <div className="card border-market-500/15 animate-pulse space-y-4 p-8">
            <div className="h-6 bg-market-500/10 rounded w-1/3" />
            <div className="h-20 bg-market-500/8 rounded w-2/3" />
            <div className="h-4 bg-market-500/8 rounded w-1/2" />
          </div>
        )}

        {state.status === "not_found" && (
          <div className="card border-amber-900/30 text-center py-12">
            <p className="text-4xl mb-4">🔍</p>
            <p className="font-display text-xl text-amber-100 mb-2">
              Certificate not found
            </p>
            <p className="text-amber-800 text-sm">
              This certificate does not exist or has been removed.
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div className="card border-red-500/20 text-center py-12">
            <p className="font-display text-xl text-amber-100 mb-2">
              Something went wrong
            </p>
            <p className="text-red-400/90 text-sm">{state.message}</p>
          </div>
        )}

        {state.status === "ok" && (
          <div className="card border-market-500/15 overflow-hidden">
            {/* Certificate header */}
            <div className="bg-gradient-to-r from-market-500/10 to-emerald-500/10 p-6 sm:p-8 text-center border-b border-market-500/15">
              <p className="text-5xl mb-3">🎓</p>
              <p className="text-xs uppercase tracking-[0.2em] text-market-400 font-semibold mb-2">
                Verified Skill Certificate
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 mb-2">
                {state.cert.skill.charAt(0).toUpperCase() + state.cert.skill.slice(1)}
              </h1>
              <p className="text-amber-700/90 text-sm">
                Issued by Stellar MarketPay
              </p>
            </div>

            {/* Certificate body */}
            <div className="p-6 sm:p-8 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                  <p className="label text-xs mb-1">Recipient</p>
                  <p className="text-amber-100 font-medium break-all">
                    {state.cert.displayName || shortenAddress(state.cert.publicKey)}
                  </p>
                </div>
                <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                  <p className="label text-xs mb-1">Score</p>
                  <p className="text-emerald-400 font-display text-xl font-bold">
                    {state.cert.score}%
                  </p>
                </div>
                <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                  <p className="label text-xs mb-1">Issued</p>
                  <p className="text-amber-100 text-sm">
                    {new Date(state.cert.issuedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                  <p className="label text-xs mb-1">Certificate ID</p>
                  <p className="text-amber-700/90 text-xs font-mono break-all">
                    {state.cert.id}
                  </p>
                </div>
              </div>

              {/* Verification section */}
              <div className="rounded-xl border border-market-500/15 bg-ink-900/50 p-4">
                <h2 className="label text-xs mb-3">On-Chain Verification</h2>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-amber-800 text-xs mb-1">Certificate Hash (SHA-256)</p>
                    <p className="text-amber-700/90 font-mono text-xs break-all">
                      {state.cert.certificateHash}
                    </p>
                  </div>
                  {state.cert.ipfsCid && (
                    <div>
                      <p className="text-amber-800 text-xs mb-1">IPFS Content Identifier (CID)</p>
                      <p className="text-amber-700/90 font-mono text-xs break-all">
                        {state.cert.ipfsCid}
                      </p>
                    </div>
                  )}
                  {state.cert.txHash && (
                    <div>
                      <p className="text-amber-800 text-xs mb-1">Soroban Transaction Hash</p>
                      <p className="text-amber-700/90 font-mono text-xs break-all">
                        {state.cert.txHash}
                      </p>
                    </div>
                  )}
                  <a
                    href={state.cert.verifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-market-400 hover:text-market-300 text-xs mt-2"
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5z" />
                      <path d="M7.414 15.414a2 2 0 01-2.828-2.828l3-3a2 2 0 012.828 0 1 1 0 001.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 005.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5z" />
                    </svg>
                    Verify on Stellar Explorer
                  </a>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={() => window.print()}
                  className="btn-primary text-sm flex-1"
                >
                  <svg className="w-4 h-4 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print / Save PDF
                </button>
                <Link
                  href={`/freelancers/${state.cert.publicKey}`}
                  className="btn-secondary text-sm flex-1 text-center"
                >
                  View Freelancer Profile
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
