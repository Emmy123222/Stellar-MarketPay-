import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import CollaborativeEditor from "../scope/CollaborativeEditor";
import "@testing-library/jest-dom";

describe("CollaborativeEditor", () => {
  const mockCursors = {
    "peer-1": { start: 5, end: 5, updatedAt: 100 },
    "my-id": { start: 0, end: 0, updatedAt: 100 },
  };

  it("renders editor textarea and remote cursor indicators", () => {
    const handleChange = jest.fn();
    const handleSelectionChange = jest.fn();

    render(
      <CollaborativeEditor
        documentText="# Initial Scope"
        onChange={handleChange}
        onSelectionChange={handleSelectionChange}
        cursors={mockCursors}
        participantId="my-id"
        hasConflict={false}
        onDismissConflict={jest.fn()}
        onReloadConflict={jest.fn()}
      />,
    );

    const textarea = screen.getByTestId(
      "scope-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe("# Initial Scope");

    // Remote collaborator tag should render
    expect(screen.getByTestId("remote-cursor-peer-1")).toBeInTheDocument();
    expect(screen.queryByTestId("remote-cursor-my-id")).not.toBeInTheDocument();

    // Conflict banner should not be present
    expect(
      screen.queryByTestId("conflict-warning-banner"),
    ).not.toBeInTheDocument();
  });

  it("renders conflict warning banner above editor when hasConflict is true", () => {
    const handleDismiss = jest.fn();
    const handleReload = jest.fn();

    render(
      <CollaborativeEditor
        documentText="# Local edited scope"
        onChange={jest.fn()}
        cursors={mockCursors}
        participantId="my-id"
        hasConflict={true}
        onDismissConflict={handleDismiss}
        onReloadConflict={handleReload}
        serverUpdatedAt="2026-09-27T12:00:00Z"
      />,
    );

    const banner = screen.getByTestId("conflict-warning-banner");
    expect(banner).toBeInTheDocument();

    // Reload button works
    const reloadBtn = screen.getByTestId("conflict-reload-btn");
    fireEvent.click(reloadBtn);
    expect(handleReload).toHaveBeenCalledTimes(1);

    // Dismiss button works
    const dismissBtn = screen.getByTestId("conflict-dismiss-btn");
    fireEvent.click(dismissBtn);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it("handles tab switching between edit, preview, and split", () => {
    const handleSetTab = jest.fn();

    render(
      <CollaborativeEditor
        documentText="# Markdown Heading"
        onChange={jest.fn()}
        cursors={{}}
        participantId="my-id"
        hasConflict={false}
        onDismissConflict={jest.fn()}
        onReloadConflict={jest.fn()}
        previewTab="edit"
        setPreviewTab={handleSetTab}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-preview"));
    expect(handleSetTab).toHaveBeenCalledWith("preview");

    fireEvent.click(screen.getByTestId("tab-split"));
    expect(handleSetTab).toHaveBeenCalledWith("split");
  });
});
