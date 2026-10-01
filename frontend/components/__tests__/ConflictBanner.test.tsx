import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ConflictBanner from "../scope/ConflictBanner";
import "@testing-library/jest-dom";

describe("ConflictBanner", () => {
  it("renders conflict warning message and action buttons", () => {
    const handleDismiss = jest.fn();
    const handleReload = jest.fn();

    render(
      <ConflictBanner
        onDismiss={handleDismiss}
        onReload={handleReload}
        serverUpdatedAt="2026-09-27T10:00:00Z"
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Conflict detected — your changes may have been overwritten",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Reload latest server content/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Dismiss/i }),
    ).toBeInTheDocument();
  });

  it("triggers onReload when reload button is clicked", () => {
    const handleDismiss = jest.fn();
    const handleReload = jest.fn();

    render(
      <ConflictBanner onDismiss={handleDismiss} onReload={handleReload} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Reload latest server content/i }),
    );
    expect(handleReload).toHaveBeenCalledTimes(1);
    expect(handleDismiss).not.toHaveBeenCalled();
  });

  it("triggers onDismiss when dismiss button is clicked", () => {
    const handleDismiss = jest.fn();
    const handleReload = jest.fn();

    render(
      <ConflictBanner onDismiss={handleDismiss} onReload={handleReload} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(handleDismiss).toHaveBeenCalledTimes(1);
    expect(handleReload).not.toHaveBeenCalled();
  });
});
