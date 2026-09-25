/**
 * __tests__/ClientReputationCard.test.tsx — Issue #1432
 */
import { render, screen, waitFor } from "@testing-library/react";
import ClientReputationCard, {
  NEW_CLIENT_THRESHOLD,
} from "@/components/ClientReputationCard";

jest.mock("@/lib/api/profiles", () => ({
  fetchClientReputation: jest.fn(),
  fetchPublicProfile: jest.fn(),
}));

import {
  fetchClientReputation,
  fetchPublicProfile,
} from "@/lib/api/profiles";

const mockRep = (completedJobs: number, disputeRate = 0) => ({
  publicKey: "GABCD",
  score: 100,
  paymentReleaseRate: 1,
  disputeRate,
  completionRate: 1,
  avgTimeToReleaseHours: 12,
  responseTimeToApplicationsHours: 4,
  totals: {
    totalJobs: completedJobs,
    completedJobs,
    disputedJobs: Math.round(completedJobs * disputeRate),
    totalReleased: completedJobs,
    releasedOnTime: completedJobs,
  },
});

const mockProfile = (rating?: number, ratingCount = 0) => ({
  publicKey: "GABCD",
  role: "client" as const,
  completedJobs: 10,
  totalEarnedXLM: "0",
  rating,
  ratingCount,
});

describe("ClientReputationCard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders average rating, jobs completed, and dispute rate", async () => {
    (fetchClientReputation as jest.Mock).mockResolvedValue(mockRep(12, 0.08));
    (fetchPublicProfile as jest.Mock).mockResolvedValue(mockProfile(4.6, 9));

    render(<ClientReputationCard clientPublicKey="GABCD" />);

    await waitFor(() =>
      expect(screen.getByText("Client Reputation")).toBeInTheDocument(),
    );
    expect(screen.getByText("4.6")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("8%")).toBeInTheDocument();
    expect(screen.queryByText("New client")).not.toBeInTheDocument();
  });

  it("shows the New client badge when completedJobs is below the threshold", async () => {
    (fetchClientReputation as jest.Mock).mockResolvedValue(
      mockRep(NEW_CLIENT_THRESHOLD - 1),
    );
    (fetchPublicProfile as jest.Mock).mockResolvedValue(mockProfile());

    render(<ClientReputationCard clientPublicKey="GABCD" />);

    await waitFor(() => expect(screen.getByText("New client")).toBeInTheDocument());
  });

  it("hides the New client badge at exactly the threshold", async () => {
    (fetchClientReputation as jest.Mock).mockResolvedValue(
      mockRep(NEW_CLIENT_THRESHOLD),
    );
    (fetchPublicProfile as jest.Mock).mockResolvedValue(mockProfile());

    render(<ClientReputationCard clientPublicKey="GABCD" />);

    await waitFor(() =>
      expect(screen.getByText("Client Reputation")).toBeInTheDocument(),
    );
    expect(screen.queryByText("New client")).not.toBeInTheDocument();
  });

  it("renders nothing when the reputation API fails", async () => {
    (fetchClientReputation as jest.Mock).mockRejectedValue(new Error("boom"));
    (fetchPublicProfile as jest.Mock).mockRejectedValue(new Error("boom"));

    const { container } = render(<ClientReputationCard clientPublicKey="GABCD" />);

    await waitFor(() =>
      expect(container.querySelector("[aria-busy]")).not.toBeInTheDocument(),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a dash for average rating when the profile has none", async () => {
    (fetchClientReputation as jest.Mock).mockResolvedValue(mockRep(5));
    (fetchPublicProfile as jest.Mock).mockResolvedValue(mockProfile(undefined));

    render(<ClientReputationCard clientPublicKey="GABCD" />);

    await waitFor(() =>
      expect(screen.getByText("Client Reputation")).toBeInTheDocument(),
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
