/**
 * pages/post-job.tsx
 */
import WalletConnect from "@/components/WalletConnect";
import PostJobForm from "@/components/PostJobForm";

interface PostJobProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function PostJob({ publicKey, onConnect }: PostJobProps) {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      {!publicKey ? (
        <div>
          <div className="text-center mb-10">
            <h1 className="font-display text-3xl font-bold text-amber-100 mb-3">Post a Job</h1>
            <p className="text-amber-800">Connect your wallet to post a job and lock the budget in escrow</p>
          </div>
          <WalletConnect onConnect={onConnect} />
        </div>
      ) : (
        <PostJobForm publicKey={publicKey} />
      )}
    </div>
  );
}
