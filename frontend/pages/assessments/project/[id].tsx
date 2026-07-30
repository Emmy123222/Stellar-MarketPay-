import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Layout from '../../../components/Layout';
import { useAuth } from '../../../contexts/AuthContext';
import api from '../../../utils/api';

export default function TakeAssessment() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  
  const [assessment, setAssessment] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (id && user) {
      fetchAssessment();
    }
  }, [id, user]);

  const fetchAssessment = async () => {
    try {
      const response = await api.get(`/api/assessments/project/${id}`);
      if (response.data.success) {
        setAssessment(response.data.data.assessment);
        setSubmission(response.data.data.submission);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load assessment');
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
          clearInterval(timerRef.current);
          handleAutoSubmit();
        } else {
          setTimeLeft(Math.ceil(remaining / 1000));
        }
      };
      
      updateTimer();
      timerRef.current = setInterval(updateTimer, 1000);
      
      return () => clearInterval(timerRef.current);
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
        alert('Assessment submitted successfully!');
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit assessment');
      setSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitAnswers();
  };

  const handleOptionChange = (qIndex, optionIndex) => {
    setAnswers({
      ...answers,
      [qIndex]: optionIndex
    });
  };

  const formatTime = (seconds) => {
    if (seconds === null) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!user) return <Layout><div className="container mx-auto p-4">Please log in.</div></Layout>;
  if (loading) return <Layout><div className="container mx-auto p-4">Loading...</div></Layout>;
  if (error && !assessment) return <Layout><div className="container mx-auto p-4 text-red-500">{error}</div></Layout>;

  return (
    <Layout>
      <Head>
        <title>{assessment?.title || 'Project Assessment'}</title>
      </Head>
      <div className="container mx-auto p-4 max-w-3xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">{assessment?.title}</h1>
          {submission?.status === 'started' && (
            <div className={`text-xl font-mono p-2 rounded ${timeLeft < 60 ? 'bg-red-100 text-red-700' : 'bg-gray-100'}`}>
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
            {assessment.questions.map((q, qIndex) => (
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
    </Layout>
  );
}
