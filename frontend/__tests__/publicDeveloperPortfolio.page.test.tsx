import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import PublicDeveloperPortfolioPage from "@/pages/freelancers/[username]";
import * as api from "@/lib/api";

const DUMMY_PK = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const mockRouter = {
  pathname: "/freelancers/[username]",
  isReady: true,
  query: { username: DUMMY_PK },
  push: jest.fn(),
  replace: jest.fn(),
  asPath: `/freelancers/${DUMMY_PK}`,
};

jest.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

// next/head's side-effect writes into document.head via the Next runtime's
// head manager, which is absent under jsdom — render its children inline so
// the injected OpenGraph tags can be asserted on.
jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: any }) => children,
}));

jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  endorseSkill: jest.fn(),
  fetchEscrow: jest.fn(),
  fetchFreelancerEarnings: jest.fn(),
  fetchFreelancerNftCertificates: jest.fn(),
  fetchProfiles: jest.fn(),
  fetchPublicProfile: jest.fn(),
  fetchRatings: jest.fn(),
  fetchSkillBadges: jest.fn(),
  fetchSkillEndorsements: jest.fn(),
  fetchUserCertificates: jest.fn(),
  fetchReputation: jest.fn(),
  verifyIdentity: jest.fn(),
}));

const profileFixture = {
  publicKey: DUMMY_PK,
  displayName: "Ada Developer",
  bio: "Rust and Soroban engineer building audited on-chain escrow systems.",
  skills: ["Rust", "Soroban"],
  completedJobs: 12,
  totalEarnedXLM: "340.5000000",
  rating: 4.8,
  ratingCount: 7,
  tier: "Top Rated" as const,
  role: "both" as const,
  createdAt: "2025-01-01T00:00:00.000Z",
};

/** Fresh SWR cache per test so key dedupe never bleeds across tests. */
function renderPortfolio(publicKey: string | null = null) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <PublicDeveloperPortfolioPage publicKey={publicKey} />
    </SWRConfig>,
  );
}

describe("PublicDeveloperPortfolioPage (/freelancers/[username])", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.query = { username: DUMMY_PK };

    (api.fetchPublicProfile as jest.Mock).mockResolvedValue(profileFixture);
    (api.fetchProfiles as jest.Mock).mockResolvedValue({
      profiles: [],
      nextCursor: null,
      hasMore: false,
    });
    (api.fetchSkillEndorsements as jest.Mock).mockResolvedValue([]);
    (api.fetchSkillBadges as jest.Mock).mockResolvedValue([]);
    (api.fetchUserCertificates as jest.Mock).mockResolvedValue([]);
    (api.fetchRatings as jest.Mock).mockResolvedValue([]);
    (api.fetchFreelancerNftCertificates as jest.Mock).mockResolvedValue([]);
    (api.fetchFreelancerEarnings as jest.Mock).mockResolvedValue({
      totalXlm: "0.0000000",
      payments: [],
      monthly: [],
    });
    (api.fetchEscrow as jest.Mock).mockResolvedValue({
      client_consent_public: false,
    });
    (api.endorseSkill as jest.Mock).mockResolvedValue(undefined);
    (api.verifyIdentity as jest.Mock).mockResolvedValue(profileFixture);
  });

  it("renders the portfolio for an unauthenticated guest without throwing or redirecting", async () => {
    (api.fetchFreelancerNftCertificates as jest.Mock).mockResolvedValue([
      {
        id: "nft-1",
        jobId: "job-1",
        jobTitle: "Soroban Escrow Audit",
        freelancerAddress: DUMMY_PK,
        clientAddress: DUMMY_PK,
        freelancerName: null,
        clientName: null,
        amountXlm: "120.0000000",
        completionDate: "2026-02-01T00:00:00.000Z",
        txHash: null,
        contractId: null,
        createdAt: "2026-02-01T00:00:00.000Z",
        verifyUrl: null,
      },
    ]);

    renderPortfolio(null);

    await waitFor(() => {
      expect(screen.getByText("Ada Developer")).toBeInTheDocument();
    });

    expect(screen.getByText(/Rust and Soroban engineer/)).toBeInTheDocument();
    expect(screen.getByText("Rust")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("4.80")).toBeInTheDocument();

    // NFT certificates section (Issue #1553 acceptance criteria)
    expect(screen.getByText("Earned certificates")).toBeInTheDocument();
    expect(screen.getByText("Soroban Escrow Audit")).toBeInTheDocument();

    // Public guests are never force-redirected.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("renders a completed job ONLY when client_consent_public === true on its escrow record", async () => {
    (api.fetchFreelancerEarnings as jest.Mock).mockResolvedValue({
      totalXlm: "500.0000000",
      payments: [
        {
          id: "pay-1",
          jobId: "job-consented",
          jobTitle: "Consented Smart Contract Audit",
          amountXlm: "300.0000000",
          releasedAt: "2026-01-05T00:00:00.000Z",
          clientAddress: DUMMY_PK,
        },
        {
          id: "pay-2",
          jobId: "job-private",
          jobTitle: "Confidential Wallet Migration",
          amountXlm: "200.0000000",
          releasedAt: "2026-01-06T00:00:00.000Z",
          clientAddress: DUMMY_PK,
        },
        {
          id: "pay-3",
          jobId: "job-missing",
          jobTitle: "Escrow Record Unavailable",
          amountXlm: "50.0000000",
          releasedAt: "2026-01-07T00:00:00.000Z",
          clientAddress: DUMMY_PK,
        },
      ],
      monthly: [],
    });

    (api.fetchEscrow as jest.Mock).mockImplementation((jobId: string) => {
      // Missing escrow record (e.g. 404) must fail closed.
      if (jobId === "job-missing") {
        return Promise.reject(new Error("No escrow record found for this job"));
      }
      return Promise.resolve({
        job_id: jobId,
        status: "released",
        client_consent_public: jobId === "job-consented",
      });
    });

    renderPortfolio(null);

    await waitFor(() => {
      expect(
        screen.getByText("Consented Smart Contract Audit"),
      ).toBeInTheDocument();
    });

    // Every completed job's escrow record was inspected…
    expect(api.fetchEscrow).toHaveBeenCalledWith("job-consented");
    expect(api.fetchEscrow).toHaveBeenCalledWith("job-private");
    expect(api.fetchEscrow).toHaveBeenCalledWith("job-missing");

    // …but only the consented one is rendered (privacy guard, fail closed).
    expect(
      screen.queryByText("Confidential Wallet Migration"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Escrow Record Unavailable"),
    ).not.toBeInTheDocument();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("injects OpenGraph meta tags for rich social previews", async () => {
    renderPortfolio(null);

    await waitFor(() => {
      expect(screen.getByText("Ada Developer")).toBeInTheDocument();
    });

    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector(
      'meta[property="og:description"]',
    );
    const ogImage = document.querySelector('meta[property="og:image"]');

    expect(ogTitle).not.toBeNull();
    expect(ogTitle?.getAttribute("content")).toContain("Ada Developer");
    expect(ogDescription).not.toBeNull();
    expect(ogDescription?.getAttribute("content")).toContain(
      "Rust and Soroban engineer",
    );
    expect(ogImage).not.toBeNull();
    expect(ogImage?.getAttribute("content")).toContain("dicebear.com");
  });

  it("shows a not-found state for unknown profiles without throwing or redirecting", async () => {
    (api.fetchPublicProfile as jest.Mock).mockResolvedValue(null);

    renderPortfolio(null);

    await waitFor(() => {
      expect(screen.getByText("Profile not found")).toBeInTheDocument();
    });

    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("resolves a display-name slug through the freelancer directory", async () => {
    mockRouter.query = { username: "ada-developer" };
    (api.fetchProfiles as jest.Mock).mockResolvedValue({
      profiles: [profileFixture],
      nextCursor: null,
      hasMore: false,
    });

    renderPortfolio(null);

    await waitFor(() => {
      expect(screen.getByText("Ada Developer")).toBeInTheDocument();
    });

    expect(api.fetchProfiles).toHaveBeenCalledWith({
      role: "freelancer",
      search: "ada-developer",
      limit: 20,
    });
    expect(api.fetchPublicProfile).not.toHaveBeenCalled();
  });
});
