/**
 * pages/assessments/[skill].tsx
 * Timed multiple-choice skill assessment quiz.
 * 15 minutes · 10 questions · 70% to pass · 30-day cooldown
 */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { fetchAssessment, submitAssessment } from "@/lib/api";
import WalletConnect from "@/components/WalletConnect";
import type { AssessmentQuestion } from "@/utils/types";

interface Props {
  publicKey: string | null;
  onConnect: () => void;
}

type Phase =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "cooldown"; retakeAt: string; lastScore: number; passed: boolean }
  | { name: "intro"; label: string; questionCount: number; durationSeconds: number }
  | { name: "quiz"; label: string; questions: AssessmentQuestion[]; durationSeconds: number }
  | { name: "result"; score: number; passed: boolean; correct: number; total: number };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function AssessmentPage({ publicKey, onConnect }: Props) {
  const router = useRouter();
  const skill  = typeof router.query.skill === "string" ? router.query.skill : "";

  const [phase, setPhase]       = useState<Phase>({ name: "loading" });
  const [answers, setAnswers]   = useState<Record<number, number>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef                = useRef<ReturnType<typeof setInterval> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load assessment info
  useEffect(() => {
    if (!router.isReady || !skill) return;
    if (!publicKey) {
      setPhase({ name: "loading" }); // will show wallet prompt below
      return;
    }

    (async () => {
      try {
        const data = await fetchAssessment(skill);
        if (!data.canRetake && data.retakeAvailableAt) {
          setPhase({
            name: "cooldown",
            retakeAt: data.retakeAvailableAt,
            lastScore: data.lastAttempt?.score ?? 0,
            passed: data.lastAttempt?.passed ?? false,
          });
          return;
        }
        setPhase({
          name: "intro",
          label: data.label,
          questionCount: data.questions.length,
          durationSeconds: data.durationSeconds,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load assessment.";
        setPhase({ name: "error", message: msg });
      }
    })();
  }, [router.isReady, skill, publicKey]);

  // Timer
  useEffect(() => {
    if (phase.name !== "quiz") return;
    setTimeLeft(phase.durationSeconds);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current!);
          doSubmit();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.name]);

  async function doSubmit() {
    if (phase.name !== "quiz") return;
    clearInterval(timerRef.current!);
    setSubmitting(true);
    try {
      const result = await submitAssessment(skill, answers);
      setPhase({ name: "result", ...result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Submission failed.";
      setPhase({ name: "error", message: msg });
    } finally {
      setSubmitting(false);
    }
  }

  function startQuiz() {
    if (phase.name !== "intro") return;
    (async () => {
      try {
        const data = await fetchAssessment(skill);
        setAnswers({});
        setPhase({ name: "quiz", label: data.label, questions: data.questions, durationSeconds: data.durationSeconds });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to start quiz.";
        setPhase({ name: "error", message: msg });
      }
    })();
  }

  const pageTitle =
    phase.name === "quiz" || phase.name === "intro"
      ? `${phase.label} Assessment · MarketPay`
      : "Skill Assessment · MarketPay";

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content="Verify your skills with a timed quiz on Stellar MarketPay." />
      </Head>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 animate-fade-in">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6"
        >
          ← Back to Dashboard
        </Link>

        {/* Wallet not connected */}
        {!publicKey && (
          <div className="card border-market-500/20 text-center py-12">
            <p className="font-display text-xl text-amber-100 mb-4">Connect your wallet to take an assessment</p>
            <WalletConnect onConnect={onConnect} />
          </div>
        )}

        {/* Loading */}
        {publicKey && phase.name === "loading" && (
          <div className="card space-y-4 animate-pulse">
            <div className="h-8 bg-market-500/10 rounded w-1/2" />
            <div className="h-4 bg-market-500/8 rounded w-3/4" />
          </div>
        )}

        {/* Error */}
        {phase.name === "error" && (
          <div className="card border-red-500/20 text-center py-12">
            <p className="font-display text-xl text-amber-100 mb-2">Something went wrong</p>
            <p className="text-red-400/90 text-sm">{phase.message}</p>
          </div>
        )}

        {/* Cooldown */}
        {phase.name === "cooldown" && (
          <div className="card border-amber-500/20 text-center py-12">
            <p className="text-4xl mb-4">⏳</p>
            <p className="font-display text-xl text-amber-100 mb-2">Assessment cooldown active</p>
            <p className="text-amber-700/90 text-sm mb-4">
              Your last score was{" "}
              <span className={phase.passed ? "text-emerald-400" : "text-red-400"}>
                {phase.lastScore}%
              </span>{" "}
              ({phase.passed ? "Passed ✓" : "Failed"}).
            </p>
            <p className="text-amber-800 text-sm">
              You can retake this assessment after{" "}
              <span className="text-amber-300">
                {new Date(phase.retakeAt).toLocaleDateString(undefined, {
                  year: "numeric", month: "long", day: "numeric",
                })}
              </span>
              .
            </p>
          </div>
        )}

        {/* Intro */}
        {phase.name === "intro" && (
          <div className="card border-market-500/15">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 mb-2">
              {phase.label} Assessment
            </h1>
            <p className="text-amber-700/90 text-sm mb-6">
              Earn a verified badge on your profile by passing this quiz.
            </p>
            <ul className="space-y-2 mb-8 text-sm text-amber-700/90">
              <li>📋 {phase.questionCount} multiple-choice questions</li>
              <li>⏱ {phase.durationSeconds / 60} minutes to complete</li>
              <li>✅ Passing score: 70% or above</li>
              <li>🔁 Can be retaken after 30 days</li>
            </ul>
            <button onClick={startQuiz} className="btn-primary w-full sm:w-auto">
              Start Assessment
            </button>
          </div>
        )}

        {/* Quiz */}
        {phase.name === "quiz" && (
          <div className="space-y-6">
            {/* Timer header */}
            <div className="card border-market-500/15 flex items-center justify-between gap-4 py-3 px-4">
              <p className="font-display text-lg font-bold text-amber-100">{phase.label}</p>
              <div
                className={`font-mono text-lg font-bold tabular-nums ${
                  timeLeft <= 60 ? "text-red-400" : "text-market-400"
                }`}
                aria-live="polite"
                aria-label={`Time remaining: ${pad(Math.floor(timeLeft / 60))} minutes ${pad(timeLeft % 60)} seconds`}
              >
                {pad(Math.floor(timeLeft / 60))}:{pad(timeLeft % 60)}
              </div>
            </div>

            {/* Questions */}
            {phase.questions.map((q, idx) => (
              <div key={q.id} className="card border-market-500/10">
                <p className="text-xs uppercase tracking-widest text-market-300/70 mb-2">
                  Question {idx + 1} of {phase.questions.length}
                </p>
                <p className="text-amber-100 font-medium mb-4">{q.question}</p>
                <ul className="space-y-2">
                  {q.options.map((opt, optIdx) => {
                    const selected = answers[q.id] === optIdx;
                    return (
                      <li key={optIdx}>
                        <button
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: optIdx }))}
                          className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                            selected
                              ? "border-market-400/60 bg-market-500/15 text-market-300"
                              : "border-market-500/15 bg-ink-900/40 text-amber-700/90 hover:border-market-400/30 hover:bg-market-500/8"
                          }`}
                          aria-pressed={selected}
                        >
                          <span className="font-mono text-xs mr-2 text-market-300/60">
                            {String.fromCharCode(65 + optIdx)}.
                          </span>
                          {opt}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {/* Submit */}
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-amber-800">
                {Object.keys(answers).length} / {phase.questions.length} answered
              </p>
              <button
                onClick={() => doSubmit()}
                disabled={submitting}
                className="btn-primary disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit Assessment"}
              </button>
            </div>
          </div>
        )}

        {/* Result */}
        {phase.name === "result" && (
          <div className={`card text-center py-12 ${phase.passed ? "border-emerald-500/20" : "border-red-500/20"}`}>
            <p className="text-5xl mb-4">{phase.passed ? "🏆" : "📚"}</p>
            <h1 className="font-display text-2xl font-bold text-amber-100 mb-2">
              {phase.passed ? "Assessment Passed!" : "Not quite there"}
            </h1>
            <p className={`text-4xl font-bold font-display mb-2 ${phase.passed ? "text-emerald-400" : "text-red-400"}`}>
              {phase.score}%
            </p>
            <p className="text-amber-700/90 text-sm mb-6">
              {phase.correct} / {phase.total} correct ·{" "}
              {phase.passed
                ? "A verified badge has been added to your profile."
                : "You need 70% to pass. You can retake this in 30 days."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {publicKey && (
                <Link href={`/freelancers/${publicKey}`} className="btn-primary text-sm">
                  View My Profile
                </Link>
              )}
              <Link href="/dashboard" className="btn-secondary text-sm">
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
