/**
 * __tests__/bulk-job-action-bar.test.tsx
 * Issue #868 — integration tests for BulkJobActionBar: it should only
 * appear once 2+ jobs are selected, confirm before destructive actions,
 * and surface the succeeded/failed results of each action.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BulkJobActionBar from "@/components/BulkJobActionBar";
import type { BulkActionResponse } from "@/utils/types";

function okResponse(succeeded: number, failed = 0): BulkActionResponse {
  return {
    success: failed === 0,
    succeeded,
    failed,
    processedCount: succeeded + failed,
    failedCount: failed,
    results: [
      ...Array.from({ length: succeeded }, (_, i) => ({ id: `ok-${i}`, success: true as const })),
      ...Array.from({ length: failed }, (_, i) => ({
        id: `bad-${i}`,
        success: false as const,
        error: "not open",
      })),
    ],
  };
}

describe("BulkJobActionBar (#868)", () => {
  it("renders nothing when fewer than 2 jobs are selected", () => {
    const { container } = render(
      <BulkJobActionBar
        selectedCount={1}
        onClose={jest.fn()}
        onDelete={jest.fn()}
        onBoost={jest.fn()}
        onClearSelection={jest.fn()}
        loading={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("appears once 2+ jobs are selected, with all three actions", () => {
    render(
      <BulkJobActionBar
        selectedCount={3}
        onClose={jest.fn()}
        onDelete={jest.fn()}
        onBoost={jest.fn()}
        onClearSelection={jest.fn()}
        loading={false}
      />,
    );
    expect(screen.getByRole("toolbar", { name: /bulk job actions/i })).toBeInTheDocument();
    expect(screen.getByText("Close Selected")).toBeInTheDocument();
    expect(screen.getByText("Delete Selected")).toBeInTheDocument();
    expect(screen.getByText("Boost Selected")).toBeInTheDocument();
  });

  it("requires confirmation before closing jobs, and only calls onClose after confirming", async () => {
    const onClose = jest.fn().mockResolvedValue(okResponse(2));
    render(
      <BulkJobActionBar
        selectedCount={2}
        onClose={onClose}
        onDelete={jest.fn()}
        onBoost={jest.fn()}
        onClearSelection={jest.fn()}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByText("Close Selected"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Close 2 jobs\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Yes, Close"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("requires confirmation before deleting jobs, and 'Keep Jobs' cancels without calling onDelete", () => {
    const onDelete = jest.fn();
    render(
      <BulkJobActionBar
        selectedCount={2}
        onClose={jest.fn()}
        onDelete={onDelete}
        onBoost={jest.fn()}
        onClearSelection={jest.fn()}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByText("Delete Selected"));
    expect(screen.getByText(/Delete 2 jobs\?/)).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Keep Jobs"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("boosting does not require a confirmation dialog", async () => {
    const onBoost = jest.fn().mockResolvedValue(okResponse(2));
    render(
      <BulkJobActionBar
        selectedCount={2}
        onClose={jest.fn()}
        onDelete={jest.fn()}
        onBoost={onBoost}
        onClearSelection={jest.fn()}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByText("Boost Selected"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(onBoost).toHaveBeenCalledTimes(1));
  });

  it("shows a summary of succeeded/failed jobs after a batch action completes", async () => {
    const onDelete = jest.fn().mockResolvedValue(okResponse(1, 1));
    render(
      <BulkJobActionBar
        selectedCount={2}
        onClose={jest.fn()}
        onDelete={onDelete}
        onBoost={jest.fn()}
        onClearSelection={jest.fn()}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByText("Delete Selected"));
    fireEvent.click(screen.getByText("Yes, Delete"));

    await waitFor(() => expect(screen.getByText(/1 succeeded, 1 failed/)).toBeInTheDocument());
    expect(screen.getByText(/not open/)).toBeInTheDocument();
  });

  it("clears the selection via the toolbar's clear button", () => {
    const onClearSelection = jest.fn();
    render(
      <BulkJobActionBar
        selectedCount={2}
        onClose={jest.fn()}
        onDelete={jest.fn()}
        onBoost={jest.fn()}
        onClearSelection={onClearSelection}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByLabelText("Clear selection"));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("disables action buttons while loading", () => {
    render(
      <BulkJobActionBar
        selectedCount={2}
        onClose={jest.fn()}
        onDelete={jest.fn()}
        onBoost={jest.fn()}
        onClearSelection={jest.fn()}
        loading
      />,
    );

    expect(screen.getByText("Close Selected").closest("button")).toBeDisabled();
    expect(screen.getByText("Delete Selected").closest("button")).toBeDisabled();
    expect(screen.getByText("Boost Selected").closest("button")).toBeDisabled();
  });
});
