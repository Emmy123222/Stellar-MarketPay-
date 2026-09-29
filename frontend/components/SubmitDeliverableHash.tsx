import { useState } from "react";
import { submitDeliverableHash } from "@/lib/api/escrow";

export default function SubmitDeliverableHash({ jobId, freelancerAddress }: { jobId: string; freelancerAddress: string }) {
  const [hash, setHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
      setError("Hash must be a 64-character hex string (SHA-256)");
      return;
    }

    setLoading(true);
    try {
      await submitDeliverableHash(jobId, freelancerAddress, hash);
      setSuccess(true);
      setHash("");
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to submit hash");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card mb-6 border border-amber-900/30">
      <h2 className="font-display text-lg font-bold text-amber-100 mb-2">Submit Deliverable Hash</h2>
      <p className="text-sm text-amber-700/80 mb-4">
        If this escrow requires a deliverable hash for release, submit the SHA-256 hash of your work here.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="e.g. 5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
          className="input bg-ink-950/40"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          disabled={loading || success}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        {success && <p className="text-xs text-emerald-500">Hash submitted successfully!</p>}
        <button
          type="submit"
          className="btn-primary w-fit"
          disabled={loading || success || !hash}
        >
          {loading ? "Submitting..." : "Submit Hash"}
        </button>
      </form>
    </div>
  );
}
