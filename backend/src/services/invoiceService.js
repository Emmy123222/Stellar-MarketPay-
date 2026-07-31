"use strict";

const PDFDocument = require("pdfkit");
const { getCurrentXlmPrice } = require("./xlmPriceService");

async function generateInvoicePdf(job, writeStream) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      
      // We don't wait for 'finish' if we are piping to response directly in express,
      // but if we do, this helps capture it. For Express res, we resolve when doc.end() is called.
      doc.pipe(writeStream);

      const companyName = process.env.INVOICE_COMPANY_NAME || "Stellar MarketPay";
      
      doc.fontSize(20).text("INVOICE", { align: "right" });
      doc.fontSize(10).text(companyName, { align: "right" });
      doc.moveDown(2);

      doc.fontSize(14).text("Job Details", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Job ID: ${job.id}`);
      doc.text(`Title: ${job.title}`);
      
      // Use updatedAt as completion date if completed
      const completionDate = job.status === "completed" && job.updatedAt ? new Date(job.updatedAt).toLocaleDateString() : new Date().toLocaleDateString();
      doc.text(`Completion Date: ${completionDate}`);
      doc.moveDown(1.5);

      doc.fontSize(14).text("Parties", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Client Address: ${job.clientAddress}`);
      doc.text(`Freelancer Address: ${job.freelancerAddress || "N/A"}`);
      doc.moveDown(1.5);

      let xlmPrice = 0;
      try {
        const priceData = await getCurrentXlmPrice();
        xlmPrice = priceData.priceUsd;
      } catch (e) {
        console.error("Failed to fetch XLM price", e);
      }
      
      const budgetXlm = parseFloat(job.budget);
      const budgetUsd = (budgetXlm * xlmPrice).toFixed(2);
      
      doc.fontSize(14).text("Amount", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`XLM Amount: ${budgetXlm} XLM`);
      if (xlmPrice > 0) {
        doc.text(`USD Equivalent: $${budgetUsd}`);
      } else {
        doc.text(`USD Equivalent: N/A`);
      }
      doc.moveDown(1.5);
      
      doc.fontSize(14).text("Transaction Details", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Transaction Hash (Escrow): ${job.escrowContractId || "N/A"}`);

      doc.end();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateInvoicePdf
};
