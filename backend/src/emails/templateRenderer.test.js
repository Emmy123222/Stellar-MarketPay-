const { renderTemplate } = require("./templateRenderer");

describe("templateRenderer", () => {
  it("renders new_application template correctly", () => {
    const html = renderTemplate("new_application", {
      clientName: "Alice",
      jobTitle: "Fix my website",
      freelancerName: "Bob",
      jobUrl: "http://localhost:3000/jobs/123"
    });
    expect(html).toContain("Alice");
    expect(html).toContain("Fix my website");
    expect(html).toContain("Bob");
    expect(html).toContain("http://localhost:3000/jobs/123");
  });

  it("renders application_accepted template correctly", () => {
    const html = renderTemplate("application_accepted", {
      freelancerName: "Bob",
      jobTitle: "Fix my website",
      jobUrl: "http://localhost:3000/jobs/123"
    });
    expect(html).toContain("Bob");
    expect(html).toContain("Fix my website");
    expect(html).toContain("http://localhost:3000/jobs/123");
  });

  it("renders escrow_released template correctly", () => {
    const html = renderTemplate("escrow_released", {
      userName: "Charlie",
      jobTitle: "Fix my website",
      amount: "100",
      currency: "XLM",
      jobUrl: "http://localhost:3000/jobs/123"
    });
    expect(html).toContain("Charlie");
    expect(html).toContain("Fix my website");
    expect(html).toContain("100");
    expect(html).toContain("XLM");
    expect(html).toContain("http://localhost:3000/jobs/123");
  });

  it("throws error for unknown template", () => {
    expect(() => renderTemplate("unknown_template", {})).toThrow("Template unknown_template not found");
  });
});
