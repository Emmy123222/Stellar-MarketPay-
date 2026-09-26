import { render, screen } from "@testing-library/react";
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
});