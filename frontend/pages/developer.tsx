import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Head from "next/head";
import {
  createDeveloperApiKey,
  fetchDeveloperApiKeys,
  revokeDeveloperApiKey,
  rotateDeveloperApiKey,
  type DeveloperApiKey,
} from "@/lib/api";
import { timeAgo } from "@/utils/format";

interface DeveloperPageProps {
  publicKey: string | null;
  onConnect: () => void;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card border-market-500/15">
      <h2 className="font-display text-xl font-bold text-amber-100 mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default function DeveloperPage({ publicKey, onConnect }: DeveloperPageProps) {
  const [keys, setKeys] = useState<DeveloperApiKey[]>([]);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDeveloperApiKeys();
      setKeys(data);
    } catch {
      setError("Failed to load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    loadKeys();
  }, [loadKeys, publicKey]);

  async function handleCreateKey() {
    if (!label.trim()) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const created = await createDeveloperApiKey(label.trim());
      setNewKey(created.apiKey);
      setLabel("");
      setMessage("API key created. Copy it now, it will not be shown again.");
      await loadKeys();
    } catch {
      setError("Failed to create API key.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeKey(id: string) {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      await revokeDeveloperApiKey(id);
      setMessage("API key revoked.");
      await loadKeys();
    } catch {
      setError("Failed to revoke API key.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRotateKey(id: string) {
    setLoading(true);
    setMessage(null);
    setError(null);
    setRotatedKey(null);
    try {
      const result = await rotateDeveloperApiKey(id);
      setRotatedKey(result.apiKey);
      setMessage("API key rotated. The old key remains valid for 24 hours. Copy the new key now.");
      await loadKeys();
    } catch {
      setError("Failed to rotate API key.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyKey() {
    if (!newKey || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(newKey);
      setMessage("API key copied to clipboard.");
    } catch {
      setError("Unable to copy the API key.");
    }
  }

  if (!publicKey) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="card border-market-500/15 text-center">
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-3">Developer Portal</h1>
          <p className="text-amber-800 mb-6">
            Connect your wallet to create API keys and manage public integrations.
          </p>
          <button className="btn-primary" onClick={onConnect} type="button">
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Developer Portal - Stellar MarketPay</title>
        <meta name="description" content="Create and manage API keys for public marketplace integrations." />
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-6 animate-fade-in">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl">⚙️</span>
            <h1 className="font-display text-3xl font-bold text-amber-100">Developer Portal</h1>
          </div>
          <p className="text-amber-800 max-w-3xl">
            Create hashed API keys for integrations, inspect usage per key, and revoke access when needed.
          </p>
          <p className="text-xs font-mono text-amber-900 break-all">
            Connected wallet: {publicKey}
          </p>
        </header>

        {message && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            {message}
          </div>
        )}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
          <Panel title="Create API Key">
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-amber-800 mb-1">Label</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="input-field w-full"
                  placeholder="Analytics integration"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCreateKey}
                  disabled={loading || !label.trim()}
                  className="btn-primary disabled:opacity-50"
                >
                  {loading ? "Working…" : "Create Key"}
                </button>
                <a href="/api/docs" target="_blank" rel="noreferrer" className="btn-ghost">
                  Open API Docs
                </a>
              </div>

              {newKey && (
                <div className="rounded-xl border border-market-500/20 bg-market-500/5 p-4 space-y-3">
                  <p className="text-sm text-amber-100 font-medium">Plaintext API key</p>
                  <p className="text-xs text-amber-800">
                    Store this now. The server stores only a hash and it will not be shown again.
                  </p>
                  <div className="rounded-lg bg-ink-950/60 border border-market-500/10 p-3 font-mono text-xs break-all text-market-300">
                    {newKey}
                  </div>
                  <button type="button" className="btn-primary text-sm" onClick={handleCopyKey}>
                    Copy Key
                  </button>
                </div>
              )}
              {rotatedKey && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                  <p className="text-sm text-amber-100 font-medium">New API key (rotation)</p>
                  <p className="text-xs text-amber-800">
                    The old key remains valid for 24 hours. Store this new key now.
                  </p>
                  <div className="rounded-lg bg-ink-950/60 border border-market-500/10 p-3 font-mono text-xs break-all text-market-300">
                    {rotatedKey}
                  </div>
                  <button type="button" className="btn-primary text-sm" onClick={() => { if (typeof navigator !== "undefined") navigator.clipboard.writeText(rotatedKey); setMessage("New API key copied to clipboard."); }}>
                    Copy New Key
                  </button>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="How to Use">
            <div className="space-y-4 text-sm text-amber-800">
              <p>
                Send the key in the `X-API-Key` header to access the public endpoints.
              </p>
              <pre className="overflow-x-auto rounded-xl bg-ink-950/70 border border-market-500/10 p-4 text-xs text-amber-200">
{`curl -H "X-API-Key: sk_live_..." \\
  "${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/public/jobs"`}
              </pre>
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-lg border border-market-500/10 p-3">
                  <p className="font-medium text-amber-100">Rate limit</p>
                  <p>100 requests per hour per key.</p>
                </div>
                <div className="rounded-lg border border-market-500/10 p-3">
                  <p className="font-medium text-amber-100">Usage tracking</p>
                  <p>Daily request counts are stored per key.</p>
                </div>
                <div className="rounded-lg border border-market-500/10 p-3">
                  <p className="font-medium text-amber-100">Public data</p>
                  <p>Open jobs and freelancer profiles are exposed with reduced fields.</p>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="API Keys">
          {loading && keys.length === 0 ? (
            <div className="text-amber-800 text-sm">Loading API keys…</div>
          ) : keys.length === 0 ? (
            <div className="border border-dashed border-market-500/20 rounded-xl p-8 text-center">
              <p className="text-amber-800 text-sm">No API keys created yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex flex-col gap-3 rounded-xl border border-market-500/15 bg-ink-950/30 p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-amber-100">{key.label}</p>
                      {key.revoked_at ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                          Revoked
                        </span>
                      ) : key.rotating_at ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Rotating
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-amber-800 break-all">
                      {key.key_prefix}
                    </p>
                    <p className="text-xs text-amber-900">
                      Created {timeAgo(key.created_at)} · Requests today: {key.requests_today}
                      {key.last_used_at ? ` · Last used ${timeAgo(key.last_used_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost text-sm px-4 text-amber-400/80 hover:text-amber-400 disabled:opacity-50"
                      disabled={Boolean(key.revoked_at) || Boolean(key.rotating_at) || loading}
                      onClick={() => handleRotateKey(key.id)}
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-sm px-4 text-red-400/80 hover:text-red-400 disabled:opacity-50"
                      disabled={Boolean(key.revoked_at) || loading}
                      onClick={() => handleRevokeKey(key.id)}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
