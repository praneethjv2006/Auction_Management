const nodemailer = require('nodemailer');

let mailTransporter = null;

function hasEmailConfig() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function canReturnDevPreview() {
  return !isProduction();
}

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  if (!hasEmailConfig()) {
    throw new Error('Email service is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.');
  }

  const port = Number(process.env.SMTP_PORT || 587);
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return mailTransporter;
}

async function sendMail({ to, subject, text, html }) {
  const transporter = getMailTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  hasEmailConfig,
  canReturnDevPreview,
  sendMail,
};
