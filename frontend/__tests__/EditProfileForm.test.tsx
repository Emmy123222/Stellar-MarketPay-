import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EditProfileForm from "@/components/EditProfileForm";
import { fetchProfile, upsertProfile, updateProfileAvailability } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  fetchProfile: jest.fn(),
  upsertProfile: jest.fn(),
  updateProfileAvailability: jest.fn(),
  uploadPortfolioFiles: jest.fn(),
}));

describe("EditProfileForm avatar validation (Issue #1406)", () => {
  const MOCK_PK = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  beforeEach(() => {
    jest.clearAllMocks();
    (fetchProfile as jest.Mock).mockResolvedValue({
      publicKey: MOCK_PK,
      displayName: "Alice Dev",
      bio: "Blockchain engineer",
      role: "freelancer",
      skills: ["Rust", "TypeScript"],
      portfolioItems: [],
      portfolioFiles: [],
      availability: { status: "available" },
    });
    (upsertProfile as jest.Mock).mockResolvedValue({});
    (updateProfileAvailability as jest.Mock).mockResolvedValue({
      availability: { status: "available" },
    });
  });

  it("shows an immediate inline error when selected avatar exceeds 5MB", async () => {
    render(<EditProfileForm publicKey={MOCK_PK} />);

    // Wait for profile to load
    await waitFor(() => {
      expect(screen.getByDisplayValue("Alice Dev")).toBeInTheDocument();
    });

    const fileInput = screen.getByTestId("avatar-upload-input");

    // Create a 6MB JPEG file (6 * 1024 * 1024 + 1 bytes)
    const largeFile = new File([new Uint8Array(6 * 1024 * 1024 + 1)], "large-avatar.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    // Inline error message should be displayed immediately
    const errorMsg = await screen.findByRole("alert");
    expect(errorMsg).toHaveTextContent(/exceeds 5MB limit/i);
    expect(screen.queryByAltText("Avatar preview")).not.toBeInTheDocument();
  });

  it("shows an immediate inline error when selected avatar has invalid MIME type", async () => {
    render(<EditProfileForm publicKey={MOCK_PK} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Alice Dev")).toBeInTheDocument();
    });

    const fileInput = screen.getByTestId("avatar-upload-input");

    // Create a 1MB PDF file
    const pdfFile = new File([new Uint8Array(1024 * 1024)], "document.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    // Inline error message should be displayed immediately
    const errorMsg = await screen.findByRole("alert");
    expect(errorMsg).toHaveTextContent(/invalid file type/i);
    expect(errorMsg).toHaveTextContent(/jpeg, png, and webp/i);
    expect(screen.queryByAltText("Avatar preview")).not.toBeInTheDocument();
  });

  it("accepts valid image (JPEG/PNG/WebP <= 5MB) and clears previous inline errors", async () => {
    render(<EditProfileForm publicKey={MOCK_PK} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Alice Dev")).toBeInTheDocument();
    });

    const fileInput = screen.getByTestId("avatar-upload-input");

    // First trigger invalid file error
    const invalidFile = new File(["dummy"], "test.gif", { type: "image/gif" });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid file type/i);

    // Mock FileReader for valid upload
    const mockDataUrl = "data:image/png;base64,validImageData";
    const originalFileReader = window.FileReader;
    const mockFileReaderInstance = {
      readAsDataURL: jest.fn(function (this: any) {
        if (this.onload) {
          this.onload({ target: { result: mockDataUrl } });
        }
      }),
      onload: null as any,
    };
    window.FileReader = jest.fn(() => mockFileReaderInstance) as any;

    // Now select a valid 2MB PNG image
    const validFile = new File([new Uint8Array(2 * 1024 * 1024)], "valid-avatar.png", {
      type: "image/png",
    });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    // Error should be cleared immediately
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    // Preview should be visible
    expect(await screen.findByAltText("Avatar preview")).toHaveAttribute("src", mockDataUrl);

    window.FileReader = originalFileReader;
  });
});
