const STORAGE_KEY = 'stock_items_v1';
const EDGE_STORAGE_KEY = 'edgeband_items_v1';
const TEXT_FALLBACK = 'stock.txt';

const materialInput = document.getElementById('stockMaterialInput');
const priceInput = document.getElementById('stockPriceInput');
const form = document.getElementById('stockForm');
const tableBody = document.getElementById('stockTableBody');
const downloadBtn = document.getElementById('downloadStockBtn');
const importInput = document.getElementById('importStockInput');
const clearBtn = document.getElementById('clearStockBtn');
const deleteMaterialBtn = document.getElementById('deleteMaterialBtn');
const closeWindowBtn = document.getElementById('closeWindowBtn');

const edgeForm = document.getElementById('edgeForm');
const edgeNameInput = document.getElementById('edgeNameInput');
const edgePriceInput = document.getElementById('edgePriceInput');
const edgeDeleteBtn = document.getElementById('deleteEdgeBtn');
const edgeTableBody = document.getElementById('edgeTableBody');

let stockItems = [];
let edgeItems = [];

const authUser = typeof ensureAuthenticated === 'function' ? ensureAuthenticated() : null;
const ALLOWED_ADMIN_EMAILS = new Set(['marcossuhit@gmail.com', 'fernandofreireadrian@gmail.com']);
const IS_ADMIN = !!(authUser && ALLOWED_ADMIN_EMAILS.has((authUser.email || '').toLowerCase()));
const StockSync = window.StockSync || null;
const REMOTE_SYNC_ENABLED = !!(StockSync && typeof StockSync.isConfigured === 'function' && StockSync.isConfigured());
const SYNC_ACTOR = authUser ? { email: authUser.email || '', name: authUser.name || '' } : null;
const AUTO_EXPORT_ON_SAVE = false;

let stockSyncTimer = null;
let stockFileHandle = null;
let stockExportNoticeShown = false;
let remoteStockUnsubscribe = null;
let remoteEdgeUnsubscribe = null;

function normaliseMaterialName(name) {
  return (name || '').trim();
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

function cacheLocally(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function loadFromStorage(key) {
  if (!IS_ADMIN) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (key === STORAGE_KEY) return normaliseStockItems(parsed);
      if (key === EDGE_STORAGE_KEY) return normaliseEdgeItems(parsed);
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
    return parseTextContent(text);
  } catch (_) {
    return [];
  }
}

function parseTextContent(text) {
  if (!text) return [];
  const rows = [];
  text.split('\n').forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    const [materialPart, pricePart] = clean.split('|').map(part => part?.trim() ?? '');
    if (!materialPart) return;
    const price = Number.parseFloat(pricePart);
    rows.push({ material: materialPart, price: Number.isFinite(price) ? price : 0 });
  });
  return rows;
}

function persist(key, value, { sync = true } = {}) {
  if (!IS_ADMIN) return;
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
    }
  }
  if (sync && key === STORAGE_KEY && AUTO_EXPORT_ON_SAVE) scheduleStockSync();
}

function buildStockText() {
  const lines = ['# Formato: material|precio'];
  stockItems.forEach(({ material, price }) => {
    lines.push(`${material}|${formatPrice(price)}`);
  });
  return lines.join('\n');
}

async function exportStockText() {
  const text = buildStockText();
  if (IS_ADMIN && 'showSaveFilePicker' in window) {
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
  if (!IS_ADMIN) return;
  if (stockSyncTimer) clearTimeout(stockSyncTimer);
  stockSyncTimer = setTimeout(() => {
    stockSyncTimer = null;
    exportStockText().catch((err) => console.error('No se pudo exportar stock.txt', err));
  }, 500);
}

function applyRemoteStockItems(items, { hydrateLocal = IS_ADMIN } = {}) {
  const normalized = normaliseStockItems(items);
  if (stockListsEqual(stockItems, normalized)) return;
  stockItems = normalized;
  if (hydrateLocal && IS_ADMIN) {
    cacheLocally(STORAGE_KEY, stockItems);
  }
  renderStock();
}

function applyRemoteEdgeItems(items, { hydrateLocal = IS_ADMIN } = {}) {
  const normalized = normaliseEdgeItems(items);
  if (edgeListsEqual(edgeItems, normalized)) return;
  edgeItems = normalized;
  if (hydrateLocal && IS_ADMIN) {
    cacheLocally(EDGE_STORAGE_KEY, edgeItems);
  }
  renderEdges();
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

    const materialTd = document.createElement('td');
    const materialBtn = document.createElement('button');
    materialBtn.type = 'button';
    materialBtn.className = 'link-button';
    materialBtn.textContent = item.material;
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
    deleteBtn.addEventListener('click', () => {
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

    const nameTd = document.createElement('td');
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'link-button';
    nameBtn.textContent = item.name;
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
    deleteBtn.addEventListener('click', () => {
      edgeItems.splice(index, 1);
      persist(EDGE_STORAGE_KEY, edgeItems);
      renderEdges();
    });
    actionsTd.appendChild(deleteBtn);
    row.appendChild(actionsTd);

    edgeTableBody.appendChild(row);
  });
}

function addOrUpdateItem(material, price) {
  const existing = stockItems.find(item => item.material.toLowerCase() === material.toLowerCase());
  if (existing) {
    existing.price = price;
  } else {
    stockItems.push({ material, price });
  }
  stockItems = normaliseStockItems(stockItems);
  persist(STORAGE_KEY, stockItems);
  renderStock();
  try { localStorage.setItem('selected_material_v1', material); } catch (_) {}
}

function addOrUpdateEdge(name, pricePerMeter) {
  const existing = edgeItems.find(item => item.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.pricePerMeter = pricePerMeter;
  } else {
    edgeItems.push({ name, pricePerMeter });
  }
  edgeItems = normaliseEdgeItems(edgeItems);
  persist(EDGE_STORAGE_KEY, edgeItems);
  renderEdges();
}

function handleDownload() {
  exportStockText();
}

async function bootstrap() {
  const useRemote = REMOTE_SYNC_ENABLED;

  const loadLocalStockFallback = async () => {
    const fromStorage = loadFromStorage(STORAGE_KEY);
    if (Array.isArray(fromStorage) && fromStorage.length) return normaliseStockItems(fromStorage);
    const fromText = await loadFromTextFile();
    return normaliseStockItems(fromText);
  };

  const loadLocalEdgeFallback = () => {
    const storedEdges = loadFromStorage(EDGE_STORAGE_KEY);
    if (Array.isArray(storedEdges) && storedEdges.length) return normaliseEdgeItems(storedEdges);
    return [];
  };

  if (useRemote) {
    if (IS_ADMIN && typeof StockSync.requiresAuth === 'function' && StockSync.requiresAuth() && typeof StockSync.ensureFirebaseAuth === 'function') {
      try { StockSync.ensureFirebaseAuth(); } catch (_) {}
    }
    if (IS_ADMIN) {
      try {
        const remote = await StockSync.getStockSnapshot();
        const normalized = normaliseStockItems(remote);
        if (normalized.length) {
          stockItems = normalized;
        } else {
          stockItems = await loadLocalStockFallback();
          if (stockItems.length) persist(STORAGE_KEY, stockItems, { sync: false });
        }
      } catch (err) {
        console.error('Stock: no se pudo cargar stock remoto, usando respaldo local', err);
        stockItems = await loadLocalStockFallback();
      }
    } else {
      try {
        stockItems = normaliseStockItems(await StockSync.getStockSnapshot());
        if (!stockItems.length) {
          stockItems = await loadLocalStockFallback();
        }
      } catch (err) {
        console.error('Stock: error obteniendo stock remoto para cliente', err);
        stockItems = await loadLocalStockFallback();
      }
    }
  } else {
    if (IS_ADMIN) {
      const fromStorage = loadFromStorage(STORAGE_KEY);
      if (Array.isArray(fromStorage) && fromStorage.length) {
        stockItems = normaliseStockItems(fromStorage);
      } else {
        stockItems = await loadLocalStockFallback();
        if (stockItems.length) persist(STORAGE_KEY, stockItems, { sync: false });
      }
    } else {
      stockItems = await loadLocalStockFallback();
    }
  }
  renderStock();

  if (useRemote) {
    if (IS_ADMIN) {
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
    if (IS_ADMIN) {
      edgeItems = loadLocalEdgeFallback();
    } else {
      edgeItems = [];
    }
  }
  renderEdges();

  if (useRemote) {
    remoteStockUnsubscribe = StockSync.watchStock((items) => {
      applyRemoteStockItems(items);
    });
    remoteEdgeUnsubscribe = StockSync.watchEdges((items) => {
      applyRemoteEdgeItems(items);
    });
    window.addEventListener('beforeunload', () => {
      if (typeof remoteStockUnsubscribe === 'function') remoteStockUnsubscribe();
      if (typeof remoteEdgeUnsubscribe === 'function') remoteEdgeUnsubscribe();
    }, { once: true });
  }

  if (!IS_ADMIN) {
    if (form) form.style.display = 'none';
    const stockActions = document.querySelector('.stock-actions');
    if (stockActions) stockActions.style.display = 'none';
    if (edgeForm) edgeForm.style.display = 'none';
  }
}

if (form) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!IS_ADMIN) return;
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

if (downloadBtn) {
  downloadBtn.addEventListener('click', (event) => {
    event.preventDefault();
    if (!IS_ADMIN) return;
    handleDownload();
  });
}

if (importInput) {
  importInput.addEventListener('change', () => {
    if (!IS_ADMIN) { importInput.value = ''; return; }
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      stockItems = normaliseStockItems(parseTextContent(text));
      persist(STORAGE_KEY, stockItems);
      renderStock();
      importInput.value = '';
    };
    reader.readAsText(file);
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (!IS_ADMIN) return;
    if (!stockItems.length) return;
    if (!confirm('¿Vaciar todo el stock?')) return;
    stockItems = [];
    persist(STORAGE_KEY, stockItems);
    renderStock();
  });
}

if (deleteMaterialBtn) {
  deleteMaterialBtn.addEventListener('click', () => {
    if (!IS_ADMIN) return;
    if (!materialInput) {
      alert('Seleccioná un material desde la tabla antes de eliminar.');
      return;
    }
    const material = normaliseMaterialName(materialInput.value);
    if (!material) {
      alert('Seleccione un material para eliminar.');
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
    if (!IS_ADMIN) return;
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
    if (!IS_ADMIN) return;
    const name = normaliseMaterialName(edgeNameInput.value);
    if (!name) {
      alert('Seleccioná un cubre canto para eliminar.');
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
