// email-provider.js

async function sendViaApi(config, emailData) {
  // 1. Prepara un único objeto con toda la información
  const payload = {
    to: emailData.to,
    subject: emailData.subject,
    html: emailData.html,
    fromName: config.fromName, // Puedes enviar datos extra si tu API los maneja
    fromOverride: config.fromOverride
  };

  try {
    // 2. Llama a tu API usando el método POST
    const response = await fetch(config.apiEndpoint, {
      method: 'POST', // Especifica que el método es POST
      headers: {
        'Content-Type': 'application/json', // Avisa que el cuerpo es un JSON
      },
      body: JSON.stringify(payload), // Convierte el objeto a un string JSON
    });

    // 3. Maneja la respuesta como antes
    if (!response.ok) {
      // Esto lanzará el error que veías si el servidor responde con 4xx o 5xx
      throw new Error(`El servidor de correo respondió ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error en sendViaApi:', error);
    throw error; // Propaga el error para que la función que llama se entere
  }
}