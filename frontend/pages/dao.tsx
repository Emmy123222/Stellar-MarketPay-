/**
 * pages/dao.tsx
 * DAO governance — proposals, token-weighted voting, arbitrators (#278).
 */
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { getXLMBalance } from "@/lib/stellar";
import { formatMoney, shortenAddress } from "@/utils/format";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/lib/i18n";
import {
  fetchDaoProposals,
  fetchDaoTreasury,
  fetchDaoArbitrators,
  createDaoProposal,
  voteDaoProposal,
  registerDaoArbitrator,
  voteDaoArbitrator,
  type DaoProposal,
  type DaoArbitrator,
} from "@/lib/api";

interface DAOProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function DAO({ publicKey, onConnect }: DAOProps) {
  const { t } = useTranslation("common");
  const [proposals, setProposals] = useState<DaoProposal[]>([]);
  const [arbitrators, setArbitrators] = useState<DaoArbitrator[]>([]);
  const [disputePanel, setDisputePanel] = useState<DaoArbitrator[]>([]);
  const [treasury, setTreasury] = useState<{
    allocatedXlm: string;
    activeProposals: number;
    quorumPercent: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);
  const [showNewProposal, setShowNewProposal] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [votingPower, setVotingPower] = useState<number>(0);
  const toast = useToast();

  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "platform" as DaoProposal["type"],
    amount: "",
    recipient: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [propList, treas, arb] = await Promise.all([
        fetchDaoProposals(),
        fetchDaoTreasury(),
        fetchDaoArbitrators(),
      ]);
      setProposals(propList);
      setTreasury(treas);
      setArbitrators(arb.arbitrators);
      setDisputePanel(arb.disputePanel);
    } catch {
      toast.error("Failed to load DAO data");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!publicKey) {
      setWalletBalance(null);
      setVotingPower(0);
      return;
    }
    getXLMBalance(publicKey)
      .then((bal) => {
        setWalletBalance(bal);
        const power = Math.floor(parseFloat(bal || "0"));
        setVotingPower(power > 0 ? power : 1);
      })
      .catch(() => setVotingPower(1));
  }, [publicKey]);

  const handleVote = async (proposalId: string, support: boolean) => {
    if (!publicKey) return;
    setVoting(proposalId);
    try {
      const updated = await voteDaoProposal(
        proposalId,
        support,
        votingPower,
        `vote-${Date.now()}`,
      );
      setProposals((prev) =>
        prev.map((p) => (p.id === proposalId ? updated : p)),
      );
      toast.success(support ? t("dao.voteFor") : t("dao.voteAgainst"));
    } catch {
      toast.error("Failed to vote. Please try again.");
    } finally {
      setVoting(null);
    }
  };

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;
    try {
      const created = await createDaoProposal({
        title: form.title,
        description: form.description,
        type: form.type,
        amount: form.amount || undefined,
        recipient: form.recipient || undefined,
      });
      setProposals((prev) => [created, ...prev]);
      setShowNewProposal(false);
      setForm({ title: "", description: "", type: "platform", amount: "", recipient: "" });
      toast.success("Proposal created");
    } catch {
      toast.error("Could not create proposal");
    }
  };

  const handleRegisterArbitrator = async () => {
    if (!publicKey) return;
    try {
      await registerDaoArbitrator({});
      const arb = await fetchDaoArbitrators();
      setArbitrators(arb.arbitrators);
      setDisputePanel(arb.disputePanel);
      toast.success(t("dao.registerArbitrator"));
    } catch {
      toast.error("Registration failed");
    }
  };

  const handleVoteArbitrator = async (key: string) => {
    if (!publicKey) return;
    try {
      const list = await voteDaoArbitrator(key, votingPower);
      setArbitrators(list);
      toast.success("Vote recorded");
    } catch {
      toast.error("Vote failed");
    }
  };

  const getStatusColor = (status: DaoProposal["status"]) => {
    switch (status) {
      case "active":
        return "text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "passed":
        return "text-green-400 bg-green-500/10 border-green-500/20";
      case "rejected":
        return "text-red-400 bg-red-500/10 border-red-500/20";
      case "executed":
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      default:
        return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    }
  };

  const quorumProgress = (p: DaoProposal) => {
    const total = p.votesFor + p.votesAgainst;
    const target = 100;
    return Math.min(100, Math.round((total / target) * 100));
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        <div className="h-8 bg-market-500/8 rounded w-2/3 mb-4" />
        <p className="text-amber-800 text-sm">{t("dao.loading")}</p>
        <div className="space-y-4 mt-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-market-500/8 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{t("dao.title")} — Stellar MarketPay</title>
      </Head>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-4">
            {t("dao.title")}
          </h1>
          <p className="text-amber-700 text-lg">{t("dao.subtitle")}</p>
        </div>

        {!publicKey ? (
          <div className="card text-center py-8 mb-8">
            <p className="text-amber-800 text-sm mb-4">{t("dao.connectPrompt")}</p>
            <WalletConnect onConnect={onConnect} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="card">
              <h3 className="font-display text-lg font-semibold text-amber-300 mb-2">
                {t("dao.treasuryBalance")}
              </h3>
              <p className="font-mono font-bold text-2xl text-market-400">
                {walletBalance != null
                  ? formatMoney(walletBalance, "XLM")
                  : treasury
                    ? formatMoney(treasury.allocatedXlm, "XLM")
                    : "—"}
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Allocated: {treasury ? formatMoney(treasury.allocatedXlm, "XLM") : "0 XLM"}
              </p>
            </div>
            <div className="card">
              <h3 className="font-display text-lg font-semibold text-amber-300 mb-2">
                {t("dao.activeProposals")}
              </h3>
              <p className="font-mono font-bold text-2xl text-market-400">
                {proposals.filter((p) => p.status === "active").length}
              </p>
            </div>
            <div className="card">
              <h3 className="font-display text-lg font-semibold text-amber-300 mb-2">
                {t("dao.votingPower")}
              </h3>
              <p className="font-mono font-bold text-2xl text-market-400">
                {votingPower}
              </p>
              <p className="text-xs text-amber-800 mt-1">1 XLM = 1 vote</p>
            </div>
          </div>
        )}

        <section className="mb-10">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-4">
            {t("dao.disputePanel")}
          </h2>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            {disputePanel.length > 0 ? (
              disputePanel.map((a) => (
                <Link
                  key={a.publicKey}
                  href={`/dao/arbitrators/${a.publicKey}`}
                  className="card hover:border-market-500/30 transition-colors"
                >
                  <p className="font-mono text-sm text-market-300">
                    {shortenAddress(a.publicKey)}
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    {a.votesReceived} votes · {a.disputesResolved} resolved
                  </p>
                </Link>
              ))
            ) : (
              <p className="text-sm text-amber-800 col-span-3">
                No arbitrators elected yet.
              </p>
            )}
          </div>
          {publicKey && (
            <button
              type="button"
              onClick={handleRegisterArbitrator}
              className="btn-secondary text-sm"
            >
              {t("dao.registerArbitrator")}
            </button>
          )}
        </section>

        {arbitrators.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-4">
              {t("dao.arbitrators")}
            </h2>
            <div className="space-y-2">
              {arbitrators.slice(0, 5).map((a) => (
                <div
                  key={a.publicKey}
                  className="card flex items-center justify-between gap-4 py-3"
                >
                  <Link
                    href={`/dao/arbitrators/${a.publicKey}`}
                    className="text-market-300 font-mono text-sm hover:underline"
                  >
                    {a.displayName || shortenAddress(a.publicKey)}
                  </Link>
                  {publicKey && publicKey !== a.publicKey && (
                    <button
                      type="button"
                      onClick={() => handleVoteArbitrator(a.publicKey)}
                      className="btn-secondary text-xs py-1 px-3"
                    >
                      Vote ({votingPower})
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-2xl font-bold text-amber-100">
            {t("dao.proposals")}
          </h2>
          {publicKey && (
            <button
              type="button"
              onClick={() => setShowNewProposal(true)}
              className="btn-primary"
            >
              {t("dao.createProposal")}
            </button>
          )}
        </div>

        {showNewProposal && publicKey && (
          <form onSubmit={handleCreateProposal} className="card mb-6 space-y-4">
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Proposal title"
              className="input-field"
            />
            <textarea
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description"
              className="textarea-field"
              rows={4}
            />
            <select
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as DaoProposal["type"] })
              }
              className="input-field"
            >
              <option value="platform">Platform</option>
              <option value="treasury">Treasury</option>
              <option value="parameter">Parameter</option>
              <option value="arbitration">Arbitration</option>
            </select>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary">
                Submit
              </button>
              <button
                type="button"
                onClick={() => setShowNewProposal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="space-y-6">
          {proposals.map((proposal) => (
            <div key={proposal.id} className="card">
              <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full border ${getStatusColor(proposal.status)}`}
                    >
                      {proposal.status.toUpperCase()}
                    </span>
                    <span className="text-xs text-amber-800">
                      by {shortenAddress(proposal.proposer)}
                    </span>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-amber-100 mb-2">
                    {proposal.title}
                  </h3>
                  <p className="text-amber-700 mb-4 leading-relaxed">
                    {proposal.description}
                  </p>
                  {proposal.amount && (
                    <p className="mb-4 text-sm">
                      <span className="text-amber-800">{t("dao.amount")}: </span>
                      <span className="font-mono text-market-400">
                        {formatMoney(proposal.amount, "XLM")}
                      </span>
                    </p>
                  )}
                  <div className="mb-4">
                    <p className="text-xs text-amber-800 mb-1">{t("dao.quorum")}</p>
                    <div className="h-2 bg-ink-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-market-400 transition-all"
                        style={{ width: `${quorumProgress(proposal)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-amber-800 mt-1">
                      {quorumProgress(proposal)}% · target {treasury?.quorumPercent ?? 10}%
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-amber-800">
                    <span>
                      {t("dao.created")}:{" "}
                      {new Date(proposal.createdAt).toLocaleDateString()}
                    </span>
                    <span>
                      {t("dao.ends")}:{" "}
                      {new Date(proposal.votingEndsAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="lg:w-64">
                  <div className="text-center mb-4">
                    <div className="text-sm text-amber-800 mb-2">
                      {t("dao.votingResults")}
                    </div>
                    <div className="flex justify-center gap-6 mb-4">
                      <div className="text-center">
                        <div className="font-mono font-bold text-2xl text-green-400">
                          {proposal.votesFor}
                        </div>
                        <div className="text-xs text-amber-800">{t("dao.votesFor")}</div>
                      </div>
                      <div className="text-center">
                        <div className="font-mono font-bold text-2xl text-red-400">
                          {proposal.votesAgainst}
                        </div>
                        <div className="text-xs text-amber-800">{t("dao.votesAgainst")}</div>
                      </div>
                    </div>
                  </div>
                  {publicKey && proposal.status === "active" && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => handleVote(proposal.id, true)}
                        disabled={voting === proposal.id}
                        className="w-full btn-secondary text-green-400 border-green-500/20 hover:bg-green-500/10 disabled:opacity-50"
                      >
                        {voting === proposal.id ? t("dao.voting") : t("dao.voteFor")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleVote(proposal.id, false)}
                        disabled={voting === proposal.id}
                        className="w-full btn-secondary text-red-400 border-red-500/20 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {voting === proposal.id ? t("dao.voting") : t("dao.voteAgainst")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {proposals.length === 0 && (
            <p className="text-amber-800 text-center py-8">No proposals yet.</p>
          )}
        </div>
      </div>
    </>
  );
}
