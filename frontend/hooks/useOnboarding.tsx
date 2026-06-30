/**
 * hooks/useOnboarding.tsx
 * Custom hook to manage onboarding state and progress
 */
import { useState, useEffect, useMemo } from "react";
import { fetchProfile, syncOnboardingProgress } from "@/lib/api";
import type { UserProfile } from "@/utils/types";
import type { ChecklistItem } from "@/components/Onboarding/ProfileChecklist";

const ONBOARDING_STORAGE_KEY = "marketpay_onboarding_completed";
const TOOLTIPS_DISMISSED_KEY = "marketpay_tooltips_dismissed";
const WIZARD_STORAGE_KEY = "marketpay_onboarding_wizard";
const ONBOARDING_COMPLETE_THRESHOLD = 80;

export interface OnboardingState {
  hasSeenWelcome: boolean;
  checklistDismissed: boolean;
  dismissedTooltips: string[];
  wizardCurrentStep: number;
  wizardCompletedSteps: string[];
  wizardDismissed: boolean;
  wizardCompleted: boolean;
}

export interface OnboardingProgress {
  hasAvatar: boolean;
  hasBio: boolean;
  hasSkills: boolean;
  hasPortfolio: boolean;
  hasAvailability: boolean;
  completionPercentage: number;
  isComplete: boolean;
}

function calculateOnboardingProgress(
  profile: UserProfile | null,
): OnboardingProgress {
  if (!profile) {
    return {
      hasAvatar: false,
      hasBio: false,
      hasSkills: false,
      hasPortfolio: false,
      hasAvailability: false,
      completionPercentage: 0,
      isComplete: false,
    };
  }

  const hasAvatar = Boolean(
    profile.displayName && profile.displayName.length >= 3,
  );
  const hasBio = Boolean(profile.bio && profile.bio.length >= 10);
  const hasSkills = Boolean(profile.skills && profile.skills.length > 0);
  const hasPortfolio = Boolean(
    (profile.portfolioItems && profile.portfolioItems.length > 0) ||
      (profile.portfolioFiles && profile.portfolioFiles.length > 0),
  );
  const hasAvailability = Boolean(
    profile.availability && profile.availability.status,
  );

  const completedItems = [
    hasAvatar,
    hasBio,
    hasSkills,
    hasPortfolio,
    hasAvailability,
  ].filter(Boolean).length;
  const totalItems = 5;
  const completionPercentage = Math.round((completedItems / totalItems) * 100);

  return {
    hasAvatar,
    hasBio,
    hasSkills,
    hasPortfolio,
    hasAvailability,
    completionPercentage,
    isComplete: completedItems === totalItems,
  };
}

function isCompleteEnoughForOnboarding(progress: OnboardingProgress): boolean {
  return progress.completionPercentage >= ONBOARDING_COMPLETE_THRESHOLD;
}

function persistOnboardingState(
  state: OnboardingState,
  profileCompletionPercentage?: number,
): void {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    ONBOARDING_STORAGE_KEY,
    JSON.stringify({
      hasSeenWelcome: state.hasSeenWelcome,
      checklistDismissed: state.checklistDismissed,
      profileCompletionPercentage,
      syncedAt: new Date().toISOString(),
    }),
  );
  localStorage.setItem(
    TOOLTIPS_DISMISSED_KEY,
    JSON.stringify(state.dismissedTooltips),
  );
  localStorage.setItem(
    WIZARD_STORAGE_KEY,
    JSON.stringify({
      currentStep: state.wizardCurrentStep,
      completedSteps: state.wizardCompletedSteps,
      dismissed: state.wizardDismissed,
      completed: state.wizardCompleted,
      syncedAt: new Date().toISOString(),
    }),
  );
}

export function useOnboarding(publicKey: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingState, setOnboardingState] = useState<OnboardingState>({
    hasSeenWelcome: false,
    checklistDismissed: false,
    dismissedTooltips: [],
    wizardCurrentStep: 0,
    wizardCompletedSteps: [],
    wizardDismissed: false,
    wizardCompleted: false,
  });

  // Load onboarding state from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      const dismissedTooltips = JSON.parse(
        localStorage.getItem(TOOLTIPS_DISMISSED_KEY) || "[]",
      );
      const wizard = JSON.parse(localStorage.getItem(WIZARD_STORAGE_KEY) || "{}");

      if (stored) {
        const parsed = JSON.parse(stored);
        setOnboardingState({
          hasSeenWelcome: parsed.hasSeenWelcome || false,
          checklistDismissed: parsed.checklistDismissed || false,
          dismissedTooltips,
          wizardCurrentStep: wizard.currentStep || 0,
          wizardCompletedSteps: wizard.completedSteps || [],
          wizardDismissed: wizard.dismissed || false,
          wizardCompleted: wizard.completed || false,
        });
      }
    } catch (error) {
      console.error("Failed to load onboarding state:", error);
    }
  }, []);

  // Fetch user profile
  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchProfile(publicKey)
      .then((data) => {
        setProfile(data);

        const serverProgress = calculateOnboardingProgress(data);
        setOnboardingState((current) => {
          const serverCompleted = isCompleteEnoughForOnboarding(serverProgress);
          const syncedState = serverCompleted
            ? {
                ...current,
                hasSeenWelcome: true,
                checklistDismissed: true,
              }
            : current;

          persistOnboardingState(
            syncedState,
            serverProgress.completionPercentage,
          );

          return syncedState;
        });
      })
      .catch((error) => {
        console.error("Failed to fetch profile:", error);
        setProfile(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [publicKey]);

  // Calculate onboarding progress from the latest API profile. The API is the
  // source of truth; localStorage is only used as a UI cache for dismissals.
  const progress: OnboardingProgress = useMemo(() => {
    return calculateOnboardingProgress(profile);
  }, [profile]);

  const serverCompletedOnboarding = isCompleteEnoughForOnboarding(progress);

  // Generate checklist items
  const checklistItems: ChecklistItem[] = useMemo(() => {
    return [
      {
        id: "avatar",
        label: "Add display name",
        completed: progress.hasAvatar,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        ),
      },
      {
        id: "bio",
        label: "Write a bio",
        completed: progress.hasBio,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        ),
      },
      {
        id: "skills",
        label: "Add your skills",
        completed: progress.hasSkills,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
            />
          </svg>
        ),
      },
      {
        id: "portfolio",
        label: "Add portfolio items",
        completed: progress.hasPortfolio,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        ),
      },
      {
        id: "availability",
        label: "Set your availability",
        completed: progress.hasAvailability,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        ),
      },
    ];
  }, [progress]);

  // Save onboarding state to localStorage
  const saveOnboardingState = (newState: Partial<OnboardingState>) => {
    const updated = { ...onboardingState, ...newState };
    setOnboardingState(updated);

    persistOnboardingState(updated, progress.completionPercentage);
    if (publicKey) {
      syncOnboardingProgress({
        publicKey,
        currentStep: updated.wizardCurrentStep,
        completedSteps: updated.wizardCompletedSteps,
        dismissed: updated.wizardDismissed,
        completed: updated.wizardCompleted,
      }).catch(() => undefined);
    }
  };

  // Mark welcome as seen
  const markWelcomeSeen = () => {
    saveOnboardingState({ hasSeenWelcome: true });
  };

  // Dismiss checklist
  const dismissChecklist = () => {
    saveOnboardingState({ checklistDismissed: true });
  };

  // Dismiss a tooltip
  const dismissTooltip = (tooltipId: string) => {
    const updated = [...onboardingState.dismissedTooltips, tooltipId];
    saveOnboardingState({ dismissedTooltips: updated });
  };

  // Dismiss all tooltips
  const dismissAllTooltips = () => {
    const allTooltipIds = ["post-job", "connect-wallet", "browse-jobs"];
    saveOnboardingState({ dismissedTooltips: allTooltipIds });
  };

  // Reset onboarding (for restart feature)
  const resetOnboarding = () => {
    setOnboardingState({
      hasSeenWelcome: false,
      checklistDismissed: false,
      dismissedTooltips: [],
      wizardCurrentStep: 0,
      wizardCompletedSteps: [],
      wizardDismissed: false,
      wizardCompleted: false,
    });

    if (typeof window !== "undefined") {
      localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      localStorage.removeItem(TOOLTIPS_DISMISSED_KEY);
      localStorage.removeItem(WIZARD_STORAGE_KEY);
    }
  };

  // Check if user should see onboarding
  const shouldShowWelcome =
    !loading &&
    !serverCompletedOnboarding &&
    !onboardingState.hasSeenWelcome &&
    publicKey !== null;
  const shouldShowWizard =
    !loading &&
    !serverCompletedOnboarding &&
    !onboardingState.wizardCompleted &&
    !onboardingState.wizardDismissed &&
    publicKey !== null;
  const shouldShowChecklist =
    !loading &&
    !serverCompletedOnboarding &&
    !onboardingState.checklistDismissed &&
    publicKey !== null;

  return {
    loading,
    profile,
    progress,
    checklistItems,
    onboardingState,
    shouldShowWelcome,
    shouldShowChecklist,
    shouldShowWizard,
    saveOnboardingState,
    markWelcomeSeen,
    dismissChecklist,
    dismissTooltip,
    dismissAllTooltips,
    resetOnboarding,
  };
}
