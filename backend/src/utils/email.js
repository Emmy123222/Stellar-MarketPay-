"use strict";

const nodemailer = require("nodemailer");

const smtpEnabled = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const smtpTransport = smtpEnabled
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

async function sendEmail({ to, subject, text, html }) {
  if (!smtpTransport || !to) {
    console.warn("[email] Email transport not configured or 'to' missing");
    return;
  }
  await smtpTransport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  sendEmail,
  smtpTransport,
};
