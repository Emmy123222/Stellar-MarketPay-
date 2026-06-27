# Onboarding Flow Components

This directory contains all components related to the first-time user onboarding experience.

## Components

### WelcomeModal
A modal that appears on first login, introducing users to the platform's key features.

**Props:**
- `isOpen: boolean` - Controls modal visibility
- `onClose: () => void` - Callback when user dismisses the modal
- `onGetStarted: () => void` - Callback when user clicks "Get Started"

### ProfileChecklist
An interactive checklist showing profile completion progress with clickable items.

**Props:**
- `items: ChecklistItem[]` - Array of checklist items
- `onItemClick: (route: string) => void` - Callback when an item is clicked
- `onDismiss?: () => void` - Optional callback to dismiss the checklist

**ChecklistItem Interface:**
```typescript
{
  id: string;
  label: string;
  completed: boolean;
  route: string;
  icon: React.ReactNode;
}
```

### ProgressBar
A visual progress indicator showing completion percentage.

**Props:**
- `current: number` - Number of completed items
- `total: number` - Total number of items
- `showLabel?: boolean` - Whether to show the label (default: true)
- `size?: "sm" | "md" | "lg"` - Size variant (default: "md")

### Tooltips
Contextual tooltips that guide users to key actions.

**Props:**
- `tooltips: TooltipConfig[]` - Array of tooltip configurations
- `onDismiss: (tooltipId: string) => void` - Callback when a tooltip is dismissed
- `onDismissAll: () => void` - Callback to dismiss all tooltips

**TooltipConfig Interface:**
```typescript
{
  id: string;
  targetSelector: string;  // CSS selector for the target element
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

## Hook

### useOnboarding
Custom hook that manages onboarding state and progress tracking.

**Parameters:**
- `publicKey: string | null` - User's Stellar public key

**Returns:**
```typescript
{
  loading: boolean;
  profile: UserProfile | null;
  progress: OnboardingProgress;
  checklistItems: ChecklistItem[];
  onboardingState: OnboardingState;
  shouldShowWelcome: boolean;
  shouldShowChecklist: boolean;
  markWelcomeSeen: () => void;
  dismissChecklist: () => void;
  dismissTooltip: (tooltipId: string) => void;
  dismissAllTooltips: () => void;
  resetOnboarding: () => void;
}
```

## Usage Example

```typescript
import { useOnboarding } from "@/hooks/useOnboarding";
import { WelcomeModal, ProfileChecklist, Tooltips } from "@/components/Onboarding";

function Dashboard({ publicKey }: { publicKey: string | null }) {
  const {
    shouldShowWelcome,
    shouldShowChecklist,
    checklistItems,
    markWelcomeSeen,
    dismissChecklist,
    dismissTooltip,
    dismissAllTooltips,
    onboardingState,
  } = useOnboarding(publicKey);

  const tooltips = [
    {
      id: "post-job",
      targetSelector: '[href="/post-job"]',
      title: "Post Your First Job",
      description: "Click here to create a job posting.",
      position: "bottom" as const,
    },
  ];

  const activeTooltips = tooltips.filter(
    (t) => !onboardingState.dismissedTooltips.includes(t.id)
  );

  return (
    <>
      <WelcomeModal
        isOpen={shouldShowWelcome}
        onClose={markWelcomeSeen}
        onGetStarted={() => {
          markWelcomeSeen();
          // Navigate to profile edit
        }}
      />

      {shouldShowChecklist && (
        <ProfileChecklist
          items={checklistItems}
          onItemClick={(route) => router.push(route)}
          onDismiss={dismissChecklist}
        />
      )}

      {activeTooltips.length > 0 && (
        <Tooltips
          tooltips={activeTooltips}
          onDismiss={dismissTooltip}
          onDismissAll={dismissAllTooltips}
        />
      )}
    </>
  );
}
```

## Storage Keys

The onboarding system uses localStorage to persist state:

- `marketpay_onboarding_completed` - Stores welcome modal and checklist dismissal state
- `marketpay_tooltips_dismissed` - Array of dismissed tooltip IDs

## Profile Completion Criteria

The system tracks four key profile completion items:

1. **Display Name** - At least 3 characters
2. **Bio** - At least 10 characters
3. **Skills** - At least one skill added
4. **Portfolio** - At least one portfolio item or file uploaded

## Restart Onboarding

Users can restart the onboarding tour from the Security tab in their dashboard settings. This clears all localStorage keys and reloads the page to show the welcome modal again.

## Styling

The components use Tailwind CSS classes and follow the existing design system. Key features:

- Gradient backgrounds with decorative elements
- Smooth animations (fade-in, scale-in)
- Highlight effect for tooltip targets (`.onboarding-highlight`)
- Responsive design for mobile and desktop
- Accessible with proper ARIA labels

## Accessibility

- Modal traps focus and prevents body scroll
- Tooltips can be dismissed with keyboard
- Progress indicators have proper ARIA labels
- All interactive elements are keyboard accessible
