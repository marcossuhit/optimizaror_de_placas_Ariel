;(function stockSyncBootstrap() {
  const CONFIG = window.STOCK_SYNC_CONFIG || {};
  const FIREBASE_SDK_URLS = [
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js'
  ];

  const state = {
    initPromise: null,
    app: null,
    firestore: null,
    unsubscribe: null,
    lastDoc: null,
    cachedStock: null,
    cachedEdges: null,
    cachedAdmins: null,
    authDisabled: false,
    watchers: {
      stock: new Set(),
      edges: new Set(),
      admins: new Set()
    }
  };

  function getConfig() {
    const cfg = window.STOCK_SYNC_CONFIG || CONFIG || {};
    const firebaseConfig = cfg.firebaseConfig || {};
    const hasFirebase = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId;
    return {
      enabled: !!hasFirebase,
      firebaseConfig: hasFirebase ? firebaseConfig : null,
      collection: cfg.collection || 'inventory',
      document: cfg.document || 'shared',
      requireAuthForWrites: typeof cfg.requireAuthForWrites === 'boolean' ? cfg.requireAuthForWrites : true
    };
  }

  function isConfigured() {
    return getConfig().enabled;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const attr = `data-stock-sync-src`;
      const existing = document.querySelector(`script[${attr}="${url}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', (err) => reject(err), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.stockSyncSrc = url;
      script.addEventListener('load', () => {
        script.dataset.loaded = '1';
        resolve();
      }, { once: true });
      script.addEventListener('error', (err) => reject(err), { once: true });
      document.head.appendChild(script);
    });
  }

  async function ensureFirestore() {
    const cfg = getConfig();
    if (!cfg.enabled) return null;
    if (state.firestore) return state.firestore;
    if (!state.initPromise) {
      state.initPromise = (async () => {
        try {
          await Promise.all(FIREBASE_SDK_URLS.map(loadScript));
          if (!window.firebase) {
            console.error('StockSync: Firebase SDK no disponible.');
            return null;
          }
          let app;
          try {
            app = firebase.app();
          } catch (_) {
            app = firebase.initializeApp(cfg.firebaseConfig);
          }
          state.app = app;
          state.firestore = firebase.firestore(app);
          return state.firestore;
        } catch (err) {
          console.error('StockSync: Error al inicializar Firebase', err);
          throw err;
        }
      })().catch((err) => {
        state.initPromise = null;
        return Promise.reject(err);
      });
    }
    return state.initPromise.then(() => state.firestore).catch(() => null);
  }

  async function getDocRef() {
    const db = await ensureFirestore();
    if (!db) return null;
    const cfg = getConfig();
    try {
      return db.collection(cfg.collection).doc(cfg.document);
    } catch (err) {
      console.error('StockSync: No se pudo obtener referencia a Firestore', err);
      return null;
    }
  }

  function getCurrentAuthUser() {
    try {
      const getter = window.Auth && typeof window.Auth.getAuthUser === 'function'
        ? window.Auth.getAuthUser
        : null;
      return getter ? getter() : window.__authUser || null;
    } catch (_) {
      return window.__authUser || null;
    }
  }

  async function ensureFirebaseAuth() {
    const cfg = getConfig();
    if (!cfg.enabled || !cfg.requireAuthForWrites) return null;
    if (state.authDisabled) return null;
    await ensureFirestore();
    if (!firebase || typeof firebase.auth !== 'function') return null;
    const auth = firebase.auth();
    const currentUser = getCurrentAuthUser();
    if (!currentUser || !currentUser.email) return auth;
    const alreadySigned = auth.currentUser && auth.currentUser.email === currentUser.email;
    if (alreadySigned) return auth;
    const idToken = currentUser.idToken;
    if (!idToken) return auth;
    try {
      const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
      await auth.signInWithCredential(credential);
    } catch (err) {
      const code = err?.code || err?.message || '';
      const isProviderDisabled = typeof code === 'string' && code.includes('operation-not-allowed');
      if (isProviderDisabled) {
        state.authDisabled = true;
        console.warn('StockSync: autenticación deshabilitada en Firebase Auth. Desactiva requireAuthForWrites o habilitá el proveedor en Firebase.');
        return auth;
      }
      console.error('StockSync: no se pudo autenticar con Firebase Auth', err);
    }
    return auth;
  }

  function signOutFirebaseAuth() {
    const cfg = getConfig();
    if (!cfg.requireAuthForWrites) return;
    if (!firebase || typeof firebase.auth !== 'function') return;
    try {
      const auth = firebase.auth();
      if (auth.currentUser) auth.signOut().catch(() => {});
    } catch (_) {}
  }

  function normaliseStockItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => ({
        material: String(item?.material || '').trim(),
        price: Number.parseFloat(item?.price ?? item?.pricePerUnit ?? item?.pricePerPlate) || 0
      }))
      .filter((item) => item.material)
      .map((item) => ({ material: item.material, price: item.price >= 0 ? item.price : 0 }))
      .sort((a, b) => a.material.localeCompare(b.material, undefined, { sensitivity: 'base' }));
  }

  function normaliseEdgeItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => ({
        name: String(item?.name || '').trim(),
        pricePerMeter: Number.parseFloat(item?.pricePerMeter) || 0
      }))
      .filter((item) => item.name)
      .map((item) => ({ name: item.name, pricePerMeter: item.pricePerMeter >= 0 ? item.pricePerMeter : 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  function normaliseAdminItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => ({
        name: String(item?.name || '').trim(),
        email: String(item?.email || '').trim().toLowerCase()
      }))
      .filter((item) => item.name && item.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email))
      .map((item) => ({ name: item.name, email: item.email }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  function emit(type, payload, metadata) {
    const listeners = state.watchers[type];
    if (!listeners || !listeners.size) return;
    listeners.forEach((callback) => {
      try {
        callback(payload.slice(), metadata);
      } catch (err) {
        console.error(`StockSync: callback de ${type} falló`, err);
      }
    });
  }

  function handleSnapshot(snapshot) {
    const data = snapshot.exists ? snapshot.data() || {} : {};
    state.lastDoc = data;
    state.cachedStock = normaliseStockItems(data.stockItems);
    state.cachedEdges = normaliseEdgeItems(data.edgeItems);
    state.cachedAdmins = normaliseAdminItems(data.adminItems);
    const metadata = {
      updatedAt: data.stockUpdatedAt || data.updatedAt || null,
      updatedBy: data.stockUpdatedBy || null,
      raw: data
    };
    emit('stock', state.cachedStock, metadata);
    const edgeMetadata = {
      updatedAt: data.edgeUpdatedAt || data.updatedAt || null,
      updatedBy: data.edgeUpdatedBy || null,
      raw: data
    };
    emit('edges', state.cachedEdges, edgeMetadata);
    emit('admins', state.cachedAdmins, metadata);
  }

  async function ensureRealtimeListener() {
    if (state.unsubscribe || !isConfigured()) return;
    const ref = await getDocRef();
    if (!ref) return;
    state.unsubscribe = ref.onSnapshot(handleSnapshot, (error) => {
      console.error('StockSync: error en listener de Firestore', error);
      state.unsubscribe = null;
    });
  }

  function subscribe(type, callback) {
    if (typeof callback !== 'function') return () => {};
    const listeners = state.watchers[type];
    if (!listeners) return () => {};
    listeners.add(callback);
    if (type === 'stock' && Array.isArray(state.cachedStock)) {
      callback(state.cachedStock.slice(), { raw: state.lastDoc });
    }
    if (type === 'edges' && Array.isArray(state.cachedEdges)) {
      callback(state.cachedEdges.slice(), { raw: state.lastDoc });
    }
    if (type === 'admins' && Array.isArray(state.cachedAdmins)) {
      callback(state.cachedAdmins.slice(), { raw: state.lastDoc });
    }
    ensureRealtimeListener();
    return () => {
      listeners.delete(callback);
      if (!state.watchers.stock.size && !state.watchers.edges.size && !state.watchers.admins.size && state.unsubscribe) {
        state.unsubscribe();
        state.unsubscribe = null;
      }
    };
  }

  async function getSnapshotField(field) {
    if (!isConfigured()) return [];
    if (field === 'stock' && Array.isArray(state.cachedStock)) return state.cachedStock.slice();
    if (field === 'edges' && Array.isArray(state.cachedEdges)) return state.cachedEdges.slice();
    if (field === 'admins' && Array.isArray(state.cachedAdmins)) return state.cachedAdmins.slice();
    const ref = await getDocRef();
    if (!ref) return [];
    try {
      const snap = await ref.get();
      if (!snap.exists) return [];
      handleSnapshot(snap);
      if (field === 'stock') return state.cachedStock.slice();
      if (field === 'edges') return state.cachedEdges.slice();
      if (field === 'admins') return state.cachedAdmins.slice();
      return [];
    } catch (err) {
      console.error('StockSync: no se pudo obtener snapshot', err);
      return [];
    }
  }

  function getServerTimestamp() {
    const tsFn = window.firebase?.firestore?.FieldValue?.serverTimestamp;
    if (typeof tsFn === 'function') {
      try { return tsFn.call(window.firebase.firestore.FieldValue); } catch (_) { return tsFn(); }
    }
    return null;
  }

  function buildWritePayload({ kind, items, actor }) {
    const base = {};
    const timestamp = getServerTimestamp();
    if (kind === 'stock') {
      base.stockItems = normaliseStockItems(items);
      if (timestamp) base.stockUpdatedAt = timestamp;
      if (actor) {
        base.stockUpdatedBy = {
          email: actor.email || '',
          name: actor.name || ''
        };
      }
    } else if (kind === 'edges') {
      base.edgeItems = normaliseEdgeItems(items);
      if (timestamp) base.edgeUpdatedAt = timestamp;
      if (actor) {
        base.edgeUpdatedBy = {
          email: actor.email || '',
          name: actor.name || ''
        };
      }
    } else if (kind === 'admins') {
      base.adminItems = normaliseAdminItems(items);
      if (timestamp) base.adminsUpdatedAt = timestamp;
      if (actor) {
        base.adminsUpdatedBy = {
          email: actor.email || '',
          name: actor.name || ''
        };
      }
    }
    if (timestamp) base.updatedAt = timestamp;
    return base;
  }

  async function saveItems(kind, items, { actor } = {}) {
    if (!isConfigured()) return false;
    const cfg = getConfig();
    if (cfg.requireAuthForWrites) {
      await ensureFirebaseAuth();
    }
    const ref = await getDocRef();
    if (!ref) return false;
    try {
      const payload = buildWritePayload({ kind, items, actor });
      await ref.set(payload, { merge: true });
      return true;
    } catch (err) {
      console.error(`StockSync: no se pudo guardar ${kind}`, err);
      return false;
    }
  }

  function getLastMetadata() {
    return state.lastDoc || null;
  }

  const api = {
    isConfigured,
    ensureReady: ensureFirestore,
    watchStock: (cb) => subscribe('stock', cb),
    watchEdges: (cb) => subscribe('edges', cb),
    watchAdmins: (cb) => subscribe('admins', cb),
    getStockSnapshot: () => getSnapshotField('stock'),
    getEdgeSnapshot: () => getSnapshotField('edges'),
    getAdminSnapshot: () => getSnapshotField('admins'),
    saveStock: (items, options) => saveItems('stock', items, options),
    saveEdges: (items, options) => saveItems('edges', items, options),
    saveAdmins: (items, options) => saveItems('admins', items, options),
    getLastMetadata,
    signOutFirebase: signOutFirebaseAuth,
    ensureFirebaseAuth,
    requiresAuth: () => getConfig().requireAuthForWrites
  };

  window.StockSync = api;
})();
