// Configuración base para sincronizar stock mediante Firestore.
// Reemplazá los valores por los de tu proyecto Firebase para habilitar la sincronización.
// Si dejás apiKey vacío, la integración queda deshabilitada y se usan los métodos actuales.
window.STOCK_SYNC_CONFIG = window.STOCK_SYNC_CONFIG || {
  firebaseConfig: {
    apiKey: 'AIzaSyCs4U1CWCddJWHc6mVJnk1T-5klVALsahQ',
    authDomain: 'optimizador-de-placas-715db.firebaseapp.com',
    projectId: 'optimizador-de-placas-715db',
    storageBucket: 'optimizador-de-placas-715db.firebasestorage.app',
    messagingSenderId: '644850544621',
    appId: '1:644850544621:web:2a27f4f4aff6afab30c1e4'
  },
  collection: 'inventory',
  document: 'shared'
};
