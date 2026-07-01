import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useOnboarding } from "@/hooks/useOnboarding";

const steps = [
  { id: "connect-wallet", title: "Connect Wallet", body: "Secure your account with a Stellar wallet before hiring or applying.", action: "Connect wallet" },
  { id: "complete-profile", title: "Complete Profile", body: "Add your name, bio, skills, and availability so clients can trust your profile.", action: "Edit profile" },
  { id: "browse-jobs", title: "Browse Jobs", body: "Explore open work and save opportunities that match your skills.", action: "Browse jobs" },
  { id: "post-first-job", title: "Post First Job", body: "Create a scoped job with budget, milestones, and screening questions.", action: "Post a job" },
  { id: "learn-escrow", title: "Learn Escrow", body: "MarketPay locks funds in escrow and releases payment when work is approved.", action: "Finish" },
];

function DemoJobCard() {
  return (
    <div className="mt-5 rounded-2xl border border-market-500/30 bg-ink-800/80 p-4 shadow-lg" aria-label="Demo job card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-amber-500">Demo job</p>
          <h3 className="mt-1 font-display text-xl text-amber-100">Build a Stellar escrow dashboard</h3>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">Open</span>
      </div>
      <p className="mt-3 text-sm text-amber-300">Interactive preview: review budget, skills, and actions before opening a real listing.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {['Next.js', 'Soroban', 'Wallet UX'].map((skill) => <span key={skill} className="rounded-full bg-market-500/10 px-3 py-1 text-xs text-amber-200">{skill}</span>)}
      </div>
      <button className="btn-secondary mt-4 w-full" type="button">Preview application flow</button>
    </div>
  );
}

export default function OnboardingWizard({ publicKey, onConnect }: { publicKey: string | null; onConnect: () => Promise<void> }) {
  const router = useRouter();
  const { onboardingState, shouldShowWizard, saveOnboardingState } = useOnboarding(publicKey);
  const [celebrate, setCelebrate] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const currentIndex = Math.min(onboardingState.wizardCurrentStep, steps.length - 1);
  const step = steps[currentIndex];

  useEffect(() => {
    if (!shouldShowWizard) return;
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button,[href],input,[tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previous?.focus?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowWizard]);

  if (!shouldShowWizard) return null;

  function persist(nextIndex: number, completed = false, dismissed = false) {
    const completedSteps = Array.from(new Set([...onboardingState.wizardCompletedSteps, step.id]));
    saveOnboardingState({ wizardCurrentStep: nextIndex, wizardCompletedSteps: completedSteps, wizardCompleted: completed, wizardDismissed: dismissed, hasSeenWelcome: true });
  }

  function dismiss() { saveOnboardingState({ wizardDismissed: true, hasSeenWelcome: true }); }
  function resumeLater() { dismiss(); }
  async function primary() {
    if (step.id === "connect-wallet" && !publicKey) await onConnect();
    if (step.id === "complete-profile") router.push("/dashboard?tab=edit_profile");
    if (step.id === "browse-jobs") router.push("/jobs");
    if (step.id === "post-first-job") router.push("/post-job");
    if (currentIndex === steps.length - 1) {
      setCelebrate(true);
      window.setTimeout(() => saveOnboardingState({ wizardCompleted: true, wizardDismissed: false, hasSeenWelcome: true, checklistDismissed: true }), 900);
      return;
    }
    persist(currentIndex + 1);
  }
  function skip() {
    if (currentIndex === steps.length - 1) primary();
    else persist(currentIndex + 1);
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="onboarding-wizard-title">
      <div ref={dialogRef} className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-market-500/30 bg-ink-900 p-6 shadow-2xl">
        {celebrate && <div className="pointer-events-none absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_20%_20%,rgba(251,191,36,.35),transparent_20%),radial-gradient(circle_at_80%_30%,rgba(16,185,129,.3),transparent_18%),radial-gradient(circle_at_50%_80%,rgba(59,130,246,.3),transparent_22%)]" aria-hidden="true" />}
        <div className="relative">
          <p className="text-sm font-semibold text-amber-400">Step {currentIndex + 1} of {steps.length}</p>
          <div className="mt-3 flex gap-2" aria-hidden="true">{steps.map((item, index) => <span key={item.id} className={`h-2 flex-1 rounded-full ${index <= currentIndex ? "bg-market-500" : "bg-ink-700"}`} />)}</div>
          <h2 id="onboarding-wizard-title" className="mt-6 font-display text-3xl text-amber-100">{step.title}</h2>
          <p className="mt-3 text-amber-300">{step.body}</p>
          {step.id === "browse-jobs" && <DemoJobCard />}
          {step.id === "learn-escrow" && <div className="mt-5 rounded-2xl bg-market-500/10 p-4 text-sm text-amber-200">Funds move from client wallet → escrow contract → freelancer after approval, with dispute controls if something goes wrong.</div>}
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={resumeLater} className="text-sm font-medium text-amber-400 hover:text-amber-200">Dismiss and resume later</button>
            <div className="flex gap-3">
              <button type="button" onClick={skip} className="btn-secondary">Skip</button>
              <button type="button" onClick={primary} className="btn-primary">{step.action}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
