/**
 * components/Onboarding/WelcomeModal.tsx
 * Welcome modal shown to first-time users
 */
import { useEffect } from "react";

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGetStarted: () => void;
}

export default function WelcomeModal({ isOpen, onClose, onGetStarted }: WelcomeModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gradient-to-br from-ink-800 to-ink-900 border border-market-500/20 rounded-2xl shadow-2xl max-w-2xl w-full p-8 animate-scale-in">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-market-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-market-500/10 border border-market-500/20 mb-6">
              <svg className="w-10 h-10 text-market-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="font-display text-3xl font-bold text-amber-100 mb-3">
              Welcome to Stellar MarketPay! 🎉
            </h2>
            <p className="text-amber-700 text-lg">
              Your decentralized freelance marketplace powered by Stellar
            </p>
          </div>

          {/* Key Features */}
          <div className="space-y-4 mb-8">
            <div className="flex items-start gap-4 p-4 rounded-xl bg-ink-900/50 border border-market-500/10">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-market-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-market-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div>
                <h3 className="font-display font-semibold text-amber-100 mb-1">Complete Your Profile</h3>
                <p className="text-sm text-amber-800">
                  Add your skills, bio, and portfolio to stand out to clients
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-xl bg-ink-900/50 border border-market-500/10">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-market-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-market-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-display font-semibold text-amber-100 mb-1">Post or Find Jobs</h3>
                <p className="text-sm text-amber-800">
                  Hire talented freelancers or apply to exciting projects
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-4 rounded-xl bg-ink-900/50 border border-market-500/10">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-market-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-market-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-display font-semibold text-amber-100 mb-1">Connect Your Wallet</h3>
                <p className="text-sm text-amber-800">
                  Secure payments with Stellar blockchain and smart contracts
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onGetStarted}
              className="flex-1 btn-primary py-3 text-base font-semibold"
            >
              Get Started →
            </button>
            <button
              onClick={onClose}
              className="flex-1 btn-secondary py-3 text-base"
            >
              Dismiss
            </button>
          </div>

          {/* Footer note */}
          <p className="text-center text-xs text-amber-800 mt-6">
            You can restart this tour anytime from your profile settings
          </p>
        </div>
      </div>
    </div>
  );
}
