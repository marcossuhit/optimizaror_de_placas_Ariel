import { Resend } from 'resend';

// Inicializa Resend con la API key guardada en las variables de entorno de Vercel
const resend = new Resend(process.env.RESEND_API_KEY);

// Vercel exporta una función 'handler' que recibe la petición (request) y la respuesta (response)
export default async (req, res) => {
  // Solo permitimos peticiones POST a esta ruta
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { from, fromName, to, subject, text, html, attachments } = req.body || {};

    const recipients = Array.isArray(to) ? to : (to ? [to] : []);
    if (!from || !recipients.length || !subject) {
      return res.status(400).json({ error: 'El payload debe incluir from, to y subject.' });
    }

    const composedFrom = fromName ? `${fromName} <${from}>` : from;
    const safeText = (text && String(text).trim()) || undefined;
    const safeHtml = (html && String(html).trim()) || undefined;

    const payload = {
      from: composedFrom,
      to: recipients,
      subject,
      text: safeText,
      html: safeHtml,
      attachments: Array.isArray(attachments)
        ? attachments
            .filter(att => att && att.filename && att.content)
            .map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              type: attachment.mimeType || attachment.type || 'application/octet-stream'
            }))
        : undefined
    };

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error('[send-email] Resend error', error);
      return res.status(400).json({ error: error.message || 'No se pudo enviar el correo.' });
    }

    // Enviamos una respuesta exitosa al frontend
    res.status(200).json(data);
  } catch (error) {
    console.error('[send-email] Unexpected error', error);
    res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
};
