import { fireEvent, render, screen } from "@testing-library/react";
import CertificatePage from "@/pages/certificates/[id]";
import { fetchCertificate } from "@/lib/api";

const mockFetchCertificate = fetchCertificate as jest.MockedFunction<typeof fetchCertificate>;

jest.mock("@/lib/api", () => ({
  fetchCertificate: jest.fn(),
}));

const CERTIFICATE = {
  id: "token-123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  displayName: "Ada Lovelace",
  skill: "rust",
  score: 98,
  certificateHash: "hash-123",
  ipfsCid: null,
  txHash: null,
  issuedAt: "2026-09-25T00:00:00.000Z",
  verifyUrl: "https://stellar.expert/verify/hash-123",
};

jest.mock("next/router", () => ({
  useRouter: () => ({
    query: { id: "token-123" },
    isReady: true,
  }),
}));

describe("CertificatePage sharing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchCertificate.mockResolvedValue(CERTIFICATE);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    (window.matchMedia as jest.Mock).mockReturnValue({ matches: false });
  });

  it("copies the public certificate URL on desktop", async () => {
    render(
      <CertificatePage
        initialCertificate={CERTIFICATE}
        ogBaseUrl="https://marketpay.example"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Share Certificate" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://marketpay.example/certificates/token-123",
    );
    expect(await screen.findByRole("button", { name: "Link copied!" })).toBeInTheDocument();
  });

  it("uses the Web Share API on mobile", async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    (window.matchMedia as jest.Mock).mockReturnValue({ matches: true });

    render(
      <CertificatePage
        initialCertificate={CERTIFICATE}
        ogBaseUrl="https://marketpay.example"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Share Certificate" }));

    expect(share).toHaveBeenCalledWith({
      title: "Rust Certificate · MarketPay",
      text: "Verified rust skill certificate issued by Stellar MarketPay",
      url: "https://marketpay.example/certificates/token-123",
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
