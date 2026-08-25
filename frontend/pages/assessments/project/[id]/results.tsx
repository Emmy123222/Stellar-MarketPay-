import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { api, getApiErrorMessage } from "@/lib/api/client";
import { useToast } from "@/components/Toast";

interface AssessmentResult {
  id: string;
  display_name?: string;
  freelancer_address: string;
  status: "started" | "submitted" | "graded";
  score: number | null;
  started_at: string;
  submitted_at?: string | null;
}

interface AssessmentResultsProps {
  publicKey: string | null;
}

export default function AssessmentResults({ publicKey }: AssessmentResultsProps) {
  const router = useRouter();
  const toast = useToast();
  const { id } = router.query;

  const [results, setResults] = useState<AssessmentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id && publicKey) {
      fetchResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, publicKey]);

  const fetchResults = async () => {
    try {
      const response = await api.get(`/api/assessments/project/${id}/results`);
      if (response.data.success) {
        setResults(response.data.data);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load results'));
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) return <><div className="container mx-auto p-4">Connect your wallet to view results.</div></>;
  if (loading) return <><div className="container mx-auto p-4">Loading...</div></>;

  return (
    <>
      <Head>
        <title>Assessment Results</title>
      </Head>
      <div className="container mx-auto p-4 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Assessment Results</h1>
          <button 
            onClick={() => {
              // Copy link to clipboard
              const link = `${window.location.origin}/assessments/project/${id}`;
              navigator.clipboard.writeText(link);
              toast.success('Assessment link copied to clipboard! Send this to freelancers.');
            }}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Copy Link to Send
          </button>
        </div>
        
        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}

        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          {results.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No one has submitted this assessment yet.
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {results.map((submission) => (
                <li key={submission.id} className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-medium text-blue-600">{submission.display_name}</h3>
                      <p className="text-sm text-gray-500 text-mono">{submission.freelancer_address}</p>
                    </div>
                    <div className="text-right">
                      {submission.status === 'started' ? (
                        <span className="px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                          In Progress
                        </span>
                      ) : (
                        <div>
                          <span className="px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full bg-green-100 text-green-800 mb-1">
                            Submitted
                          </span>
                          <div className="text-xl font-bold">
                            Score: {submission.score !== null ? `${submission.score}%` : 'Pending'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-500">
                    Started: {new Date(submission.started_at).toLocaleString()}
                    {submission.submitted_at && ` • Submitted: ${new Date(submission.submitted_at).toLocaleString()}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
