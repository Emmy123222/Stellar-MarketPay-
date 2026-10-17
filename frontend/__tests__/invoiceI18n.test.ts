/**
 * __tests__/invoiceI18n.test.ts
 * Tests for Multi-language Invoice PDF localization and formatting (Issue #1555)
 */
import {
  INVOICE_LOCALES,
  getInvoiceTranslations,
  formatInvoiceDate,
  formatInvoiceCurrency,
  InvoiceLocale,
} from "@/utils/invoiceI18n";

describe("Invoice i18n & Formatting (Issue #1555)", () => {
  const supportedLocales: InvoiceLocale[] = ["en", "es", "fr", "pt", "de"];

  test("supports at minimum English, Spanish, French, Portuguese, and German", () => {
    const localeCodes = INVOICE_LOCALES.map((l) => l.code);
    for (const loc of supportedLocales) {
      expect(localeCodes).toContain(loc);
    }
  });

  test("each supported locale has non-empty translation strings for invoice fields", () => {
    const requiredKeys = [
      "logoSubtext",
      "invoiceId",
      "status",
      "statusApproved",
      "statusPending",
      "freelancer",
      "client",
      "timeEntries",
      "totalHours",
      "hourlyRate",
      "totalAmount",
      "footerNotice",
    ];

    for (const loc of supportedLocales) {
      const t = getInvoiceTranslations(loc);
      expect(t).toBeDefined();
      for (const key of requiredKeys) {
        expect(t[key]).toBeTruthy();
        expect(typeof t[key]).toBe("string");
      }
    }
  });

  test("formats dates using Intl.DateTimeFormat for the specified locale", () => {
    const testDate = new Date("2026-06-15T12:00:00Z");

    const enFormatted = formatInvoiceDate(testDate, "en");
    const esFormatted = formatInvoiceDate(testDate, "es");
    const frFormatted = formatInvoiceDate(testDate, "fr");
    const deFormatted = formatInvoiceDate(testDate, "de");

    expect(enFormatted).toContain("2026");
    expect(enFormatted).toContain("June");

    expect(esFormatted).toContain("2026");
    expect(esFormatted.toLowerCase()).toContain("junio");

    expect(frFormatted).toContain("2026");
    expect(frFormatted.toLowerCase()).toContain("juin");

    expect(deFormatted).toContain("2026");
    expect(deFormatted.toLowerCase()).toContain("juni");
  });

  test("formats currency and numbers using Intl.NumberFormat for the selected locale", () => {
    const amount = 1250.5;

    const enFormatted = formatInvoiceCurrency(amount, "en", "XLM");
    const deFormatted = formatInvoiceCurrency(amount, "de", "XLM");

    expect(enFormatted).toContain("XLM");
    expect(deFormatted).toContain("XLM");

    // English uses comma as thousands separator and period as decimal
    expect(enFormatted).toMatch(/1,250\.50/);

    // German uses period as thousands separator and comma as decimal
    expect(deFormatted).toMatch(/1\.250,50/);
  });
});
