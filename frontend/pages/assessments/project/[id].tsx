import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { api, getApiErrorMessage } from "@/lib/api/client";
import { useToast } from "@/components/Toast";

interface AssessmentQuestion {
  question: string;
  options: string[];
}

interface ProjectAssessment {
  id: string;
  title: string;
  description?: string;
  time_limit_minutes: number;
  questions: AssessmentQuestion[];
}

interface AssessmentSubmission {
  status: "started" | "submitted" | "graded";
  started_at: string;
}

interface TakeAssessmentProps {
  publicKey: string | null;
}

export default function TakeAssessment({ publicKey }: TakeAssessmentProps) {
  const router = useRouter();
  const toast = useToast();
  const { id } = router.query;

  const [assessment, setAssessment] = useState<ProjectAssessment | null>(null);
  const [submission, setSubmission] = useState<AssessmentSubmission | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (id && publicKey) {
      fetchAssessment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, publicKey]);

  const fetchAssessment = async () => {
    try {
      const response = await api.get(`/api/assessments/project/${id}`);
      if (response.data.success) {
        setAssessment(response.data.data.assessment);
        setSubmission(response.data.data.submission);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load assessment'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (assessment && submission && submission.status === 'started') {
      const timeLimitMs = assessment.time_limit_minutes * 60 * 1000;
      const startedAt = new Date(submission.started_at).getTime();
      
      const updateTimer = () => {
        const now = Date.now();
        const elapsed = now - startedAt;
        const remaining = timeLimitMs - elapsed;
        
        if (remaining <= 0) {
          setTimeLeft(0);
          if (timerRef.current) clearInterval(timerRef.current);
          handleAutoSubmit();
        } else {
          setTimeLeft(Math.ceil(remaining / 1000));
        }
      };
      
      updateTimer();
      timerRef.current = setInterval(updateTimer, 1000);
      
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
  }, [assessment, submission]);

  const handleAutoSubmit = async () => {
    // Only auto-submit if we haven't already submitted
    if (!submitting) {
      await submitAnswers();
    }
  };

  const submitAnswers = async () => {
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post(`/api/assessments/project/${id}/submit`, {
        answers
      });
      if (response.data.success) {
        toast.success('Assessment submitted successfully!');
        router.push('/dashboard');
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to submit assessment'));
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitAnswers();
  };

  const handleOptionChange = (qIndex: number, optionIndex: number) => {
    setAnswers({
      ...answers,
      [qIndex]: optionIndex
    });
  };

  const formatTime = (seconds: number | null) => {
    if (seconds === null) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!publicKey) return <><div className="container mx-auto p-4">Connect your wallet to take this assessment.</div></>;
  if (loading) return <><div className="container mx-auto p-4">Loading...</div></>;
  if (error && !assessment) return <><div className="container mx-auto p-4 text-red-500">{error}</div></>;

  return (
    <>
      <Head>
        <title>{assessment?.title || 'Project Assessment'}</title>
      </Head>
      <div className="container mx-auto p-4 max-w-3xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">{assessment?.title}</h1>
          {submission?.status === 'started' && (
            <div className={`text-xl font-mono p-2 rounded ${timeLeft !== null && timeLeft < 60 ? 'bg-red-100 text-red-700' : 'bg-gray-100'}`}>
              Time Left: {formatTime(timeLeft)}
            </div>
          )}
        </div>
        
        {assessment?.description && (
          <p className="text-gray-600 mb-8 pb-4 border-b">{assessment.description}</p>
        )}
        
        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}

        {submission?.status === 'started' ? (
          <form onSubmit={handleSubmit} className="space-y-8">
            {(assessment?.questions ?? []).map((q, qIndex) => (
              <div key={qIndex} className="bg-white p-6 rounded-lg shadow-sm border">
                <h3 className="text-lg font-medium mb-4">{qIndex + 1}. {q.question}</h3>
                <div className="space-y-3">
                  {q.options.map((opt, oIndex) => (
                    <label key={oIndex} className="flex items-center space-x-3 p-3 border rounded hover:bg-gray-50 cursor-pointer">
                      <input 
                        type="radio" 
                        name={`question-${qIndex}`}
                        className="h-4 w-4 text-blue-600"
                        checked={answers[qIndex] === oIndex}
                        onChange={() => handleOptionChange(qIndex, oIndex)}
                        required
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            
            <button 
              type="submit" 
              disabled={submitting}
              className="w-full bg-blue-600 text-white font-bold py-4 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Assessment'}
            </button>
          </form>
        ) : (
          <div className="bg-blue-50 text-blue-800 p-6 rounded-lg text-center">
            <h2 className="text-2xl font-bold mb-2">Assessment Completed</h2>
            <p>You have already submitted this assessment. Thank you!</p>
          </div>
        )}
      </div>
    </>
  );
}
