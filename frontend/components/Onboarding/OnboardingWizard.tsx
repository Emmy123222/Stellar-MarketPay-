import { useEffect, useRef, useState } from "react";
import { useOnboarding } from "@/hooks/useOnboarding";
import { upsertProfile } from "@/lib/api";
import type { UserRole } from "@/utils/types";

const steps = [
  { id: "connect-wallet", title: "Connect Wallet", subtitle: "Connect your Stellar wallet to get started" },
  { id: "choose-role", title: "Choose Your Role", subtitle: "Tell us how you want to use MarketPay" },
  { id: "complete-profile", title: "Complete Profile", subtitle: "Add a few details to help others find you" },
];

const roleOptions: { value: UserRole; icon: string; desc: string }[] = [
  { value: "freelancer", icon: "💼", desc: "Find work and apply to jobs" },
  { value: "client", icon: "📋", desc: "Hire freelancers and post jobs" },
  { value: "both", icon: "🤝", desc: "Do both — hire and find work" },
];

export default function OnboardingWizard({ publicKey, onConnect }: { publicKey: string | null; onConnect: () => Promise<void> }) {
  const { onboardingState, shouldShowWizard, saveOnboardingState } = useOnboarding(publicKey);
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const currentIndex = Math.min(onboardingState.wizardCurrentStep, steps.length - 1);
  const step = steps[currentIndex];
  const isLastStep = currentIndex === steps.length - 1;

  useEffect(() => {
    if (!shouldShowWizard) return;
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button,select")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button,[href],input,select,[tabindex]:not([tabindex="-1"])');
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
    saveOnboardingState({
      wizardCurrentStep: nextIndex,
      wizardCompletedSteps: completedSteps,
      wizardCompleted: completed,
      wizardDismissed: dismissed,
      hasSeenWelcome: true,
    });
  }

  function dismiss() {
    saveOnboardingState({ wizardDismissed: true, hasSeenWelcome: true });
  }

  async function handlePrimary() {
    if (step.id === "connect-wallet") {
      if (!publicKey) {
        setConnecting(true);
        try {
          await onConnect();
        } finally {
          setConnecting(false);
        }
      }
      persist(currentIndex + 1);
    } else if (step.id === "choose-role") {
      if (publicKey && selectedRole) {
        setSaving(true);
        try {
          await upsertProfile({ publicKey, role: selectedRole });
        } finally {
          setSaving(false);
        }
      }
      persist(currentIndex + 1);
    } else {
      if (publicKey && (displayName || bio)) {
        setSaving(true);
        try {
          await upsertProfile({
            publicKey,
            ...(displayName ? { displayName } : {}),
            ...(bio ? { bio } : {}),
          });
        } finally {
          setSaving(false);
        }
      }
      setShowSuccess(true);
      setTimeout(() => saveOnboardingState({
        wizardCompleted: true,
        wizardDismissed: false,
        hasSeenWelcome: true,
        checklistDismissed: true,
      }), 1200);
    }
  }

  function handleSkip() {
    if (isLastStep) {
      handlePrimary();
    } else {
      persist(currentIndex + 1);
    }
  }

  function canProceed(): boolean {
    if (step.id === "choose-role") return selectedRole !== null;
    return true;
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="onboarding-wizard-title">
      <div ref={dialogRef} className="relative w-full max-w-lg rounded-3xl border border-market-500/30 bg-ink-900 p-6 shadow-2xl animate-scale-in">
        {showSuccess && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-900/90 rounded-3xl z-10 animate-fade-in">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4 animate-scale-in">
                <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="font-display text-2xl text-amber-100 font-semibold">All set!</p>
              <p className="text-amber-400 mt-2">You&apos;re ready to use MarketPay</p>
            </div>
          </div>
        )}

        <div className="relative">
          <p className="text-sm font-semibold text-amber-400">
            Step {currentIndex + 1} of {steps.length}
          </p>

          <div className="mt-3 flex gap-2" aria-hidden="true">
            {steps.map((item, index) => (
              <span
                key={item.id}
                className={`h-2 flex-1 rounded-full transition-colors duration-300 ${
                  index <= currentIndex ? "bg-market-500" : "bg-ink-700"
                }`}
              />
            ))}
          </div>

          <h2 id="onboarding-wizard-title" className="mt-6 font-display text-2xl sm:text-3xl text-amber-100">
            {step.title}
          </h2>
          <p className="mt-2 text-amber-400">{step.subtitle}</p>

          <div className="mt-6 space-y-4">
            {step.id === "connect-wallet" && (
              <div className="rounded-2xl border border-market-500/20 bg-ink-800/50 p-5">
                {publicKey ? (
                  <div className="flex items-center gap-3 text-emerald-400">
                    <svg className="w-6 h-6 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-medium">Wallet connected</span>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-amber-300 text-sm mb-4">
                      Connect your Stellar wallet to start using the platform
                    </p>
                    <button onClick={onConnect} disabled={connecting} className="btn-primary w-full sm:w-auto">
                      {connecting ? "Connecting..." : "Connect Wallet"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {step.id === "choose-role" && (
              <div className="space-y-3">
                {roleOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedRole(opt.value)}
                    type="button"
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                      selectedRole === opt.value
                        ? "bg-market-500/10 border-market-400"
                        : "bg-ink-800/50 border-market-500/20 hover:border-market-500/40"
                    }`}
                  >
                    <span className="text-2xl">{opt.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium capitalize ${
                        selectedRole === opt.value ? "text-market-300" : "text-amber-100"
                      }`}>
                        {opt.value === "both" ? "Both" : opt.value}
                      </p>
                      <p className="text-sm text-amber-500 mt-0.5">{opt.desc}</p>
                    </div>
                    {selectedRole === opt.value && (
                      <svg className="w-5 h-5 text-market-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}

            {step.id === "complete-profile" && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="wizard-display-name" className="block text-sm font-medium text-amber-200 mb-1.5">
                    Display Name
                  </label>
                  <input
                    id="wizard-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-ink-800 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 placeholder:text-amber-700 focus:outline-none focus:border-market-400 transition-colors"
                    maxLength={30}
                  />
                </div>
                <div>
                  <label htmlFor="wizard-bio" className="block text-sm font-medium text-amber-200 mb-1.5">
                    Bio
                  </label>
                  <textarea
                    id="wizard-bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tell us about yourself..."
                    className="w-full bg-ink-800 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100 placeholder:text-amber-700 focus:outline-none focus:border-market-400 transition-colors h-24 resize-none"
                    maxLength={300}
                  />
                </div>
                <p className="text-xs text-amber-600">You can always update these later</p>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={dismiss}
              className="text-sm font-medium text-amber-500 hover:text-amber-300 transition-colors min-h-[44px]"
            >
              Dismiss
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSkip}
                className="btn-secondary text-sm"
                disabled={saving || connecting}
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handlePrimary}
                className="btn-primary"
                disabled={!canProceed() || saving || connecting}
              >
                {connecting ? "Connecting..." : saving ? "Saving..." : isLastStep ? "Complete" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
