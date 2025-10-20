const STORAGE_KEY = 'stock_items_v1';
const EDGE_STORAGE_KEY = 'edgeband_items_v1';
const ADMIN_STORAGE_KEY = 'admin_items_v1';
const TEXT_FALLBACK = 'stock.txt';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const materialInput = document.getElementById('stockMaterialInput');
const priceInput = document.getElementById('stockPriceInput');
const form = document.getElementById('stockForm');
const tableBody = document.getElementById('stockTableBody');
const downloadBtn = document.getElementById('downloadStockBtn');
const importInput = document.getElementById('importStockInput');
const clearBtn = document.getElementById('clearStockBtn');
const deleteMaterialBtn = document.getElementById('deleteMaterialBtn');
const closeWindowBtn = document.getElementById('closeWindowBtn');

const adminPanel = document.getElementById('adminPanel');
const adminForm = document.getElementById('adminForm');
const adminNameInput = document.getElementById('adminNameInput');
const adminEmailInput = document.getElementById('adminEmailInput');
const adminTableBody = document.getElementById('adminTableBody');
const deleteAdminBtn = document.getElementById('deleteAdminBtn');

const edgeForm = document.getElementById('edgeForm');
const edgeNameInput = document.getElementById('edgeNameInput');
const edgePriceInput = document.getElementById('edgePriceInput');
const edgeDeleteBtn = document.getElementById('deleteEdgeBtn');
const edgeTableBody = document.getElementById('edgeTableBody');

let stockItems = [];
let edgeItems = [];
let adminItems = [];

const authUser = typeof ensureAuthenticated === 'function' ? ensureAuthenticated() : null;
const DEFAULT_ADMIN_EMAILS = ['marcossuhit@gmail.com', 'ludovicots@gmail.com'];
let allowedAdminEmailSet = new Set(DEFAULT_ADMIN_EMAILS.map((email) => email.toLowerCase()));
let isAdmin = false;
const StockSync = window.StockSync || null;
const REMOTE_SYNC_ENABLED = !!(StockSync && typeof StockSync.isConfigured === 'function' && StockSync.isConfigured());
const SYNC_ACTOR = authUser ? { email: authUser.email || '', name: authUser.name || '' } : null;
const AUTO_EXPORT_ON_SAVE = false;

let stockSyncTimer = null;
let stockFileHandle = null;
let stockExportNoticeShown = false;
let remoteStockUnsubscribe = null;
let remoteEdgeUnsubscribe = null;
let remoteAdminUnsubscribe = null;

function normaliseMaterialName(name) {
  return (name || '').trim();
}

// Normaliza el nombre de un item para comparación case-insensitive
function normalizeItemName(name) {
  return (name || '').trim().toLowerCase();
}
// Verifica si un item es protegido (no puede ser eliminado)
function isProtectedItem(name, type = 'material') {
  const normalized = normalizeItemName(name);
  if (type === 'material') {
    return normalized === 'mdf blanco';
  }
  if (type === 'edge') {
    return normalized === 'blanco';
  }
  return false;
}

function formatPrice(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function normaliseStockItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      material: normaliseMaterialName(item?.material || ''),
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
      name: normaliseMaterialName(item?.name || ''),
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
      name: normaliseMaterialName(item?.name || ''),
      email: String(item?.email || '').trim().toLowerCase()
    }))
    .filter((item) => item.name && EMAIL_REGEX.test(item.email))
    .map((item) => ({ name: item.name, email: item.email }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function computeCurrentAdminStatus() {
  const email = (authUser?.email || '').trim().toLowerCase();
  return !!email && allowedAdminEmailSet.has(email);
}

function applyAdminVisibility() {
  const showAdminUi = isAdmin;
  if (form) form.style.display = showAdminUi ? '' : 'none';
  if (edgeForm) edgeForm.style.display = showAdminUi ? '' : 'none';
  if (adminPanel) adminPanel.style.display = showAdminUi ? '' : 'none';
  const stockActions = document.querySelector('.stock-actions');
  if (stockActions) stockActions.style.display = showAdminUi ? '' : 'none';
  const stockActionsPanel = document.querySelector('.stock-actions-panel');
  if (stockActionsPanel) stockActionsPanel.style.display = showAdminUi ? '' : 'none';
}

function updateAllowedAdminEmails(records, { persist = false } = {}) {
  const normalized = normaliseAdminItems(records);
  allowedAdminEmailSet = new Set(DEFAULT_ADMIN_EMAILS.map((email) => email.toLowerCase()));
  normalized.forEach(({ email }) => allowedAdminEmailSet.add(email));
  if (persist) cacheLocally(ADMIN_STORAGE_KEY, normalized);
  const previous = isAdmin;
  isAdmin = computeCurrentAdminStatus();
  if (previous !== isAdmin) applyAdminVisibility();
  return normalized;
}

updateAllowedAdminEmails(loadFromStorage(ADMIN_STORAGE_KEY) || []);
applyAdminVisibility();

function stockListsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].material !== b[i].material || a[i].price !== b[i].price) return false;
  }
  return true;
}

function edgeListsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].pricePerMeter !== b[i].pricePerMeter) return false;
  }
  return true;
}

function adminListsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].email !== b[i].email || a[i].name !== b[i].name) return false;
  }
  return true;
}

function cacheLocally(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function loadFromStorage(key) {
  if (!isAdmin && key !== ADMIN_STORAGE_KEY) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (key === STORAGE_KEY) return normaliseStockItems(parsed);
      if (key === EDGE_STORAGE_KEY) return normaliseEdgeItems(parsed);
      if (key === ADMIN_STORAGE_KEY) return normaliseAdminItems(parsed);
      return parsed;
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function loadFromTextFile() {
  try {
    const response = await fetch(TEXT_FALLBACK, { cache: 'no-store' });
    if (!response.ok) return [];
    const text = await response.text();
    return parseInventoryText(text);
  } catch (_) {
    return { stockItems: [], adminItems: [] };
  }
}

function parseInventoryText(text) {
  const payload = { stockItems: [], adminItems: [] };
  if (!text) return payload;
  text.split('\n').forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    const parts = clean.split('|').map((part) => (part ?? '').trim());
    if (!parts.length) return;
    const type = parts[0].toLowerCase();
    if (type === 'admin') {
      const name = parts[1] || '';
      const email = (parts[2] || '').toLowerCase();
      if (name && EMAIL_REGEX.test(email)) {
        payload.adminItems.push({ name, email });
      }
      return;
    }
    if (type === 'stock') {
      const material = parts[1] || '';
      if (!material) return;
      const price = Number.parseFloat(parts[2]);
      payload.stockItems.push({ material, price: Number.isFinite(price) ? price : 0 });
      return;
    }
    // Compatibilidad con formato legacy material|precio
    const materialPart = parts[0];
    if (!materialPart) return;
    const price = Number.parseFloat(parts[1]);
    payload.stockItems.push({ material: materialPart, price: Number.isFinite(price) ? price : 0 });
  });
  return payload;
}

function persist(key, value, { sync = true } = {}) {
  if (!isAdmin) return;
  cacheLocally(key, value);
  if (REMOTE_SYNC_ENABLED) {
    if (key === STORAGE_KEY) {
      StockSync.saveStock(value, { actor: SYNC_ACTOR }).catch((err) => {
        console.error('No se pudo sincronizar stock remoto', err);
      });
    } else if (key === EDGE_STORAGE_KEY) {
      StockSync.saveEdges(value, { actor: SYNC_ACTOR }).catch((err) => {
        console.error('No se pudo sincronizar cubre cantos remotos', err);
      });
    } else if (key === ADMIN_STORAGE_KEY && typeof StockSync.saveAdmins === 'function') {
      StockSync.saveAdmins(value, { actor: SYNC_ACTOR }).catch((err) => {
        console.error('No se pudo sincronizar administradores remotos', err);
      });
    }
  }
  if (sync && (key === STORAGE_KEY || key === ADMIN_STORAGE_KEY) && AUTO_EXPORT_ON_SAVE) scheduleStockSync();
}

function buildStockText() {
  const lines = [
    '# Formato: tipo|campo1|campo2',
    '# stock|Material|Precio',
    '# admin|Nombre|Correo'
  ];
  const adminsForExport = adminItems.length ? adminItems.slice() : normaliseAdminItems(loadFromStorage(ADMIN_STORAGE_KEY) || []);
  stockItems.forEach(({ material, price }) => {
    lines.push(`stock|${material}|${formatPrice(price)}`);
  });
  if (adminsForExport.length) {
    lines.push('', '# Administradores');
    adminsForExport.forEach(({ name, email }) => {
      lines.push(`admin|${name}|${email}`);
    });
  }
  return lines.join('\n');
}

async function exportStockText() {
  const text = buildStockText();
  if (isAdmin && 'showSaveFilePicker' in window) {
    try {
      if (!stockFileHandle) {
        stockFileHandle = await window.showSaveFilePicker({
          suggestedName: 'stock.txt',
          types: [{ description: 'Archivo de texto', accept: { 'text/plain': ['.txt'] } }]
        });
      }
      const writable = await stockFileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      if (!stockExportNoticeShown) {
        alert('Se guardó stock.txt con los últimos cambios. Publicalo en tu hosting para que los clientes lo vean.');
        stockExportNoticeShown = true;
      }
      return;
    } catch (err) {
      if (err?.name === 'AbortError') {
        return; // usuario canceló
      }
      stockFileHandle = null;
      console.error('No se pudo guardar stock.txt con el selector nativo', err);
    }
  }
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stock.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  if (!stockExportNoticeShown) {
    alert('Se descargó stock.txt con los cambios. Subilo al servidor para compartirlo con los clientes.');
    stockExportNoticeShown = true;
  }
}

function scheduleStockSync() {
  if (!isAdmin) return;
  if (stockSyncTimer) clearTimeout(stockSyncTimer);
  stockSyncTimer = setTimeout(() => {
    stockSyncTimer = null;
    exportStockText().catch((err) => console.error('No se pudo exportar stock.txt', err));
  }, 500);
}

function applyRemoteStockItems(items, { hydrateLocal = isAdmin } = {}) {
  const normalized = normaliseStockItems(items);
  if (stockListsEqual(stockItems, normalized)) return;
  stockItems = normalized;
  if (hydrateLocal && isAdmin) {
    cacheLocally(STORAGE_KEY, stockItems);
  }
  renderStock();
}

function applyRemoteEdgeItems(items, { hydrateLocal = isAdmin } = {}) {
  const normalized = normaliseEdgeItems(items);
  if (edgeListsEqual(edgeItems, normalized)) return;
  edgeItems = normalized;
  if (hydrateLocal && isAdmin) {
    cacheLocally(EDGE_STORAGE_KEY, edgeItems);
  }
  renderEdges();
}

function applyAdminItems(items, { hydrateLocal = isAdmin } = {}) {
  const normalized = normaliseAdminItems(items);
  if (adminListsEqual(adminItems, normalized)) {
    updateAllowedAdminEmails(normalized, { persist: hydrateLocal });
    return;
  }
  adminItems = normalized;
  if (hydrateLocal) {
    cacheLocally(ADMIN_STORAGE_KEY, adminItems);
  }
  updateAllowedAdminEmails(adminItems, { persist: hydrateLocal });
  renderAdmins();
}

function renderStock() {
  tableBody.innerHTML = '';
  if (!stockItems.length) {
    const emptyRow = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'Sin registros de stock';
    cell.className = 'stock-empty';
    emptyRow.appendChild(cell);
    tableBody.appendChild(emptyRow);
    return;
  }

  stockItems.forEach((item, index) => {
    const row = document.createElement('tr');
    const isProtected = isProtectedItem(item.material, 'material');

    const materialTd = document.createElement('td');
    const materialBtn = document.createElement('button');
    materialBtn.type = 'button';
    materialBtn.className = 'link-button';
    materialBtn.textContent = item.material;
    if (isProtected) {
      materialBtn.textContent += ' 🔒';
      materialBtn.title = 'Material protegido: solo se puede editar el precio';
    }
    materialBtn.addEventListener('click', () => {
      if (!materialInput) return;
      materialInput.value = item.material;
      if (priceInput) priceInput.value = formatPrice(item.price);
      materialInput.focus();
    });
    materialTd.appendChild(materialBtn);
    row.appendChild(materialTd);

    const priceTd = document.createElement('td');
    priceTd.textContent = `$ ${formatPrice(item.price)}`;
    row.appendChild(priceTd);

    const actionsTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn danger btn-small';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.disabled = isProtected;
    if (isProtected) {
      deleteBtn.title = 'Este material no puede ser eliminado';
      deleteBtn.style.opacity = '0.5';
      deleteBtn.style.cursor = 'not-allowed';
    }
    deleteBtn.addEventListener('click', () => {
      if (isProtected) {
        alert(`"${item.material}" es un material protegido y no puede ser eliminado.`);
        return;
      }
      stockItems.splice(index, 1);
      persist(STORAGE_KEY, stockItems);
      renderStock();
    });
    actionsTd.appendChild(deleteBtn);
    row.appendChild(actionsTd);

    tableBody.appendChild(row);
  });
}

function renderEdges() {
  if (!edgeTableBody) return;
  edgeTableBody.innerHTML = '';
  if (!edgeItems.length) {
    const emptyRow = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'Sin cubre cantos registrados';
    cell.className = 'stock-empty';
    emptyRow.appendChild(cell);
    edgeTableBody.appendChild(emptyRow);
    return;
  }

  edgeItems.forEach((item, index) => {
    const row = document.createElement('tr');
    const isProtected = isProtectedItem(item.name, 'edge');

    const nameTd = document.createElement('td');
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'link-button';
    nameBtn.textContent = item.name;
    if (isProtected) {
      nameBtn.textContent += ' 🔒';
      nameBtn.title = 'Cubre canto protegido: solo se puede editar el precio';
    }
    nameBtn.addEventListener('click', () => {
      edgeNameInput.value = item.name;
      edgePriceInput.value = String(item.pricePerMeter);
      edgeNameInput.focus();
    });
    nameTd.appendChild(nameBtn);
    row.appendChild(nameTd);

    const priceTd = document.createElement('td');
    priceTd.textContent = `$ ${item.pricePerMeter.toFixed(2)}`;
    row.appendChild(priceTd);

    const actionsTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn danger btn-small';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.disabled = isProtected;
    if (isProtected) {
      deleteBtn.title = 'Este cubre canto no puede ser eliminado';
      deleteBtn.style.opacity = '0.5';
      deleteBtn.style.cursor = 'not-allowed';
    }
    deleteBtn.addEventListener('click', () => {
      if (isProtected) {
        alert(`"${item.name}" es un cubre canto protegido y no puede ser eliminado.`);
        return;
      }
      edgeItems.splice(index, 1);
      persist(EDGE_STORAGE_KEY, edgeItems);
      renderEdges();
    });
    actionsTd.appendChild(deleteBtn);
    row.appendChild(actionsTd);

    edgeTableBody.appendChild(row);
  });
}

function renderAdmins() {
  if (!adminTableBody) return;
  adminTableBody.innerHTML = '';
  if (!adminItems.length) {
    const emptyRow = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'Sin administradores configurados';
    cell.className = 'admin-empty';
    emptyRow.appendChild(cell);
    adminTableBody.appendChild(emptyRow);
    return;
  }

  adminItems.forEach((item, index) => {
    const row = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'link-button';
    nameBtn.textContent = item.name;
    nameBtn.addEventListener('click', () => {
      if (adminNameInput) adminNameInput.value = item.name;
      if (adminEmailInput) adminEmailInput.value = item.email;
      adminNameInput?.focus();
    });
    nameTd.appendChild(nameBtn);
    row.appendChild(nameTd);

    const emailTd = document.createElement('td');
    emailTd.textContent = item.email;
    row.appendChild(emailTd);

    const actionsTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn danger btn-small';
    deleteBtn.textContent = 'Quitar';
    deleteBtn.addEventListener('click', () => {
      adminItems.splice(index, 1);
      adminItems = normaliseAdminItems(adminItems);
      updateAllowedAdminEmails(adminItems, { persist: true });
      persist(ADMIN_STORAGE_KEY, adminItems);
      renderAdmins();
    });
    actionsTd.appendChild(deleteBtn);
    row.appendChild(actionsTd);

    adminTableBody.appendChild(row);
  });
}

function addOrUpdateItem(material, price) {
  const normalizedMaterial = material.toLowerCase();
  const existingIndex = stockItems.findIndex(item => item.material.toLowerCase() === normalizedMaterial);
  
  if (existingIndex !== -1) {
    // Actualizar existente
    const existing = stockItems[existingIndex];
    const isProtected = isProtectedItem(existing.material, 'material');
    
    // Si es protegido, solo permite cambiar precio
    if (isProtected && normalizeItemName(material) !== normalizeItemName(existing.material)) {
      alert(`"${existing.material}" es un material protegido. Solo podés cambiar su precio, no el nombre.`);
      return;
    }
    
    existing.price = price;
  } else {
    // Nuevo item
    stockItems.push({ material, price });
  }
  
  stockItems = normaliseStockItems(stockItems);
  persist(STORAGE_KEY, stockItems);
  renderStock();
  try { localStorage.setItem('selected_material_v1', material); } catch (_) {}
}

function addOrUpdateEdge(name, pricePerMeter) {
  const normalizedName = name.toLowerCase();
  const existingIndex = edgeItems.findIndex(item => item.name.toLowerCase() === normalizedName);
  
  if (existingIndex !== -1) {
    // Actualizar existente
    const existing = edgeItems[existingIndex];
    const isProtected = isProtectedItem(existing.name, 'edge');
    
    // Si es protegido, solo permite cambiar precio
    if (isProtected && normalizeItemName(name) !== normalizeItemName(existing.name)) {
      alert(`"${existing.name}" es un cubre canto protegido. Solo podés cambiar su precio, no el nombre.`);
      return;
    }
    
    existing.pricePerMeter = pricePerMeter;
  } else {
    // Nuevo item
    edgeItems.push({ name, pricePerMeter });
  }
  
  edgeItems = normaliseEdgeItems(edgeItems);
  persist(EDGE_STORAGE_KEY, edgeItems);
  renderEdges();
}

function addOrUpdateAdmin(name, email) {
  const normalizedEmail = email.toLowerCase();
  const existing = adminItems.find((item) => item.email === normalizedEmail);
  if (existing) {
    existing.name = name;
  } else {
    adminItems.push({ name, email: normalizedEmail });
  }
  adminItems = normaliseAdminItems(adminItems);
  updateAllowedAdminEmails(adminItems, { persist: true });
  persist(ADMIN_STORAGE_KEY, adminItems);
  renderAdmins();
}

function handleDownload() {
  exportStockText();
}

// Asegura que los items protegidos existan
function ensureDefaultItems() {
  if (!isAdmin) return;
  
  // Verificar MDF Blanco
  const hasMdfBlanco = stockItems.some(item => normalizeItemName(item.material) === 'mdf blanco');
  if (!hasMdfBlanco) {
    stockItems.push({ material: 'MDF Blanco', price: 0 });
    console.log('✅ Item protegido "MDF Blanco" creado automáticamente');
  }
  
  // Verificar Blanco en cubre cantos
  const hasBlanco = edgeItems.some(item => normalizeItemName(item.name) === 'blanco');
  if (!hasBlanco) {
    edgeItems.push({ name: 'Blanco', pricePerMeter: 0 });
    console.log('✅ Cubre canto protegido "Blanco" creado automáticamente');
  }
}

async function bootstrap() {
  const useRemote = REMOTE_SYNC_ENABLED;
  let cachedInventoryText = null;

  const getInventoryFromText = async () => {
    if (cachedInventoryText) return cachedInventoryText;
    cachedInventoryText = await loadFromTextFile();
    return cachedInventoryText;
  };

  const ensureAdminData = async () => {
    const storedAdmins = loadFromStorage(ADMIN_STORAGE_KEY);
    if (Array.isArray(storedAdmins) && storedAdmins.length) {
      applyAdminItems(storedAdmins, { hydrateLocal: false });
      return;
    }
    if (!useRemote) {
      const fromText = await getInventoryFromText();
      applyAdminItems(fromText.adminItems, { hydrateLocal: false });
    }
  };

  const loadInventoryFallback = async () => {
    const fromStorage = loadFromStorage(STORAGE_KEY);
    const storedAdmins = loadFromStorage(ADMIN_STORAGE_KEY);
    if (Array.isArray(storedAdmins)) {
      applyAdminItems(storedAdmins, { hydrateLocal: false });
    }
    if (Array.isArray(fromStorage) && fromStorage.length) {
      return normaliseStockItems(fromStorage);
    }
    const fromText = await getInventoryFromText();
    if (!useRemote) {
      applyAdminItems(fromText.adminItems, { hydrateLocal: false });
    }
    return normaliseStockItems(fromText.stockItems);
  };

  const loadLocalEdgeFallback = () => {
    const storedEdges = loadFromStorage(EDGE_STORAGE_KEY);
    if (Array.isArray(storedEdges) && storedEdges.length) return normaliseEdgeItems(storedEdges);
    return [];
  };

  await ensureAdminData();
  renderAdmins();

  if (useRemote) {
    if (isAdmin && typeof StockSync.requiresAuth === 'function' && StockSync.requiresAuth() && typeof StockSync.ensureFirebaseAuth === 'function') {
      try { StockSync.ensureFirebaseAuth(); } catch (_) {}
    }
    if (typeof StockSync.getAdminSnapshot === 'function') {
      try {
        const remoteAdmins = await StockSync.getAdminSnapshot();
        if (Array.isArray(remoteAdmins) && remoteAdmins.length) {
          applyAdminItems(remoteAdmins, { hydrateLocal: isAdmin });
        }
      } catch (err) {
        console.error('Stock: no se pudo cargar administradores remotos, usando respaldo local', err);
      }
    }
    if (isAdmin) {
      try {
        const remote = await StockSync.getStockSnapshot();
        const normalized = normaliseStockItems(remote);
        if (normalized.length) {
          stockItems = normalized;
        } else {
          stockItems = await loadInventoryFallback();
          if (stockItems.length) persist(STORAGE_KEY, stockItems, { sync: false });
        }
      } catch (err) {
        console.error('Stock: no se pudo cargar stock remoto, usando respaldo local', err);
        stockItems = await loadInventoryFallback();
      }
    } else {
      try {
        stockItems = normaliseStockItems(await StockSync.getStockSnapshot());
        if (!stockItems.length) {
          stockItems = await loadInventoryFallback();
        }
      } catch (err) {
        console.error('Stock: error obteniendo stock remoto para cliente', err);
        stockItems = await loadInventoryFallback();
      }
    }
  } else {
    if (isAdmin) {
      const fromStorage = loadFromStorage(STORAGE_KEY);
      if (Array.isArray(fromStorage) && fromStorage.length) {
        stockItems = normaliseStockItems(fromStorage);
      } else {
        stockItems = await loadInventoryFallback();
        if (stockItems.length) persist(STORAGE_KEY, stockItems, { sync: false });
      }
    } else {
      stockItems = await loadInventoryFallback();
    }
  }
  renderStock();

  if (useRemote) {
    if (isAdmin) {
      try {
        const remoteEdges = await StockSync.getEdgeSnapshot();
        const normalizedEdges = normaliseEdgeItems(remoteEdges);
        if (normalizedEdges.length) {
          edgeItems = normalizedEdges;
        } else {
          edgeItems = loadLocalEdgeFallback();
          if (edgeItems.length) persist(EDGE_STORAGE_KEY, edgeItems);
        }
      } catch (err) {
        console.error('Stock: no se pudo cargar cubre cantos remotos, usando respaldo', err);
        edgeItems = loadLocalEdgeFallback();
      }
    } else {
      try {
        edgeItems = normaliseEdgeItems(await StockSync.getEdgeSnapshot());
      } catch (err) {
        console.error('Stock: error obteniendo cubre cantos remotos para cliente', err);
        edgeItems = [];
      }
    }
  } else {
    if (isAdmin) {
      edgeItems = loadLocalEdgeFallback();
    } else {
      edgeItems = [];
    }
  }
  renderEdges();

  // Asegurar que los items protegidos existan
  ensureDefaultItems();
  if (isAdmin) {
    const needsStockSave = !stockItems.some(item => normalizeItemName(item.material) === 'mdf blanco');
    const needsEdgeSave = !edgeItems.some(item => normalizeItemName(item.name) === 'blanco');
    if (needsStockSave) persist(STORAGE_KEY, stockItems);
    if (needsEdgeSave) persist(EDGE_STORAGE_KEY, edgeItems);
  }

  if (useRemote) {
    remoteStockUnsubscribe = StockSync.watchStock((items) => {
      applyRemoteStockItems(items);
    });
    remoteEdgeUnsubscribe = StockSync.watchEdges((items) => {
      applyRemoteEdgeItems(items);
    });
    if (typeof StockSync.watchAdmins === 'function') {
      remoteAdminUnsubscribe = StockSync.watchAdmins((items) => {
        applyAdminItems(items, { hydrateLocal: isAdmin });
      });
    }
    window.addEventListener('beforeunload', () => {
      if (typeof remoteStockUnsubscribe === 'function') remoteStockUnsubscribe();
      if (typeof remoteEdgeUnsubscribe === 'function') remoteEdgeUnsubscribe();
      if (typeof remoteAdminUnsubscribe === 'function') remoteAdminUnsubscribe();
    }, { once: true });
  }

  applyAdminVisibility();
}

if (form) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isAdmin) return;
    if (!materialInput || !priceInput) {
      alert('Formulario de stock no disponible en este momento. Recargá la página e intentá nuevamente.');
      return;
    }
    const material = normaliseMaterialName(materialInput.value);
    const priceValue = priceInput.value;
    const price = Number.parseFloat(priceValue);
    if (!material || !Number.isFinite(price) || price < 0) {
      alert('Completa material y valor válido.');
      return;
    }
    addOrUpdateItem(material, price);
    form.reset();
    materialInput.focus();
  });
}

if (adminForm) {
  adminForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isAdmin) return;
    const name = normaliseMaterialName(adminNameInput?.value || '');
    const email = String(adminEmailInput?.value || '').trim().toLowerCase();
    if (!name || !EMAIL_REGEX.test(email)) {
      alert('Ingresá un nombre y un correo electrónico válido.');
      return;
    }
    addOrUpdateAdmin(name, email);
    adminForm.reset();
    adminNameInput?.focus();
  });
}

if (deleteAdminBtn) {
  deleteAdminBtn.addEventListener('click', () => {
    if (!isAdmin) return;
    const email = String(adminEmailInput?.value || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      alert('Seleccioná un administrador válido para eliminar.');
      return;
    }
    const index = adminItems.findIndex((item) => item.email === email);
    if (index === -1) {
      alert('Ese administrador no está en la lista.');
      return;
    }
    if (!confirm(`¿Quitar el acceso de ${adminItems[index].name || adminItems[index].email}?`)) return;
    adminItems.splice(index, 1);
    adminItems = normaliseAdminItems(adminItems);
    updateAllowedAdminEmails(adminItems, { persist: true });
    persist(ADMIN_STORAGE_KEY, adminItems);
    renderAdmins();
    adminForm?.reset();
    adminNameInput?.focus();
  });
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', (event) => {
    event.preventDefault();
    if (!isAdmin) return;
    handleDownload();
  });
}

if (importInput) {
  importInput.addEventListener('change', () => {
    if (!isAdmin) { importInput.value = ''; return; }
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseInventoryText(text);
      stockItems = normaliseStockItems(parsed.stockItems);
      persist(STORAGE_KEY, stockItems);
      applyAdminItems(parsed.adminItems);
      renderAdmins();
      renderStock();
      importInput.value = '';
    };
    reader.readAsText(file);
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (!isAdmin) return;
    if (!stockItems.length) return;
    if (!confirm('¿Vaciar todo el stock?')) return;
    stockItems = [];
    persist(STORAGE_KEY, stockItems);
    renderStock();
  });
}

if (deleteMaterialBtn) {
  deleteMaterialBtn.addEventListener('click', () => {
    if (!isAdmin) return;
    if (!materialInput) {
      alert('Seleccioná un material desde la tabla antes de eliminar.');
      return;
    }
    const material = normaliseMaterialName(materialInput.value);
    if (!material) {
      alert('Seleccione un material para eliminar.');
      return;
    }
    
    // Verificar si es protegido
    if (isProtectedItem(material, 'material')) {
      alert(`"${material}" es un material protegido y no puede ser eliminado.`);
      return;
    }
    
    const index = stockItems.findIndex(item => item.material.toLowerCase() === material.toLowerCase());
    if (index === -1) {
      alert('El material no existe en el stock.');
      return;
    }
    if (!confirm(`¿Eliminar "${stockItems[index].material}" del stock?`)) return;
    stockItems.splice(index, 1);
    persist(STORAGE_KEY, stockItems);
    renderStock();
    try {
      const key = 'selected_material_v1';
      const saved = localStorage.getItem(key);
      if (saved && saved.trim().toLowerCase() === material.toLowerCase()) {
        localStorage.removeItem(key);
      }
    } catch (_) {}
    form?.reset();
    materialInput?.focus();
  });
}

if (edgeForm) {
  edgeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isAdmin) return;
    const name = normaliseMaterialName(edgeNameInput.value);
    const price = Number.parseFloat(edgePriceInput.value);
    if (!name || !Number.isFinite(price) || price < 0) {
      alert('Completa un nombre y un valor por metro válidos.');
      return;
    }
    addOrUpdateEdge(name, price);
    edgeForm.reset();
    edgeNameInput.focus();
  });
}

if (edgeDeleteBtn) {
  edgeDeleteBtn.addEventListener('click', () => {
    if (!isAdmin) return;
    const name = normaliseMaterialName(edgeNameInput.value);
    if (!name) {
      alert('Seleccioná un cubre canto para eliminar.');
      return;
    }
    
    // Verificar si es protegido
    if (isProtectedItem(name, 'edge')) {
      alert(`"${name}" es un cubre canto protegido y no puede ser eliminado.`);
      return;
    }
    
    const index = edgeItems.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
    if (index === -1) {
      alert('Ese cubre canto no está en la lista.');
      return;
    }
    if (!confirm(`¿Eliminar "${edgeItems[index].name}" de la lista?`)) return;
    edgeItems.splice(index, 1);
    persist(EDGE_STORAGE_KEY, edgeItems);
    renderEdges();
    edgeForm.reset();
    edgeNameInput.focus();
  });
}

bootstrap();

closeWindowBtn.addEventListener('click', (event) => {
  event.preventDefault();
  window.close();
});
