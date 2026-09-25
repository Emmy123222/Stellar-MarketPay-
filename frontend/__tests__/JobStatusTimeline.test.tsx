import { render, screen, fireEvent } from "@testing-library/react";
import JobStatusTimeline from "@/components/JobStatusTimeline";
import { sampleJob } from "./helpers/fixtures";

describe("JobStatusTimeline status tooltips (Issue #1431)", () => {
  it("renders an info icon button for each status node", () => {
    render(<JobStatusTimeline job={sampleJob} />);

    // Check desktop status nodes have info icon buttons
    expect(
      screen.getAllByRole("button", { name: "Info about Posted status" }).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Info about Hired status" }).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Info about Escrow Funded status" }).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Info about Released status" }).length
    ).toBeGreaterThan(0);
  });

  it("shows tooltip on hover with meaning and whose turn it is to act", () => {
    render(<JobStatusTimeline job={sampleJob} />);

    const infoButtons = screen.getAllByRole("button", { name: "Info about Escrow Funded status" });
    const infoButton = infoButtons[0];

    // Tooltip should not be visible before hover
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Hover to trigger tooltip
    fireEvent.mouseEnter(infoButton);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent(/Escrow funds are locked securely on-chain/i);
    expect(tooltip).toHaveTextContent(/Whose turn:/i);
    expect(tooltip).toHaveTextContent(/Freelancer is actively working on agreed deliverables/i);

    // Mouse leave hides tooltip
    fireEvent.mouseLeave(infoButton);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on keyboard focus (focus-triggered) and closes on blur or Escape", () => {
    render(<JobStatusTimeline job={sampleJob} />);

    const infoButtons = screen.getAllByRole("button", { name: "Info about Hired status" });
    const infoButton = infoButtons[0];

    // Keyboard focus triggers tooltip
    fireEvent.focus(infoButton);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent(/A freelancer has been selected/i);
    expect(tooltip).toHaveTextContent(/Whose turn:/i);
    expect(tooltip).toHaveTextContent(/Client needs to fund the escrow/i);

    // Escape closes tooltip
    fireEvent.keyDown(infoButton, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Re-focus and blur
    fireEvent.focus(infoButton);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(infoButton);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("displays tooltip for disputed branch status node", () => {
    const disputedJob = { ...sampleJob, status: "disputed" as const };
    render(<JobStatusTimeline job={disputedJob} />);

    const disputedButtons = screen.getAllByRole("button", { name: "Info about Disputed status" });
    expect(disputedButtons.length).toBeGreaterThan(0);

    fireEvent.focus(disputedButtons[0]);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent(/A dispute has been raised/i);
    expect(tooltip).toHaveTextContent(/Both client and freelancer must submit evidence/i);
  });
});
