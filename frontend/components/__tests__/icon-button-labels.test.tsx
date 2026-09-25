import { render, screen } from "@testing-library/react";
import BoostJobModal from "../BoostJobModal";
import ShareJobModal from "../ShareJobModal";
import BudgetEscrowStep from "../post-job-steps/BudgetEscrowStep";
import RequirementsStep from "../post-job-steps/RequirementsStep";

describe("icon-only buttons have accessible names", () => {
  it("labels the boost modal close button", () => {
    render(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Example job"
        clientPublicKey="GB123"
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /close boost job modal/i })).toBeInTheDocument();
  });

  it("labels the share modal close button", () => {
    render(
      <ShareJobModal
        job={{ id: "job-1", title: "Example job" } as any}
        onClose={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /close share job modal/i })).toBeInTheDocument();
  });

  it("labels milestone removal buttons", () => {
    render(
      <BudgetEscrowStep
        form={{ milestones: [{ description: "First", amount: "100" }, { description: "Second", amount: "50" }] } as any}
        touched={{}}
        errors={{}}
        budgetValue={150}
        milestoneSum={150}
        xlmPriceUsd={0.1}
        onChange={() => {}}
        updateMilestone={() => {}}
        addMilestone={() => {}}
        removeMilestone={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /remove milestone 1/i })).toBeInTheDocument();
  });

  it("labels screening question removal buttons", () => {
    render(
      <RequirementsStep
        form={{ screeningQuestions: ["First question", "Second question"] } as any}
        suggestions={[]}
        showSuggestions={false}
        onChange={() => {}}
        onSelectSkill={() => {}}
        updateScreeningQuestion={() => {}}
        addScreeningQuestion={() => {}}
        removeScreeningQuestion={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /remove screening question 1/i })).toBeInTheDocument();
  });
});
