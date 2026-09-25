import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BulkJobActionBar from "../components/BulkJobActionBar";
import type { BulkActionResponse } from "@/utils/types";

describe("BulkJobActionBar — Bulk close confirmation (#1404)", () => {
  const mockSuccessResponse: BulkActionResponse = {
    success: true,
    succeeded: 3,
    failed: 0,
    processedCount: 3,
    failedCount: 0,
    results: [
      { id: "job-1", success: true },
      { id: "job-2", success: true },
      { id: "job-3", success: true },
    ],
  };

  const defaultProps = {
    selectedCount: 3,
    onExtend: jest.fn().mockResolvedValue(mockSuccessResponse),
    onBoost: jest.fn().mockResolvedValue(mockSuccessResponse),
    onClearSelection: jest.fn(),
    loading: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render when selectedCount is 0", () => {
    const { container } = render(
      <BulkJobActionBar
        {...defaultProps}
        selectedCount={0}
        onCancel={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("clicking 'Close selected' displays the confirmation dialog with 'You are about to close N jobs. This cannot be undone.'", () => {
    const onCancel = jest.fn();
    render(
      <BulkJobActionBar
        {...defaultProps}
        selectedCount={3}
        onCancel={onCancel}
      />
    );

    // Dialog should not be open initially
    expect(
      screen.queryByText("You are about to close 3 jobs. This cannot be undone.")
    ).not.toBeInTheDocument();

    // Click "Close selected"
    const closeBtn = screen.getByRole("button", { name: /close selected/i });
    fireEvent.click(closeBtn);

    // Confirmation dialog should be visible with expected text
    expect(
      screen.getByText("You are about to close 3 jobs. This cannot be undone.")
    ).toBeInTheDocument();
    expect(screen.getByText("Close 3 Jobs")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("clicking 'Cancel' in confirmation dialog returns to selection state without proceeding", () => {
    const onCancel = jest.fn();
    const onClearSelection = jest.fn();

    render(
      <BulkJobActionBar
        {...defaultProps}
        selectedCount={2}
        onCancel={onCancel}
        onClearSelection={onClearSelection}
      />
    );

    // Open confirmation dialog
    fireEvent.click(screen.getByRole("button", { name: /close selected/i }));
    expect(
      screen.getByText("You are about to close 2 jobs. This cannot be undone.")
    ).toBeInTheDocument();

    // Click Cancel in dialog
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    // Dialog should be closed
    expect(
      screen.queryByText("You are about to close 2 jobs. This cannot be undone.")
    ).not.toBeInTheDocument();

    // Should not have executed cancel and should not have cleared selection
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClearSelection).not.toHaveBeenCalled();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/jobs selected/i)).toBeInTheDocument();
  });

  it("clicking 'Confirm' in confirmation dialog proceeds with closing jobs", async () => {
    const onCancel = jest.fn().mockResolvedValue(mockSuccessResponse);

    render(
      <BulkJobActionBar
        {...defaultProps}
        selectedCount={3}
        onCancel={onCancel}
      />
    );

    // Open dialog
    fireEvent.click(screen.getByRole("button", { name: /close selected/i }));

    // Click Confirm
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    // Confirmation dialog closes after confirm
    await waitFor(() => {
      expect(
        screen.queryByText("You are about to close 3 jobs. This cannot be undone.")
      ).not.toBeInTheDocument();
    });
  });

  it("supports onClose prop as an alias for onCancel", async () => {
    const onClose = jest.fn().mockResolvedValue(mockSuccessResponse);

    render(
      <BulkJobActionBar
        {...defaultProps}
        selectedCount={4}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /close selected/i }));
    expect(
      screen.getByText("You are about to close 4 jobs. This cannot be undone.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
