;(function () {
  const cfg = window.EMAIL_PROVIDER_CONFIG || {};
  const API_ENDPOINT = cfg.apiEndpoint || window.EMAIL_PROVIDER_ENDPOINT || '/api/send-email';

  async function sendViaApi({ from, to, subject, text, html, attachments }) {
    const recipients = Array.isArray(to) ? to : [to];
    if (!recipients.length) throw new Error('El correo requiere al menos un destinatario.');

    const payload = {
      from: cfg.fromOverride || from,
      fromName: cfg.fromName || '',
      to: recipients,
      subject,
      text,
      html,
      attachments: attachments || []
    };

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let details = '';
      try {
        const errBody = await response.json();
        details = errBody?.error ? `: ${errBody.error}` : '';
      } catch (_) {}
      throw new Error(`El servidor de correo respondió ${response.status}${details}`);
    }

    try {
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  async function GenericMailProvider(options) {
    const normalized = {
      from: options.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments || []
    };
    if (!normalized.from) throw new Error('El remitente (from) es obligatorio.');
    if (!normalized.to) throw new Error('El destinatario (to) es obligatorio.');
    return sendViaApi(normalized);
  }

  window.GenericMailProvider = GenericMailProvider;
})();
