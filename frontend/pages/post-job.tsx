/**
 * pages/post-job.tsx
 */
import { useRouter } from "next/router";
import WalletConnect from "@/components/WalletConnect";
import PostJobForm from "@/components/PostJobForm";
import Link from "next/link";

interface PostJobProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function PostJob({ publicKey, onConnect }: PostJobProps) {
  const router = useRouter();

  const category =
    typeof router.query.category === "string" ? router.query.category : "";

  const suggestedFreelancer =
    typeof router.query.freelancer === "string" ? router.query.freelancer : "";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      {!publicKey ? (
        <div>
          <div className="text-center mb-10">
            <h1 className="font-display text-3xl font-bold text-amber-100 mb-3">
              Post a Job
            </h1>
            <p className="text-amber-800">
              Connect your wallet to post a job and lock the budget in escrow
            </p>
          </div>
          <WalletConnect onConnect={onConnect} />
        </div>
      ) : (
        <PostJobForm
          publicKey={publicKey}
          initialCategory={category}
          suggestedFreelancer={suggestedFreelancer}
        />
      )}
    </div>
  );
}