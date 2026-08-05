import { render, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import React from "react";

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/",
    push: jest.fn(),
    query: {},
    isReady: true,
  }),
}));

jest.mock("@/components/WalletConnect", () => () => <button type="button">Connect Wallet</button>);
jest.mock("@/components/PostJobForm", () => () => <form aria-label="Post job form"><input aria-label="Job title" /></form>);
jest.mock("@/lib/offlineJobs", () => ({
  getLastViewedJobs: () => [],
}));
jest.mock("@/lib/api", () => ({
  fetchHealthStatus: jest.fn().mockResolvedValue({
    status: "healthy",
    database: { status: "ok", latency_ms: 12 },
    stellar: { status: "ok", ledger: 123 },
    ipfs: { status: "ok" },
  }),
  fetchHealthHistory: jest.fn().mockResolvedValue({
    database: [],
    stellar: [],
    ipfs: [],
  }),
  subscribeStatusAlerts: jest.fn().mockResolvedValue({ success: true }),
  fetchRecentlyCompletedJobs: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/hooks/useCountUp", () => () => ({
  animatedValue: "0",
  elementRef: { current: null },
}));

import Home from "@/pages/index";
import Custom404 from "@/pages/404";
import OfflinePage from "@/pages/offline";
import StatusPage from "@/pages/status";
import PostJob from "@/pages/post-job";

describe("frontend page accessibility", () => {
  it("home page has no serious axe violations", async () => {
    const { container } = render(
      <Home publicKey={null} onConnect={jest.fn()} completedJobs={[]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("404 page has no serious axe violations", async () => {
    const { container } = render(<Custom404 />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offline page has no serious axe violations", async () => {
    const { container } = render(<OfflinePage />);
    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("status page has no serious axe violations", async () => {
    const { container } = render(<StatusPage />);
    await waitFor(() => {
      expect(container.textContent).toContain("System Status");
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("post job page has no serious axe violations", async () => {
    const { container } = render(<PostJob publicKey={null} onConnect={jest.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
