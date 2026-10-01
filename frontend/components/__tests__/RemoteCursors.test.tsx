import React from "react";
import { render, screen } from "@testing-library/react";
import RemoteCursors, {
  getCollaboratorColor,
  getCursorPosition,
} from "../scope/RemoteCursors";
import "@testing-library/jest-dom";

describe("RemoteCursors", () => {
  const mockCursors = {
    "user-alpha": { start: 10, end: 10, updatedAt: 1000 },
    "user-beta": { start: 25, end: 35, updatedAt: 2000 },
    "current-user": { start: 5, end: 5, updatedAt: 3000 },
  };

  const sampleDoc =
    "Line 1: Hello World\nLine 2: MarketPay Collaborative Scope\nLine 3: Milestone details";

  it("filters out the current user's cursor and renders remote collaborators", () => {
    render(
      <RemoteCursors
        cursors={mockCursors}
        currentParticipantId="current-user"
        documentText={sampleDoc}
      />,
    );

    // Current user's cursor should not be rendered
    expect(
      screen.queryByTestId("remote-cursor-current-user"),
    ).not.toBeInTheDocument();

    // Remote cursors should be rendered
    expect(screen.getByTestId("remote-cursor-user-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("remote-cursor-user-beta")).toBeInTheDocument();

    // Labels
    expect(screen.getByText("user-alp")).toBeInTheDocument();
    expect(screen.getByText("user-bet")).toBeInTheDocument();
  });

  it("renders nothing when no remote cursors are active", () => {
    const { container } = render(
      <RemoteCursors
        cursors={{ "current-user": { start: 0, end: 0, updatedAt: 1000 } }}
        currentParticipantId="current-user"
        documentText={sampleDoc}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("calculates cursor line and column correctly", () => {
    const pos1 = getCursorPosition(sampleDoc, 5); // Line 1, Col 6
    expect(pos1.line).toBe(1);
    expect(pos1.col).toBe(6);

    const pos2 = getCursorPosition(sampleDoc, 25); // In Line 2
    expect(pos2.line).toBe(2);
  });

  it("returns deterministic distinct colors for different collaborators", () => {
    const color1 = getCollaboratorColor("collaborator-1", 0);
    const color2 = getCollaboratorColor("collaborator-2", 1);
    expect(typeof color1).toBe("string");
    expect(typeof color2).toBe("string");
    expect(color1.startsWith("#")).toBe(true);
  });
});
