/**
 * hooks/useOnboarding.tsx
 * Custom hook to manage onboarding state and progress
 */
import { useState, useEffect, useMemo } from "react";
import { fetchProfile } from "@/lib/api";
import type { UserProfile } from "@/utils/types";
import type { ChecklistItem } from "@/components/Onboarding/ProfileChecklist";

const ONBOARDING_STORAGE_KEY = "marketpay_onboarding_completed";
const TOOLTIPS_DISMISSED_KEY = "marketpay_tooltips_dismissed";

export interface OnboardingState {
  hasSeenWelcome: boolean;
  checklistDismissed: boolean;
  dismissedTooltips: string[];
}

export interface OnboardingProgress {
  hasAvatar: boolean;
  hasBio: boolean;
  hasSkills: boolean;
  hasPortfolio: boolean;
  completionPercentage: number;
  isComplete: boolean;
}

export function useOnboarding(publicKey: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingState, setOnboardingState] = useState<OnboardingState>({
    hasSeenWelcome: false,
    checklistDismissed: false,
    dismissedTooltips: [],
  });

  // Load onboarding state from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      const dismissedTooltips = JSON.parse(
        localStorage.getItem(TOOLTIPS_DISMISSED_KEY) || "[]"
      );

      if (stored) {
        const parsed = JSON.parse(stored);
        setOnboardingState({
          hasSeenWelcome: parsed.hasSeenWelcome || false,
          checklistDismissed: parsed.checklistDismissed || false,
          dismissedTooltips,
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
      })
      .catch((error) => {
        console.error("Failed to fetch profile:", error);
        setProfile(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [publicKey]);

  // Calculate onboarding progress
  const progress: OnboardingProgress = useMemo(() => {
    if (!profile) {
      return {
        hasAvatar: false,
        hasBio: false,
        hasSkills: false,
        hasPortfolio: false,
        completionPercentage: 0,
        isComplete: false,
      };
    }

    const hasAvatar = Boolean(profile.displayName && profile.displayName.length >= 3);
    const hasBio = Boolean(profile.bio && profile.bio.length >= 10);
    const hasSkills = Boolean(profile.skills && profile.skills.length > 0);
    const hasPortfolio = Boolean(
      (profile.portfolioItems && profile.portfolioItems.length > 0) ||
      (profile.portfolioFiles && profile.portfolioFiles.length > 0)
    );

    const completedItems = [hasAvatar, hasBio, hasSkills, hasPortfolio].filter(Boolean).length;
    const totalItems = 4;
    const completionPercentage = Math.round((completedItems / totalItems) * 100);
    const isComplete = completedItems === totalItems;

    return {
      hasAvatar,
      hasBio,
      hasSkills,
      hasPortfolio,
      completionPercentage,
      isComplete,
    };
  }, [profile]);

  // Generate checklist items
  const checklistItems: ChecklistItem[] = useMemo(() => {
    return [
      {
        id: "avatar",
        label: "Add display name",
        completed: progress.hasAvatar,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        ),
      },
      {
        id: "bio",
        label: "Write a bio",
        completed: progress.hasBio,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
      },
      {
        id: "skills",
        label: "Add your skills",
        completed: progress.hasSkills,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
        ),
      },
      {
        id: "portfolio",
        label: "Add portfolio items",
        completed: progress.hasPortfolio,
        route: "/dashboard?tab=edit_profile",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ),
      },
    ];
  }, [progress]);

  // Save onboarding state to localStorage
  const saveOnboardingState = (newState: Partial<OnboardingState>) => {
    const updated = { ...onboardingState, ...newState };
    setOnboardingState(updated);

    if (typeof window !== "undefined") {
      localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({
          hasSeenWelcome: updated.hasSeenWelcome,
          checklistDismissed: updated.checklistDismissed,
        })
      );
      localStorage.setItem(
        TOOLTIPS_DISMISSED_KEY,
        JSON.stringify(updated.dismissedTooltips)
      );
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
    });

    if (typeof window !== "undefined") {
      localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      localStorage.removeItem(TOOLTIPS_DISMISSED_KEY);
    }
  };

  // Check if user should see onboarding
  const shouldShowWelcome = !onboardingState.hasSeenWelcome && publicKey !== null;
  const shouldShowChecklist = 
    !onboardingState.checklistDismissed && 
    !progress.isComplete && 
    publicKey !== null;

  return {
    loading,
    profile,
    progress,
    checklistItems,
    onboardingState,
    shouldShowWelcome,
    shouldShowChecklist,
    markWelcomeSeen,
    dismissChecklist,
    dismissTooltip,
    dismissAllTooltips,
    resetOnboarding,
  };
}
