/**
 * pages/certificates/index.tsx
 * Lists a freelancer's earned proof-of-work certificates (Soroban NFTs).
 *
 * Reads the freelancer from the `?publicKey=` query param (shareable) or falls
 * back to the connected wallet. Each card links to the shareable certificate
 * page at /certificates/job/[jobId].
 */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import WalletConnect from "@/components/WalletConnect";
import {
  fetchFreelancerNftCertificates,
  type NftCertificateData,
} from "@/lib/api";
import { formatXLM, formatDate, shortenAddress } from "@/utils/format";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; certs: NftCertificateData[] };

export default function CertificatesIndex({
  publicKey,
  onConnect,
}: {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}) {
  const router = useRouter();
  const queryKey =
    typeof router.query.publicKey === "string" ? router.query.publicKey : "";

  // Prefer the explicit query param (shareable link) over the wallet.
  const targetKey = queryKey || publicKey || "";

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!targetKey) {
      setState({ status: "ok", certs: [] });
      return;
    }
    if (!/^G[A-Z0-9]{55}$/.test(targetKey)) {
      setState({ status: "error", message: "Invalid Stellar public key." });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    fetchFreelancerNftCertificates(targetKey)
      .then((certs) => {
        if (!cancelled) setState({ status: "ok", certs });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Failed to load certificates",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [targetKey]);

  const copyShareUrl = async (cert: NftCertificateData) => {
    const url = `${window.location.origin}/certificates/job/${cert.jobId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(cert.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard unavailable — the URL is still shown in the UI.
    }
  };

  return (
    <>
      <Head>
        <title>Certificates · Stellar MarketPay</title>
        <meta
          name="description"
          content="Proof-of-work certificates earned by a freelancer on Stellar MarketPay."
        />
      </Head>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-market-400 font-semibold mb-2">
              Proof of Work
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100">
              Completion Certificates
            </h1>
            <p className="text-amber-700/90 text-sm mt-2">
              {targetKey
                ? `Certificates earned by ${shortenAddress(targetKey)}`
                : "Connect your wallet to see your earned certificates."}
            </p>
          </div>
          {!targetKey && <WalletConnect onConnect={onConnect} />}
        </div>

        {state.status === "loading" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="card border-market-500/15 animate-pulse p-6 space-y-3">
                <div className="h-6 bg-market-500/10 rounded w-2/3" />
                <div className="h-4 bg-market-500/8 rounded w-1/2" />
                <div className="h-4 bg-market-500/8 rounded w-3/4" />
              </div>
            ))}
          </div>
        )}

        {state.status === "error" && (
          <div className="card border-red-500/20 text-center py-12">
            <p className="font-display text-xl text-amber-100 mb-2">Something went wrong</p>
            <p className="text-red-400/90 text-sm">{state.message}</p>
          </div>
        )}

        {state.status === "ok" && state.certs.length === 0 && (
          <div className="card border-market-500/15 text-center py-14">
            <p className="text-5xl mb-4">🏅</p>
            <p className="font-display text-xl text-amber-100 mb-2">
              {targetKey ? "No certificates yet" : "Connect your wallet"}
            </p>
            <p className="text-amber-800 text-sm max-w-md mx-auto">
              {targetKey
                ? "Completed jobs with released escrows mint a proof-of-work certificate to the freelancer's wallet."
                : "Once a job you completed has its escrow released, a proof-of-work certificate is minted to your wallet and listed here."}
            </p>
          </div>
        )}

        {state.status === "ok" && state.certs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {state.certs.map((cert) => (
              <div
                key={cert.id}
                className="card border-market-500/15 hover:border-market-500/40 transition-colors p-5 flex flex-col gap-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-market-500/20 to-emerald-500/20 border border-market-500/20 flex items-center justify-center text-2xl shrink-0">
                    🏅
                  </div>
                  <button
                    onClick={() => copyShareUrl(cert)}
                    className="text-xs text-market-400 hover:text-market-300 underline whitespace-nowrap"
                  >
                    {copiedId === cert.id ? "Copied ✓" : "Share link"}
                  </button>
                </div>

                <div>
                  <h2 className="font-display text-lg font-bold text-amber-100 leading-snug">
                    {cert.jobTitle}
                  </h2>
                  <p className="text-xs text-amber-800 mt-1">
                    {cert.amountXlm ? `${formatXLM(cert.amountXlm)} XLM` : "Amount on chain"} ·{" "}
                    {cert.completionDate
                      ? formatDate(cert.completionDate)
                      : "Completed"}
                  </p>
                  <p className="text-xs text-amber-700/80 mt-1 break-all">
                    Client: {cert.clientName || shortenAddress(cert.clientAddress)}
                  </p>
                </div>

                <Link
                  href={`/certificates/job/${cert.jobId}`}
                  className="btn-secondary text-sm text-center"
                >
                  View Certificate
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
