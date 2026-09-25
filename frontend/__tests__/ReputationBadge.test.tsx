import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ReputationBadge, {
  getReputationTier,
} from "@/components/ReputationBadge";
import * as api from "@/lib/api";

jest.mock("@/lib/api", () => ({
  fetchReputation: jest.fn(),
}));

describe("ReputationBadge", () => {
  const dummyUser = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getReputationTier", () => {
    it("returns New for null or undefined score", () => {
      expect(getReputationTier(null).label).toBe("New");
      expect(getReputationTier(undefined).label).toBe("New");
    });

    it("returns Excellent for score >= 85", () => {
      expect(getReputationTier(92).label).toBe("Excellent");
      expect(getReputationTier(85).label).toBe("Excellent");
    });

    it("returns Trusted for score between 70 and 84.99", () => {
      expect(getReputationTier(72).label).toBe("Trusted");
      expect(getReputationTier(84.9).label).toBe("Trusted");
    });

    it("returns Established for score between 50 and 69.99", () => {
      expect(getReputationTier(55).label).toBe("Established");
      expect(getReputationTier(69.9).label).toBe("Established");
    });

    it("returns Building for score < 50", () => {
      expect(getReputationTier(45).label).toBe("Building");
      expect(getReputationTier(0).label).toBe("Building");
    });
  });

  it("renders with initialScore and initialLabel", () => {
    render(
      <ReputationBadge
        userId={dummyUser}
        initialScore={88}
        initialLabel="Excellent"
      />,
    );
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("Excellent")).toBeInTheDocument();
  });

  it("fetches reputation data on mouse enter when popover opens", async () => {
    (api.fetchReputation as jest.Mock).mockResolvedValueOnce({
      userId: dummyUser,
      score: 95.5,
      scoreBps: 9550,
      label: "Excellent",
      completedJobs: 18,
      disputeRate: 0.0,
      avgResponseHours: 1.5,
      avgRating: 4.9,
      ratingCount: 12,
      referralQuality: 0.8,
      updatedAt: new Date().toISOString(),
    });

    const { container } = render(
      <ReputationBadge userId={dummyUser} initialScore={95} />,
    );

    const badgeWrapper = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(badgeWrapper);

    await waitFor(() => {
      expect(api.fetchReputation).toHaveBeenCalledWith(dummyUser);
    });
  });
});
