/**
 * Arbitrator profile page (#278).
 */
import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { fetchDaoArbitrators, type DaoArbitrator } from "@/lib/api";
import { shortenAddress } from "@/utils/format";

export default function ArbitratorProfilePage() {
  const router = useRouter();
  const key = router.query.publicKey as string;
  const [arbitrator, setArbitrator] = useState<DaoArbitrator | null>(null);

  useEffect(() => {
    if (!key) return;
    fetchDaoArbitrators()
      .then(({ arbitrators }) => {
        setArbitrator(arbitrators.find((a) => a.publicKey === key) || null);
      })
      .catch(() => setArbitrator(null));
  }, [key]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <Head>
        <title>Arbitrator — Stellar MarketPay</title>
      </Head>
      <Link href="/dao" className="text-sm text-market-400 hover:underline mb-6 inline-block">
        ← Back to DAO
      </Link>
      {arbitrator ? (
        <div className="card">
          <h1 className="font-display text-2xl font-bold text-amber-100 mb-2">
            {arbitrator.displayName || shortenAddress(arbitrator.publicKey)}
          </h1>
          <p className="font-mono text-sm text-amber-800 mb-4">{arbitrator.publicKey}</p>
          {arbitrator.bio && (
            <p className="text-amber-700 mb-4">{arbitrator.bio}</p>
          )}
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-amber-800">Votes received</dt>
              <dd className="font-mono text-market-300">{arbitrator.votesReceived}</dd>
            </div>
            <div>
              <dt className="text-amber-800">Disputes resolved</dt>
              <dd className="font-mono text-market-300">{arbitrator.disputesResolved}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="text-amber-800">Arbitrator not found.</p>
      )}
    </div>
  );
}
