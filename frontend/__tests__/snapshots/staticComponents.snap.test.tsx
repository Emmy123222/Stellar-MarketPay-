import "../setup/snapshotMocks";

import { render } from "@testing-library/react";
import { snapshotContainer } from "../helpers/snapshotRender";
import {
  sampleJob,
  sampleProfile,
  sampleApplication,
  checklistItems,
  clientSpendingAnalytics,
  MOCK_PK,
  MOCK_PK_B,
} from "../helpers/fixtures";

import Spinner from "@/components/Spinner";
import StateMessage from "@/components/StateMessage";
import { ToastSnapshot } from "@/components/Toast";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import FreelancerProfileSkeleton from "@/components/FreelancerProfileSkeleton";
import JobCard, { JobCardSkeleton } from "@/components/JobCard";
import Navbar from "@/components/Navbar";
import AppFooter from "@/components/AppFooter";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import JobTimeline from "@/components/JobTimeline";
import JobStatusTimeline from "@/components/JobStatusTimeline";
import FreelancerCard from "@/components/FreelancerCard";
import ClientSpendingTab from "@/components/ClientSpendingTab";
import JobFiltersPanel, { ActiveFilterChips } from "@/components/JobFiltersPanel";
import BulkJobActionBar from "@/components/BulkJobActionBar";
import ProgressBar from "@/components/Onboarding/ProgressBar";
import ProfileChecklist from "@/components/Onboarding/ProfileChecklist";
import WelcomeModal from "@/components/Onboarding/WelcomeModal";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";

import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import ExtendJobModal from "@/components/ExtendJobModal";
import BoostJobModal from "@/components/BoostJobModal";
import BuyXLMModal from "@/components/BuyXLMModal";
import WithdrawToBankModal from "@/components/WithdrawToBankModal";
import WalletConnect from "@/components/WalletConnect";
import SendPaymentForm from "@/components/SendPaymentForm";
import ApplicationForm from "@/components/ApplicationForm";
import PostJobForm from "@/components/PostJobForm";
import ProposalComparison from "@/components/ProposalComparison";
import RealtimeBidComparison from "@/components/RealtimeBidComparison";
import ProfileCompletenessWidget from "@/components/ProfileCompletenessWidget";
import Admin2FAModal from "@/components/Admin2FAModal";
import Tooltips from "@/components/Onboarding/Tooltips";
import FeeEstimationModal from "@/components/FeeEstimationModal";

const mockTransaction = {} as import("@stellar/stellar-sdk").Transaction;

const noop = jest.fn();

describe("static component snapshots", () => {
  describe("Spinner", () => {
    it("default", () => snapshotContainer(<Spinner />, "Spinner default"));
  });

  describe("StateMessage", () => {
    it("empty state", () =>
      snapshotContainer(
        <StateMessage type="empty" title="No jobs found" description="Try adjusting your filters." />,
        "StateMessage empty",
      ));
    it("error state", () =>
      snapshotContainer(
        <StateMessage type="error" title="Something went wrong" description="Please try again later." />,
        "StateMessage error",
      ));
  });

  describe("Toast", () => {
    it.each(["success", "error", "info"] as const)("variant %s", (variant) =>
      snapshotContainer(
        <ToastSnapshot variant={variant} message={`${variant} message`} />,
        `Toast ${variant}`,
      ),
    );
  });

  describe("FreelancerTierBadge", () => {
    it.each(["Newcomer", "Rising Talent", "Top Rated", "Expert"] as const)("%s", (tier) =>
      snapshotContainer(<FreelancerTierBadge tier={tier} />, `FreelancerTierBadge ${tier}`),
    );
  });

  describe("FreelancerProfileSkeleton", () => {
    it("loading skeleton", () =>
      snapshotContainer(<FreelancerProfileSkeleton />, "FreelancerProfileSkeleton"));
  });

  describe("JobCard", () => {
    it("default", () => snapshotContainer(<JobCard job={sampleJob} />, "JobCard default"));
    it("bookmarked", () =>
      snapshotContainer(
        <JobCard job={{ ...sampleJob, id: "job-bookmarked" }} />,
        "JobCard bookmarked",
      ));
    it("loading skeleton", () =>
      snapshotContainer(<JobCardSkeleton />, "JobCardSkeleton"));
  });

  describe("Navbar", () => {
    it("logged out", () =>
      snapshotContainer(
        <Navbar publicKey={null} onConnect={noop} onDisconnect={noop} />,
        "Navbar logged out",
      ));
    it("logged in", () =>
      snapshotContainer(
        <Navbar publicKey={MOCK_PK} onConnect={noop} onDisconnect={noop} />,
        "Navbar logged in",
      ));
  });

  describe("AppFooter", () => {
    it("default", () => snapshotContainer(<AppFooter onOpenShortcuts={noop} />, "AppFooter"));
  });

  describe("LanguageSwitcher", () => {
    it("default", () => snapshotContainer(<LanguageSwitcher />, "LanguageSwitcher"));
  });

  describe("JobTimeline", () => {
    it("default", () =>
      snapshotContainer(
        <JobTimeline status="open" createdAt={sampleJob.createdAt} updatedAt={sampleJob.updatedAt} />,
        "JobTimeline default",
      ));
    it("compact", () =>
      snapshotContainer(
        <JobTimeline
          status="in_progress"
          createdAt={sampleJob.createdAt}
          updatedAt={sampleJob.updatedAt}
          isCompact
        />,
        "JobTimeline compact",
      ));
  });

  describe("JobStatusTimeline", () => {
    it("open", () =>
      snapshotContainer(<JobStatusTimeline job={sampleJob} />, "JobStatusTimeline open"));
    it("compact cancelled", () =>
      snapshotContainer(
        <JobStatusTimeline job={{ ...sampleJob, status: "cancelled" }} compact />,
        "JobStatusTimeline compact cancelled",
      ));
  });

  describe("FreelancerCard", () => {
    it("default", () =>
      snapshotContainer(<FreelancerCard profile={sampleProfile} />, "FreelancerCard"));
  });

  describe("ClientSpendingTab", () => {
    it("loading", () =>
      snapshotContainer(
        <ClientSpendingTab analytics={null} loading xlmPriceUsd={0.12} />,
        "ClientSpendingTab loading",
      ));
    it("empty", () =>
      snapshotContainer(
        <ClientSpendingTab analytics={null} loading={false} xlmPriceUsd={0.12} />,
        "ClientSpendingTab empty",
      ));
    it("populated", () =>
      snapshotContainer(
        <ClientSpendingTab analytics={clientSpendingAnalytics} loading={false} xlmPriceUsd={0.12} />,
        "ClientSpendingTab populated",
      ));
  });

  describe("JobFiltersPanel", () => {
    it("expanded", () =>
      snapshotContainer(
        <JobFiltersPanel query={{}} onQueryChange={noop} collapsible={false} />,
        "JobFiltersPanel expanded",
      ));
    it("active chips", () => {
      const { container } = render(
        <ActiveFilterChips query={{ minBudget: "100", skills: "Rust" }} onRemove={noop} />,
      );
      expect(container.firstChild).toMatchSnapshot("ActiveFilterChips");
    });
  });

  describe("BulkJobActionBar", () => {
    it("default", () =>
      snapshotContainer(
        <BulkJobActionBar
          selectedCount={2}
          loading={false}
          onCancel={noop}
          onExtend={noop}
          onBoost={noop}
          onClearSelection={noop}
        />,
        "BulkJobActionBar",
      ));
    it("loading", () =>
      snapshotContainer(
        <BulkJobActionBar
          selectedCount={2}
          loading
          onCancel={noop}
          onExtend={noop}
          onBoost={noop}
          onClearSelection={noop}
        />,
        "BulkJobActionBar loading",
      ));
  });

  describe("Onboarding ProgressBar", () => {
    it("in progress", () =>
      snapshotContainer(<ProgressBar current={2} total={5} />, "ProgressBar in progress"));
    it("complete", () =>
      snapshotContainer(<ProgressBar current={5} total={5} />, "ProgressBar complete"));
  });

  describe("ProfileChecklist", () => {
    it("default", () =>
      snapshotContainer(
        <ProfileChecklist items={checklistItems} onItemClick={noop} />,
        "ProfileChecklist",
      ));
    it("complete", () =>
      snapshotContainer(
        <ProfileChecklist
          items={checklistItems.map((item) => ({ ...item, completed: true }))}
          onItemClick={noop}
        />,
        "ProfileChecklist complete",
      ));
  });

  describe("WelcomeModal", () => {
    it("open", () =>
      snapshotContainer(
        <WelcomeModal isOpen onClose={noop} onGetStarted={noop} />,
        "WelcomeModal open",
      ));
  });

  describe("KeyboardShortcutsModal", () => {
    it("open", () =>
      snapshotContainer(<KeyboardShortcutsModal isOpen onClose={noop} />, "KeyboardShortcutsModal"));
  });



  describe("RatingForm", () => {
    it("default", () =>
      snapshotContainer(
        <RatingForm jobId="job-1" ratedAddress={MOCK_PK_B} ratedLabel="the freelancer" />,
        "RatingForm",
      ));
  });

  describe("ShareJobModal", () => {
    it("default", () =>
      snapshotContainer(<ShareJobModal job={sampleJob} onClose={noop} />, "ShareJobModal"));
  });

  describe("ExtendJobModal", () => {
    it("default", () =>
      snapshotContainer(
        <ExtendJobModal job={sampleJob} onClose={noop} onExtended={noop} />,
        "ExtendJobModal",
      ));
  });

  describe("BoostJobModal", () => {
    it("default", () =>
      snapshotContainer(
        <BoostJobModal
          jobId="job-1"
          jobTitle={sampleJob.title}
          clientPublicKey={MOCK_PK}
          onClose={noop}
          onSuccess={noop}
        />,
        "BoostJobModal",
      ));
  });

  describe("BuyXLMModal", () => {
    it("default", () =>
      snapshotContainer(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} />, "BuyXLMModal"));
  });

  describe("WithdrawToBankModal", () => {
    it("default", () =>
      snapshotContainer(
        <WithdrawToBankModal publicKey={MOCK_PK} onClose={noop} />,
        "WithdrawToBankModal",
      ));
  });

  describe("WalletConnect", () => {
    it("idle", () => snapshotContainer(<WalletConnect onConnect={noop} />, "WalletConnect idle"));
  });

  describe("SendPaymentForm", () => {
    it("default", () =>
      snapshotContainer(<SendPaymentForm fromPublicKey={MOCK_PK} />, "SendPaymentForm"));
  });

  describe("ApplicationForm", () => {
    it("default", () =>
      snapshotContainer(
        <ApplicationForm job={sampleJob} publicKey={MOCK_PK_B} onSuccess={noop} />,
        "ApplicationForm",
      ));
  });

  describe("PostJobForm", () => {
    it("default", () =>
      snapshotContainer(<PostJobForm publicKey={MOCK_PK} />, "PostJobForm"));
  });

  describe("ProposalComparison", () => {
    it("default", () => snapshotContainer(<ProposalComparison />, "ProposalComparison"));
  });

  describe("RealtimeBidComparison", () => {
    it("with applications", () =>
      snapshotContainer(
        <RealtimeBidComparison
          jobId="job-1"
          initialApplications={[sampleApplication]}
          isClient
        />,
        "RealtimeBidComparison populated",
      ));
    it("empty", () =>
      snapshotContainer(
        <RealtimeBidComparison jobId="job-1" initialApplications={[]} isClient />,
        "RealtimeBidComparison empty",
      ));
  });

  describe("ProfileCompletenessWidget", () => {
    it("in progress", () =>
      snapshotContainer(
        <ProfileCompletenessWidget
          completionPercentage={40}
          isComplete={false}
          checklistItems={checklistItems}
        />,
        "ProfileCompletenessWidget in progress",
      ));
    it("complete", () =>
      snapshotContainer(
        <ProfileCompletenessWidget
          completionPercentage={100}
          isComplete
          checklistItems={checklistItems.map((item) => ({ ...item, completed: true }))}
        />,
        "ProfileCompletenessWidget complete",
      ));
  });

  describe("Admin2FAModal", () => {
    it("verify mode", () =>
      snapshotContainer(<Admin2FAModal mode="verify" onComplete={noop} />, "Admin2FAModal verify"));
    it("setup mode", () =>
      snapshotContainer(<Admin2FAModal mode="setup" onComplete={noop} />, "Admin2FAModal setup"));
  });

  describe("FeeEstimationModal", () => {
    it("loading", () =>
      snapshotContainer(
        <FeeEstimationModal
          transaction={mockTransaction}
          functionName="create_escrow"
          payerPublicKey={MOCK_PK}
          onConfirm={noop}
          onCancel={noop}
        />,
        "FeeEstimationModal loading",
      ));
  });

  describe("Tooltips", () => {
    it("with target", () => {
      const { container } = render(
        <>
          <button data-testid="tooltip-target" type="button">
            Target
          </button>
          <Tooltips
            tooltips={[
              {
                id: "tip-1",
                targetSelector: '[data-testid="tooltip-target"]',
                title: "Quick tip",
                description: "Use filters to narrow jobs.",
              },
            ]}
            onDismiss={noop}
            onDismissAll={noop}
          />
        </>,
      );
      expect(container.firstChild?.parentElement ?? container).toMatchSnapshot("Tooltips");
    });
  });
});
