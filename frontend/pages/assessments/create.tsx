import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Layout from '../../components/Layout';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../utils/api';

export default function CreateAssessment() {
  const router = useRouter();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(15);
  const [questions, setQuestions] = useState([
    { type: 'multiple_choice', question: '', options: ['', ''], correctAnswer: 0 }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAddQuestion = () => {
    setQuestions([
      ...questions,
      { type: 'multiple_choice', question: '', options: ['', ''], correctAnswer: 0 }
    ]);
  };

  const handleQuestionChange = (index, field, value) => {
    const newQuestions = [...questions];
    newQuestions[index][field] = value;
    setQuestions(newQuestions);
  };

  const handleOptionChange = (qIndex, oIndex, value) => {
    const newQuestions = [...questions];
    newQuestions[qIndex].options[oIndex] = value;
    setQuestions(newQuestions);
  };

  const handleAddOption = (qIndex) => {
    const newQuestions = [...questions];
    newQuestions[qIndex].options.push('');
    setQuestions(newQuestions);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/api/assessments/project', {
        title,
        description,
        timeLimitMinutes: parseInt(timeLimitMinutes, 10),
        questions
      });

      if (response.data.success) {
        alert('Assessment created successfully!');
        router.push(`/assessments/project/${response.data.data.id}/results`);
      } else {
        setError('Failed to create assessment.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred while creating the assessment.');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return <Layout><div className="container mx-auto p-4">Please log in to create assessments.</div></Layout>;
  }

  return (
    <Layout>
      <Head>
        <title>Create Project Assessment</title>
      </Head>
      <div className="container mx-auto p-4 max-w-3xl">
        <h1 className="text-3xl font-bold mb-6">Create Project Assessment</h1>
        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Assessment Title</label>
            <input 
              type="text" 
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              value={title} 
              onChange={e => setTitle(e.target.value)} 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              rows={3}
              value={description} 
              onChange={e => setDescription(e.target.value)} 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Time Limit (Minutes)</label>
            <input 
              type="number" 
              required
              min={1}
              className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm p-2 border"
              value={timeLimitMinutes} 
              onChange={e => setTimeLimitMinutes(e.target.value)} 
            />
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold border-b pb-2">Questions</h2>
            {questions.map((q, qIndex) => (
              <div key={qIndex} className="bg-gray-50 p-4 rounded-md border">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">Question {qIndex + 1}</span>
                  {questions.length > 1 && (
                    <button 
                      type="button" 
                      className="text-red-500 text-sm hover:underline"
                      onClick={() => setQuestions(questions.filter((_, i) => i !== qIndex))}
                    >
                      Remove
                    </button>
                  )}
                </div>
                
                <input 
                  type="text" 
                  placeholder="Question text"
                  required
                  className="block w-full rounded-md border-gray-300 shadow-sm p-2 border mb-3"
                  value={q.question} 
                  onChange={e => handleQuestionChange(qIndex, 'question', e.target.value)} 
                />

                <div className="space-y-2 ml-4">
                  {q.options.map((opt, oIndex) => (
                    <div key={oIndex} className="flex items-center space-x-2">
                      <input 
                        type="radio" 
                        name={`correct-${qIndex}`} 
                        checked={q.correctAnswer === oIndex}
                        onChange={() => handleQuestionChange(qIndex, 'correctAnswer', oIndex)}
                      />
                      <input 
                        type="text" 
                        placeholder={`Option ${oIndex + 1}`}
                        required
                        className="block w-full rounded-md border-gray-300 shadow-sm p-2 border"
                        value={opt} 
                        onChange={e => handleOptionChange(qIndex, oIndex, e.target.value)} 
                      />
                      {q.options.length > 2 && (
                        <button 
                          type="button" 
                          className="text-red-500 hover:text-red-700"
                          onClick={() => {
                            const newQs = [...questions];
                            newQs[qIndex].options = newQs[qIndex].options.filter((_, i) => i !== oIndex);
                            if (newQs[qIndex].correctAnswer >= newQs[qIndex].options.length) {
                              newQs[qIndex].correctAnswer = 0;
                            }
                            setQuestions(newQs);
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button 
                    type="button"
                    className="text-blue-500 text-sm mt-2 hover:underline"
                    onClick={() => handleAddOption(qIndex)}
                  >
                    + Add Option
                  </button>
                </div>
              </div>
            ))}
            
            <button 
              type="button" 
              className="bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300"
              onClick={handleAddQuestion}
            >
              Add Question
            </button>
          </div>

          <div className="pt-4 border-t">
            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Assessment'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
