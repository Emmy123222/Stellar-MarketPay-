/**
 * utils/invoiceI18n.ts
 * Multi-language localization and formatting for invoice PDF generation (Issue #1555)
 */
import enInvoice from "../public/locales/en/invoice.json";
import esInvoice from "../public/locales/es/invoice.json";
import frInvoice from "../public/locales/fr/invoice.json";
import ptInvoice from "../public/locales/pt/invoice.json";
import deInvoice from "../public/locales/de/invoice.json";

export type InvoiceLocale = "en" | "es" | "fr" | "pt" | "de";

export const INVOICE_LOCALES: { code: InvoiceLocale; name: string; flag: string }[] = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "pt", name: "Português", flag: "🇵🇹" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
];

export const INVOICE_TRANSLATIONS: Record<InvoiceLocale, Record<string, string>> = {
  en: enInvoice,
  es: esInvoice,
  fr: frInvoice,
  pt: ptInvoice,
  de: deInvoice,
};

export function getInvoiceTranslations(locale: string = "en"): Record<string, string> {
  const norm = locale.slice(0, 2).toLowerCase() as InvoiceLocale;
  return INVOICE_TRANSLATIONS[norm] || INVOICE_TRANSLATIONS.en;
}

export function formatInvoiceDate(
  date: Date | string | number,
  locale: string = "en",
  options?: Intl.DateTimeFormatOptions
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const norm = locale.slice(0, 2).toLowerCase();
  return new Intl.DateTimeFormat(
    norm,
    options || {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  ).format(d);
}

export function formatInvoiceCurrency(
  amount: number | string,
  locale: string = "en",
  currency: string = "XLM",
  minFractionDigits = 2
): string {
  const val = typeof amount === "number" ? amount : parseFloat(String(amount || "0"));
  const norm = locale.slice(0, 2).toLowerCase();
  const formattedNumber = new Intl.NumberFormat(norm, {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: 7,
  }).format(isNaN(val) ? 0 : val);
  return `${formattedNumber} ${currency}`;
}
