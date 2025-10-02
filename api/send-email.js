import nodemailer from 'nodemailer';

const DEFAULT_SMTP_HOST = process.env.GMAIL_SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
const DEFAULT_SMTP_PORT = Number.parseInt(process.env.GMAIL_SMTP_PORT || process.env.SMTP_PORT || '465', 10);
const DEFAULT_SMTP_SECURE = (() => {
  const explicit = process.env.GMAIL_SMTP_SECURE ?? process.env.SMTP_SECURE;
  if (explicit != null) return explicit !== 'false';
  return DEFAULT_SMTP_PORT === 465;
})();

let transporterPromise = null;

async function resolveTransporter() {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const user = process.env.GMAIL_SMTP_USER || process.env.SMTP_USER;
      const pass = process.env.GMAIL_SMTP_PASS || process.env.GMAIL_SMTP_APP_PASSWORD || process.env.SMTP_PASS;
      if (!user || !pass) {
        throw new Error('El servidor necesita SMTP_USER y SMTP_PASS (o GMAIL_SMTP_* equivalentes).');
      }
      const transporter = nodemailer.createTransport({
        host: DEFAULT_SMTP_HOST,
        port: DEFAULT_SMTP_PORT,
        secure: DEFAULT_SMTP_SECURE,
        auth: { user, pass }
      });
      if (process.env.VERIFY_SMTP !== 'false') {
        await transporter.verify().catch((err) => {
          console.error('[send-email] Error verificando SMTP', err);
          throw err;
        });
      }
      return transporter;
    })();
  }
  return transporterPromise;
}

function normalizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return [];
  return rawAttachments
    .filter((att) => att && att.filename && att.content)
    .map((att) => ({
      filename: String(att.filename),
      content: Buffer.from(att.content, 'base64'),
      contentType: att.mimeType || att.type || 'application/octet-stream'
    }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { from, fromName, replyTo, to, subject, text, html, attachments } = req.body || {};

    const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
    if (!recipients.length) {
      return res.status(400).json({ error: 'El payload debe incluir al menos un destinatario en to.' });
    }
    if (!subject) {
      return res.status(400).json({ error: 'El payload debe incluir subject.' });
    }

    const transporter = await resolveTransporter();
    const smtpUser = process.env.GMAIL_SMTP_FROM || process.env.SMTP_FROM || process.env.GMAIL_SMTP_USER || process.env.SMTP_USER;
    const senderName = fromName?.trim() || process.env.GMAIL_SMTP_FROM_NAME || process.env.SMTP_FROM_NAME || '';
    const composedFrom = senderName ? `${senderName} <${smtpUser}>` : smtpUser;
    const safeText = text && String(text).trim() ? String(text).trim() : undefined;
    const safeHtml = html && String(html).trim() ? String(html).trim() : undefined;

    const mailOptions = {
      from: composedFrom,
      to: recipients,
      subject: String(subject),
      text: safeText,
      html: safeHtml,
      attachments: normalizeAttachments(attachments)
    };

    const providedReplyTo = replyTo && String(replyTo).trim();
    const fallbackReplyTo = from && String(from).trim();
    const candidateReplyTo = providedReplyTo || fallbackReplyTo;
    if (candidateReplyTo && candidateReplyTo !== smtpUser) {
      mailOptions.replyTo = candidateReplyTo;
    }

    const info = await transporter.sendMail(mailOptions);
    return res.status(200).json({ messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  } catch (error) {
    console.error('[send-email] Unexpected error', error);
    const status = error?.responseCode && Number.isInteger(error.responseCode) ? error.responseCode : 500;
    const message = error?.message || 'No se pudo enviar el correo.';
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  }
}
