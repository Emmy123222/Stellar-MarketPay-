/**
 * components/InvoiceDownloadButton.tsx
 * Invoice PDF download button with language picker (Issue #1555)
 */
import React, { useState } from "react";
import { InvoicePDF } from "@/components/InvoicePDF";
import { usePDFDownload } from "@/hooks/usePDFDownload";
import { INVOICE_LOCALES, InvoiceLocale } from "@/utils/invoiceI18n";
import type { TimeInvoice, TimeEntry, Job } from "@/utils/types";

interface InvoiceDownloadButtonProps {
  job: Job;
  invoice: TimeInvoice;
  entries: TimeEntry[];
  freelancerAddress: string;
  clientAddress: string;
  onSuccess?: (msg: string) => void;
  onError?: (err: string) => void;
  className?: string;
}

export const InvoiceDownloadButton: React.FC<InvoiceDownloadButtonProps> = ({
  job,
  invoice,
  entries,
  freelancerAddress,
  clientAddress,
  onSuccess,
  onError,
  className = "",
}) => {
  const [selectedLocale, setSelectedLocale] = useState<InvoiceLocale>("en");
  const [isDownloading, setIsDownloading] = useState(false);
  const { downloadPDF } = usePDFDownload();

  const handleDownload = async (localeToUse = selectedLocale) => {
    setIsDownloading(true);
    try {
      const invoiceEntries = (entries || []).filter(
        (e) => new Date(e.createdAt) <= new Date(invoice.createdAt)
      );

      const pdfDocument = (
        <InvoicePDF
          job={job}
          invoice={invoice}
          entries={invoiceEntries}
          freelancerAddress={freelancerAddress || "Unknown"}
          clientAddress={clientAddress || "Unknown"}
          locale={localeToUse}
        />
      );

      const dateStr = new Date(invoice.createdAt).toISOString().split("T")[0];
      const filename = `invoice-${invoice.id.slice(0, 8)}-${localeToUse}-${dateStr}.pdf`;

      await downloadPDF(pdfDocument, filename);
      onSuccess?.(`Invoice PDF (${localeToUse.toUpperCase()}) downloaded successfully`);
    } catch (e: unknown) {
      onError?.(e instanceof Error ? e.message : "Failed to download PDF");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      {/* Language Picker */}
      <select
        value={selectedLocale}
        onChange={(e) => {
          const newLocale = e.target.value as InvoiceLocale;
          setSelectedLocale(newLocale);
        }}
        aria-label="Invoice language"
        className="bg-ink-800 text-amber-200 border border-market-500/20 rounded text-xs py-1.5 px-2 focus:outline-none focus:border-market-400 cursor-pointer"
        title="Select invoice language"
      >
        {INVOICE_LOCALES.map((loc) => (
          <option key={loc.code} value={loc.code} className="bg-ink-900 text-amber-100">
            {loc.flag} {loc.code.toUpperCase()} ({loc.name})
          </option>
        ))}
      </select>

      {/* Download Button */}
      <button
        type="button"
        onClick={() => handleDownload()}
        disabled={isDownloading}
        className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1 whitespace-nowrap hover:border-market-400 transition-colors"
        title={`Download invoice as PDF in ${selectedLocale.toUpperCase()}`}
        aria-label={`Download invoice ${invoice.id.slice(0, 8)} in ${selectedLocale.toUpperCase()}`}
      >
        {isDownloading ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            <span>…</span>
          </>
        ) : (
          <>
            <span>📄</span>
            <span className="hidden sm:inline">PDF</span>
          </>
        )}
      </button>
    </div>
  );
};

export default InvoiceDownloadButton;
