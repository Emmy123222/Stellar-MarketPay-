/** @jest-environment node */
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/InvoicePDF";

jest.mock("@react-pdf/renderer", () => ({
  renderToBuffer: jest.fn().mockResolvedValue(Buffer.from("mock pdf data")),
  Document: ({ children }: any) => <div>{children}</div>,
  Page: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  View: ({ children }: any) => <div>{children}</div>,
  StyleSheet: { create: (s: any) => s },
  Font: { register: jest.fn() },
  Image: () => <img />,
}));
import type { Job, TimeEntry, TimeInvoice } from "@/utils/types";

describe("InvoicePDF", () => {
  it("renders an invoice containing every required field", async () => {
    const job = {
      id: "job-1",
      title: "Build a payment dashboard",
      description: "Dashboard",
      budget: "100",
      currency: "XLM",
      category: "Development",
      skills: [],
      status: "completed",
      clientAddress: "GCLIENT",
      applicantCount: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    } as Job;
    const invoice = {
      id: "invoice-1234",
      jobId: "job-1",
      status: "approved",
      totalMinutes: 90,
      amountXlm: "15",
      hourlyRateXlm: "10",
      totalAmountXlm: "15",
      createdAt: "2026-01-02",
    } as TimeInvoice;
    const entries = [
      {
        id: "entry-1",
        jobId: "job-1",
        durationMinutes: 90,
        description: "Implemented checkout",
        startedAt: "2026-01-01T10:00:00Z",
        createdAt: "2026-01-01T10:00:00Z",
      },
    ] as TimeEntry[];

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

  it("renders a non-English invoice with translated labels (Spanish & German)", async () => {
    const { renderToStaticMarkup } = require("react-dom/server");

    const job = {
      id: "job-es",
      title: "Desarrollo de Contratos",
      description: "Auditoría",
      budget: "250",
      currency: "XLM",
      category: "Development",
      skills: [],
      status: "completed",
      clientAddress: "GCLIENT_ES",
      applicantCount: 1,
      createdAt: "2026-03-01",
      updatedAt: "2026-03-01",
    } as Job;
    const invoice = {
      id: "invoice-es-1",
      jobId: "job-es",
      status: "approved",
      totalMinutes: 120,
      amountXlm: "25",
      hourlyRateXlm: "12.5",
      totalAmountXlm: "25",
      createdAt: "2026-03-02",
    } as TimeInvoice;
    const entries = [
      {
        id: "entry-es-1",
        jobId: "job-es",
        durationMinutes: 120,
        description: "Revisión de seguridad",
        startedAt: "2026-03-01T10:00:00Z",
        createdAt: "2026-03-01T10:00:00Z",
      },
    ] as TimeEntry[];

    // Test Spanish render
    const htmlEs = renderToStaticMarkup(
      <InvoicePDF
        job={job}
        invoice={invoice}
        entries={entries}
        freelancerAddress="GFREELANCER_ES"
        clientAddress="GCLIENT_ES"
        locale="es"
      />,
    );
    expect(htmlEs).toContain("Factura por Horas");
    expect(htmlEs).toContain("Factura Nº");
    expect(htmlEs).toContain("Aprobada");
    expect(htmlEs).toContain("Profesional");
    expect(htmlEs).toContain("Cliente");
    expect(htmlEs).toContain("Revisión de seguridad");

    const esBuffer = await renderToBuffer(
      <InvoicePDF
        job={job}
        invoice={invoice}
        entries={entries}
        freelancerAddress="GFREELANCER_ES"
        clientAddress="GCLIENT_ES"
        locale="es"
      />,
    );
    expect(esBuffer.length).toBeGreaterThan(0);

    // Test German render
    const htmlDe = renderToStaticMarkup(
      <InvoicePDF
        job={job}
        invoice={invoice}
        entries={entries}
        freelancerAddress="GFREELANCER_DE"
        clientAddress="GCLIENT_DE"
        locale="de"
      />,
    );
    expect(htmlDe).toContain("Zeitrechnung");
    expect(htmlDe).toContain("Rechnungs-Nr.");
    expect(htmlDe).toContain("Genehmigt");
    expect(htmlDe).toContain("Auftragnehmer");
    expect(htmlDe).toContain("Auftraggeber");

    const deBuffer = await renderToBuffer(
      <InvoicePDF
        job={job}
        invoice={invoice}
        entries={entries}
        freelancerAddress="GFREELANCER_DE"
        clientAddress="GCLIENT_DE"
        locale="de"
      />,
    );
    expect(deBuffer.length).toBeGreaterThan(0);
  });
});
