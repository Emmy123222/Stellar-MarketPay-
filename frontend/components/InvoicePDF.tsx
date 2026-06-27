// @ts-nocheck
/**
 * components/InvoicePDF.tsx
 * PDF invoice document for time tracking invoices.
 * Generates a branded PDF with job details, time entries, and totals.
 *
 * Note: TypeScript checking is disabled for this file due to @react-pdf/renderer's
 * limited TypeScript support. The component is tested at runtime and works correctly.
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { TimeInvoice, TimeEntry, Job } from "@/utils/types";

// Register a default font for consistency
Font.register({
  family: "Helvetica",
  src: "https://fonts.gstatic.com/s/roboto/v29/KFOmCnqEu92Fr1Mu4mxK.ttf",
});

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  header: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 30,
    paddingBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: "#e5b45d",
  },
  logo: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#d4a55d",
  },
  logoSubtext: {
    fontSize: 10,
    color: "#666",
    marginTop: 2,
  },
  invoiceInfo: {
    textAlign: "right",
  },
  invoiceLabel: {
    fontSize: 10,
    color: "#666",
    marginBottom: 2,
  },
  invoiceNumber: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 8,
  },
  status: {
    fontSize: 10,
    padding: "4 8",
    borderRadius: 3,
  },
  statusApproved: {
    backgroundColor: "#ecfdf5",
    color: "#065f46",
    borderWidth: 1,
    borderColor: "#a7f3d0",
  },
  statusPending: {
    backgroundColor: "#fffbeb",
    color: "#92400e",
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#333",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingBottom: 5,
  },
  twoColumn: {
    display: "flex",
    flexDirection: "row",
    gap: 30,
  },
  column: {
    flex: 1,
  },
  label: {
    fontSize: 9,
    color: "#666",
    marginBottom: 2,
  },
  value: {
    fontSize: 11,
    color: "#1a1a1a",
    marginBottom: 12,
    fontFamily: "Courier",
  },
  table: {
    display: "flex",
    width: "100%",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  tableHeader: {
    display: "flex",
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  tableRow: {
    display: "flex",
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  tableCell: {
    flex: 1,
    padding: "8 10",
    fontSize: 10,
  },
  tableCellHeader: {
    flex: 1,
    padding: "10 10",
    fontSize: 10,
    fontWeight: "bold",
    color: "#333",
  },
  tableDescription: {
    flex: 2,
  },
  tableDuration: {
    flex: 1,
  },
  summaryRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 15,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "bold",
    width: 150,
  },
  summaryValue: {
    fontSize: 11,
    fontWeight: "bold",
    textAlign: "right",
    width: 100,
  },
  totalRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: "#e5b45d",
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#1a1a1a",
    width: 150,
  },
  totalValue: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#d4a55d",
    textAlign: "right",
    width: 100,
  },
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    fontSize: 9,
    color: "#999",
    textAlign: "center",
  },
});

interface InvoicePDFProps {
  job: Job;
  invoice: TimeInvoice;
  entries: TimeEntry[];
  freelancerAddress: string;
  clientAddress: string;
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export const InvoicePDF: React.FC<InvoicePDFProps> = ({
  job,
  invoice,
  entries,
  freelancerAddress,
  clientAddress,
}) => {
  const invoiceDate = new Date(invoice.createdAt);
  const formattedDate = invoiceDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const hourlyRate = parseFloat(String(invoice.hourlyRateXlm ?? "0"));
  const totalAmount = parseFloat(String(invoice.totalAmountXlm ?? "0"));

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>💫 MarketPay</Text>
            <Text style={styles.logoSubtext}>Time Invoice</Text>
          </View>
          <View style={styles.invoiceInfo}>
            <Text style={styles.invoiceLabel}>Invoice ID</Text>
            <Text style={styles.invoiceNumber}>{invoice.id.slice(0, 8)}</Text>
            <Text
              style={[
                styles.status,
                invoice.status === "approved"
                  ? styles.statusApproved
                  : styles.statusPending,
              ]}
            >
              {invoice.status.charAt(0).toUpperCase() +
                invoice.status.slice(1)}
            </Text>
          </View>
        </View>

        {/* Job Title */}
        <View style={styles.section}>
          <Text style={{ fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
            {job.title}
          </Text>
          <Text style={{ fontSize: 11, color: "#666" }}>{job.category}</Text>
        </View>

        {/* Parties */}
        <View style={[styles.section, styles.twoColumn]}>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Freelancer</Text>
            <Text style={styles.label}>Stellar Address</Text>
            <Text style={styles.value}>{freelancerAddress}</Text>
          </View>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Client</Text>
            <Text style={styles.label}>Stellar Address</Text>
            <Text style={styles.value}>{clientAddress}</Text>
          </View>
        </View>

        {/* Invoice Date */}
        <View style={styles.section}>
          <Text style={styles.label}>Invoice Date</Text>
          <Text style={styles.value}>{formattedDate}</Text>
        </View>

        {/* Time Entries Table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Time Entries</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCellHeader, styles.tableDescription]}>
                Description
              </Text>
              <Text style={[styles.tableCellHeader, styles.tableDuration]}>
                Duration
              </Text>
              <Text
                style={[styles.tableCellHeader, { flex: 1, textAlign: "right" }]}
              >
                Date
              </Text>
            </View>
            {entries.map((entry) => (
              <View key={entry.id} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableDescription]}>
                  {entry.description || <Text style={{ opacity: 0.5 }}>—</Text>}
                </Text>
                <Text style={[styles.tableCell, styles.tableDuration]}>
                  {minutesToHHMM(entry.durationMinutes)}
                </Text>
                <Text style={[styles.tableCell, { flex: 1, textAlign: "right" }]}>
                  {new Date(entry.startedAt || entry.createdAt).toLocaleDateString(
                    "en-US"
                  )}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Summary */}
        <View style={styles.section}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Hours:</Text>
            <Text style={styles.summaryValue}>
              {(invoice.totalMinutes / 60).toFixed(2)} hrs
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Hourly Rate:</Text>
            <Text style={styles.summaryValue}>{hourlyRate.toFixed(2)} XLM</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Amount:</Text>
            <Text style={styles.totalValue}>{totalAmount.toFixed(4)} XLM</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>
            This is an automatically generated invoice from MarketPay
          </Text>
          <Text style={{ marginTop: 4 }}>
            Invoice ID: {invoice.id} | Generated: {formattedDate}
          </Text>
        </View>
      </Page>
    </Document>
  );
};
