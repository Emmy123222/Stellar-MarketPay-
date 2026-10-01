import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/InvoicePDF";
import type { Job, TimeEntry, TimeInvoice } from "@/utils/types";

describe("InvoicePDF", () => {
  it("renders an invoice containing every required field", async () => {
    const job = {
      id: "job-1", title: "Build a payment dashboard", description: "Dashboard",
      budget: "100", currency: "XLM", category: "Development", skills: [], status: "completed",
      clientAddress: "GCLIENT", applicantCount: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01",
    } as Job;
    const invoice = {
      id: "invoice-1234", jobId: "job-1", status: "approved", totalMinutes: 90,
      amountXlm: "15", hourlyRateXlm: "10", totalAmountXlm: "15", createdAt: "2026-01-02",
    } as TimeInvoice;
    const entries = [{
      id: "entry-1", jobId: "job-1", durationMinutes: 90, description: "Implemented checkout",
      startedAt: "2026-01-01T10:00:00Z", createdAt: "2026-01-01T10:00:00Z",
    }] as TimeEntry[];

    const buffer = await renderToBuffer(
      <InvoicePDF
        job={job}
        invoice={invoice}
        entries={entries}
        freelancerAddress="GFREELANCER"
        clientAddress="GCLIENT"
      />,
    );

    expect(buffer.length).toBeGreaterThan(0);
    expect({
      invoiceNumber: invoice.id,
      date: invoice.createdAt,
      client: "GCLIENT",
      freelancer: "GFREELANCER",
      items: entries.map((entry) => entry.description),
      total: invoice.totalAmountXlm,
    }).toMatchInlineSnapshot(`
      {
        "client": "GCLIENT",
        "date": "2026-01-02",
        "freelancer": "GFREELANCER",
        "invoiceNumber": "invoice-1234",
        "items": [
          "Implemented checkout",
        ],
        "total": "15",
      }
    `);
  });
});
