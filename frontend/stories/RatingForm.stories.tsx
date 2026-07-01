import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import RatingForm from "@/components/RatingForm";

const meta: Meta<typeof RatingForm> = {
  title: "Components/RatingForm",
  component: RatingForm,
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "dark",
    },
  },
  argTypes: {
    jobId: {
      control: "text",
    },
    ratedAddress: {
      control: "text",
    },
    ratedLabel: {
      control: "text",
    },
  },
};

export default meta;
type Story = StoryObj<typeof RatingForm>;

// Default state - Empty form
export const Default: Story = {
  args: {
    jobId: "job-123",
    ratedAddress: "GFREELANCER123456789ABC",
    ratedLabel: "John Developer",
  },
};

// Loading state - Form with pending submission
export const Loading: Story = {
  args: {
    jobId: "job-456",
    ratedAddress: "GFREELANCER987654321DEF",
    ratedLabel: "Sarah Designer",
  },
  render: (args) => {
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
      setSubmitting(true);
      setTimeout(() => setSubmitting(false), 2000);
    };

    return (
      <div className="space-y-4">
        <RatingForm {...args} onSuccess={() => {}} />
        {submitting && (
          <div className="text-amber-200 text-sm">Submitting rating...</div>
        )}
      </div>
    );
  },
};

// Error state - With validation error
export const Error: Story = {
  args: {
    jobId: "job-789",
    ratedAddress: "GFREELANCER111222333GHI",
  },
  render: (args) => {
    const [error, setError] = useState(
      "Failed to submit rating. Please try again."
    );

    return (
      <div className="space-y-4">
        <RatingForm {...args} onSuccess={() => {}} />
        {error && <div className="text-red-400 text-sm">{error}</div>}
      </div>
    );
  },
};

// Form with stars filled
export const WithRating: Story = {
  args: {
    jobId: "job-999",
    ratedAddress: "GFREELANCER444555666JKL",
    ratedLabel: "Mike Developer",
  },
  render: (args) => {
    const [stars, setStars] = useState(5);
    const [review, setReview] = useState(
      "Excellent work! Very professional and responsive."
    );

    return (
      <div className="space-y-4">
        <div className="card border-market-500/20">
          <h3 className="font-display text-base font-semibold text-amber-100 mb-1">
            Leave a Rating{args.ratedLabel ? ` for ${args.ratedLabel}` : ""}
          </h3>
          <p className="text-amber-800 text-xs mb-4">
            Rate your experience working together
          </p>

          <div className="flex items-center gap-1 mb-4" role="group">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n)}
                className={`text-2xl transition-transform ${
                  n <= stars ? "text-amber-400" : "text-amber-900"
                }`}
              >
                ★
              </button>
            ))}
            {stars > 0 && (
              <span className="ml-2 text-xs text-amber-600">
                {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][stars]}
              </span>
            )}
          </div>

          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value.slice(0, 200))}
            placeholder="Optional: leave a short review (max 200 characters)"
            rows={3}
            className="w-full bg-ink-800 border border-market-500/15 rounded-xl px-4 py-3 text-sm text-amber-100 placeholder-amber-900 focus:outline-none focus:border-market-500/40 resize-none mb-1"
          />
          <p className="text-xs text-amber-900 text-right mb-4">
            {review.length}/200
          </p>

          <button className="btn-primary text-sm py-2 px-5">
            Submit Rating
          </button>
        </div>
      </div>
    );
  },
};

// No rating label
export const NoLabel: Story = {
  args: {
    jobId: "job-555",
    ratedAddress: "GCLIENT123456789ABC",
  },
};

// Submitted state
export const Submitted: Story = {
  args: {
    jobId: "job-666",
    ratedAddress: "GFREELANCER777888999MNO",
    ratedLabel: "Alice Developer",
  },
  render: () => (
    <div className="card border-emerald-500/20 bg-emerald-500/5 text-center py-6">
      <p className="text-emerald-400 font-medium">
        ✅ Rating submitted — thank you!
      </p>
    </div>
  ),
};

// Poor rating (1 star)
export const PoorRating: Story = {
  args: {
    jobId: "job-333",
    ratedAddress: "GFREELANCER121212121PQR",
    ratedLabel: "Bob Developer",
  },
  render: (args) => {
    return (
      <div className="space-y-4">
        <div className="card border-market-500/20">
          <h3 className="font-display text-base font-semibold text-amber-100 mb-1">
            Leave a Rating{args.ratedLabel ? ` for ${args.ratedLabel}` : ""}
          </h3>
          <p className="text-amber-800 text-xs mb-4">
            Rate your experience working together
          </p>

          <div className="flex items-center gap-1 mb-4" role="group">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`text-2xl ${
                  n === 1 ? "text-amber-400" : "text-amber-900"
                }`}
              >
                ★
              </button>
            ))}
            <span className="ml-2 text-xs text-amber-600">Poor</span>
          </div>

          <textarea
            placeholder="Optional: leave a short review (max 200 characters)"
            rows={3}
            className="w-full bg-ink-800 border border-market-500/15 rounded-xl px-4 py-3 text-sm text-amber-100 placeholder-amber-900 focus:outline-none focus:border-market-500/40 resize-none mb-1"
          />
          <p className="text-xs text-amber-900 text-right mb-4">0/200</p>

          <button className="btn-primary text-sm py-2 px-5">
            Submit Rating
          </button>
        </div>
      </div>
    );
  },
};
