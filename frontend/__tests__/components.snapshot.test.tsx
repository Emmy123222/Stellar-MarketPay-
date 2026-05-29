import { render } from "@testing-library/react";
import JobCard, { JobCardSkeleton } from "@/components/JobCard";
import RatingForm from "@/components/RatingForm";
import { ToastSnapshot } from "@/components/Toast";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import Navbar from "@/components/Navbar";
import type { Job } from "@/utils/types";

jest.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    isSaved: (jobId: string) => jobId === "job-bookmarked",
    toggleBookmark: jest.fn(),
    savedCount: 1,
    getSavedJobs: jest.fn(),
    bookmarks: ["job-bookmarked"],
  }),
}));

jest.mock("@/contexts/PriceContext", () => ({
  usePriceContext: () => ({ xlmPriceUsd: 0.12 }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

jest.mock("@/lib/api", () => ({
  submitRating: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "nav.home": "Home",
        "nav.browseJobs": "Browse Jobs",
        "nav.dashboard": "Dashboard",
        "nav.postJob": "Post Job",
        "nav.insights": "Insights",
        "nav.developer": "Developer",
        "nav.connectWallet": "Connect Wallet",
        "nav.disconnect": "Disconnect",
        "language.switch": "Language",
        "language.english": "English",
        "language.spanish": "Spanish",
        "wallet.balance": "Balance",
        "wallet.loading": "Loading…",
      })[key] ?? key,
    i18n: { language: "en", changeLanguage: jest.fn() },
    ready: true,
  }),
}));

jest.mock("@/components/FaucetButton", () => ({
  __esModule: true,
  default: () => null,
}));

const sampleJob: Job = {
  id: "job-1",
  title: "Build a Soroban escrow contract for marketplace payouts",
  description:
    "Need a secure escrow contract and integration tests for release and refund paths on testnet.",
  budget: "500.0000000",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban", "Testing"],
  status: "open",
  clientAddress: "GCLIENTADDRESS1234567890EXAMPLEABCDEFGHIJKLMNOPQRSTUV",
  applicantCount: 2,
  createdAt: "2026-01-12T10:00:00.000Z",
  updatedAt: "2026-01-12T10:00:00.000Z",
};

describe("component snapshots", () => {
  it("JobCard without bookmark", () => {
    const { container } = render(<JobCard job={sampleJob} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("JobCard with bookmark", () => {
    const { container } = render(
      <JobCard job={{ ...sampleJob, id: "job-bookmarked" }} />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("JobCardSkeleton", () => {
    const { container } = render(<JobCardSkeleton />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("RatingForm", () => {
    const { container } = render(
      <RatingForm
        jobId="job-1"
        ratedAddress="GFREELANCER1234567890EXAMPLEABCDEFGHIJKLMNOPQRSTU"
        ratedLabel="the freelancer"
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("Toast success", () => {
    const { container } = render(
      <ToastSnapshot variant="success" message="Escrow funded successfully" />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("Toast error", () => {
    const { container } = render(
      <ToastSnapshot variant="error" message="Transaction failed" />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("Toast info", () => {
    const { container } = render(
      <ToastSnapshot variant="info" message="Application saved" />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it.each([
    "Newcomer",
    "Rising Star",
    "Expert",
    "Top Talent",
  ] as const)("FreelancerTierBadge %s", (tier) => {
    const { container } = render(<FreelancerTierBadge tier={tier} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("Navbar logged out", () => {
    const { container } = render(
      <Navbar publicKey={null} onConnect={jest.fn()} onDisconnect={jest.fn()} />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("Navbar logged in", () => {
    const { container } = render(
      <Navbar
        publicKey="GCLIENTADDRESS1234567890EXAMPLEABCDEFGHIJKLMNOPQRSTUV"
        onConnect={jest.fn()}
        onDisconnect={jest.fn()}
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
