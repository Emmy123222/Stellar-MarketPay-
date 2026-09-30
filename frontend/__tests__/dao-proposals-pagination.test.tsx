/**
 * __tests__/dao-proposals-pagination.test.tsx
 * Issue #1405 — DAO proposal list loads 20 proposals at a time via cursor
 * pagination with a "Load more" button and a loading state between pages.
 */
import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import DAO from "@/pages/dao";
import * as api from "@/lib/api";
import type { DaoProposal, DaoProposalPage } from "@/lib/api";

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", t: (key: string) => key },
    ready: true,
  }),
}));

// Stable identity: the page's loadData callback depends on `toast`.
const mockToastError = jest.fn();
const mockToast = { success: jest.fn(), error: mockToastError, info: jest.fn() };
jest.mock("@/components/Toast", () => ({
  useToast: () => mockToast,
}));

jest.mock("@/components/WalletConnect", () => ({
  __esModule: true,
  default: () => <div data-testid="wallet-connect" />,
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("0"),
}));

jest.mock("@/lib/api", () => ({
  fetchDaoProposalsPage: jest.fn(),
  fetchDaoTreasury: jest.fn(),
  fetchDaoArbitrators: jest.fn(),
  createDaoProposal: jest.fn(),
  voteDaoProposal: jest.fn(),
  registerDaoArbitrator: jest.fn(),
  voteDaoArbitrator: jest.fn(),
}));

const fetchPage = api.fetchDaoProposalsPage as jest.Mock;

function makeProposal(n: number): DaoProposal {
  return {
    id: `prop-${n}`,
    title: `Proposal ${n}`,
    description: `Description ${n}`,
    type: "platform",
    proposer: "G" + "A".repeat(55),
    votesFor: 0,
    votesAgainst: 0,
    status: "passed",
    createdAt: new Date(2026, 0, 1).toISOString(),
    votingEndsAt: new Date(2026, 0, 8).toISOString(),
  };
}

function range(from: number, to: number): DaoProposal[] {
  return Array.from({ length: to - from + 1 }, (_, i) => makeProposal(from + i));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderPage() {
  render(<DAO publicKey={null} onConnect={jest.fn()} />);
  await screen.findByText("Proposal 1");
}

describe("DAO proposals pagination (#1405)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.fetchDaoTreasury as jest.Mock).mockResolvedValue({
      allocatedXlm: "0",
      activeProposals: 0,
      quorumPercent: 10,
    });
    (api.fetchDaoArbitrators as jest.Mock).mockResolvedValue({
      arbitrators: [],
      disputePanel: [],
    });
  });

  it("requests the first page with limit=20 and renders 20 proposals", async () => {
    fetchPage.mockResolvedValueOnce({ proposals: range(1, 20), nextCursor: "c1" });

    await renderPage();

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({ limit: 20 });
    expect(screen.getAllByRole("heading", { level: 3, name: /^Proposal \d+$/ })).toHaveLength(20);
    expect(screen.getByRole("button", { name: "dao.loadMore" })).toBeInTheDocument();
  });

  it("appends the next page using the cursor when Load more is clicked", async () => {
    fetchPage
      .mockResolvedValueOnce({ proposals: range(1, 20), nextCursor: "c1" })
      .mockResolvedValueOnce({ proposals: range(21, 25), nextCursor: null });

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "dao.loadMore" }));

    await screen.findByText("Proposal 25");
    expect(fetchPage).toHaveBeenLastCalledWith({ limit: 20, cursor: "c1" });
    expect(screen.getByText("Proposal 1")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3, name: /^Proposal \d+$/ })).toHaveLength(25);
  });

  it("hides Load more when there is no next page", async () => {
    fetchPage.mockResolvedValueOnce({ proposals: range(1, 5), nextCursor: null });

    await renderPage();

    expect(screen.queryByRole("button", { name: "dao.loadMore" })).not.toBeInTheDocument();
  });

  it("shows a loading state while the next page is fetched and keeps existing proposals", async () => {
    const next = deferred<DaoProposalPage>();
    fetchPage
      .mockResolvedValueOnce({ proposals: range(1, 20), nextCursor: "c1" })
      .mockReturnValueOnce(next.promise);

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "dao.loadMore" }));

    const button = await screen.findByRole("button", { name: "dao.loadingMore" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("dao-proposals-loading-more")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("dao.loadingMore");
    expect(screen.getByText("Proposal 1")).toBeInTheDocument();

    // A second click while loading must not fire another request.
    fireEvent.click(button);
    expect(fetchPage).toHaveBeenCalledTimes(2);

    await act(async () => {
      next.resolve({ proposals: range(21, 22), nextCursor: null });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("dao-proposals-loading-more")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Proposal 22")).toBeInTheDocument();
  });

  it("keeps loaded proposals and the cursor when loading more fails", async () => {
    fetchPage
      .mockResolvedValueOnce({ proposals: range(1, 20), nextCursor: "c1" })
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ proposals: range(21, 21), nextCursor: null });

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "dao.loadMore" }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("Failed to load more proposals"));
    expect(screen.getByText("Proposal 20")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "dao.loadMore" }));
    await screen.findByText("Proposal 21");
    expect(fetchPage).toHaveBeenLastCalledWith({ limit: 20, cursor: "c1" });
  });
});
