/**
 * hooks/usePDFDownload.ts
 * Hook for downloading PDF documents generated with @react-pdf/renderer.
 */

import { pdf } from "@react-pdf/renderer";
import type { ReactElement } from "react";

export function usePDFDownload() {
  const downloadPDF = async (
    pdfDocument: ReactElement,
    filename: string
  ): Promise<void> => {
    try {
      const pdfBlob = await pdf(pdfDocument).toBlob();
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to generate PDF:", error);
      throw new Error("Failed to generate PDF. Please try again.");
    }
  };

  return { downloadPDF };
}
