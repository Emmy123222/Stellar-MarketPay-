import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'stellar_marketpay_onboarding_checkpoint';

export interface OnboardingData {
  step: number;
  formData: {
    fullName: string;
    skills: string;
    payoutAddress: string;
    [key: string]: any;
  };
}

export function OnboardingFlow({ onComplete, onResumeLater }: { onComplete: () => void; onResumeLater?: () => void }) {
  const [step, setStep] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: OnboardingData = JSON.parse(saved);
        return parsed.step || 1;
      } catch {
        return 1;
      }
    }
    return 1;
  });

  const [formData, setFormData] = useState<OnboardingData['formData']>(() => {
    if (typeof window === 'undefined') return { fullName: '', skills: '', payoutAddress: '' };
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: OnboardingData = JSON.parse(saved);
        return parsed.formData || { fullName: '', skills: '', payoutAddress: '' };
      } catch {
        return { fullName: '', skills: '', payoutAddress: '' };
      }
    }
    return { fullName: '', skills: '', payoutAddress: '' };
  });

  // Checkpoint progress to sessionStorage on every change
  useEffect(() => {
    const payload: OnboardingData = { step, formData };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [step, formData]);

  const handleNext = () => {
    if (step < 3) {
      setStep((prev) => prev + 1);
    } else {
      // Successful completion
      sessionStorage.removeItem(STORAGE_KEY);
      onComplete();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((prev) => prev - 1);
    }
  };

  const handleResumeLater = () => {
    // Progress is already saved in sessionStorage via useEffect
    if (onResumeLater) {
      onResumeLater();
    } else {
      window.location.href = '/dashboard';
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white rounded-xl shadow-md mt-10">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-800">Freelancer Onboarding (Step {step} of 3)</h2>
        <button
          type="button"
          onClick={handleResumeLater}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium underline"
        >
          Resume later
        </button>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">Full Name</label>
          <input
            type="text"
            value={formData.fullName}
            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
            placeholder="Alice Developer"
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">Primary Skills</label>
          <input
            type="text"
            value={formData.skills}
            onChange={(e) => setFormData({ ...formData, skills: e.target.value })}
            placeholder="Rust, React, Stellar"
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">Stellar Payout Address</label>
          <input
            type="text"
            value={formData.payoutAddress}
            onChange={(e) => setFormData({ ...formData, payoutAddress: e.target.value })}
            placeholder="G..."
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
      )}

      <div className="flex justify-between mt-6">
        {step > 1 ? (
          <button
            type="button"
            onClick={handleBack}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
          >
            Back
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={handleNext}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          {step === 3 ? 'Complete' : 'Next'}
        </button>
      </div>
    </div>
  );
}