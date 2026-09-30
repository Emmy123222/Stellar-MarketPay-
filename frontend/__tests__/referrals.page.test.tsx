import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ReferralsPage from "@/pages/referrals";
import * as api from "@/lib/api";

jest.mock("next/router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    pathname: "/referrals",
    query: {},
  }),
}));

jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  fetchMyReferralStats: jest.fn(),
}));

describe("ReferralsPage", () => {
  const dummyUser = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows connect wallet state when user is not connected", () => {
    render(<ReferralsPage publicKey={null} onConnect={jest.fn()} />);
    expect(screen.getByText("Connect Your Wallet")).toBeInTheDocument();
  });

  it("loads and displays stats and referee pipeline when connected", async () => {
    (api.fetchMyReferralStats as jest.Mock).mockResolvedValueOnce({
      referralLink: `http://localhost:3000/?ref=${dummyUser}`,
      bonusBps: 200,
      totalReferred: 3,
      pendingCreditsXlm: "10.0000000",
      paidCreditsXlm: "25.0000000",
      pipeline: {
        registered: 1,
        firstJobCompleted: 1,
        creditPaid: 1,
      },
      referees: [
        {
          id: "ref-1",
          refereeAddress:
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          refereeDisplayName: "Alice",
          status: "credit_paid",
          registeredAt: new Date().toISOString(),
          firstJobId: "job-1",
          firstJobTitle: "Smart Contract Audit",
          firstJobCompletedAt: new Date().toISOString(),
          creditXlm: "25.0000000",
          paidAt: new Date().toISOString(),
        },
      ],
      pagination: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      },
    });

    render(<ReferralsPage publicKey={dummyUser} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(api.fetchMyReferralStats).toHaveBeenCalled();
    });

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getAllByText("2%").length).toBeGreaterThan(0);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Smart Contract Audit")).toBeInTheDocument();
    expect(screen.getAllByText("Credit Paid").length).toBeGreaterThan(0);
  });
});
