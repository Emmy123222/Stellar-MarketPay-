import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OnboardingWizard, {
  ONBOARDING_SESSION_KEY,
  OnboardingCheckpoint,
} from "@/components/Onboarding/OnboardingWizard";
import { upsertProfile } from "@/lib/api";

const mockPush = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockSaveOnboardingState = jest.fn();
let mockHookState = {
  onboardingState: {
    wizardCurrentStep: 0,
    wizardCompletedSteps: [],
    wizardCompleted: false,
    wizardDismissed: false,
    hasSeenWelcome: false,
    checklistDismissed: false,
    dismissedTooltips: [],
  },
  shouldShowWizard: true,
  saveOnboardingState: mockSaveOnboardingState,
};

jest.mock("@/hooks/useOnboarding", () => ({
  useOnboarding: () => mockHookState,
}));

jest.mock("@/lib/api", () => ({
  upsertProfile: jest.fn().mockResolvedValue({}),
}));

describe("OnboardingWizard progress checkpointing (Issue #1415)", () => {
  const MOCK_PK = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const mockConnect = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockHookState = {
      onboardingState: {
        wizardCurrentStep: 0,
        wizardCompletedSteps: [],
        wizardCompleted: false,
        wizardDismissed: false,
        hasSeenWelcome: false,
        checklistDismissed: false,
        dismissedTooltips: [],
      },
      shouldShowWizard: true,
      saveOnboardingState: mockSaveOnboardingState,
    };
  });

  it("restores step and partial form data from sessionStorage on mount", async () => {
    const savedCheckpoint: OnboardingCheckpoint = {
      stepIndex: 2, // Complete profile step
      selectedRole: "freelancer",
      displayName: "Jane Developer",
      bio: "Expert Rust and Stellar engineer",
    };
    sessionStorage.setItem(ONBOARDING_SESSION_KEY, JSON.stringify(savedCheckpoint));

    render(<OnboardingWizard publicKey={MOCK_PK} onConnect={mockConnect} />);

    // Should mount directly on step 3 (Complete Profile)
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Complete Profile")).toBeInTheDocument();

    // Partial form data should be restored in inputs
    expect(screen.getByDisplayValue("Jane Developer")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Expert Rust and Stellar engineer")).toBeInTheDocument();
  });

  it("persists current step and form changes into sessionStorage", async () => {
    render(<OnboardingWizard publicKey={MOCK_PK} onConnect={mockConnect} />);

    // Starts on step 1
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();

    // Advance to step 2
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Now on step 2
    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Choose Your Role")).toBeInTheDocument();

    // Select role "freelancer"
    const freelancerRoleBtn = screen.getByRole("button", { name: /Find work and apply to jobs/i });
    fireEvent.click(freelancerRoleBtn);

    const savedRaw = sessionStorage.getItem(ONBOARDING_SESSION_KEY);
    expect(savedRaw).not.toBeNull();
    const saved = JSON.parse(savedRaw!);
    expect(saved.stepIndex).toBe(1);
    expect(saved.selectedRole).toBe("freelancer");
  });

  it("Resume later explicitly saves progress and redirects to dashboard", async () => {
    render(<OnboardingWizard publicKey={MOCK_PK} onConnect={mockConnect} />);

    // Advance to step 2 and select client role
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();

    const clientRoleBtn = screen.getByRole("button", { name: /Hire freelancers and post jobs/i });
    fireEvent.click(clientRoleBtn);

    // Click "Resume later" button
    const resumeLaterBtn = screen.getByRole("button", { name: /resume later/i });
    fireEvent.click(resumeLaterBtn);

    // Verifies state was saved to sessionStorage
    const saved = JSON.parse(sessionStorage.getItem(ONBOARDING_SESSION_KEY)!);
    expect(saved.stepIndex).toBe(1);
    expect(saved.selectedRole).toBe("client");

    // Verifies onboardingState was updated to dismiss modal and save step
    expect(mockSaveOnboardingState).toHaveBeenCalledWith(
      expect.objectContaining({
        wizardDismissed: true,
        wizardCurrentStep: 1,
      })
    );

    // Verifies redirect to /dashboard
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });

  it("clears sessionStorage on successful completion", async () => {
    // Mount on final step with data
    const savedCheckpoint: OnboardingCheckpoint = {
      stepIndex: 2,
      selectedRole: "both",
      displayName: "Alex Star",
      bio: "Contract specialist",
    };
    sessionStorage.setItem(ONBOARDING_SESSION_KEY, JSON.stringify(savedCheckpoint));

    render(<OnboardingWizard publicKey={MOCK_PK} onConnect={mockConnect} />);

    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();

    // Click Complete button
    const completeBtn = screen.getByRole("button", { name: "Complete" });
    fireEvent.click(completeBtn);

    // Verifies upsertProfile called
    await waitFor(() => {
      expect(upsertProfile).toHaveBeenCalledWith({
        publicKey: MOCK_PK,
        displayName: "Alex Star",
        bio: "Contract specialist",
      });
    });

    // Verifies sessionStorage is cleared on completion
    await waitFor(() => {
      expect(sessionStorage.getItem(ONBOARDING_SESSION_KEY)).toBeNull();
    });

    // Verifies success screen shows up
    expect(await screen.findByText("All set!")).toBeInTheDocument();
  });
});
