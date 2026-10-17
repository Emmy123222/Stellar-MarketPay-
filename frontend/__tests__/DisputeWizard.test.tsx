import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DisputeWizard from "@/components/DisputeWizard";
import { raiseDispute, uploadDisputeEvidence } from "@/lib/api";
import "@testing-library/jest-dom";

jest.mock("@/lib/api", () => ({
  raiseDispute: jest.fn().mockResolvedValue({ id: "job-123", status: "disputed" }),
  uploadDisputeEvidence: jest.fn().mockResolvedValue({ id: "ev-1" }),
}));

describe("Dispute Resolution Helper Chatbot (Issue #1557)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the 5-step guided flow and displays contextual tips at each step", async () => {
    render(<DisputeWizard jobId="job-456" isOpen={true} />);

    // --- STEP 1: Describe Issue ---
    expect(screen.getByText("Dispute Resolution Helper")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByTestId("contextual-tip")).toHaveTextContent(
      "Tip: Focus on objective differences between the original job specifications and what was delivered."
    );

    // Change category to Non-delivery and verify contextual tip changes
    const nonDeliveryBtn = screen.getByText("Non-delivery / Missed Deadline");
    fireEvent.click(nonDeliveryBtn);
    expect(screen.getByTestId("contextual-tip")).toHaveTextContent(
      "Tip: Note the agreed milestone delivery date and when you last attempted contact."
    );

    // Fill description
    const descInput = screen.getByPlaceholderText(/Explain specifically what happened/i);
    fireEvent.change(descInput, { target: { value: "Freelancer failed to deliver smart contracts on time." } });

    // Proceed to Step 2
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));

    // --- STEP 2: Timeline of Events ---
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByTestId("contextual-tip")).toHaveTextContent(
      "Tip: Dates, milestone deadlines, and communication attempts in chronological order make your case significantly easier to rule on."
    );

    // Add a new timeline event
    const eventInput = screen.getByLabelText("Event description");
    fireEvent.change(eventInput, { target: { value: "Sent warning email regarding deadline." } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Event" }));
    expect(screen.getByText("Sent warning email regarding deadline.")).toBeInTheDocument();

    // Proceed to Step 3
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));

    // --- STEP 3: Desired Resolution ---
    expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
    expect(screen.getByTestId("contextual-tip")).toHaveTextContent(
      "Tip: Proposing a proportional resolution (e.g. partial refund for work completed) shows good faith and often leads to faster rulings."
    );

    // Select Partial Refund
    fireEvent.click(screen.getByText("Partial Refund"));
    expect(screen.getByText(/Refund to Client: 50%/i)).toBeInTheDocument();

    // Proceed to Step 4
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));

    // --- STEP 4: Upload Evidence ---
    expect(screen.getByText("Step 4 of 5")).toBeInTheDocument();
    // Contextual tip explicitly mentions "Screenshots of deliverables are most useful"
    expect(screen.getByTestId("contextual-tip")).toHaveTextContent(
      "Screenshots of deliverables are most useful"
    );

    // Upload a test file
    const file = new File(["dummy content"], "evidence-screenshot.png", { type: "image/png" });
    const dropzone = screen.getByText(/Drag and drop evidence files here/i);
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });
    expect(screen.getByText("evidence-screenshot.png")).toBeInTheDocument();

    // Proceed to Step 5
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));

    // --- STEP 5: Review & Submit ---
    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    expect(screen.getByText("Pre-filled Dispute Form")).toBeInTheDocument();
    expect(screen.getAllByText("Non-delivery").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 file\(s\) attached \(evidence-screenshot\.png\)/i)).toBeInTheDocument();
  });

  it("pre-fills the dispute form with collected data before submission", async () => {
    const handlePrefill = jest.fn();
    const handleComplete = jest.fn();

    render(
      <DisputeWizard
        jobId="job-789"
        isOpen={true}
        onPrefillForm={handlePrefill}
        onComplete={handleComplete}
      />
    );

    // Navigate to step 5
    for (let i = 1; i <= 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));
    }

    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();

    // Click "Pre-fill Dispute Form" button
    const prefillBtn = screen.getByRole("button", { name: "Pre-fill Dispute Form" });
    fireEvent.click(prefillBtn);

    expect(handlePrefill).toHaveBeenCalledTimes(1);
    expect(handlePrefill).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Quality of work",
        description: expect.stringContaining("## Dispute Summary"),
      })
    );
  });

  it("submits dispute via API with synthesized description and evidence upload", async () => {
    const handleComplete = jest.fn();

    render(
      <DisputeWizard
        jobId="job-999"
        isOpen={true}
        onComplete={handleComplete}
      />
    );

    // Fill description in step 1
    const descInput = screen.getByPlaceholderText(/Explain specifically what happened/i);
    fireEvent.change(descInput, { target: { value: "Smart contract has critical reentrancy bug." } });

    // Step 1 -> 4
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));

    // In step 4, add a file
    const file = new File(["test code"], "audit_report.pdf", { type: "application/pdf" });
    const dropzone = screen.getByText(/Drag and drop evidence files here/i);
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });

    // Step 4 -> 5
    fireEvent.click(screen.getByRole("button", { name: "Next Step →" }));

    // Submit Dispute
    const submitBtn = screen.getByRole("button", { name: "Submit Dispute" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(raiseDispute).toHaveBeenCalledWith(
        "job-999",
        expect.objectContaining({
          reason: "Quality of work",
          description: expect.stringContaining("Smart contract has critical reentrancy bug."),
        })
      );
      expect(uploadDisputeEvidence).toHaveBeenCalledWith("job-999", file);
      expect(screen.getByText("Dispute Filed Successfully")).toBeInTheDocument();
    });
  });
});
