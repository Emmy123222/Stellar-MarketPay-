/**
 * pages/dev/visual-harness.tsx
 *
 * Renders money-critical surfaces in a fixed, wallet-free state so Playwright
 * can snapshot them in light and dark themes (issue #1897):
 *
 *   /dev/visual-harness?surface=escrow-funding
 *   /dev/visual-harness?surface=fee-estimation
 *   /dev/visual-harness?surface=withdraw-to-bank
 *   /dev/visual-harness?surface=transactions
 *
 * The page 404s unless the server is started with VISUAL_HARNESS=1 (set only by
 * playwright.config.ts), so it never exists in a normal build.
 */
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { Account, Contract, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import BudgetEscrowStep from "@/components/post-job-steps/BudgetEscrowStep";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import WithdrawToBankModal from "@/components/WithdrawToBankModal";
import TransactionsPage from "@/pages/dashboard/transactions";
import type { JobFormData } from "@/components/PostJobFormtypes";

const VISUAL_HARNESS_PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const FORM: JobFormData = {
  title: "Build a Soroban escrow contract",
  description: "Escrow contract with release and refund paths.",
  budget: "500",
  currency: "XLM",
  category: "Smart Contracts",
  skills: "Rust, Soroban",
  deadline: "2026-03-01",
  milestones: [
    { description: "Contract implementation", amount: "300" },
    { description: "Tests and audit fixes", amount: "200" },
  ],
  visibility: "public",
  screeningQuestions: [],
  isRecurring: false,
  intervalDays: "30",
  totalReleases: "1",
};

const noop = () => undefined;

function EscrowFunding() {
  return (
    <div className="max-w-2xl mx-auto card">
      <h1 className="font-display text-xl font-bold text-amber-100 mb-4">
        Budget &amp; Escrow
      </h1>
      <BudgetEscrowStep
        form={FORM}
        touched={{}}
        errors={{}}
        budgetValue={500}
        milestoneSum={500}
        xlmPriceUsd={0.12}
        onChange={noop}
        updateMilestone={noop}
        addMilestone={noop}
        removeMilestone={noop}
      />
    </div>
  );
}

function FeeEstimation() {
  // A real (unsigned) Soroban invocation so estimateSorobanFee can simulate it;
  // the RPC response is stubbed by the Playwright spec.
  const transaction = useMemo(() => {
    const source = new Account(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "1",
    );
    return new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        new Contract(
          "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        ).call("release_escrow"),
      )
      .setTimeout(30)
      .build();
  }, []);

  return (
    <FeeEstimationModal
      transaction={transaction}
      amount="500"
      functionName="release_escrow"
      payerPublicKey={VISUAL_HARNESS_PUBLIC_KEY}
      platformFeeBps={250}
      onConfirm={noop}
      onCancel={noop}
    />
  );
}

export default function VisualHarness() {
  const { query } = useRouter();
  const surface = typeof query.surface === "string" ? query.surface : "";

  switch (surface) {
    case "escrow-funding":
      return <EscrowFunding />;
    case "fee-estimation":
      return <FeeEstimation />;
    case "withdraw-to-bank":
      return (
        <WithdrawToBankModal
          publicKey={VISUAL_HARNESS_PUBLIC_KEY}
          onClose={noop}
        />
      );
    case "transactions":
      return (
        <TransactionsPage publicKey={VISUAL_HARNESS_PUBLIC_KEY} onConnect={noop} />
      );
    default:
      return null;
  }
}

export const getServerSideProps: GetServerSideProps = async () => {
  if (process.env.VISUAL_HARNESS !== "1") return { notFound: true };
  return { props: {} };
};
