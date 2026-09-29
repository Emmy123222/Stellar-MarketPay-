import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RealtimeBidComparison from "@/components/RealtimeBidComparison";
import * as applicationsApi from "@/lib/api/applications";
import type { Application } from "@/utils/types";

jest.mock("@/lib/api/applications", () => ({
  bulkUpdateApplications: jest.fn(),
  fetchApplications: jest.fn(),
}));

jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

const mockApplications: Application[] = [
  {
    id: "app-1",
    jobId: "job-1",
    freelancerAddress: "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
    freelancerTier: "Rising Talent",
    proposal: "First proposal that meets all criteria and has ample detail.",
    bidAmount: "500",
    currency: "XLM",
    status: "pending",
    createdAt: "2026-09-20T10:00:00Z",
  },
  {
    id: "app-2",
    jobId: "job-1",
    freelancerAddress: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    freelancerTier: "Top Rated",
    proposal: "Second proposal from a top-rated developer ready to work.",
    bidAmount: "600",
    currency: "XLM",
    status: "pending",
    createdAt: "2026-09-21T10:00:00Z",
  },
];

describe("Bulk Application Management", () => {
  const clientAddress = "G" + "A".repeat(55);

  beforeEach(() => {
    jest.clearAllMocks();
    (applicationsApi.bulkUpdateApplications as jest.Mock).mockResolvedValue({
      updatedCount: 2,
      status: "shortlisted",
      applications: mockApplications,
    });
  });

  it("renders checkboxes and bulk toolbar for client", () => {
    render(
      <RealtimeBidComparison
        jobId="job-1"
        initialApplications={mockApplications}
        isClient={true}
        clientAddress={clientAddress}
      />,
    );

    expect(screen.getByText(/Select All/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Shortlist Selected/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reject Selected/i })).toBeDisabled();

    const checkbox1 = screen.getByLabelText(/Select application from GBBC/i);
    expect(checkbox1).toBeInTheDocument();
  });

  it("does not render checkboxes or bulk toolbar for non-client", () => {
    render(
      <RealtimeBidComparison
        jobId="job-1"
        initialApplications={mockApplications}
        isClient={false}
      />,
    );

    expect(screen.queryByText(/Select All/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Shortlist Selected/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Select application/i)).not.toBeInTheDocument();
  });

  it("enables bulk actions when items are selected and shortlists them", async () => {
    render(
      <RealtimeBidComparison
        jobId="job-1"
        initialApplications={mockApplications}
        isClient={true}
        clientAddress={clientAddress}
      />,
    );

    const checkbox1 = screen.getByLabelText(/Select application from GBBC/i);
    fireEvent.click(checkbox1);

    const shortlistBtn = screen.getByRole("button", { name: /Shortlist Selected/i });
    expect(shortlistBtn).not.toBeDisabled();

    fireEvent.click(shortlistBtn);

    await waitFor(() => {
      expect(applicationsApi.bulkUpdateApplications).toHaveBeenCalledWith({
        applicationIds: ["app-1"],
        action: "shortlist",
        clientAddress,
      });
    });
  });

  it("opens confirmation dialog on reject and calls bulk update when confirmed", async () => {
    (applicationsApi.bulkUpdateApplications as jest.Mock).mockResolvedValue({
      updatedCount: 1,
      status: "rejected",
      applications: [{ ...mockApplications[0], status: "rejected" }],
    });

    render(
      <RealtimeBidComparison
        jobId="job-1"
        initialApplications={mockApplications}
        isClient={true}
        clientAddress={clientAddress}
      />,
    );

    const checkbox1 = screen.getByLabelText(/Select application from GBBC/i);
    fireEvent.click(checkbox1);

    const rejectBtn = screen.getByRole("button", { name: /Reject Selected/i });
    expect(rejectBtn).not.toBeDisabled();

    fireEvent.click(rejectBtn);

    expect(screen.getByText(/Reject Selected Applications/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to reject 1 selected application/i),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /Reject Applications/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(applicationsApi.bulkUpdateApplications).toHaveBeenCalledWith({
        applicationIds: ["app-1"],
        action: "reject",
        clientAddress,
      });
    });
  });

  it("highlights shortlisted application and displays badge", () => {
    const appsWithShortlist: Application[] = [
      {
        ...mockApplications[0],
        status: "shortlisted",
      },
      mockApplications[1],
    ];

    render(
      <RealtimeBidComparison
        jobId="job-1"
        initialApplications={appsWithShortlist}
        isClient={true}
        clientAddress={clientAddress}
      />,
    );

    expect(screen.getByText("★ Shortlisted")).toBeInTheDocument();
  });
});
