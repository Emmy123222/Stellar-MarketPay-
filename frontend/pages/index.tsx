/**
 * pages/index.tsx
 * Landing page for Stellar MarketPay.
 */
import Link from "next/link";
import { useState } from "react";
import WalletConnect from "@/components/WalletConnect";

interface HomeProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

const STEPS = [
  { icon: "📋", title: "Client posts a job", desc: "Describe the work, set an XLM budget, and post. Budget is locked in Soroban escrow instantly." },
  { icon: "🙋", title: "Freelancers apply", desc: "Skilled contributors submit proposals and bid amounts. Client reviews and picks the best fit." },
  { icon: "🔒", title: "Work begins in escrow", desc: "Funds sit safely in a smart contract. Freelancer starts work knowing payment is guaranteed." },
  { icon: "✅", title: "Client approves & pays", desc: "Once work is approved, one click releases the escrowed XLM directly to the freelancer." },
];

const STATS = [
  { value: "0%", label: "Platform fee" },
  { value: "3–5s", label: "Payment speed" },
  { value: "~$0", label: "Transaction cost" },
];

const CATEGORIES = [
  "Smart Contracts", "Frontend Dev", "Backend Dev",
  "UI/UX Design", "Technical Writing", "Security Audit",
  "DevOps", "Data Analysis",
];

export default function Home({ publicKey, onConnect }: HomeProps) {
  const [showConnect, setShowConnect] = useState(false);

  return (
    <div className="relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-market-500/4 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6">

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <div className="text-center pt-20 pb-16 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-market-500/20 bg-market-500/6 text-market-400/90 text-xs font-medium mb-8 font-body">
            <span className="w-1.5 h-1.5 rounded-full bg-market-400 animate-pulse" />
            Open Source · Built on Stellar · Powered by Soroban
          </div>

          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-amber-100 leading-tight mb-6">
            Freelance without{" "}
            <span className="text-gradient-gold">middlemen</span>
          </h1>

          <p className="text-amber-700 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed font-body">
            Stellar MarketPay connects clients and freelancers globally. Payments are secured in Soroban smart contract escrow — released the moment work is approved.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {publicKey ? (
              <>
                <Link href="/jobs" className="btn-primary text-base px-8 py-3.5">Browse Jobs →</Link>
                <Link href="/post-job" className="btn-secondary text-base px-8 py-3.5">Post a Job</Link>
              </>
            ) : (
              <>
                <button onClick={() => setShowConnect(true)} className="btn-primary text-base px-8 py-3.5">
                  Get Started Free
                </button>
                <Link href="/jobs" className="btn-secondary text-base px-8 py-3.5">Browse Jobs</Link>
              </>
            )}
          </div>
        </div>

        {/* ── Stats ───────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-px bg-market-500/8 rounded-2xl overflow-hidden border border-market-500/12 mb-20">
          {STATS.map((s) => (
            <div key={s.label} className="bg-ink-900 text-center py-8 px-4">
              <div className="font-display text-4xl font-bold text-gradient-gold mb-1">{s.value}</div>
              <div className="text-amber-800 text-sm font-body">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-amber-100 mb-3">How it works</h2>
            <p className="text-amber-800 max-w-xl mx-auto font-body">Four steps from job post to payment. No banks. No waiting. No trust required.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="card group hover:border-market-500/25 transition-all">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{step.icon}</span>
                  <span className="text-xs font-mono text-market-500/60 font-medium">Step {i + 1}</span>
                </div>
                <h3 className="font-display font-semibold text-amber-200 mb-2 text-base">{step.title}</h3>
                <p className="text-amber-800/80 text-sm leading-relaxed font-body">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Categories ──────────────────────────────────────────────────── */}
        <div className="mb-20">
          <div className="text-center mb-8">
            <h2 className="font-display text-3xl font-bold text-amber-100 mb-3">Browse by Category</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {CATEGORIES.map((cat) => (
              <Link key={cat} href={`/jobs?category=${encodeURIComponent(cat)}`}
                className="px-5 py-2.5 rounded-xl border border-market-500/15 bg-ink-800 text-amber-700 hover:text-market-300 hover:border-market-500/35 transition-all font-body text-sm font-medium">
                {cat}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Why Stellar ─────────────────────────────────────────────────── */}
        <div className="card mb-20 bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/18">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-display text-3xl font-bold text-amber-100 mb-4">Why Stellar?</h2>
            <p className="text-amber-700 leading-relaxed mb-6 font-body">
              Traditional freelance platforms take 10–20% of every payment and hold funds for weeks. Stellar transactions settle in seconds for a fraction of a cent — and Soroban smart contracts enforce payment release automatically, so neither party needs to trust the other.
            </p>
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              {[
                { label: "Settlement time", value: "3–5 seconds" },
                { label: "Transaction fee", value: "0.00001 XLM" },
                { label: "Escrow enforcement", value: "Soroban contract" },
              ].map((f) => (
                <div key={f.label} className="bg-ink-900/60 rounded-xl p-4 border border-market-500/10">
                  <p className="text-market-400 font-mono font-semibold text-base">{f.value}</p>
                  <p className="text-amber-800 text-xs mt-1 font-body">{f.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="text-center pb-12 border-t border-market-500/8 pt-8">
          <p className="text-amber-900 text-sm font-body">
            Open source · MIT License ·{" "}
            <a href="https://github.com/your-org/stellar-marketpay" target="_blank" rel="noopener noreferrer"
              className="hover:text-market-400 transition-colors">Contribute on GitHub →</a>
          </p>
        </div>
      </div>

      {/* Wallet connect modal */}
      {showConnect && !publicKey && (
        <div className="fixed inset-0 z-50 bg-ink-900/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <WalletConnect onConnect={(pk) => { onConnect(pk); setShowConnect(false); }} />
            <button onClick={() => setShowConnect(false)}
              className="mt-4 w-full text-center text-sm text-amber-900 hover:text-amber-600 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
