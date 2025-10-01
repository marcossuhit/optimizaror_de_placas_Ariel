/*
 * Configuración del proveedor de email.
 * Reemplazá el valor de apiKey por tu clave privada de Resend
 * (https://resend.com). También podés ajustar el nombre que
 * aparecerá en los correos salientes.
 */
window.EMAIL_PROVIDER_CONFIG = {
  service: 'vercel-api',
  apiEndpoint: '/api/send-email',
  fromName: 'Optimizador de Placas',
  fromOverride: ''
};
