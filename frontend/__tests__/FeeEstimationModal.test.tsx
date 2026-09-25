import { act, render, screen } from "@testing-library/react";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import { estimateSorobanFee } from "@/lib/sorobanFees";
import { getXLMBalance } from "@/lib/stellar";

jest.mock("@/lib/sorobanFees", () => ({
  describeContractCall: () => "Submit payment",
  estimateSorobanFee: jest.fn(),
  stroopsToXlm: () => "0.01",
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn(),
}));

jest.mock("@/contexts/PriceContext", () => ({
  usePriceContext: () => ({ xlmPriceUsd: 1 }),
}));

const mockTransaction = {} as Parameters<typeof estimateSorobanFee>[0];

describe("FeeEstimationModal", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(estimateSorobanFee).mockResolvedValue({
      totalStroops: BigInt(100_000),
      totalXlm: "0.01",
      totalUsd: 0.01,
      resourceFeeStroops: BigInt(90_000),
      inclusionFeeStroops: BigInt(10_000),
    });
    jest.mocked(getXLMBalance).mockResolvedValue("10");
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("debounces fee recalculation when the amount changes", async () => {
    const { rerender } = render(
      <FeeEstimationModal
        transaction={mockTransaction}
        amount="10"
        functionName="submit_payment"
        payerPublicKey="GTEST"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText("Simulating contract call…")).toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(estimateSorobanFee).toHaveBeenCalledTimes(1);

    rerender(
      <FeeEstimationModal
        transaction={mockTransaction}
        amount="12"
        functionName="submit_payment"
        payerPublicKey="GTEST"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText("Simulating contract call…")).toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(499);
    });
    expect(estimateSorobanFee).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(estimateSorobanFee).toHaveBeenCalledTimes(2);
  });
});