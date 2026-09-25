import { sanitizeInlineScript, sanitizeRichHtml } from "@/lib/sanitize";

describe("shared HTML sanitizer", () => {
  test("preserves approved rich text and removes executable markup", () => {
    const result = sanitizeRichHtml(
      '<mark>Job</mark><strong>description</strong><img src="x" onerror="alert(1)"><script>alert(2)</script>',
    );

    expect(result).toContain("<mark>Job</mark>");
    expect(result).toContain("<strong>description</strong>");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  test("does not alter trusted inline script text", () => {
    const script = "document.documentElement.classList.add('dark');";

    expect(sanitizeInlineScript(script)).toBe(script);
  });
});