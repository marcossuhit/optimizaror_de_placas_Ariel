/*
 * Configuración del proveedor de email.
 * Para usar Gmail SMTP configurá las variables de entorno
 * GMAIL_SMTP_USER y GMAIL_SMTP_PASS (o GMAIL_SMTP_APP_PASSWORD)
 * y opcionalmente GMAIL_SMTP_FROM_NAME en el servidor.
 */
window.EMAIL_PROVIDER_CONFIG = {
  service: 'gmail-smtp',
  apiEndpoint: '/api/send-email',
  fromName: 'Optimizador de Placas',
  fromOverride: 'marcossuhit@gmail.com'
};
