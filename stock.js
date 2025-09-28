const STORAGE_KEY = 'stock_items_v1';
const EDGE_STORAGE_KEY = 'edgeband_items_v1';
const TEXT_FALLBACK = 'stock.txt';

const materialInput = document.getElementById('stockMaterialInput');
const qtyInput = document.getElementById('stockQtyInput');
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

let stockSyncTimer = null;
let stockFileHandle = null;
let stockExportNoticeShown = false;

function normaliseMaterialName(name) {
  return (name || '').trim();
}

function loadFromStorage(key) {
  if (!IS_ADMIN) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
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
    const [materialPart, qtyPart] = clean.split('|').map(part => part?.trim() ?? '');
    if (!materialPart) return;
    const qty = Number.parseInt(qtyPart, 10);
    rows.push({ material: materialPart, quantity: Number.isFinite(qty) ? qty : 0 });
  });
  return rows;
}

function persist(key, value, { sync = true } = {}) {
  if (!IS_ADMIN) return;
  localStorage.setItem(key, JSON.stringify(value));
  if (sync && key === STORAGE_KEY) scheduleStockSync();
}

function buildStockText() {
  const lines = ['# Formato: material|cantidad'];
  stockItems.forEach(({ material, quantity }) => {
    lines.push(`${material}|${quantity}`);
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
      materialInput.value = item.material;
      qtyInput.value = String(item.quantity);
      materialInput.focus();
    });
    materialTd.appendChild(materialBtn);
    row.appendChild(materialTd);

    const qtyTd = document.createElement('td');
    qtyTd.textContent = String(item.quantity);
    row.appendChild(qtyTd);

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

function addOrUpdateItem(material, quantity) {
  const existing = stockItems.find(item => item.material.toLowerCase() === material.toLowerCase());
  if (existing) {
    existing.quantity = quantity;
  } else {
    stockItems.push({ material, quantity });
  }
  stockItems.sort((a, b) => a.material.localeCompare(b.material));
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
  edgeItems.sort((a, b) => a.name.localeCompare(b.name));
  persist(EDGE_STORAGE_KEY, edgeItems);
  renderEdges();
}

function handleDownload() {
  exportStockText();
}

async function bootstrap() {
  if (IS_ADMIN) {
    const fromStorage = loadFromStorage(STORAGE_KEY);
    if (fromStorage) {
      stockItems = fromStorage;
    } else {
      stockItems = await loadFromTextFile();
      persist(STORAGE_KEY, stockItems, { sync: false });
    }
  } else {
    stockItems = await loadFromTextFile();
  }
  renderStock();

  if (IS_ADMIN) {
    const storedEdges = loadFromStorage(EDGE_STORAGE_KEY);
    if (storedEdges) {
      edgeItems = storedEdges.map((item) => ({
        name: String(item?.name || '').trim(),
        pricePerMeter: Number.parseFloat(item?.pricePerMeter) || 0
      })).filter(item => item.name);
    } else {
      edgeItems = [];
    }
  } else {
    edgeItems = [];
  }
  renderEdges();

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
    const material = normaliseMaterialName(materialInput.value);
    const qty = Number.parseInt(qtyInput.value, 10);
    if (!material || !Number.isFinite(qty) || qty < 0) {
      alert('Complete material y cantidad válida.');
      return;
    }
    addOrUpdateItem(material, qty);
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
      stockItems = parseTextContent(text);
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
