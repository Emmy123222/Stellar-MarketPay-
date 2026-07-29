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
                0.25 XLM
                <span className="text-amber-700 ml-2">≈ $0.0375 USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">100.5 XLM</dd>
            </div>
          </dl>

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

// Error state - Fee estimation failed
export const Error: Story = {
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
        <div className="card max-w-md w-full bg-ink-900 border border-market-500/20">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-1">
            Confirm transaction
          </h2>
          <p className="text-xs text-amber-700 mb-4">
            submitPayment — review the fee before signing.
          </p>

          <p className="text-red-400 text-sm mb-3">
            Failed to estimate fee. Please try again.
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
                50.0 XLM
                <span className="text-amber-700 ml-2">≈ $7.50 USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">10.5 XLM</dd>
            </div>
          </dl>

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
                2.5 XLM
                <span className="text-amber-700 ml-2">≈ $0.3750 USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">1000.0 XLM</dd>
            </div>
          </dl>

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
                0.15 XLM
                <span className="text-amber-700 ml-2">≈ $0.0225 USD</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">50,000.1234567 XLM</dd>
            </div>
          </dl>

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
