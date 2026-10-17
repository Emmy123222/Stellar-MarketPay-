import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccessibleModal from "@/components/AccessibleModal";

describe("AccessibleModal", () => {
  it("renders the description referenced by the dialog", () => {
    render(
      <AccessibleModal
        titleId="modal-title"
        description="Review the transaction details before signing."
        onClose={jest.fn()}
      >
        <h2 id="modal-title">Confirm transaction</h2>
      </AccessibleModal>,
    );

    const dialog = screen.getByRole("dialog");
    const description = screen.getByText(
      "Review the transaction details before signing.",
    );

    expect(dialog).toHaveAttribute("aria-describedby", "modal-description");
    expect(description).toHaveAttribute("id", "modal-description");
  });

  it("exposes modal dialog semantics labelled by its title", () => {
    render(
      <AccessibleModal titleId="t" description="d" onClose={jest.fn()}>
        <h2 id="t">Title</h2>
      </AccessibleModal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Title" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("supports a custom description id", () => {
    render(
      <AccessibleModal
        titleId="t"
        description="d"
        descriptionId="custom-desc"
        onClose={jest.fn()}
      >
        <h2 id="t">Title</h2>
      </AccessibleModal>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-describedby",
      "custom-desc",
    );
  });

  it("moves focus into the dialog on open", () => {
    render(
      <AccessibleModal titleId="t" description="d" onClose={jest.fn()}>
        <h2 id="t">Title</h2>
        <button>First</button>
        <button>Second</button>
      </AccessibleModal>,
    );
    expect(screen.getByText("First")).toHaveFocus();
  });

  it("focuses the dialog itself when it has no focusable children", () => {
    render(
      <AccessibleModal titleId="t" description="d" onClose={jest.fn()}>
        <h2 id="t">Title</h2>
      </AccessibleModal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("closes on Escape", () => {
    const onClose = jest.fn();
    render(
      <AccessibleModal titleId="t" description="d" onClose={onClose}>
        <h2 id="t">Title</h2>
        <button>Only</button>
      </AccessibleModal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = jest.fn();
    render(
      <AccessibleModal titleId="t" description="d" onClose={onClose}>
        <h2 id="t">Title</h2>
      </AccessibleModal>,
    );
    fireEvent.click(screen.getByLabelText("Close dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Outside before</button>
        <AccessibleModal titleId="t" description="d" onClose={jest.fn()}>
          <h2 id="t">Title</h2>
          <button>First</button>
          <button>Middle</button>
          <button>Last</button>
        </AccessibleModal>
        <button>Outside after</button>
      </>,
    );

    expect(screen.getByText("First")).toHaveFocus();
    await user.tab();
    expect(screen.getByText("Middle")).toHaveFocus();
    await user.tab();
    expect(screen.getByText("Last")).toHaveFocus();

    // Tab from the last control wraps to the first, never to the page behind.
    await user.tab();
    expect(screen.getByText("First")).toHaveFocus();

    // Shift+Tab from the first control wraps to the last.
    await user.tab({ shift: true });
    expect(screen.getByText("Last")).toHaveFocus();
  });

  it("restores focus to the trigger when closed", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <AccessibleModal
              titleId="t"
              description="d"
              onClose={() => setOpen(false)}
            >
              <h2 id="t">Title</h2>
              <button>Inside</button>
            </AccessibleModal>
          )}
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByText("Open");
    await user.click(trigger);
    expect(screen.getByText("Inside")).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps focus where the user put it when the parent re-renders with a new onClose", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [count, setCount] = useState(0);
      return (
        <AccessibleModal
          titleId="t"
          description="d"
          onClose={() => setCount(count + 1)} // new function identity each render
        >
          <h2 id="t">Title</h2>
          <button>First</button>
          <button onClick={() => setCount(count + 1)}>Second {count}</button>
        </AccessibleModal>
      );
    }
    render(<Harness />);

    await user.tab();
    const second = screen.getByText(/Second/);
    expect(second).toHaveFocus();
    await user.click(second);
    expect(screen.getByText(/Second 1/)).toHaveFocus();
  });

  describe("dismissible={false}", () => {
    it("ignores Escape and has no clickable backdrop", () => {
      const onClose = jest.fn();
      render(
        <AccessibleModal
          titleId="t"
          description="d"
          onClose={onClose}
          dismissible={false}
        >
          <h2 id="t">Title</h2>
          <button>Only</button>
        </AccessibleModal>,
      );
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Close dialog")).not.toBeInTheDocument();
    });

    it("still traps focus", async () => {
      const user = userEvent.setup();
      render(
        <AccessibleModal
          titleId="t"
          description="d"
          onClose={jest.fn()}
          dismissible={false}
        >
          <h2 id="t">Title</h2>
          <button>A</button>
          <button>B</button>
        </AccessibleModal>,
      );
      await user.tab();
      await user.tab();
      expect(screen.getByText("A")).toHaveFocus();
    });
  });
});
