/**
 * pages/dao.tsx
 * DAO governance page for platform decisions and treasury management
 */
import { useState, useEffect } from "react";
import WalletConnect from "@/components/WalletConnect";
import { getXLMBalance, submitTransaction } from "@/lib/stellar";
import { formatXLM, shortenAddress } from "@/utils/format";
import { useToast } from "@/components/Toast";
import type { UserProfile } from "@/utils/types";

interface Proposal {
  id: string;
  title: string;
  description: string;
  type: "treasury" | "platform" | "parameter";
  proposer: string;
  amount?: string;
  recipient?: string;
  votesFor: number;
  votesAgainst: number;
  status: "active" | "passed" | "rejected" | "executed";
  createdAt: string;
  endsAt: string;
}

interface DAOProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function DAO({ publicKey, onConnect }: DAOProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);
  const [showNewProposal, setShowNewProposal] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const toast = useToast();

  // Mock proposals data - in real implementation, this would come from the backend
  const mockProposals: Proposal[] = [
    {
      id: "1",
      title: "Reduce platform fee from 3% to 2%",
      description: "Lower the platform fee to make the marketplace more competitive and attract more users.",
      type: "parameter",
      proposer: "GDQY...PROPOSER",
      votesFor: 125,
      votesAgainst: 45,
      status: "active",
      createdAt: "2024-01-15T10:00:00Z",
      endsAt: "2024-01-22T10:00:00Z",
    },
    {
      id: "2",
      title: "Fund community marketing campaign",
      description: "Allocate 10,000 XLM from treasury for marketing initiatives to grow the platform.",
      type: "treasury",
      proposer: "GDQY...PROPOSER",
      amount: "10000",
      recipient: "GDQY...MARKETING",
      votesFor: 89,
      votesAgainst: 12,
      status: "passed",
      createdAt: "2024-01-10T10:00:00Z",
      endsAt: "2024-01-17T10:00:00Z",
    },
    {
      id: "3",
      title: "Add milestone payments feature",
      description: "Implement milestone-based payments for larger projects to improve security for both clients and freelancers.",
      type: "platform",
      proposer: "GDQY...PROPOSER",
      votesFor: 156,
      votesAgainst: 23,
      status: "executed",
      createdAt: "2024-01-05T10:00:00Z",
      endsAt: "2024-01-12T10:00:00Z",
    },
  ];

  useEffect(() => {
    // Load proposals
    setProposals(mockProposals);
    setLoading(false);
    
    // Load treasury balance
    if (publicKey) {
      getXLMBalance(publicKey).then(setBalance).catch(console.error);
    }
  }, [publicKey]);

  const handleVote = async (proposalId: string, support: boolean) => {
    if (!publicKey) return;
    
    setVoting(proposalId);
    try {
      // In real implementation, this would call the DAO contract
      toast.success(support ? "Voted in favor!" : "Voted against!");
      
      // Update local state
      setProposals(prev => prev.map(p => 
        p.id === proposalId 
          ? { ...p, votesFor: support ? p.votesFor + 1 : p.votesFor, votesAgainst: !support ? p.votesAgainst + 1 : p.votesAgainst }
          : p
      ));
    } catch (error) {
      toast.error("Failed to vote. Please try again.");
    } finally {
      setVoting(null);
    }
  };

  const getStatusColor = (status: Proposal['status']) => {
    switch (status) {
      case 'active': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'passed': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'rejected': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'executed': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      default: return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    }
  };

  const getTypeLabel = (type: Proposal['type']) => {
    switch (type) {
      case 'treasury': return 'Treasury';
      case 'platform': return 'Platform';
      case 'parameter': return 'Parameter';
      default: return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        <div className="h-8 bg-market-500/8 rounded w-2/3 mb-4" />
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-32 bg-market-500/8 rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-amber-100 mb-4">DAO Governance</h1>
        <p className="text-amber-700 text-lg">
          Participate in platform governance and help shape the future of Stellar MarketPay.
        </p>
      </div>

      {!publicKey ? (
        <div className="card text-center py-8 mb-8">
          <p className="text-amber-800 text-sm mb-4">Connect your wallet to participate in DAO governance</p>
          <WalletConnect onConnect={onConnect} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card">
            <h3 className="font-display text-lg font-semibold text-amber-300 mb-2">Treasury Balance</h3>
            <p className="font-mono font-bold text-2xl text-market-400">
              {balance ? formatXLM(balance) : "Loading..."}
            </p>
          </div>
          <div className="card">
            <h3 className="font-display text-lg font-semibold text-amber-300 mb-2">Active Proposals</h3>
            <p className="font-mono font-bold text-2xl text-market-400">
              {proposals.filter(p => p.status === 'active').length}
            </p>
          </div>
          <div className="card">
            <h3 className="font-display text-lg font-semibold text-amber-300 mb-2">Your Voting Power</h3>
            <p className="font-mono font-bold text-2xl text-market-400">1</p>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h2 className="font-display text-2xl font-bold text-amber-100">Proposals</h2>
        {publicKey && (
          <button
            onClick={() => setShowNewProposal(true)}
            className="btn-primary"
          >
            Create Proposal
          </button>
        )}
      </div>

      <div className="space-y-6">
        {proposals.map((proposal) => (
          <div key={proposal.id} className="card">
            <div className="flex flex-col lg:flex-row lg:items-start gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full border ${getStatusColor(proposal.status)}`}>
                    {proposal.status.toUpperCase()}
                  </span>
                  <span className="text-xs text-amber-800 bg-ink-700 px-2.5 py-1 rounded-full border border-market-500/10">
                    {getTypeLabel(proposal.type)}
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
                  <div className="mb-4">
                    <span className="text-sm text-amber-800">Amount: </span>
                    <span className="font-mono font-semibold text-market-400 ml-2">
                      {formatXLM(proposal.amount)}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap gap-4 text-xs text-amber-800">
                  <span>Created: {new Date(proposal.createdAt).toLocaleDateString()}</span>
                  <span>Ends: {new Date(proposal.endsAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="lg:w-64">
                <div className="text-center mb-4">
                  <div className="text-sm text-amber-800 mb-2">Voting Results</div>
                  <div className="flex justify-center gap-6 mb-4">
                    <div className="text-center">
                      <div className="font-mono font-bold text-2xl text-green-400">{proposal.votesFor}</div>
                      <div className="text-xs text-amber-800">For</div>
                    </div>
                    <div className="text-center">
                      <div className="font-mono font-bold text-2xl text-red-400">{proposal.votesAgainst}</div>
                      <div className="text-xs text-amber-800">Against</div>
                    </div>
                  </div>
                </div>

                {publicKey && proposal.status === 'active' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => handleVote(proposal.id, true)}
                      disabled={voting === proposal.id}
                      className="w-full btn-secondary text-green-400 border-green-500/20 hover:bg-green-500/10 disabled:opacity-50"
                    >
                      {voting === proposal.id ? 'Voting...' : 'Vote For'}
                    </button>
                    <button
                      onClick={() => handleVote(proposal.id, false)}
                      disabled={voting === proposal.id}
                      className="w-full btn-secondary text-red-400 border-red-500/20 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {voting === proposal.id ? 'Voting...' : 'Vote Against'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
