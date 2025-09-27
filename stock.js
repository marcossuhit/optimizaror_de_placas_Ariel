const STORAGE_KEY = 'stock_items_v1';
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

let stockItems = [];

const authUser = typeof ensureAuthenticated === 'function' ? ensureAuthenticated() : null;

function normaliseMaterialName(name) {
  return (name || '').trim();
}

function loadFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
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

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stockItems));
}

function render() {
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
      persist();
      render();
    });
    actionsTd.appendChild(deleteBtn);
    row.appendChild(actionsTd);

    tableBody.appendChild(row);
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
  persist();
  render();
  try { localStorage.setItem('selected_material_v1', material); } catch (_) {}
}

function handleDownload() {
  const lines = ['# Formato: material|cantidad'];
  stockItems.forEach(({ material, quantity }) => {
    lines.push(`${material}|${quantity}`);
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stock.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function bootstrap() {
  const fromStorage = loadFromStorage();
  if (fromStorage) {
    stockItems = fromStorage;
  } else {
    stockItems = await loadFromTextFile();
    persist();
  }
  render();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
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

downloadBtn.addEventListener('click', handleDownload);

importInput.addEventListener('change', () => {
  const file = importInput.files && importInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    stockItems = parseTextContent(text);
    persist();
    render();
    importInput.value = '';
  };
  reader.readAsText(file);
});

clearBtn.addEventListener('click', () => {
  if (!stockItems.length) return;
  if (!confirm('¿Vaciar todo el stock?')) return;
  stockItems = [];
  persist();
  render();
});

deleteMaterialBtn.addEventListener('click', () => {
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
  persist();
  render();
  try {
    const key = 'selected_material_v1';
    const saved = localStorage.getItem(key);
    if (saved && saved.trim().toLowerCase() === material.toLowerCase()) {
      localStorage.removeItem(key);
    }
  } catch (_) {}
  form.reset();
  materialInput.focus();
});

bootstrap();

closeWindowBtn.addEventListener('click', (event) => {
  event.preventDefault();
  window.close();
});
