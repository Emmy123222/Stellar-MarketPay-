/**
 * __tests__/accessibility.test.tsx
 * Component-level accessibility tests using jest-axe
 */
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";

// Extend Jest matchers
expect.extend(toHaveNoViolations);

// Mock theme context for tests
const MockThemeProvider = ({ children, theme = "light" }: { children: React.ReactNode; theme?: string }) => {
  React.useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else if (theme === "high-contrast") {
      document.documentElement.classList.add("high-contrast", "dark");
    } else {
      document.documentElement.classList.remove("dark", "high-contrast");
    }
  }, [theme]);
  
  return <>{children}</>;
};

describe("Accessibility - Components", () => {
  describe("Button Components", () => {
    it("primary button should have no accessibility violations", async () => {
      const { container } = render(
        <button className="btn-primary">Submit</button>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("secondary button should have no accessibility violations", async () => {
      const { container } = render(
        <button className="btn-secondary">Cancel</button>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("ghost button should have no accessibility violations", async () => {
      const { container } = render(
        <button className="btn-ghost">Edit</button>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Form Components", () => {
    it("input field should have no accessibility violations", async () => {
      const { container } = render(
        <div>
          <label htmlFor="test-input" className="label">
            Email
          </label>
          <input
            id="test-input"
            type="email"
            className="input-field"
            placeholder="Enter your email"
            aria-required="true"
          />
        </div>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("textarea field should have no accessibility violations", async () => {
      const { container } = render(
        <div>
          <label htmlFor="test-textarea" className="label">
            Description
          </label>
          <textarea
            id="test-textarea"
            className="textarea-field"
            placeholder="Enter description"
            aria-required="true"
          />
        </div>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Card Components", () => {
    it("card should have no accessibility violations", async () => {
      const { container } = render(
        <div className="card">
          <h2 className="section-title">Card Title</h2>
          <p className="text-amber-700">Card content with proper contrast</p>
        </div>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Badge Components", () => {
    it("status badges should have no accessibility violations", async () => {
      const { container } = render(
        <div>
          <span className="badge-open">Open</span>
          <span className="badge-progress">In Progress</span>
          <span className="badge-complete">Complete</span>
          <span className="badge-cancelled">Cancelled</span>
          <span className="badge-disputed">Disputed</span>
        </div>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Dark Mode", () => {
    it("buttons in dark mode should have no accessibility violations", async () => {
      const { container } = render(
        <MockThemeProvider theme="dark">
          <button className="btn-primary">Primary</button>
          <button className="btn-secondary">Secondary</button>
        </MockThemeProvider>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("form fields in dark mode should have no accessibility violations", async () => {
      const { container } = render(
        <MockThemeProvider theme="dark">
          <label htmlFor="dark-input" className="label">Label</label>
          <input id="dark-input" className="input-field" />
        </MockThemeProvider>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("High Contrast Mode", () => {
    it("buttons in high contrast mode should have no accessibility violations", async () => {
      const { container } = render(
        <MockThemeProvider theme="high-contrast">
          <button className="btn-primary">Primary</button>
          <button className="btn-secondary">Secondary</button>
        </MockThemeProvider>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("form fields in high contrast mode should have no accessibility violations", async () => {
      const { container } = render(
        <MockThemeProvider theme="high-contrast">
          <label htmlFor="hc-input" className="label">Label</label>
          <input id="hc-input" className="input-field" />
        </MockThemeProvider>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Color Contrast", () => {
    it("text should have sufficient contrast in light mode", async () => {
      const { container } = render(
        <MockThemeProvider theme="light">
          <div className="card">
            <h1 className="section-title">Heading</h1>
            <p style={{ color: "var(--text)" }}>Normal text content</p>
            <p style={{ color: "var(--text-muted)" }}>Muted text content</p>
            <p style={{ color: "var(--text-subtle)" }}>Subtle text content</p>
          </div>
        </MockThemeProvider>
      );
      const results = await axe(container, {
        rules: {
          "color-contrast": { enabled: true },
        },
      });
      expect(results).toHaveNoViolations();
    });

    it("text should have sufficient contrast in dark mode", async () => {
      const { container } = render(
        <MockThemeProvider theme="dark">
          <div className="card">
            <h1 className="section-title">Heading</h1>
            <p style={{ color: "var(--text)" }}>Normal text content</p>
            <p style={{ color: "var(--text-muted)" }}>Muted text content</p>
            <p style={{ color: "var(--text-subtle)" }}>Subtle text content</p>
          </div>
        </MockThemeProvider>
      );
      const results = await axe(container, {
        rules: {
          "color-contrast": { enabled: true },
        },
      });
      expect(results).toHaveNoViolations();
    });

    it("text should have sufficient contrast in high contrast mode", async () => {
      const { container } = render(
        <MockThemeProvider theme="high-contrast">
          <div className="card">
            <h1 className="section-title">Heading</h1>
            <p style={{ color: "var(--text)" }}>Normal text content</p>
            <p style={{ color: "var(--text-muted)" }}>Muted text content</p>
            <p style={{ color: "var(--text-subtle)" }}>Subtle text content</p>
          </div>
        </MockThemeProvider>
      );
      const results = await axe(container, {
        rules: {
          "color-contrast": { enabled: true },
        },
      });
      expect(results).toHaveNoViolations();
    });
  });
});
