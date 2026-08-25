import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import type { Transaction } from "@stellar/stellar-sdk";

// Mock transaction object for stories
const mockTransaction = {
  toXDR: () => "mock-xdr-string",
} as unknown as Transaction;

const meta: Meta<typeof FeeEstimationModal> = {
  title: "Components/FeeEstimationModal",
  component: FeeEstimationModal,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
    },
  },
  argTypes: {
    functionName: {
      control: "text",
    },
    payerPublicKey: {
      control: "text",
    },
  },
};

export default meta;
type Story = StoryObj<typeof FeeEstimationModal>;

// Default state - Loading
export const Default: Story = {
  args: {
    transaction: mockTransaction,
    functionName: "submitPayment",
    payerPublicKey: "GPAYER123456789ABC",
    onConfirm: () => console.log("Confirmed"),
    onCancel: () => console.log("Cancelled"),
  },
  render: (args) => {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <FeeEstimationModal {...args} />
      </div>
    );
  },
};

// Loaded state - With fee estimate
export const Loaded: Story = {
  args: {
    transaction: mockTransaction,
    functionName: "submitPayment",
    payerPublicKey: "GPAYER123456789ABC",
    onConfirm: () => console.log("Confirmed"),
    onCancel: () => console.log("Cancelled"),
  },
  render: (args) => {
    const [multiplier, setMultiplier] = useState(1);
    const estimatedXlm = "0.25";
    const maxFeeXlm = (0.25 * multiplier).toFixed(7);
    const xlmPriceUsd = 0.15;
    const maxFeeUsd = parseFloat(maxFeeXlm) * xlmPriceUsd;

    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card max-w-md w-full bg-ink-900 border border-market-500/20">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-1">
            Confirm transaction
          </h2>
          <p className="text-xs text-amber-700 mb-4">
            submitPayment — review the fee before signing.
          </p>

          <dl className="text-sm text-amber-200 space-y-2 mb-4">
            <div className="flex justify-between">
              <dt className="text-amber-700">Function</dt>
              <dd className="font-mono">submitPayment</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Estimated fee</dt>
              <dd className="font-mono">
                {estimatedXlm} XLM
                <span className="text-amber-700 ml-2">≈ $0.0375 USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Max fee ({multiplier}×)</dt>
              <dd className="font-mono">
                {maxFeeXlm} XLM
                <span className="text-amber-700 ml-2">≈ ${maxFeeUsd.toFixed(4)} USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Exchange rate</dt>
              <dd className="font-mono">1 XLM ≈ $0.1500 USD</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">100.5 XLM</dd>
            </div>
          </dl>

          {/* Max fee slider */}
          <div className="mb-4">
            <label className="block text-xs text-amber-700 mb-2">
              Max fee multiplier: <span className="font-mono text-amber-300">{multiplier}×</span>
              <span className="ml-2 text-amber-600">
                (max: {maxFeeXlm} XLM ≈ ${maxFeeUsd.toFixed(4)} USD)
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.5}
              value={multiplier}
              onChange={(e) => setMultiplier(parseFloat(e.target.value))}
              className="w-full h-2 bg-market-500/20 rounded-lg appearance-none cursor-pointer accent-market-400"
            />
            <div className="flex justify-between text-[11px] text-amber-700 mt-1">
              <span>1× (minimum)</span>
              <span>2×</span>
              <span>3× (maximum)</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => console.log("Cancelled")} className="btn-secondary flex-1 text-sm">
              Cancel
            </button>
            <button
              onClick={() => console.log("Confirmed")}
              className="btn-primary flex-1 text-sm"
            >
              Confirm & Sign
            </button>
          </div>
        </div>
      </div>
    );
  },
};

// Error state - Fee estimation failed with option to proceed
export const Error: Story = {
  args: {
    transaction: mockTransaction,
    functionName: "submitPayment",
    payerPublicKey: "GPAYER123456789ABC",
    onConfirm: () => console.log("Confirmed with default fee"),
    onCancel: () => console.log("Cancelled"),
  },
  render: (args) => {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card max-w-md w-full bg-ink-900 border border-market-500/20">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-1">
            Confirm transaction
          </h2>
          <p className="text-xs text-amber-700 mb-4">
            submitPayment — review the fee before signing.
          </p>

          <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm mb-1">
              <span className="font-semibold">Fee estimation failed:</span> Network error
            </p>
            <p className="text-amber-300 text-xs">
              You can still proceed with a default max fee of 0.0100000 XLM.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => console.log("Cancelled")} className="btn-secondary flex-1 text-sm">
              Cancel
            </button>
            <button
              onClick={() => console.log("Confirmed")}
              className="btn-primary flex-1 text-sm"
            >
              Proceed with default fee
            </button>
          </div>
        </div>
      </div>
    );
  },
};

// Insufficient balance state
export const InsufficientBalance: Story = {
  args: {
    transaction: mockTransaction,
    functionName: "submitPayment",
    payerPublicKey: "GPAYER123456789ABC",
    onConfirm: () => console.log("Confirmed"),
    onCancel: () => console.log("Cancelled"),
  },
  render: (args) => {
    const [multiplier, setMultiplier] = useState(1);
    const estimatedXlm = "50.0";
    const maxFeeXlm = (50.0 * multiplier).toFixed(7);
    const xlmPriceUsd = 0.15;
    const maxFeeUsd = parseFloat(maxFeeXlm) * xlmPriceUsd;

    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card max-w-md w-full bg-ink-900 border border-market-500/20">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-1">
            Confirm transaction
          </h2>
          <p className="text-xs text-amber-700 mb-4">
            submitPayment — review the fee before signing.
          </p>

          <dl className="text-sm text-amber-200 space-y-2 mb-4">
            <div className="flex justify-between">
              <dt className="text-amber-700">Function</dt>
              <dd className="font-mono">submitPayment</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Estimated fee</dt>
              <dd className="font-mono">
                {estimatedXlm} XLM
                <span className="text-amber-700 ml-2">≈ $7.50 USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Max fee ({multiplier}×)</dt>
              <dd className="font-mono">
                {maxFeeXlm} XLM
                <span className="text-amber-700 ml-2">≈ ${maxFeeUsd.toFixed(4)} USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Exchange rate</dt>
              <dd className="font-mono">1 XLM ≈ $0.1500 USD</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">10.5 XLM</dd>
            </div>
          </dl>

          {/* Max fee slider */}
          <div className="mb-4">
            <label className="block text-xs text-amber-700 mb-2">
              Max fee multiplier: <span className="font-mono text-amber-300">{multiplier}×</span>
              <span className="ml-2 text-amber-600">
                (max: {maxFeeXlm} XLM ≈ ${maxFeeUsd.toFixed(4)} USD)
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.5}
              value={multiplier}
              onChange={(e) => setMultiplier(parseFloat(e.target.value))}
              className="w-full h-2 bg-market-500/20 rounded-lg appearance-none cursor-pointer accent-market-400"
            />
            <div className="flex justify-between text-[11px] text-amber-700 mt-1">
              <span>1× (minimum)</span>
              <span>2×</span>
              <span>3× (maximum)</span>
            </div>
          </div>

          <p className="text-red-400 text-xs mb-3">
            Insufficient balance — top up XLM and try again.
          </p>

          <div className="flex gap-3">
            <button onClick={() => console.log("Cancelled")} className="btn-secondary flex-1 text-sm">
              Cancel
            </button>
            <button
              disabled
              className="btn-primary flex-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm & Sign
            </button>
          </div>
        </div>
      </div>
    );
  },
};

// High fee warning
export const HighFee: Story = {
  args: {
    transaction: mockTransaction,
    functionName: "complexContractCall",
    payerPublicKey: "GPAYER123456789ABC",
    onConfirm: () => console.log("Confirmed"),
    onCancel: () => console.log("Cancelled"),
  },
  render: (args) => {
    const [multiplier, setMultiplier] = useState(2);
    const estimatedXlm = "2.5";
    const maxFeeXlm = (2.5 * multiplier).toFixed(7);
    const xlmPriceUsd = 0.15;
    const maxFeeUsd = parseFloat(maxFeeXlm) * xlmPriceUsd;

    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card max-w-md w-full bg-ink-900 border border-market-500/20">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-1">
            Confirm transaction
          </h2>
          <p className="text-xs text-amber-700 mb-4">
            complexContractCall — review the fee before signing.
          </p>

          <dl className="text-sm text-amber-200 space-y-2 mb-4">
            <div className="flex justify-between">
              <dt className="text-amber-700">Function</dt>
              <dd className="font-mono">complexContractCall</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Estimated fee</dt>
              <dd className="font-mono">
                {estimatedXlm} XLM
                <span className="text-amber-700 ml-2">≈ $0.3750 USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Max fee ({multiplier}×)</dt>
              <dd className="font-mono">
                {maxFeeXlm} XLM
                <span className="text-amber-700 ml-2">≈ ${maxFeeUsd.toFixed(4)} USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Exchange rate</dt>
              <dd className="font-mono">1 XLM ≈ $0.1500 USD</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">1000.0 XLM</dd>
            </div>
          </dl>

          {/* Max fee slider */}
          <div className="mb-4">
            <label className="block text-xs text-amber-700 mb-2">
              Max fee multiplier: <span className="font-mono text-amber-300">{multiplier}×</span>
              <span className="ml-2 text-amber-600">
                (max: {maxFeeXlm} XLM ≈ ${maxFeeUsd.toFixed(4)} USD)
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.5}
              value={multiplier}
              onChange={(e) => setMultiplier(parseFloat(e.target.value))}
              className="w-full h-2 bg-market-500/20 rounded-lg appearance-none cursor-pointer accent-market-400"
            />
            <div className="flex justify-between text-[11px] text-amber-700 mt-1">
              <span>1× (minimum)</span>
              <span>2×</span>
              <span>3× (maximum)</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => console.log("Cancelled")} className="btn-secondary flex-1 text-sm">
              Cancel
            </button>
            <button
              onClick={() => console.log("Confirmed")}
              className="btn-primary flex-1 text-sm"
            >
              Confirm & Sign
            </button>
          </div>
        </div>
      </div>
    );
  },
};

// Multiple balance formats
export const LargeBalance: Story = {
  args: {
    transaction: mockTransaction,
    functionName: "withdraw",
    payerPublicKey: "GPAYER123456789ABC",
    onConfirm: () => console.log("Confirmed"),
    onCancel: () => console.log("Cancelled"),
  },
  render: (args) => {
    const [multiplier, setMultiplier] = useState(1);
    const estimatedXlm = "0.15";
    const maxFeeXlm = (0.15 * multiplier).toFixed(7);
    const xlmPriceUsd = 0.15;
    const maxFeeUsd = parseFloat(maxFeeXlm) * xlmPriceUsd;

    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card max-w-md w-full bg-ink-900 border border-market-500/20">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-1">
            Confirm transaction
          </h2>
          <p className="text-xs text-amber-700 mb-4">
            withdraw — review the fee before signing.
          </p>

          <dl className="text-sm text-amber-200 space-y-2 mb-4">
            <div className="flex justify-between">
              <dt className="text-amber-700">Function</dt>
              <dd className="font-mono">withdraw</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Estimated fee</dt>
              <dd className="font-mono">
                {estimatedXlm} XLM
                <span className="text-amber-700 ml-2">≈ $0.0225 USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Max fee ({multiplier}×)</dt>
              <dd className="font-mono">
                {maxFeeXlm} XLM
                <span className="text-amber-700 ml-2">≈ ${maxFeeUsd.toFixed(4)} USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Exchange rate</dt>
              <dd className="font-mono">1 XLM ≈ $0.1500 USD</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">50,000.1234567 XLM</dd>
            </div>
          </dl>

          {/* Max fee slider */}
          <div className="mb-4">
            <label className="block text-xs text-amber-700 mb-2">
              Max fee multiplier: <span className="font-mono text-amber-300">{multiplier}×</span>
              <span className="ml-2 text-amber-600">
                (max: {maxFeeXlm} XLM ≈ ${maxFeeUsd.toFixed(4)} USD)
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.5}
              value={multiplier}
              onChange={(e) => setMultiplier(parseFloat(e.target.value))}
              className="w-full h-2 bg-market-500/20 rounded-lg appearance-none cursor-pointer accent-market-400"
            />
            <div className="flex justify-between text-[11px] text-amber-700 mt-1">
              <span>1× (minimum)</span>
              <span>2×</span>
              <span>3× (maximum)</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => console.log("Cancelled")} className="btn-secondary flex-1 text-sm">
              Cancel
            </button>
            <button
              onClick={() => console.log("Confirmed")}
              className="btn-primary flex-1 text-sm"
            >
              Confirm & Sign
            </button>
          </div>
        </div>
      </div>
    );
  },
};
