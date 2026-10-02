/**
 * hooks/usePDFDownload.ts
 * Hook for downloading PDF documents generated with @react-pdf/renderer.
 */

import { useState, useEffect } from "react";
import { pdf } from "@react-pdf/renderer";
import type { ReactElement } from "react";

export function usePDFDownload() {
  const [downloadRequest, setDownloadRequest] = useState<{
    document: ReactElement;
    filename: string;
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  } | null>(null);

  useEffect(() => {
    if (!downloadRequest) return;

    let isCancelled = false;

    const generateAndDownload = async () => {
      // Yield to the browser to allow the UI (like loading spinners) to paint
      await new Promise((resolve) => setTimeout(resolve, 50));

      try {
        if (isCancelled) return;
        const pdfBlob = await pdf(downloadRequest.document).toBlob();

        if (isCancelled) return;
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = downloadRequest.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        if (!isCancelled) {
          downloadRequest.onSuccess?.();
        }
      } catch (error) {
        console.error("Failed to generate PDF:", error);
        if (!isCancelled) {
          downloadRequest.onError?.(
            error instanceof Error ? error : new Error("Failed to generate PDF")
          );
        }
      } finally {
        if (!isCancelled) {
          setDownloadRequest(null);
        }
      }
    };

    generateAndDownload();

    return () => {
      isCancelled = true;
    };
  }, [downloadRequest]);

  const downloadPDF = (
    pdfDocument: ReactElement,
    filename: string
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      setDownloadRequest({
        document: pdfDocument,
        filename,
        onSuccess: resolve,
        onError: reject,
      });
    });
  };

  return { downloadPDF };
}
