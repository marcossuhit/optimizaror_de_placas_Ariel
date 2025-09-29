const MAX_ROWS = Number.MAX_SAFE_INTEGER;

const rowsEl = document.getElementById('rows');
const addRowBtn = document.getElementById('addRowBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const projectNameEl = document.getElementById('projectName');
const saveJsonBtn = document.getElementById('saveJsonBtn');
const loadJsonBtn = document.getElementById('loadJsonBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const resetAllBtn = document.getElementById('resetAllBtn');
const installBtn = document.getElementById('installBtn');
const autoRotateToggle = document.getElementById('autoRotateToggle');
const plateMaterialSelect = document.getElementById('plateMaterialSelect');
const manageStockBtn = document.getElementById('manageStockBtn');
const themeToggleBtn = document.getElementById('themeToggle');
// Placas dinámicas (lista)
const platesEl = document.getElementById('plates');
const addPlateBtn = document.getElementById('addPlateBtn');
const kerfInput = document.getElementById('kerfInput');
const summaryTotalEl = document.getElementById('summaryTotal');
const summaryListEl = document.getElementById('summaryList');
const sheetCanvasEl = document.getElementById('sheetCanvas');
const summaryPiecesEl = document.getElementById('summaryPieces');
const summaryAreaEl = document.getElementById('summaryArea');
const summaryWasteEl = document.getElementById('summaryWaste');
const summaryUtilEl = document.getElementById('summaryUtil');
const summaryReqEl = document.getElementById('summaryReq');
const summaryPlacedEl = document.getElementById('summaryPlaced');
const summaryLeftEl = document.getElementById('summaryLeft');
const userSessionEl = document.getElementById('userSession');
const userGreetingEl = document.getElementById('userGreeting');
const userEmailEl = document.getElementById('userEmail');
const userAvatarEl = document.getElementById('userAvatar');
const signOutBtn = document.getElementById('signOutBtn');
const sendCutsBtn = document.getElementById('sendCutsBtn');
const sendCutsDefaultLabel = sendCutsBtn?.textContent || 'Enviar cortes';
const ALLOWED_ADMIN_EMAILS = new Set(['marcossuhit@gmail.com', 'fernandofreireadrian@gmail.com']);

const LS_KEY = 'cortes_proyecto_v1';
const DEFAULT_MATERIAL = 'MDF Blanco';
const LAST_MATERIAL_KEY = 'selected_material_v1';
const EDGE_STORAGE_KEY = 'edgeband_items_v1';
let collapsedPlates = new Set();
let edgeCatalog = [];

// Estado para sincronizar resumen por fila
let lastEdgebandByRow = new Map(); // rowIdx -> mm subtotal
let lastPlacementByRow = new Map(); // rowIdx -> { requested, placed, left }
let currentMaterialName;
try {
  currentMaterialName = localStorage.getItem(LAST_MATERIAL_KEY) || plateMaterialSelect?.value || DEFAULT_MATERIAL;
} catch (_) {
  currentMaterialName = plateMaterialSelect?.value || DEFAULT_MATERIAL;
}
const STOCK_STORAGE_KEY = 'stock_items_v1';
const STOCK_TEXT_FALLBACK = 'stock.txt';
let lastFetchedStockItems = [];
let lastFeasibleStateSnapshot = null;
let autoPlateAllocationInProgress = false;
let pendingAutoPlateAllocation = false;
let lastStockAlertTs = 0;
const STOCK_ALERT_COOLDOWN_MS = 1500;

function resetSummaryUI() {
  lastEdgebandByRow.clear();
  lastPlacementByRow.clear();
  if (summaryPiecesEl) summaryPiecesEl.textContent = '';
  if (summaryReqEl) summaryReqEl.textContent = '';
  if (summaryPlacedEl) summaryPlacedEl.textContent = '';
  if (summaryLeftEl) summaryLeftEl.textContent = '';
  if (summaryAreaEl) summaryAreaEl.textContent = '';
  if (summaryWasteEl) summaryWasteEl.textContent = '';
  if (summaryUtilEl) summaryUtilEl.textContent = '';
  if (summaryTotalEl) summaryTotalEl.textContent = '';
  if (summaryListEl) summaryListEl.innerHTML = '';
}

const authUser = typeof ensureAuthenticated === 'function' ? ensureAuthenticated() : null;
resetSummaryUI();

if (signOutBtn) {
  signOutBtn.addEventListener('click', () => {
    if (window.Auth?.signOut) {
      window.Auth.signOut();
    }
  });
}

if (userSessionEl) {
  if (authUser) {
    const name = (authUser.name || '').trim();
    const firstName = name ? name.split(' ')[0] : '';
    if (userGreetingEl) {
      userGreetingEl.textContent = firstName ? `Hola, ${firstName}` : 'Sesión iniciada';
    }
    if (userEmailEl) {
      userEmailEl.textContent = authUser.email || '';
      userEmailEl.style.display = authUser.email ? 'block' : 'none';
    }
    if (userAvatarEl) {
      if (authUser.picture) {
        userAvatarEl.style.backgroundImage = `url(${authUser.picture})`;
        userAvatarEl.style.backgroundSize = 'cover';
        userAvatarEl.style.backgroundPosition = 'center';
        userAvatarEl.textContent = '';
      } else {
        const initials = name
          ? name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2)
          : (authUser.email || '?').charAt(0);
        userAvatarEl.style.backgroundImage = '';
        userAvatarEl.textContent = initials.toUpperCase();
      }
    }
    userSessionEl.style.display = 'flex';
  } else {
    userSessionEl.style.display = 'none';
  }
}

const isBackofficeAllowed = !!(authUser && ALLOWED_ADMIN_EMAILS.has((authUser.email || '').toLowerCase()));
if (manageStockBtn && !isBackofficeAllowed) {
  manageStockBtn.style.display = 'none';
}

function updateRowSummaryUI() {
  if (!summaryListEl) return;
  summaryListEl.innerHTML = '';
  const hasPlacementData = Array.from(lastPlacementByRow.values()).some((entry) => {
    if (!entry) return false;
    return (entry.requested ?? 0) > 0 || (entry.placed ?? 0) > 0 || (entry.left ?? 0) > 0;
  });
  if (!hasPlacementData && lastEdgebandByRow.size === 0) return;
  const rows = getRows();
  for (let i = 0; i < rows.length && i < 50; i++) {
    const color = getRowColor(i);
    const place = lastPlacementByRow.get(i) || { requested: 0, placed: 0, left: 0 };
    const cc = lastEdgebandByRow.get(i) || 0;
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = color;
    const text = document.createElement('span');
    const fmt = (n) => formatNumber(Number(n) || 0, 2);
    text.textContent = `Fila ${i + 1}: ${place.placed} de ${place.requested} (fuera ${place.left}) — cubre canto: ${fmt(cc)} mm`;
    li.appendChild(dot);
    li.appendChild(text);
    summaryListEl.appendChild(li);
  }
}

// Paletas de colores para filas (oscuro y claro)
const ROW_COLORS_DARK = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
  '#f87171', '#22d3ee', '#c084fc', '#fb923c', '#4ade80',
  '#93c5fd', '#fca5a5', '#fdba74', '#86efac', '#67e8f9'
];
const ROW_COLORS_LIGHT = [
  '#93c5fd', '#f9a8d4', '#86efac', '#fde68a', '#c4b5fd',
  '#fecaca', '#a5f3fc', '#e9d5ff', '#fed7aa', '#bbf7d0',
  '#bfdbfe', '#fecdd3', '#fed7aa', '#dcfce7', '#bae6fd'
];
function getRowColor(idx) {
  const isLight = document.body.classList.contains('theme-light');
  const arr = isLight ? ROW_COLORS_LIGHT : ROW_COLORS_DARK;
  return arr[idx % arr.length];
}

function parseStockText(text) {
  if (!text) return [];
  const rows = [];
  text.split('\n').forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    const [materialPart, qtyPart] = clean.split('|').map((part) => (part ?? '').trim());
    if (!materialPart) return;
    const qty = Number.parseInt(qtyPart, 10);
    rows.push({ material: materialPart, quantity: Number.isFinite(qty) ? qty : 0 });
  });
  return rows;
}

function loadStockFromStorage() {
  if (!isBackofficeAllowed) return null;
  try {
    const raw = localStorage.getItem(STOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  return null;
}

async function loadStockFromText() {
  try {
    const response = await fetch(STOCK_TEXT_FALLBACK, { cache: 'no-store' });
    if (!response.ok) return [];
    const text = await response.text();
    return parseStockText(text);
  } catch (_) {
    return [];
  }
}

async function fetchStockItems() {
  const fromStorage = loadStockFromStorage();
  if (fromStorage && fromStorage.length) return fromStorage;
  return loadStockFromText();
}

function getMaterialStockQuantity(material) {
  if (!material) return null;
  if (!Array.isArray(lastFetchedStockItems) || !lastFetchedStockItems.length) return null;
  const normalized = material.toLocaleLowerCase();
  const match = lastFetchedStockItems.find((item) => (item.material || '').toLocaleLowerCase() === normalized);
  if (!match) return 0;
  const qty = Number.parseInt(match.quantity, 10);
  return Number.isFinite(qty) ? qty : 0;
}

function countCurrentPlates() {
  return getPlates().reduce((acc, plate) => acc + (Number.isFinite(plate.sc) ? plate.sc : 0), 0);
}

function getPrimaryPlateRow() {
  if (!platesEl) return null;
  return platesEl.querySelector('.plate-row');
}

function getPlateRowQuantity(row) {
  if (!row) return 0;
  const input = row.querySelector('input.plate-c');
  const num = parseInt(input?.value ?? '', 10);
  return Number.isFinite(num) ? num : 0;
}

function setPlateRowQuantity(row, value) {
  if (!row) return false;
  const input = row.querySelector('input.plate-c');
  if (!input) return false;
  const next = Math.max(1, Math.round(value));
  input.value = String(next);
  return true;
}

function adjustPlateRowQuantity(row, delta) {
  const current = getPlateRowQuantity(row);
  return setPlateRowQuantity(row, current + delta);
}

function leftoverPiecesFitAnyPlate(pieces, instances) {
  if (!Array.isArray(pieces) || !pieces.length || !Array.isArray(instances) || !instances.length) return false;
  return pieces.every((piece) => {
    const pw = Number(piece?.rawW) || 0;
    const ph = Number(piece?.rawH) || 0;
    return instances.some((inst) => {
      if (!inst) return false;
      const trim = inst.trim || { mm: 0, top: false, right: false, bottom: false, left: false };
      const trimValue = Math.max(0, trim.mm || 0);
      const leftTrim = trim.left ? trimValue : 0;
      const rightTrim = trim.right ? trimValue : 0;
      const topTrim = trim.top ? trimValue : 0;
      const bottomTrim = trim.bottom ? trimValue : 0;
      const usableW = Math.max(0, inst.sw - leftTrim - rightTrim);
      const usableH = Math.max(0, inst.sh - topTrim - bottomTrim);
      if (!(usableW > 0 && usableH > 0)) return false;
      const fitsDirect = pw <= usableW + PACKING_EPSILON && ph <= usableH + PACKING_EPSILON;
      const fitsRotated = ph <= usableW + PACKING_EPSILON && pw <= usableH + PACKING_EPSILON;
      return fitsDirect || fitsRotated;
    });
  });
}

function captureFeasibleState() {
  try {
    const snapshot = serializeState();
    lastFeasibleStateSnapshot = JSON.stringify(snapshot);
  } catch (_) {
    // ignore
  }
}

function removeLastRowIfAny() {
  const rows = getRows();
  if (!rows.length) return;
  rows[rows.length - 1].remove();
}

function revertToLastFeasibleState() {
  if (lastFeasibleStateSnapshot) {
    try {
      const parsed = JSON.parse(lastFeasibleStateSnapshot);
      loadState(parsed);
      return;
    } catch (_) {
      // fall through to fallback logic
    }
  }
  removeLastRowIfAny();
  applyPlatesGate();
}

function showLimitedStockAlert(material) {
  if (Date.now() - lastStockAlertTs < STOCK_ALERT_COOLDOWN_MS) return;
  const name = material || DEFAULT_MATERIAL;
  alert(`No hay stock disponible para agregar otra placa de "${name}". El corte no se agregó.`);
  lastStockAlertTs = Date.now();
}

function showPieceDoesNotFitAlert() {
  alert('El corte ingresado no cabe en la placa seleccionada. Ajustá las dimensiones o el material.');
}

function scheduleAutoPlateCheck() {
  if (pendingAutoPlateAllocation || autoPlateAllocationInProgress) return;
  pendingAutoPlateAllocation = true;
  requestAnimationFrame(() => {
    pendingAutoPlateAllocation = false;
    ensurePlateCapacity();
  });
}

function ensurePlateCapacity() {
  if (autoPlateAllocationInProgress) return;
  autoPlateAllocationInProgress = true;
  try {
    let solution = solveCutLayoutInternal();
    if (!solution || !Array.isArray(solution.leftoverPieces) || !solution.leftoverPieces.length) return;
    const primaryRow = getPrimaryPlateRow();
    if (!primaryRow) return;
    const material = currentMaterialName || DEFAULT_MATERIAL;
    const stockQty = getMaterialStockQuantity(material);
    const totalPlates = countCurrentPlates();
    const initialLeftover = solution.leftoverPieces.length;
    const maxAdditional = Number.isFinite(stockQty) ? Math.max(0, stockQty - totalPlates) : initialLeftover;
    if (maxAdditional <= 0) {
      showLimitedStockAlert(material);
      revertToLastFeasibleState();
      return;
    }
    const initialQty = getPlateRowQuantity(primaryRow);
    let added = 0;
    let stalled = false;
    let previousLeftover = initialLeftover;
    while (solution.leftoverPieces.length && added < maxAdditional) {
      if (!adjustPlateRowQuantity(primaryRow, 1)) break;
      added += 1;
      const updated = solveCutLayoutInternal();
      if (!updated) break;
      const currentLeftover = Array.isArray(updated.leftoverPieces) ? updated.leftoverPieces.length : 0;
      if (currentLeftover >= previousLeftover) {
        solution = updated;
        stalled = true;
        break;
      }
      solution = updated;
      previousLeftover = currentLeftover;
    }
    if (solution.leftoverPieces.length) {
      setPlateRowQuantity(primaryRow, initialQty);
      if (stalled && !leftoverPiecesFitAnyPlate(solution.leftoverPieces, solution.instances)) {
        showPieceDoesNotFitAlert();
      } else {
        showLimitedStockAlert(material);
      }
      revertToLastFeasibleState();
      return;
    }
    if (added > 0) {
      applyPlatesGate();
    }
  } finally {
    autoPlateAllocationInProgress = false;
  }
}

function loadEdgeCatalog() {
  try {
    const raw = localStorage.getItem(EDGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        name: String(item?.name || '').trim(),
        pricePerMeter: Number.parseFloat(item?.pricePerMeter) || 0
      }))
      .filter((item) => item.name);
  } catch (_) {
    return [];
  }
}

function formatEdgeLabel(item) {
  if (!item) return '';
  const hasPrice = Number.isFinite(item.pricePerMeter) && item.pricePerMeter > 0;
  if (hasPrice) {
    return `${item.name} — $${formatNumber(item.pricePerMeter, 2)}/m`;
  }
  return item.name;
}

function populateEdgeSelectOptions(select, selectedValue) {
  if (!select) return;
  const value = selectedValue !== undefined ? selectedValue : select.value;
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Sin cubre canto';
  select.appendChild(placeholder);

  let matched = false;
  edgeCatalog.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = formatEdgeLabel(item);
    if (value && item.name.localeCompare(value, undefined, { sensitivity: 'accent' }) === 0) {
      matched = true;
    }
    select.appendChild(option);
  });

  if (value && !matched) {
    const fallback = document.createElement('option');
    fallback.value = value;
    fallback.textContent = `${value} (no listado)`;
    fallback.dataset.missing = '1';
    select.appendChild(fallback);
    matched = true;
  }

  if (matched && value) {
    select.value = value;
  } else {
    select.value = '';
  }
}

function refreshEdgeCatalog({ updateRows = true } = {}) {
  edgeCatalog = loadEdgeCatalog().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (updateRows) {
    getRows().forEach((row) => {
      if (row._refreshEdgeSelects) row._refreshEdgeSelects();
    });
  }
  recalcEdgebanding();
}

refreshEdgeCatalog({ updateRows: false });

function rebuildMaterialOptions(names, { placeholder = false } = {}) {
  if (!plateMaterialSelect) return;
  const previous = currentMaterialName;
  plateMaterialSelect.innerHTML = '';
  if (!names.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder ? placeholder : 'Agregá materiales en el backoffice';
    option.disabled = true;
    option.selected = true;
    plateMaterialSelect.appendChild(option);
    plateMaterialSelect.disabled = true;
    if (currentMaterialName) {
      currentMaterialName = '';
      try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}
      applyPlatesGate();
    }
    return;
  }

  plateMaterialSelect.disabled = false;
  names.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    plateMaterialSelect.appendChild(option);
  });
  const findInsensitive = (arr, target) => arr.find(name => name.localeCompare(target, undefined, { sensitivity: 'accent' }) === 0);
  let nextSelection = findInsensitive(names, DEFAULT_MATERIAL)
    || (previous ? findInsensitive(names, previous) : undefined)
    || names[0];
  plateMaterialSelect.value = nextSelection;
  if (currentMaterialName !== nextSelection) {
    currentMaterialName = nextSelection;
    try { localStorage.setItem(LAST_MATERIAL_KEY, currentMaterialName); } catch (_) {}
    applyPlatesGate();
  } else {
    currentMaterialName = nextSelection;
  }
}

async function refreshMaterialOptions() {
  if (!plateMaterialSelect) return;
  const items = await fetchStockItems();
  const normalized = Array.isArray(items)
    ? items
        .map((item) => ({
          material: String(item?.material || '').trim(),
          quantity: Number.parseInt(item?.quantity, 10) || 0
        }))
        .filter((item) => item.material)
    : [];
  lastFetchedStockItems = normalized;
  const available = normalized.filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);
  const namesMap = new Map();
  available.forEach((item) => {
    const material = (item?.material || '').trim();
    if (!material) return;
    const key = material.toLocaleLowerCase();
    if (!namesMap.has(key)) namesMap.set(key, key === DEFAULT_MATERIAL.toLocaleLowerCase() ? DEFAULT_MATERIAL : material);
  });
  const defaultKey = DEFAULT_MATERIAL.toLocaleLowerCase();
  if (namesMap.has(defaultKey)) {
    namesMap.set(defaultKey, DEFAULT_MATERIAL);
  }
  const names = Array.from(namesMap.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (!names.length && currentMaterialName) {
    currentMaterialName = '';
    try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}
  }
  rebuildMaterialOptions(names, { placeholder: isBackofficeAllowed ? 'Agregá materiales en el backoffice' : 'Sin placas disponibles' });
}

function getRows() {
  return Array.from(rowsEl.querySelectorAll('.row'));
}

const ROW_CORE_SELECTORS = {
  qty: 'input[data-role="qty"]',
  width: 'input[data-role="width"]',
  height: 'input[data-role="height"]'
};

function getRowCoreInputs(row) {
  if (!row) return [null, null, null];
  const qty = row.querySelector(ROW_CORE_SELECTORS.qty);
  const width = row.querySelector(ROW_CORE_SELECTORS.width);
  const height = row.querySelector(ROW_CORE_SELECTORS.height);
  return [qty, width, height];
}

function isRowCompleteEl(row) {
  const [qtyInput, widthInput, heightInput] = getRowCoreInputs(row);
  if (!qtyInput || !widthInput || !heightInput) return false;
  const qty = parseInt(qtyInput.value, 10);
  const w = parseFloat(widthInput.value);
  const h = parseFloat(heightInput.value);
  return !isNaN(qty) && qty >= 1 && w > 0 && h > 0;
}

function getAddRowDisabledReason() {
  const rows = getRows();
  const count = rows.length;
  if (!isSheetComplete()) return 'Complete la(s) placa(s) para habilitar filas';
  if (count >= 5) {
    const firstFiveComplete = rows.slice(0, 5).every(isRowCompleteEl);
    if (!firstFiveComplete) return 'Completá las primeras 5 filas';
    if (count > 0 && !isRowCompleteEl(rows[rows.length - 1])) return 'Completá la última fila';
  } else if (count > 0 && !isRowCompleteEl(rows[rows.length - 1])) {
    return 'Completá la última fila';
  }
  return null;
}

function toggleAddButton() {
  const reason = getAddRowDisabledReason();
  const hint = document.getElementById('addRowHint');
  addRowBtn.disabled = !!reason;
  if (hint) hint.textContent = reason ? `• ${reason}` : '';
  addRowBtn.title = reason || '';
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function formatNumber(value, decimals = 2) {
  if (!isFinite(value)) return '0';
  return value
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

function getPlates() {
  const list = [];
  if (!platesEl) return list;
  platesEl.querySelectorAll('.plate-row').forEach((row) => {
    const sw = parseFloat(row.querySelector('input.plate-w')?.value ?? '');
    const sh = parseFloat(row.querySelector('input.plate-h')?.value ?? '');
    const sc = parseInt(row.querySelector('input.plate-c')?.value ?? '', 10);
    const tmm = parseInt(row.querySelector('input.trim-mm')?.value ?? '0', 10) || 0;
    const sides = row.querySelectorAll('.trim-controls .side input');
    const top = !!sides[0]?.checked;
    const right = !!sides[1]?.checked;
    const bottom = !!sides[2]?.checked;
    const left = !!sides[3]?.checked;
    if (sw > 0 && sh > 0 && sc >= 1) list.push({ sw, sh, sc, trim: { mm: tmm, top, right, bottom, left } });
  });
  return list;
}

function getPrimaryPlateDims() {
  const list = getPlates();
  return list.length ? { sw: list[0].sw, sh: list[0].sh } : null;
}

function isSheetComplete() {
  return getPlates().length > 0;
}

function getKerfMm() {
  const v = parseInt(kerfInput?.value ?? '0', 10);
  if (isNaN(v) || v < 0) return 0;
  // El input ya está en milímetros
  return v;
}

const PACKING_EPSILON = 0.0001;
const META_SETTINGS = {
  minIterations: 40,
  perPieceFactor: 6,
  maxIterations: 400,
  temperatureStart: 1.8,
  temperatureCool: 0.9,
  temperatureMin: 0.08,
  minPerturbation: 0.05,
  maxPerturbation: 0.55,
  missingAreaWeight: 8,
  missingPiecePenaltyFactor: 64,
  randomRestarts: 7,
  globalLoopsFactor: 0.6,
  maxGlobalLoops: 80,
  seedOrderSamples: 10
};

function dimensionKeyNormalized(wVal, hVal) {
  const safeW = Number.isFinite(wVal) ? wVal : 0;
  const safeH = Number.isFinite(hVal) ? hVal : 0;
  const normW = Math.round(safeW * 1000) / 1000;
  const normH = Math.round(safeH * 1000) / 1000;
  const minSide = Math.min(normW, normH);
  const maxSide = Math.max(normW, normH);
  return `${minSide}×${maxSide}`;
}

function collectSolverInputs() {
  const plates = getPlates();
  if (!plates.length) return null;

  const instances = [];
  plates.forEach((p) => {
    for (let i = 0; i < p.sc; i++) {
      instances.push({ sw: p.sw, sh: p.sh, trim: p.trim || { mm: 0, top: false, right: false, bottom: false, left: false } });
    }
  });

  const allowAutoRotate = !!(autoRotateToggle && autoRotateToggle.checked);
  const kerf = getKerfMm();
  const pieces = [];
  let totalRequested = 0;

  getRows().forEach((row, idx) => {
    const [qtyInput, widthInput, heightInput] = getRowCoreInputs(row);
    if (!qtyInput || !widthInput || !heightInput) return;
    const qty = parseInt(qtyInput.value, 10);
    const w = parseFloat(widthInput.value);
    const h = parseFloat(heightInput.value);
    if (!(qty >= 1 && w > 0 && h > 0)) return;
    const rot = row._getRotation ? row._getRotation() : false;
    const rawW = rot ? h : w;
    const rawH = rot ? w : h;
    const color = getRowColor(idx);
    const baseId = totalRequested;
    for (let i = 0; i < qty; i++) {
      const pieceId = `${idx}-${baseId + i}`;
      pieces.push({
        id: pieceId,
        rowIdx: idx,
        rawW,
        rawH,
        color,
        rot,
        area: rawW * rawH,
        order: pieces.length,
        dimKey: dimensionKeyNormalized(rawW, rawH)
      });
    }
    totalRequested += qty;
  });

  return {
    instances,
    pieces,
    totalRequested,
    allowAutoRotate,
    kerf
  };
}

function cleanupFreeRectsList(rects, eps = PACKING_EPSILON) {
  const pruned = [];
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    let contained = false;
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const b = rects[j];
      if (a.x >= b.x - eps && a.y >= b.y - eps &&
          a.x + a.w <= b.x + b.w + eps &&
          a.y + a.h <= b.y + b.h + eps) {
        contained = true;
        break;
      }
    }
    if (!contained) pruned.push(a);
  }
  return pruned;
}

function createPlateState(instance, kerf, allowAutoRotate) {
  const trim = instance.trim || { mm: 0, top: false, right: false, bottom: false, left: false };
  const trimValue = Math.max(0, trim.mm || 0);
  const leftT = trim.left ? trimValue : 0;
  const rightT = trim.right ? trimValue : 0;
  const topT = trim.top ? trimValue : 0;
  const bottomT = trim.bottom ? trimValue : 0;
  const usableW = Math.max(0, instance.sw - leftT - rightT);
  const usableH = Math.max(0, instance.sh - topT - bottomT);
  return {
    sw: instance.sw,
    sh: instance.sh,
    trim,
    kerf,
    allowAutoRotate,
    offX: leftT,
    offY: topT,
    usableW,
    usableH,
    freeRects: usableW > 0 && usableH > 0 ? [{ x: 0, y: 0, w: usableW, h: usableH }] : [],
    placements: []
  };
}

function tryPlacePieceOnPlate(state, piece) {
  if (!state.freeRects.length) return null;
  const kerf = state.kerf;
  const orientations = state.allowAutoRotate ? [
    { rawW: piece.rawW, rawH: piece.rawH, rot: piece.rot },
    { rawW: piece.rawH, rawH: piece.rawW, rot: !piece.rot }
  ] : [{ rawW: piece.rawW, rawH: piece.rawH, rot: piece.rot }];

  let best = null;
  for (let rIdx = 0; rIdx < state.freeRects.length; rIdx++) {
    const rect = state.freeRects[rIdx];
    for (const orientation of orientations) {
      const wf = orientation.rawW + kerf;
      const hf = orientation.rawH + kerf;
      if (!(wf > 0 && hf > 0)) continue;
      if (wf > rect.w + PACKING_EPSILON || hf > rect.h + PACKING_EPSILON) continue;

      const leftoverX = Math.max(0, rect.w - wf);
      const leftoverY = Math.max(0, rect.h - hf);
      const hSplit = [];
      if (leftoverY > PACKING_EPSILON) hSplit.push({ x: rect.x, y: rect.y + hf, w: rect.w, h: leftoverY });
      if (leftoverX > PACKING_EPSILON) hSplit.push({ x: rect.x + wf, y: rect.y, w: leftoverX, h: hf });
      const vSplit = [];
      if (leftoverX > PACKING_EPSILON) vSplit.push({ x: rect.x + wf, y: rect.y, w: leftoverX, h: rect.h });
      if (leftoverY > PACKING_EPSILON) vSplit.push({ x: rect.x, y: rect.y + hf, w: wf, h: leftoverY });
      const options = [
        { rects: hSplit, waste: hSplit.reduce((acc, r) => acc + r.w * r.h, 0) },
        { rects: vSplit, waste: vSplit.reduce((acc, r) => acc + r.w * r.h, 0) }
      ];
      if (!options[0].rects.length && !options[1].rects.length) options.push({ rects: [], waste: 0 });

      for (const opt of options) {
        const score = opt.waste;
        if (!best ||
            score < best.score - PACKING_EPSILON ||
            (Math.abs(score - best.score) <= PACKING_EPSILON && (rect.y < best.rect.y - PACKING_EPSILON ||
            (Math.abs(rect.y - best.rect.y) <= PACKING_EPSILON && rect.x < best.rect.x - PACKING_EPSILON)))) {
          best = {
            rectIdx: rIdx,
            rect,
            orientation: { ...orientation, wf, hf },
            score,
            rects: opt.rects
          };
        }
      }
    }
  }

  if (!best) return null;

  const rect = state.freeRects.splice(best.rectIdx, 1)[0];
  const leftoverRects = [];
  for (const candidate of best.rects || []) {
    if (candidate.w > PACKING_EPSILON && candidate.h > PACKING_EPSILON) leftoverRects.push(candidate);
  }
  if (leftoverRects.length) state.freeRects.push(...leftoverRects);
  state.freeRects = cleanupFreeRectsList(state.freeRects, PACKING_EPSILON);

  return {
    x: rect.x + state.offX,
    y: rect.y + state.offY,
    w: best.orientation.wf,
    h: best.orientation.hf,
    rawW: best.orientation.rawW,
    rawH: best.orientation.rawH,
    rot: best.orientation.rot
  };
}

function buildGreedyOrder(pieces) {
  const groupsMap = new Map();
  pieces.forEach((piece) => {
    if (!groupsMap.has(piece.dimKey)) {
      groupsMap.set(piece.dimKey, {
        key: piece.dimKey,
        area: piece.area,
        maxSide: Math.max(piece.rawW, piece.rawH),
        pieces: []
      });
    }
    const group = groupsMap.get(piece.dimKey);
    group.area = Math.max(group.area, piece.area);
    group.maxSide = Math.max(group.maxSide, Math.max(piece.rawW, piece.rawH));
    group.pieces.push(piece);
  });

  const groups = Array.from(groupsMap.values());
  groups.sort((a, b) => {
    if (b.area !== a.area) return b.area - a.area;
    if (b.maxSide !== a.maxSide) return b.maxSide - a.maxSide;
    return a.key.localeCompare(b.key);
  });

  groups.forEach((group) => {
    group.pieces.sort((a, b) => {
      if (b.area !== a.area) return b.area - a.area;
      return a.order - b.order;
    });
  });

  const ordered = [];
  groups.forEach((group) => ordered.push(...group.pieces));
  return ordered;
}

function generateSeedOrders(pieces, metaSettings) {
  if (!pieces.length) return [[]];
  const seeds = [];
  const seen = new Set();
  const register = (order) => {
    if (!order.length) return;
    const key = order.map((p) => p.id).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push(order.slice());
  };

  const base = buildGreedyOrder(pieces);
  register(base);
  register(base.slice().reverse());

  const byLongestSide = pieces.slice().sort((a, b) => {
    const aMax = Math.max(a.rawW, a.rawH);
    const bMax = Math.max(b.rawW, b.rawH);
    if (bMax !== aMax) return bMax - aMax;
    return (b.area || 0) - (a.area || 0);
  });
  register(byLongestSide);

  const bySkew = pieces.slice().sort((a, b) => {
    const aSkew = Math.abs((a.rawW || 0) - (a.rawH || 0));
    const bSkew = Math.abs((b.rawW || 0) - (b.rawH || 0));
    if (bSkew !== aSkew) return bSkew - aSkew;
    return (b.area || 0) - (a.area || 0);
  });
  register(bySkew);

  const byRowGroup = pieces.slice().sort((a, b) => {
    if (a.rowIdx !== b.rowIdx) return a.rowIdx - b.rowIdx;
    if (b.area !== a.area) return b.area - a.area;
    return a.order - b.order;
  });
  register(byRowGroup);

  const randomSamples = Math.max(0, metaSettings.seedOrderSamples || 0);
  for (let i = 0; i < randomSamples; i++) {
    const shuffled = pieces.slice().sort(() => Math.random() - 0.5);
    register(shuffled);
  }

  return seeds.length ? seeds : [pieces.slice()];
}

function perturbOrder(order, intensity) {
  if (order.length <= 1) return order.slice();
  const clone = order.slice();
  const ops = Math.max(1, Math.round(clone.length * intensity));
  for (let i = 0; i < ops; i++) {
    const choice = Math.random();
    if (choice < 0.34) {
      const a = Math.floor(Math.random() * clone.length);
      let b = Math.floor(Math.random() * clone.length);
      if (clone.length > 1 && b === a) b = (b + 1) % clone.length;
      const tmp = clone[a];
      clone[a] = clone[b];
      clone[b] = tmp;
    } else if (choice < 0.67) {
      const start = Math.floor(Math.random() * clone.length);
      const span = Math.max(1, Math.round(intensity * Math.random() * clone.length * 0.5));
      const end = Math.min(clone.length, start + span);
      const segment = clone.splice(start, end - start);
      let insertAt = Math.floor(Math.random() * (clone.length + 1));
      clone.splice(insertAt, 0, ...segment);
    } else {
      const start = Math.floor(Math.random() * clone.length);
      const span = Math.max(2, Math.round(intensity * Math.random() * clone.length * 0.6));
      const end = Math.min(clone.length, start + span);
      const segment = clone.slice(start, end).reverse();
      clone.splice(start, segment.length, ...segment);
    }
  }
  return clone;
}

function runGreedyGuillotine(instances, order, options, metaSettings) {
  const states = instances.map((inst) => createPlateState(inst, options.kerf, options.allowAutoRotate));
  const remaining = order.slice();
  const placements = [];
  const placementsByPlate = states.map(() => []);

  for (let plateIdx = 0; plateIdx < states.length && remaining.length; plateIdx++) {
    const state = states[plateIdx];
    let progress = true;
    while (progress && remaining.length) {
      progress = false;
      for (let i = 0; i < remaining.length; i++) {
        const piece = remaining[i];
        const placement = tryPlacePieceOnPlate(state, piece);
        if (!placement) continue;

        const placementWithMeta = {
          plateIdx,
          x: placement.x,
          y: placement.y,
          w: placement.w,
          h: placement.h,
          rawW: placement.rawW,
          rawH: placement.rawH,
          rot: placement.rot,
          color: piece.color,
          rowIdx: piece.rowIdx,
          id: piece.id
        };

        placements.push(placementWithMeta);
        placementsByPlate[plateIdx].push(placementWithMeta);
        remaining.splice(i, 1);
        progress = true;
        i--;
      }
    }
  }

  const leftovers = remaining.slice();
  const usedArea = placements.reduce((acc, r) => acc + r.w * r.h, 0);
  const totalArea = instances.reduce((acc, inst) => acc + inst.sw * inst.sh, 0);
  const wasteArea = Math.max(0, totalArea - usedArea);
  const missingArea = leftovers.reduce((acc, piece) => acc + piece.rawW * piece.rawH, 0);
  const missingCountPenalty = totalArea * metaSettings.missingPiecePenaltyFactor * leftovers.length;
  const score = wasteArea + missingArea * metaSettings.missingAreaWeight + missingCountPenalty;

  return {
    placements,
    placementsByPlate,
    leftovers,
    usedArea,
    wasteArea,
    totalArea,
    score
  };
}

function groupLeftoverPieces(leftovers) {
  const groupsMap = new Map();
  leftovers.forEach((piece) => {
    const key = dimensionKeyNormalized(piece.rawW, piece.rawH);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        key,
        area: piece.rawW * piece.rawH,
        maxSide: Math.max(piece.rawW, piece.rawH),
        pieces: []
      });
    }
    const group = groupsMap.get(key);
    group.area = Math.max(group.area, piece.rawW * piece.rawH);
    group.maxSide = Math.max(group.maxSide, Math.max(piece.rawW, piece.rawH));
    group.pieces.push(piece);
  });

  return Array.from(groupsMap.values()).sort((a, b) => {
    if (b.area !== a.area) return b.area - a.area;
    if (b.maxSide !== a.maxSide) return b.maxSide - a.maxSide;
    return a.key.localeCompare(b.key);
  });
}

function solveWithMetaHeuristics(instances, pieces, options) {
  const metaSettings = { ...META_SETTINGS };
  if (!pieces.length) {
    const emptySolution = runGreedyGuillotine(instances, [], options, metaSettings);
    return {
      ...emptySolution,
      bestOrder: [],
      iterationsUsed: 0,
      acceptedMoves: 0,
      baseScore: emptySolution.score
    };
  }

  const seedOrders = generateSeedOrders(pieces, metaSettings);

  const evaluateOrder = (order) => runGreedyGuillotine(instances, order, options, metaSettings);

  const annealFromOrder = (seedOrder, passIdx) => {
    const startOrder = seedOrder.slice();
    const baseSolution = evaluateOrder(startOrder);
    let bestSolution = baseSolution;
    let bestOrder = startOrder.slice();
    let currentSolution = baseSolution;
    let currentOrder = startOrder.slice();
    let temperature = metaSettings.temperatureStart;
    let acceptedMoves = 0;

    const iterationMultiplier = 1 + Math.min(3, (passIdx || 0) * 0.35);
    const dynamicMaxIterations = Math.max(metaSettings.maxIterations, Math.ceil(metaSettings.maxIterations * iterationMultiplier));
    const iterations = Math.max(
      metaSettings.minIterations,
      Math.min(dynamicMaxIterations, Math.ceil(startOrder.length * metaSettings.perPieceFactor * iterationMultiplier))
    );

    for (let iter = 0; iter < iterations; iter++) {
      const intensity = metaSettings.minPerturbation + Math.random() * (metaSettings.maxPerturbation - metaSettings.minPerturbation);
      const candidateOrder = perturbOrder(currentOrder, intensity);
      const candidateSolution = evaluateOrder(candidateOrder);
      const delta = candidateSolution.score - currentSolution.score;
      const effectiveTemp = Math.max(metaSettings.temperatureMin, temperature);
      if (delta < 0 || Math.random() < Math.exp(-delta / effectiveTemp)) {
        currentOrder = candidateOrder;
        currentSolution = candidateSolution;
        acceptedMoves++;
        if (candidateSolution.score < bestSolution.score - PACKING_EPSILON) {
          bestSolution = candidateSolution;
          bestOrder = candidateOrder.slice();
        }
      }
      temperature = Math.max(metaSettings.temperatureMin, temperature * metaSettings.temperatureCool);
    }

    const restartsBase = Math.max(1, Math.min(metaSettings.randomRestarts, Math.floor(startOrder.length / 4) || 1));
    const restarts = Math.max(restartsBase, Math.ceil(restartsBase * iterationMultiplier));
    for (let r = 0; r < restarts; r++) {
      const randomIntensity = 0.45 + Math.random() * 0.45;
      const randomOrder = perturbOrder(bestOrder, randomIntensity);
      const candidate = evaluateOrder(randomOrder);
      if (candidate.score < bestSolution.score - PACKING_EPSILON) {
        bestSolution = candidate;
        bestOrder = randomOrder.slice();
      }
    }

    return {
      bestSolution,
      bestOrder,
      baseSolution,
      iterationsUsed: iterations,
      acceptedMoves
    };
  };

  let globalBest = null;
  let globalBestOrder = [];
  let totalIterations = 0;
  let totalAccepted = 0;
  let lowestBaseScore = Infinity;

  const loopsByPieces = Math.ceil(pieces.length * (metaSettings.globalLoopsFactor || 0));
  const baseLoops = Math.max(seedOrders.length, loopsByPieces, 1);
  const maxLoops = Math.max(baseLoops, metaSettings.maxGlobalLoops || baseLoops);

  let loopIdx = 0;
  while (loopIdx < maxLoops) {
    const seed = seedOrders[loopIdx % seedOrders.length];
    let warmedSeed;
    if (loopIdx < seedOrders.length) {
      warmedSeed = seed.slice();
    } else if (globalBestOrder.length) {
      const drift = 0.3 + Math.random() * 0.5;
      warmedSeed = perturbOrder(globalBestOrder, drift);
    } else {
      warmedSeed = perturbOrder(seed, 0.35 + Math.random() * 0.55);
    }

    if (loopIdx % 7 === 6) {
      const randomSeed = pieces.slice().sort(() => Math.random() - 0.5);
      warmedSeed = randomSeed;
    }

    const result = annealFromOrder(warmedSeed, loopIdx);
    totalIterations += result.iterationsUsed;
    totalAccepted += result.acceptedMoves;
    lowestBaseScore = Math.min(lowestBaseScore, result.baseSolution.score);
    if (!globalBest || result.bestSolution.score < globalBest.score - PACKING_EPSILON) {
      globalBest = result.bestSolution;
      globalBestOrder = result.bestOrder.slice();
    }

    if (globalBest && globalBest.leftovers.length === 0) {
      break;
    }

    loopIdx += 1;
  }

  if (!globalBest) {
    const fallback = evaluateOrder(seedOrders[0]);
    globalBest = fallback;
    globalBestOrder = seedOrders[0].slice();
    lowestBaseScore = Math.min(lowestBaseScore, fallback.score);
  }

  return {
    ...globalBest,
    bestOrder: globalBestOrder,
    iterationsUsed: totalIterations,
    acceptedMoves: totalAccepted,
    baseScore: lowestBaseScore
  };
}

function solveCutLayoutInternal() {
  const inputs = collectSolverInputs();
  if (!inputs) return null;

  const { instances, pieces, totalRequested, allowAutoRotate, kerf } = inputs;
  const computeLeftoverArea = (leftovers) => leftovers.reduce((acc, p) => acc + (p.rawW * p.rawH), 0);
  const clonePieces = (src) => src.map(piece => ({ ...piece }));
  const runSolverWithFallback = (instSubset, pieceSource) => {
    let workingPieces = clonePieces(pieceSource);
    let sol = solveWithMetaHeuristics(instSubset, workingPieces, { allowAutoRotate, kerf });
    if (allowAutoRotate && sol.leftovers.length) {
      const leftoverIds = new Set(sol.leftovers.map((p) => p.id));
      if (leftoverIds.size) {
        const flippedPieces = workingPieces.map((piece) => {
          if (!leftoverIds.has(piece.id)) return { ...piece };
          const rawW = piece.rawH;
          const rawH = piece.rawW;
          return {
            ...piece,
            rawW,
            rawH,
            rot: !piece.rot,
            area: rawW * rawH,
            dimKey: dimensionKeyNormalized(rawW, rawH)
          };
        });
        const retry = solveWithMetaHeuristics(instSubset, flippedPieces, { allowAutoRotate, kerf });
        const retryLeftoverArea = computeLeftoverArea(retry.leftovers);
        const currentLeftoverArea = computeLeftoverArea(sol.leftovers);
        const isBetter =
          retry.leftovers.length < sol.leftovers.length ||
          (retry.leftovers.length === sol.leftovers.length && retryLeftoverArea < currentLeftoverArea);
        if (isBetter) {
          workingPieces = flippedPieces;
          sol = retry;
        }
      }
    }
    return { solution: sol, pieces: workingPieces };
  };

  const getMaxUsedPlateIdx = (placementsByPlate) => {
    let maxIdx = -1;
    placementsByPlate.forEach((plate, idx) => {
      if (plate && plate.length) maxIdx = idx;
    });
    return maxIdx;
  };

  let { solution, pieces: solverPieces } = runSolverWithFallback(instances, pieces);

  if (!solution.leftovers.length) {
    const maxPlateIdx = getMaxUsedPlateIdx(solution.placementsByPlate);
    if (maxPlateIdx > 0) {
      const placementPlateMap = new Map();
      solution.placements.forEach((placement) => {
        if (placement) placementPlateMap.set(placement.id, placement.plateIdx);
      });
      const prioritizedPiecesSource = pieces.slice().sort((a, b) => {
        const plateA = placementPlateMap.has(a.id) ? placementPlateMap.get(a.id) : Number.MAX_SAFE_INTEGER;
        const plateB = placementPlateMap.has(b.id) ? placementPlateMap.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (plateA !== plateB) return plateB - plateA; // piezas ubicadas en placas posteriores primero
        const areaA = (a.rawW || 0) * (a.rawH || 0);
        const areaB = (b.rawW || 0) * (b.rawH || 0);
        if (areaA !== areaB) return areaB - areaA;
        return String(a.id).localeCompare(String(b.id));
      });
      const prioritized = runSolverWithFallback(instances, prioritizedPiecesSource);
      if (!prioritized.solution.leftovers.length) {
        const prioritizedMaxIdx = getMaxUsedPlateIdx(prioritized.solution.placementsByPlate);
        const betterByPlate = prioritizedMaxIdx < maxPlateIdx;
        const betterByScore = prioritized.solution.score + PACKING_EPSILON < solution.score;
        if (betterByPlate || betterByScore) {
          solution = prioritized.solution;
          solverPieces = prioritized.pieces;
        }
      }
    }
  }

  const leftoverGroups = groupLeftoverPieces(solution.leftovers);

  return {
    instances,
    placements: solution.placements,
    placementsByPlate: solution.placementsByPlate,
    leftoverGroups,
    leftoverPieces: solution.leftovers,
    totalRequested,
    usedArea: solution.usedArea,
    wasteArea: solution.wasteArea,
    totalArea: solution.totalArea,
    pieces: solverPieces,
    meta: {
      bestScore: solution.score,
      baseScore: solution.baseScore,
      iterations: solution.iterationsUsed,
      acceptedMoves: solution.acceptedMoves
    }
  };
}

function computePlacement() {
  const result = solveCutLayoutInternal();
  if (!result) return null;
  return {
    instances: result.instances,
    placed: result.placements,
    totalRequested: result.totalRequested,
    leftovers: result.leftoverGroups
  };
}

function makeRow(index) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.rowIdx = String(index);
  row._manualRotWanted = false;
  row._inputsEnabled = true;

  // Índice de fila
  const fIdx = document.createElement('div');
  fIdx.className = 'idx';
  fIdx.textContent = String(index + 1);

  // Cantidad
  const fQty = document.createElement('div');
  fQty.className = 'field field--qty';
  const lQty = document.createElement('label');
  lQty.textContent = 'Cantidad';
  const iQty = document.createElement('input');
  iQty.type = 'number';
  iQty.placeholder = 'Ej: 7';
  iQty.min = '1';
  iQty.value = '';
  iQty.className = 'row-input row-input-primary';
  iQty.dataset.role = 'qty';
  fQty.appendChild(lQty);
  fQty.appendChild(iQty);

  // Ancho
  const fW = document.createElement('div');
  fW.className = 'field field--width';
  const lW = document.createElement('label');
  lW.textContent = 'Ancho (mm)';
  const iW = document.createElement('input');
  iW.type = 'number';
  iW.placeholder = 'Ej: 600';
  iW.min = '0';
  iW.step = '1';
  iW.className = 'row-input row-input-primary';
  iW.dataset.role = 'width';
  const iWLevel = document.createElement('input');
  iWLevel.type = 'number';
  iWLevel.placeholder = '0';
  iWLevel.min = '0';
  iWLevel.max = '2';
  iWLevel.step = '1';
  iWLevel.inputMode = 'numeric';
  iWLevel.pattern = '[0-2]';
  iWLevel.className = 'row-input row-input-secondary';
  iWLevel.dataset.role = 'width-tier';
  iWLevel.title = 'Solo números 0, 1 o 2';
  iWLevel.setAttribute('aria-label', 'Ancho adicional (0 a 2)');
  const wEdgeSelect = document.createElement('select');
  wEdgeSelect.className = 'edge-select';
  wEdgeSelect.dataset.role = 'width-edge';
  wEdgeSelect.setAttribute('aria-label', 'Tipo de cubre canto horizontal');
  const wWrap = document.createElement('div');
  wWrap.className = 'dim-inputs';
  fW.appendChild(lW);
  wWrap.appendChild(iW);
  wWrap.appendChild(iWLevel);
  wWrap.appendChild(wEdgeSelect);
  fW.appendChild(wWrap);

  // Alto
  const fH = document.createElement('div');
  fH.className = 'field field--height';
  const lH = document.createElement('label');
  lH.textContent = 'Alto (mm)';
  const iH = document.createElement('input');
  iH.type = 'number';
  iH.placeholder = 'Ej: 720';
  iH.min = '0';
  iH.step = '1';
  iH.className = 'row-input row-input-primary';
  iH.dataset.role = 'height';
  const iHLevel = document.createElement('input');
  iHLevel.type = 'number';
  iHLevel.placeholder = '0';
  iHLevel.min = '0';
  iHLevel.max = '2';
  iHLevel.step = '1';
  iHLevel.inputMode = 'numeric';
  iHLevel.pattern = '[0-2]';
  iHLevel.className = 'row-input row-input-secondary';
  iHLevel.dataset.role = 'height-tier';
  iHLevel.title = 'Solo números 0, 1 o 2';
  iHLevel.setAttribute('aria-label', 'Alto adicional (0 a 2)');
  const hEdgeSelect = document.createElement('select');
  hEdgeSelect.className = 'edge-select';
  hEdgeSelect.dataset.role = 'height-edge';
  hEdgeSelect.setAttribute('aria-label', 'Tipo de cubre canto vertical');
  const hWrap = document.createElement('div');
  hWrap.className = 'dim-inputs';
  fH.appendChild(lH);
  hWrap.appendChild(iH);
  hWrap.appendChild(iHLevel);
  hWrap.appendChild(hEdgeSelect);
  fH.appendChild(hWrap);

  // Acciones (unidades / eliminar)
  const actions = document.createElement('div');
  actions.className = 'actions';
  const units = document.createElement('div');
  units.className = 'units';
  units.textContent = 'mm';
  const colorDot = document.createElement('span');
  colorDot.className = 'color-dot';
  colorDot.title = 'Color de esta fila';
  colorDot.style.background = getRowColor(index);

  const navElements = [
    { el: iQty, validate: (input) => {
      const num = parseInt(input.value, 10);
      return Number.isFinite(num) && num >= 1;
    } },
    { el: iW, validate: (input) => {
      const num = parseFloat(input.value);
      return Number.isFinite(num) && num > 0;
    } },
    { el: iWLevel, validate: () => true },
    { el: wEdgeSelect, validate: () => true },
    { el: iH, validate: (input) => {
      const num = parseFloat(input.value);
      return Number.isFinite(num) && num > 0;
    } },
    { el: iHLevel, validate: () => true },
    { el: hEdgeSelect, validate: () => true }
  ];
  const tierInputs = [iWLevel, iHLevel];

  const parseTierValue = (input) => {
    if (!input) return 0;
    const val = parseInt(input.value, 10);
    if (!Number.isFinite(val)) return 0;
    return clamp(val, 0, 2);
  };

  const computeEdgeCounts = () => {
    const leftSelected = edges.left.dataset.selected === '1';
    const rightSelected = edges.right.dataset.selected === '1';
    const topSelected = edges.top.dataset.selected === '1';
    const bottomSelected = edges.bottom.dataset.selected === '1';
    const previewVertical = (leftSelected ? 1 : 0) + (rightSelected ? 1 : 0);
    const previewHorizontal = (topSelected ? 1 : 0) + (bottomSelected ? 1 : 0);
    const widthTierVal = parseTierValue(iWLevel);
    const heightTierVal = parseTierValue(iHLevel);
    return {
      previewVertical,
      previewHorizontal,
      verticalCount: Math.max(previewVertical, widthTierVal),
      horizontalCount: Math.max(previewHorizontal, heightTierVal),
      widthTierVal,
      heightTierVal,
      leftSelected,
      rightSelected,
      topSelected,
      bottomSelected
    };
  };
  const focusInput = (input) => {
    if (!input) return;
    requestAnimationFrame(() => {
      input.focus();
      if (typeof input.select === 'function') input.select();
    });
  };
  const focusNextNav = (currentIdx) => {
    for (let next = currentIdx + 1; next < navElements.length; next++) {
      const nextEl = navElements[next]?.el;
      if (nextEl && !nextEl.disabled) {
        focusInput(nextEl);
        return true;
      }
    }
    return false;
  };

  const focusFirstNavInRow = (targetRow) => {
    if (!targetRow) return;
    const nav = targetRow._navElements || [];
    const nextEl = nav.find((el) => el && !el.disabled) || targetRow.querySelector(ROW_CORE_SELECTORS.qty);
    focusInput(nextEl);
  };

  const handleEnter = (fieldIdx) => (event) => {
    if (event.key !== 'Enter') return;
    const config = navElements[fieldIdx];
    if (!config || event.target !== config.el) return;
    if (typeof config.validate === 'function' && !config.validate(config.el)) return;
    event.preventDefault();

    if (focusNextNav(fieldIdx)) return;

    let nextRow = row.nextElementSibling;
    while (nextRow && !nextRow.classList.contains('row')) {
      nextRow = nextRow.nextElementSibling;
    }

    if (!nextRow) {
      const beforeCount = currentRowCount();
      if (addRowBtn && !addRowBtn.disabled) {
        addRowBtn.click();
        const rows = getRows();
        nextRow = rows[beforeCount] || null;
      }
    }

    if (nextRow) {
      focusFirstNavInRow(nextRow);
    }
  };

  navElements.forEach((cfg, idx) => {
    if (!cfg.el) return;
    cfg.el.addEventListener('keydown', handleEnter(idx));
  });
  const applyTierChange = () => {
    recalcEdgebanding();
    renderSheetOverview();
    persistState && persistState();
  };
  const handleTierInputChange = (input) => {
    let parsed = parseInt(input.value.trim(), 10);
    if (!Number.isFinite(parsed)) parsed = 0;
    parsed = clamp(parsed, 0, 2);
    if (String(parsed) !== input.value) input.value = String(parsed);
    syncEdgesFromTierInputs({ emitChange: true });
  };
  tierInputs.forEach((input) => {
    input.addEventListener('input', () => handleTierInputChange(input));
  });
  const handleEdgeSelectChange = () => {
    recalcEdgebanding();
    renderSheetOverview();
    if (typeof persistState === 'function') persistState();
  };
  wEdgeSelect.addEventListener('change', handleEdgeSelectChange);
  hEdgeSelect.addEventListener('change', handleEdgeSelectChange);

  const updateEdgeSelectState = () => {
    if (!row._inputsEnabled) {
      wEdgeSelect.disabled = true;
      hEdgeSelect.disabled = true;
      return;
    }
    const { verticalCount, horizontalCount } = computeEdgeCounts();
    const states = [
      { select: wEdgeSelect, enable: verticalCount > 0 },
      { select: hEdgeSelect, enable: horizontalCount > 0 }
    ];
    let cleared = false;
    states.forEach(({ select, enable }) => {
      if (!select) return;
      if (enable) {
        if (select.disabled) select.disabled = false;
      } else {
        if (!select.disabled) select.disabled = true;
        if (select.value) {
          select.value = '';
          cleared = true;
        }
      }
    });
    if (cleared) handleEdgeSelectChange();
  };
  const rotWrap = document.createElement('label');
  rotWrap.className = 'rot-label';
  const iRot = document.createElement('input');
  iRot.type = 'checkbox';
  iRot.title = 'Rotar 90° en la placa';
  rotWrap.appendChild(iRot);
  rotWrap.appendChild(document.createTextNode('Rotar 90°'));
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn remove';
  removeBtn.textContent = 'Eliminar';
  removeBtn.addEventListener('click', () => {
    row.remove();
    reindexRows();
    applyPlatesGate();
  });
  actions.appendChild(units);
  actions.appendChild(colorDot);
  actions.appendChild(rotWrap);
  actions.appendChild(removeBtn);

  // Vista previa (SVG con bordes clicables)
  const preview = document.createElement('div');
  preview.className = 'preview';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Vista previa';
  preview.appendChild(hint);

  // Capa de bloqueo hasta completar los 3 campos
  const lock = document.createElement('div');
  lock.className = 'overlay';
  lock.textContent = 'Complete cantidad, ancho y alto';
  preview.appendChild(lock);

  const svgWrap = document.createElement('div');
  svgWrap.className = 'svg-wrap';
  const svgNS = 'http://www.w3.org/2000/svg';
  const VIEW_W = 200;
  const VIEW_H = 110;
  const OUTER_PAD = 20; // margen interno amplio para que no se salga
  const EDGE_INSET = 8; // distancia de las líneas respecto al borde del rect
  const VBIAS_ENABLED = 6;  // sesgo hacia arriba cuando está habilitado
  const VBIAS_LOCKED = 12;  // sesgo mayor cuando está bloqueado
  const MIN_PREVIEW_PX = 26; // lado mínimo cómodo en px
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Grupo sombra
  const g = document.createElementNS(svgNS, 'g');
  g.setAttribute('class', 'rect-shadow');

  // Rectángulo base para referencia
  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('class', 'rect-outline');
  rect.setAttribute('x', String(OUTER_PAD));
  rect.setAttribute('y', String(OUTER_PAD));
  rect.setAttribute('width', String(VIEW_W - OUTER_PAD * 2));
  rect.setAttribute('height', String(VIEW_H - OUTER_PAD * 2));
  rect.setAttribute('rx', '4');
  g.appendChild(rect);

  // Bordes clicables (top, right, bottom, left)
  const edges = {
    top: document.createElementNS(svgNS, 'line'),
    right: document.createElementNS(svgNS, 'line'),
    bottom: document.createElementNS(svgNS, 'line'),
    left: document.createElementNS(svgNS, 'line'),
  };
  // Líneas invisibles para ampliar área de clic
  const edgesHit = {
    top: document.createElementNS(svgNS, 'line'),
    right: document.createElementNS(svgNS, 'line'),
    bottom: document.createElementNS(svgNS, 'line'),
    left: document.createElementNS(svgNS, 'line'),
  };

  function updateTierInputsFromEdges() {
    const widthCount = (edges.left.dataset.selected === '1' ? 1 : 0) + (edges.right.dataset.selected === '1' ? 1 : 0);
    const heightCount = (edges.top.dataset.selected === '1' ? 1 : 0) + (edges.bottom.dataset.selected === '1' ? 1 : 0);
    const widthStr = String(widthCount);
    const heightStr = String(heightCount);
    if (iWLevel.value !== widthStr) iWLevel.value = widthStr;
    if (iHLevel.value !== heightStr) iHLevel.value = heightStr;
    updateEdgeSelectState();
  }

  function setEdgeSelected(edge, selected, skipTierSync = false) {
    const current = edge.dataset.selected === '1';
    if (current === selected) return;
    edge.dataset.selected = selected ? '1' : '0';
    edge.classList.toggle('selected', selected);
    if (!skipTierSync) updateTierInputsFromEdges();
  }

  function syncEdgesFromTierInputs({ emitChange = false } = {}) {
    let widthVal = parseInt(iWLevel.value, 10);
    if (!Number.isFinite(widthVal)) widthVal = 0;
    widthVal = clamp(widthVal, 0, 2);
    if (String(widthVal) !== iWLevel.value) iWLevel.value = String(widthVal);

    let heightVal = parseInt(iHLevel.value, 10);
    if (!Number.isFinite(heightVal)) heightVal = 0;
    heightVal = clamp(heightVal, 0, 2);
    if (String(heightVal) !== iHLevel.value) iHLevel.value = String(heightVal);

    const leftSelected = edges.left.dataset.selected === '1';
    const rightSelected = edges.right.dataset.selected === '1';
    if (widthVal === 0) {
      setEdgeSelected(edges.left, false, true);
      setEdgeSelected(edges.right, false, true);
    } else if (widthVal === 1) {
      if (leftSelected && !rightSelected) {
        setEdgeSelected(edges.right, false, true);
      } else if (rightSelected && !leftSelected) {
        setEdgeSelected(edges.left, false, true);
      } else {
        setEdgeSelected(edges.left, true, true);
        setEdgeSelected(edges.right, false, true);
      }
    } else {
      setEdgeSelected(edges.left, true, true);
      setEdgeSelected(edges.right, true, true);
    }

    const topSelected = edges.top.dataset.selected === '1';
    const bottomSelected = edges.bottom.dataset.selected === '1';
    if (heightVal === 0) {
      setEdgeSelected(edges.top, false, true);
      setEdgeSelected(edges.bottom, false, true);
    } else if (heightVal === 1) {
      if (topSelected && !bottomSelected) {
        setEdgeSelected(edges.bottom, false, true);
      } else if (bottomSelected && !topSelected) {
        setEdgeSelected(edges.top, false, true);
      } else {
        setEdgeSelected(edges.top, true, true);
        setEdgeSelected(edges.bottom, false, true);
      }
    } else {
      setEdgeSelected(edges.top, true, true);
      setEdgeSelected(edges.bottom, true, true);
    }

    updateTierInputsFromEdges();
    updatePreview();
    if (emitChange) applyTierChange();
  }

  const handleEdgeToggle = (edge) => {
    const newSelected = edge.dataset.selected !== '1';
    setEdgeSelected(edge, newSelected);
    recalcEdgebanding();
    renderSheetOverview();
    persistState && persistState();
  };

  for (const key of Object.keys(edges)) {
    const el = edges[key];
    el.setAttribute('class', 'edge');
    el.dataset.selected = '0';
    el.addEventListener('click', () => handleEdgeToggle(el));
    g.appendChild(el);
  }
  for (const key of Object.keys(edgesHit)) {
    const hot = edgesHit[key];
    hot.setAttribute('class', 'edge-hit');
    hot.addEventListener('click', () => handleEdgeToggle(edges[key]));
    g.appendChild(hot);
  }

  updateTierInputsFromEdges();

  // Etiqueta de dimensiones arriba a la derecha + fondo
  const dimsBg = document.createElementNS(svgNS, 'rect');
  dimsBg.setAttribute('class', 'dims-badge');
  dimsBg.setAttribute('rx', '4');
  const dims = document.createElementNS(svgNS, 'text');
  dims.setAttribute('class', 'dims-label');
  dims.setAttribute('x', String(VIEW_W - 6));
  dims.setAttribute('y', String(6));
  dims.setAttribute('text-anchor', 'end');
  dims.setAttribute('dominant-baseline', 'hanging');
  svg.appendChild(g);
  svg.appendChild(dimsBg);
  svg.appendChild(dims);
  svgWrap.appendChild(svg);
  preview.appendChild(svgWrap);

  // Ensamble de la fila
  row.appendChild(fIdx);
  row.appendChild(fQty);
  row.appendChild(fW);
  row.appendChild(fH);
  row.appendChild(actions);
  row.appendChild(preview);

  row._navElements = navElements.map(cfg => cfg.el).filter(Boolean);
  row._refreshEdgeSelects = () => {
    populateEdgeSelectOptions(wEdgeSelect);
    populateEdgeSelectOptions(hEdgeSelect);
    updateEdgeSelectState();
  };
  row._edgeSelects = { width: wEdgeSelect, height: hEdgeSelect };
  row._computeEdgeCounts = computeEdgeCounts;
  row._updateEdgeSelectState = updateEdgeSelectState;
  row._refreshEdgeSelects();

  function setInputsEnabled(enabled) {
    row._inputsEnabled = !!enabled;
    iQty.disabled = !enabled;
    iW.disabled = !enabled;
    iH.disabled = !enabled;
    iWLevel.disabled = !enabled;
    iHLevel.disabled = !enabled;
    if (!enabled) {
      wEdgeSelect.disabled = true;
      hEdgeSelect.disabled = true;
    } else {
      updateEdgeSelectState();
    }
  }

  // Lógica para ajustar el rect y los bordes según ancho/alto y rotación
  function updatePreview() {
    const w = parseFloat(iW.value);
    const h = parseFloat(iH.value);
    const qty = parseInt(iQty.value, 10);

    const sheet = getPrimaryPlateDims();
    const haveSheet = !!sheet;
    const enabled = haveSheet && !isNaN(qty) && qty >= 1 && w > 0 && h > 0;
    lock.style.display = enabled ? 'none' : 'grid';
    lock.textContent = haveSheet ? 'Complete cantidad, ancho y alto' : 'Complete el tamaño de la placa';

    const innerW = VIEW_W - OUTER_PAD * 2;
    const innerH = VIEW_H - OUTER_PAD * 2;

    let rw, rh, rx, ry;
    const rot = !!iRot.checked;
    const effW = rot ? h : w;
    const effH = rot ? w : h;
    const fmtSize = (val) => formatNumber(val, 2);
    if (enabled) {
      // Escala basada en la placa con mínimo confortable y respetando el contenedor
      const scalePlate = sheet ? Math.min(innerW / sheet.sw, innerH / sheet.sh) : 0;
      const scaleFit = Math.min(innerW / effW, innerH / effH);
      const scaleComfort = MIN_PREVIEW_PX / Math.max(1e-6, Math.min(effW, effH));
      const scale = Math.min(scaleFit, Math.max(scalePlate, scaleComfort));
      rw = clamp(effW * scale, MIN_PREVIEW_PX, innerW);
      rh = clamp(effH * scale, MIN_PREVIEW_PX, innerH);
      rx = OUTER_PAD + (innerW - rw) / 2;
      ry = OUTER_PAD + (innerH - rh) / 2;
      ry = Math.max(OUTER_PAD, ry - VBIAS_ENABLED);
      if (rot) {
        dims.textContent = `${fmtSize(h)} × ${fmtSize(w)} mm (rotado)`;
      } else {
        dims.textContent = `${fmtSize(w)} × ${fmtSize(h)} mm`;
      }
    } else {
      // Al bloquear, limpiar selección de bordes
      for (const key of Object.keys(edges)) {
        const el = edges[key];
        el.dataset.selected = '0';
        el.classList.remove('selected');
      }
      // Placeholder centrado dentro del área visible
      rw = innerW * 0.72;
      rh = innerH * 0.65;
      rx = OUTER_PAD + (innerW - rw) / 2;
      ry = OUTER_PAD + (innerH - rh) / 2;
      ry = Math.max(OUTER_PAD, ry - VBIAS_LOCKED);
      dims.textContent = '';
    }

    rect.setAttribute('x', String(rx));
    rect.setAttribute('y', String(ry));
    rect.setAttribute('width', String(rw));
    rect.setAttribute('height', String(rh));
    // Posicionar etiqueta arriba-derecha del preview y dibujar fondo
    const padEdge = 6;
    dims.setAttribute('x', String(VIEW_W - padEdge));
    dims.setAttribute('y', String(padEdge));
    const text = dims.textContent || '';
    if (text) {
      // calcular bbox una vez que el texto existe
      const bb = dims.getBBox();
      const pad = 3;
      const bx = bb.x - pad;
      const by = bb.y - pad;
      const bw = bb.width + pad * 2;
      const bh = bb.height + pad * 2;
      dimsBg.setAttribute('x', String(bx));
      dimsBg.setAttribute('y', String(by));
      dimsBg.setAttribute('width', String(Math.max(1, bw)));
      dimsBg.setAttribute('height', String(Math.max(1, bh)));
      // color según tema
      const isLight = document.body.classList.contains('theme-light');
      const fill = isLight ? '#ffffffcc' : '#00000066';
      const stroke = isLight ? '#94a3b866' : '#ffffff33';
      dimsBg.setAttribute('fill', fill);
      dimsBg.setAttribute('stroke', stroke);
      dimsBg.setAttribute('stroke-width', '0.5');
      dimsBg.style.display = '';
    } else {
      dimsBg.style.display = 'none';
    }

    // Inset dinámico para no colapsar los lados en piezas muy chicas
    const inset = Math.max(1, Math.min(EDGE_INSET, rw * 0.5 - 2, rh * 0.5 - 2));

    edges.top.setAttribute('x1', String(rx + inset));
    edges.top.setAttribute('y1', String(ry + inset));
    edges.top.setAttribute('x2', String(rx + rw - inset));
    edges.top.setAttribute('y2', String(ry + inset));

    edges.right.setAttribute('x1', String(rx + rw - inset));
    edges.right.setAttribute('y1', String(ry + inset));
    edges.right.setAttribute('x2', String(rx + rw - inset));
    edges.right.setAttribute('y2', String(ry + rh - inset));

    edges.bottom.setAttribute('x1', String(rx + inset));
    edges.bottom.setAttribute('y1', String(ry + rh - inset));
    edges.bottom.setAttribute('x2', String(rx + rw - inset));
    edges.bottom.setAttribute('y2', String(ry + rh - inset));

    edges.left.setAttribute('x1', String(rx + inset));
    edges.left.setAttribute('y1', String(ry + inset));
    edges.left.setAttribute('x2', String(rx + inset));
    edges.left.setAttribute('y2', String(ry + rh - inset));

    // Posicionar las líneas de hit (ocupando todo el lado)
    edgesHit.top.setAttribute('x1', String(rx));
    edgesHit.top.setAttribute('y1', String(ry));
    edgesHit.top.setAttribute('x2', String(rx + rw));
    edgesHit.top.setAttribute('y2', String(ry));
    edgesHit.right.setAttribute('x1', String(rx + rw));
    edgesHit.right.setAttribute('y1', String(ry));
    edgesHit.right.setAttribute('x2', String(rx + rw));
    edgesHit.right.setAttribute('y2', String(ry + rh));
    edgesHit.bottom.setAttribute('x1', String(rx));
    edgesHit.bottom.setAttribute('y1', String(ry + rh));
    edgesHit.bottom.setAttribute('x2', String(rx + rw));
    edgesHit.bottom.setAttribute('y2', String(ry + rh));
    edgesHit.left.setAttribute('x1', String(rx));
    edgesHit.left.setAttribute('y1', String(ry));
    edgesHit.left.setAttribute('x2', String(rx));
    edgesHit.left.setAttribute('y2', String(ry + rh));
  }

  iW.addEventListener('input', () => { updatePreview(); toggleAddButton(); recalcEdgebanding(); renderSheetOverview(); persistState && persistState(); });
  iH.addEventListener('input', () => { updatePreview(); toggleAddButton(); recalcEdgebanding(); renderSheetOverview(); persistState && persistState(); });
  iRot.addEventListener('change', () => {
    row._manualRotWanted = iRot.checked;
    updatePreview();
    recalcEdgebanding();
    renderSheetOverview();
    persistState && persistState();
  });

  // Cambios de cantidad no afectan la vista previa, pero validamos
  iQty.addEventListener('input', () => {
    if (iQty.value !== '') {
      const v = parseInt(iQty.value, 10);
      if (isNaN(v) || v < 1) iQty.value = '1';
    }
    updatePreview();
    toggleAddButton();
    recalcEdgebanding();
    renderSheetOverview();
    persistState && persistState();
  });

  // Inicializar
  updatePreview();
  setInputsEnabled(isSheetComplete());

  // Exponer actualizador para cambios globales (placa)
  row._updatePreview = updatePreview;
  row._setInputsEnabled = setInputsEnabled;
  row._getRotation = () => !!iRot.checked;
  row._applyAutoRotateForced = (forced) => {
    const autoForced = !!forced;
    const shouldDisable = autoForced || !row._inputsEnabled;
    iRot.disabled = shouldDisable;
    if (autoForced) {
      iRot.checked = false;
    } else if (!shouldDisable) {
      iRot.checked = !!row._manualRotWanted;
    }
    rotWrap.classList.toggle('rot-disabled', shouldDisable);
  };
  row._syncEdgesFromTier = (emit = false) => { syncEdgesFromTierInputs({ emitChange: emit }); };
  row._syncTierFromEdges = () => { updateTierInputsFromEdges(); updatePreview(); };
  const autoEnabledNow = !!(autoRotateToggle && autoRotateToggle.checked);
  row._applyAutoRotateForced(autoEnabledNow);
  return row;
}

function currentRowCount() {
  return rowsEl.querySelectorAll('.row').length;
}

function reindexRows() {
  getRows().forEach((r, i) => {
    r.dataset.rowIdx = String(i);
    const dot = r.querySelector('.color-dot');
    if (dot) dot.style.background = getRowColor(i);
    const idx = r.querySelector('.idx');
    if (idx) idx.textContent = String(i + 1);
  });
}

addRowBtn.addEventListener('click', () => {
  if (addRowBtn.disabled) return;
  rowsEl.appendChild(makeRow(currentRowCount()));
  applyPlatesGate();
});

clearAllBtn.addEventListener('click', () => {
  rowsEl.innerHTML = '';
  applyPlatesGate();
});

// Crear filas iniciales si no hay (cuando no hay proyecto guardado)
function ensureDefaultRows() {
  if (currentRowCount() === 0) {
    for (let i = 0; i < 5; i++) rowsEl.appendChild(makeRow(i));
    toggleAddButton();
  }
}

// Asegurar que la rotación automática esté habilitada por defecto
if (autoRotateToggle) autoRotateToggle.checked = true;

// Actualizar todas las filas cuando cambian las placas
function refreshAllPreviews() {
  getRows().forEach(r => r._updatePreview && r._updatePreview());
}

function makePlateRow() {
  const row = document.createElement('div');
  row.className = 'plate-row';

  const fW = document.createElement('div'); fW.className = 'field';
  const lW = document.createElement('label'); lW.textContent = 'Ancho (mm)';
  const iW = document.createElement('input'); iW.className = 'plate-w'; iW.type = 'number'; iW.min = '0'; iW.step = '1'; iW.placeholder = 'Ej: 2440';
  fW.appendChild(lW); fW.appendChild(iW);

  const fH = document.createElement('div'); fH.className = 'field';
  const lH = document.createElement('label'); lH.textContent = 'Alto (mm)';
  const iH = document.createElement('input'); iH.className = 'plate-h'; iH.type = 'number'; iH.min = '0'; iH.step = '1'; iH.placeholder = 'Ej: 1220';
  fH.appendChild(lH); fH.appendChild(iH);

  const fC = document.createElement('div'); fC.className = 'field';
  const lC = document.createElement('label'); lC.textContent = 'Cantidad';
  const iC = document.createElement('input'); iC.className = 'plate-c'; iC.type = 'number'; iC.min = '1'; iC.step = '1'; iC.value = '1';
  fC.appendChild(lC); fC.appendChild(iC);

  const trim = document.createElement('div');
  trim.className = 'trim-wrap';
  const trimControls = document.createElement('div');
  trimControls.className = 'trim-controls';
  const trimLabel = document.createElement('div'); trimLabel.className = 'trim-label'; trimLabel.innerHTML = 'Refilado <span class="trim-badge">naranja</span> (mm) + lados';
  const trimMm = document.createElement('input'); trimMm.className = 'trim-mm'; trimMm.type = 'number'; trimMm.min = '0'; trimMm.step = '1'; trimMm.value = '0'; trimMm.title = 'Refilado en milímetros';
  const sideTop = document.createElement('label'); sideTop.className = 'side'; const cTop = document.createElement('input'); cTop.type = 'checkbox'; sideTop.appendChild(cTop); sideTop.appendChild(document.createTextNode('Arriba'));
  const sideRight = document.createElement('label'); sideRight.className = 'side'; const cRight = document.createElement('input'); cRight.type = 'checkbox'; sideRight.appendChild(cRight); sideRight.appendChild(document.createTextNode('Derecha'));
  const sideBottom = document.createElement('label'); sideBottom.className = 'side'; const cBottom = document.createElement('input'); cBottom.type = 'checkbox'; sideBottom.appendChild(cBottom); sideBottom.appendChild(document.createTextNode('Abajo'));
  const sideLeft = document.createElement('label'); sideLeft.className = 'side'; const cLeft = document.createElement('input'); cLeft.type = 'checkbox'; sideLeft.appendChild(cLeft); sideLeft.appendChild(document.createTextNode('Izquierda'));
  trimControls.appendChild(trimLabel);
  trimControls.appendChild(trimMm);
  trimControls.appendChild(sideTop);
  trimControls.appendChild(sideRight);
  trimControls.appendChild(sideBottom);
  trimControls.appendChild(sideLeft);
  trim.appendChild(trimControls);

  const del = document.createElement('button'); del.className = 'btn remove'; del.textContent = 'Eliminar';
  del.addEventListener('click', () => { row.remove(); applyPlatesGate(); });

  const onChange = () => { applyPlatesGate(); };
  iW.addEventListener('input', onChange); iH.addEventListener('input', onChange); iC.addEventListener('input', onChange);
  trimMm.addEventListener('input', onChange);
  [cTop, cRight, cBottom, cLeft].forEach(ch => ch.addEventListener('change', onChange));

  row.appendChild(fW); row.appendChild(fH); row.appendChild(fC); row.appendChild(del);
  row.appendChild(trim);
  return row;
}

function applyPlatesGate() {
  const enabled = isSheetComplete();
  const autoEnabled = !!(autoRotateToggle && autoRotateToggle.checked);
  getRows().forEach((r) => {
    if (r._setInputsEnabled) r._setInputsEnabled(enabled);
    if (r._applyAutoRotateForced) r._applyAutoRotateForced(autoEnabled);
  });
  toggleAddButton();
  recalcEdgebanding();
  refreshAllPreviews();
  renderSheetOverview();
  persistState && persistState();
}

if (platesEl && addPlateBtn) {
  addPlateBtn.addEventListener('click', () => { platesEl.appendChild(makePlateRow()); applyPlatesGate(); });
  // Intentar cargar desde localStorage; si no hay, crear por defecto
  let loadedFromLS = false;
  try {
    loadedFromLS = tryLoadFromLocalStorage();
  } catch (_) { loadedFromLS = false; }
  if (!loadedFromLS) {
    platesEl.appendChild(makePlateRow());
    applyPlatesGate();
    ensureDefaultRows();
  }
}
if (kerfInput) kerfInput.addEventListener('input', () => { applyPlatesGate(); });

refreshMaterialOptions();
refreshEdgeCatalog();
window.addEventListener('focus', () => {
  refreshMaterialOptions();
  refreshEdgeCatalog();
});
window.addEventListener('storage', (event) => {
  if (event.key === STOCK_STORAGE_KEY) refreshMaterialOptions();
  if (event.key === EDGE_STORAGE_KEY) refreshEdgeCatalog();
});

// -------- Persistencia (Guardar/Cargar) --------
function serializeState() {
  const plates = getPlates();
  const rows = getRows().map((row) => {
    const [qtyInput, widthInput, heightInput] = getRowCoreInputs(row);
    const qty = parseFloat(qtyInput?.value) || 0;
    const w = parseFloat(widthInput?.value) || 0;
    const h = parseFloat(heightInput?.value) || 0;
    const widthTier = parseInt(row.querySelector('input[data-role="width-tier"]')?.value ?? '', 10);
    const heightTier = parseInt(row.querySelector('input[data-role="height-tier"]')?.value ?? '', 10);
    const widthEdgeSelect = row.querySelector('select[data-role="width-edge"]');
    const heightEdgeSelect = row.querySelector('select[data-role="height-edge"]');
    const rotEl = row.querySelector('.rot-label input');
    const manualRot = row._manualRotWanted;
    const rot = typeof manualRot === 'boolean' ? manualRot : !!(rotEl && rotEl.checked);
    const edges = Array.from(row.querySelectorAll('line.edge')).map(e => e.dataset.selected === '1');
    return {
      qty,
      w,
      h,
      rot,
      edges,
      widthTier: Number.isFinite(widthTier) ? clamp(widthTier, 0, 2) : null,
      heightTier: Number.isFinite(heightTier) ? clamp(heightTier, 0, 2) : null,
      widthEdge: widthEdgeSelect && widthEdgeSelect.value ? widthEdgeSelect.value : null,
      heightEdge: heightEdgeSelect && heightEdgeSelect.value ? heightEdgeSelect.value : null
    };
  });
  const name = (projectNameEl?.value || '').trim();
  const kerfMm = parseInt(kerfInput?.value ?? '0', 10) || 0;
  const autoRotate = !!(autoRotateToggle && autoRotateToggle.checked);
  const material = currentMaterialName || DEFAULT_MATERIAL;
  return { name, plates, rows, kerfMm, autoRotate, material };
}

function persistState() {
  try {
    const state = serializeState();
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (_) {}
}

function download(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerBlobDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  download(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function saveJSON() {
  const state = serializeState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const name = (projectNameEl?.value || '').trim();
  const fname = name ? `proyecto-${name.replace(/\s+/g,'_')}.json` : 'proyecto-cortes.json';
  download(fname, url);
  URL.revokeObjectURL(url);
}

function cloneSvgForExport(svgEl) {
  const clone = svgEl.cloneNode(true);

  const adjustHeightLabel = (label) => {
    const rawX = parseFloat(label.getAttribute('x') || '0');
    if (Number.isFinite(rawX)) label.setAttribute('x', String(rawX - 10));
    label.setAttribute('fill', '#111827');
    label.setAttribute('text-anchor', 'end');
  };

  clone.querySelectorAll('[data-label="height"]').forEach(adjustHeightLabel);
  clone.querySelectorAll('[data-label="width"]').forEach(label => {
    label.setAttribute('fill', '#111827');
    label.setAttribute('text-anchor', 'middle');
  });

  clone.querySelectorAll('.piece-label').forEach(label => {
    label.removeAttribute('stroke');
  });

  clone.querySelectorAll('.piece-rect').forEach(rect => {
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#111827');
    rect.setAttribute('stroke-width', '1');
  });

  clone.querySelectorAll('.piece-inner').forEach(rect => rect.remove());
  clone.querySelectorAll('.trim-band').forEach(rect => rect.remove());

  const sheetOutline = clone.querySelector('.sheet-outline');
  if (sheetOutline) {
    sheetOutline.setAttribute('fill', 'none');
    sheetOutline.setAttribute('stroke', '#111827');
    sheetOutline.setAttribute('stroke-width', '1');
  }

  clone.querySelectorAll('line').forEach(line => {
    if (line.classList.contains('edge-band-line')) {
      line.setAttribute('stroke', '#6b7280');
      line.setAttribute('stroke-width', '1.2');
    } else {
      line.setAttribute('stroke', '#111827');
    }
  });

  clone.querySelectorAll('.piece-rot').forEach(label => {
    label.setAttribute('fill', '#111827');
  });

  clone.querySelectorAll('text').forEach(label => {
    label.setAttribute('fill', '#111827');
  });

  clone.querySelectorAll('.dims-badge').forEach(rect => {
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', 'none');
  });

  clone.querySelectorAll('pattern path').forEach(path => {
    path.setAttribute('stroke', '#11182733');
  });

  return clone;
}

function svgDataUrlForExport(svgEl) {
  const clone = cloneSvgForExport(svgEl);
  const xml = new XMLSerializer().serializeToString(clone);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}

function clearAllRows() {
  rowsEl.innerHTML = '';
}

function clearAllPlates() {
  if (platesEl) platesEl.innerHTML = '';
}

function loadState(state) {
  clearAllPlates();
  if (projectNameEl && typeof state.name === 'string') projectNameEl.value = state.name;
  if (kerfInput && typeof state.kerfMm === 'number') kerfInput.value = String(state.kerfMm);
  if (autoRotateToggle) autoRotateToggle.checked = state.autoRotate !== false;
  if (plateMaterialSelect) {
    if (typeof state.material === 'string' && state.material.trim()) {
      const materialValue = state.material.trim();
      let option = Array.from(plateMaterialSelect.options).find(opt => opt.value === materialValue);
      if (!option) {
        option = document.createElement('option');
        option.value = materialValue;
        option.textContent = materialValue;
        plateMaterialSelect.appendChild(option);
      }
      plateMaterialSelect.value = materialValue;
      currentMaterialName = materialValue;
    } else {
      plateMaterialSelect.selectedIndex = 0;
      currentMaterialName = plateMaterialSelect.value || DEFAULT_MATERIAL;
    }
  } else {
    currentMaterialName = state.material && typeof state.material === 'string'
      ? state.material
      : currentMaterialName;
  }
  // Cargar placas
  if (platesEl && Array.isArray(state.plates)) {
    state.plates.forEach(p => {
      const r = makePlateRow();
      r.querySelector('input.plate-w').value = String(p.sw || '');
      r.querySelector('input.plate-h').value = String(p.sh || '');
      r.querySelector('input.plate-c').value = String(p.sc || 1);
      if (p.trim) {
        const tmm = r.querySelector('input.trim-mm');
        if (tmm) tmm.value = String(p.trim.mm || 0);
        const sides = r.querySelectorAll('.trim-controls .side input');
        if (sides[0]) sides[0].checked = !!p.trim.top;
        if (sides[1]) sides[1].checked = !!p.trim.right;
        if (sides[2]) sides[2].checked = !!p.trim.bottom;
        if (sides[3]) sides[3].checked = !!p.trim.left;
      }
      platesEl.appendChild(r);
    });
  }

  // Cargar filas de cortes
  clearAllRows();
  if (Array.isArray(state.rows)) {
    state.rows.forEach((it, idx) => {
      const r = makeRow(idx);
      const [qtyInput, widthInput, heightInput] = getRowCoreInputs(r);
      if (qtyInput) qtyInput.value = it.qty != null ? String(it.qty) : '';
      if (widthInput) widthInput.value = it.w != null ? String(it.w) : '';
      if (heightInput) heightInput.value = it.h != null ? String(it.h) : '';
      const widthTierInput = r.querySelector('input[data-role="width-tier"]');
      const heightTierInput = r.querySelector('input[data-role="height-tier"]');
      const widthEdgeSelect = r.querySelector('select[data-role="width-edge"]');
      const heightEdgeSelect = r.querySelector('select[data-role="height-edge"]');
      if (widthTierInput) {
        const wVal = clamp(parseInt(it.widthTier ?? '', 10) || 0, 0, 2);
        widthTierInput.value = it.widthTier == null ? '' : String(wVal);
      }
      if (heightTierInput) {
        const hVal = clamp(parseInt(it.heightTier ?? '', 10) || 0, 0, 2);
        heightTierInput.value = it.heightTier == null ? '' : String(hVal);
      }
      if (widthEdgeSelect) {
        populateEdgeSelectOptions(widthEdgeSelect, typeof it.widthEdge === 'string' ? it.widthEdge : '');
      }
      if (heightEdgeSelect) {
        populateEdgeSelectOptions(heightEdgeSelect, typeof it.heightEdge === 'string' ? it.heightEdge : '');
      }
      if (r._updateEdgeSelectState) r._updateEdgeSelectState();
      const rotEl = r.querySelector('.rot-label input');
      if (rotEl) rotEl.checked = !!it.rot;
      if (typeof it.rot === 'boolean') {
        r._manualRotWanted = !!it.rot;
      } else if (rotEl) {
        r._manualRotWanted = !!rotEl.checked;
      }
      const edges = r.querySelectorAll('line.edge');
      if (Array.isArray(it.edges)) {
        edges.forEach((e, i) => {
          const sel = !!it.edges[i];
          e.dataset.selected = sel ? '1' : '0';
          e.classList.toggle('selected', sel);
        });
      } else if (r._syncEdgesFromTier) {
        r._syncEdgesFromTier(false);
      }
      if (r._syncTierFromEdges) r._syncTierFromEdges();
      rowsEl.appendChild(r);
    });
  }

  applyPlatesGate();
  persistState();
}

function loadJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        loadState(data);
      } catch (e) {
        alert('JSON inválido');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

if (saveJsonBtn) saveJsonBtn.addEventListener('click', saveJSON);
if (loadJsonBtn) loadJsonBtn.addEventListener('click', loadJSON);
if (autoRotateToggle) {
  autoRotateToggle.addEventListener('change', () => {
    applyPlatesGate();
  });
}
if (plateMaterialSelect) {
  plateMaterialSelect.addEventListener('change', () => {
    currentMaterialName = plateMaterialSelect.value || DEFAULT_MATERIAL;
    try { localStorage.setItem(LAST_MATERIAL_KEY, currentMaterialName); } catch (_) {}
    applyPlatesGate();
  });
}
if (manageStockBtn) {
  manageStockBtn.addEventListener('click', () => {
    window.open('stock.html', '_blank');
  });
}
if (projectNameEl) projectNameEl.addEventListener('input', () => { persistState(); });

// -------- Exportar PNG/PDF --------
async function buildExportCanvasForPdf() {
  const svgs = document.querySelectorAll('#sheetCanvas svg');
  if (!svgs.length) {
    alert('No hay placas para exportar');
    return null;
  }
  const margin = 20;
  const targetW = 1200;
  const images = await Promise.all(Array.from(svgs).map(svg => new Promise((resolve) => {
    const svg64 = svgDataUrlForExport(svg);
    const img = new Image();
    img.onload = () => resolve({ img, w: img.width, h: img.height });
    img.src = svg64;
  })));
  const scaled = images.map(({ img, w, h }) => ({ img, w: targetW, h: Math.round(h * (targetW / w)) }));

  const summaryTexts = [];
  const addSummary = (text) => {
    const trimmed = (text || '').trim();
    if (trimmed) summaryTexts.push(trimmed);
  };
  addSummary(currentMaterialName ? `Material: ${currentMaterialName}` : '');
  addSummary(summaryPiecesEl?.textContent);
  addSummary(summaryReqEl?.textContent);
  addSummary(summaryPlacedEl?.textContent);
  addSummary(summaryLeftEl?.textContent);
  addSummary(summaryAreaEl?.textContent);
  addSummary(summaryWasteEl?.textContent);
  addSummary(summaryUtilEl?.textContent);
  addSummary(summaryTotalEl?.textContent);

  const rowSummaries = Array.from(summaryListEl?.querySelectorAll('li span:last-child') || [])
    .map((span) => span.textContent?.trim())
    .filter(Boolean);

  const summaryLineHeight = 20;
  const headingHeight = 20;
  const columnGap = 40;
  const contentGap = 6;
  const summaryStartY = margin + 44;
  const leftBottom = summaryTexts.length
    ? summaryStartY + headingHeight + contentGap + summaryTexts.length * summaryLineHeight
    : summaryStartY + headingHeight;
  const rightBottom = rowSummaries.length
    ? summaryStartY + headingHeight + contentGap + rowSummaries.length * summaryLineHeight
    : summaryStartY + headingHeight;
  const summaryBlockBottom = Math.max(leftBottom, rightBottom);
  const headerH = Math.max(120, summaryBlockBottom + margin);

  const totalH = headerH + margin + scaled.reduce((acc, s) => acc + s.h + margin, 0);
  const canvas = document.createElement('canvas');
  canvas.width = targetW + margin * 2;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 20px system-ui';
  const projectName = (projectNameEl?.value || '').trim();
  const title = projectName || 'Plano de cortes';
  ctx.fillText(title, margin, 34);

  const columnWidth = (targetW - margin * 2 - columnGap) / 2;
  const leftX = margin;
  const rightX = margin + columnWidth + columnGap;
  const headingYOffset = summaryStartY;
  const bodyStartY = headingYOffset + headingHeight + contentGap;

  ctx.font = 'bold 16px system-ui';
  ctx.fillText('Resumen', leftX, headingYOffset);
  ctx.fillText('Filas', rightX, headingYOffset);

  ctx.font = '16px system-ui';
  summaryTexts.forEach((line, idx) => {
    ctx.fillText(line, leftX, bodyStartY + idx * summaryLineHeight);
  });
  rowSummaries.forEach((line, idx) => {
    ctx.fillText(line, rightX, bodyStartY + idx * summaryLineHeight);
  });
  let y = headerH;
  scaled.forEach(({ img, w, h }, idx) => {
    ctx.fillStyle = '#111827';
    ctx.font = '14px system-ui';
    ctx.fillText(`Placa ${idx + 1}`, margin, y - 6);
    ctx.drawImage(img, margin, y, w, h);
    y += h + margin;
  });

  return { canvas, title, projectName };
}

async function exportPNG() {
  // Tomar todos los SVG de la sección de placas y construir una imagen vertical
  const svgs = Array.from(document.querySelectorAll('#sheetCanvas svg'));
  if (!svgs.length) { alert('No hay placas para exportar'); return; }
  const margin = 20;
  const targetW = 1200; // px
  // Calcular alturas escaladas
  const images = await Promise.all(svgs.map(svg => new Promise((resolve) => {
    const svg64 = svgDataUrlForExport(svg);
    const img = new Image();
    img.onload = () => resolve({ img, w: img.width, h: img.height });
    img.src = svg64;
  })));
  const scaled = images.map(({ img, w, h }) => ({ img, w: targetW, h: Math.round(h * (targetW / w)) }));
  const headerH = 120;
  const totalH = headerH + margin + scaled.reduce((acc, s) => acc + s.h + margin, 0);
  const canvas = document.createElement('canvas');
  canvas.width = targetW + margin * 2;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0f1c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Dibujar encabezado con resumen
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 20px system-ui';
  const title = (projectNameEl?.value || '').trim() || 'Plano de cortes';
  ctx.fillText(title, margin, 34);
  const sMaterial = currentMaterialName ? `Material: ${currentMaterialName}` : '';
  const sPieces = (summaryPiecesEl?.textContent || '').trim();
  const sArea = (summaryAreaEl?.textContent || '').trim();
  const sUtil = (summaryUtilEl?.textContent || '').trim();
  const sWaste = (summaryWasteEl?.textContent || '').trim();
  ctx.font = '16px system-ui';
  if (sMaterial) ctx.fillText(sMaterial, margin, 52);
  ctx.fillText(sPieces, margin, 64);
  ctx.fillText(sArea, margin, 88);
  ctx.fillText(sUtil, targetW - 360, 64);
  ctx.fillText(sWaste, targetW - 360, 88);
  // Placas
  let y = headerH;
  scaled.forEach(({ img, w, h }, idx) => {
    ctx.fillStyle = '#93c5fd';
    ctx.font = '14px system-ui';
    ctx.fillText(`Placa ${idx + 1}`, margin, y - 6);
    ctx.drawImage(img, margin, y, w, h);
    y += h + margin;
  });
  const dataUrl = canvas.toDataURL('image/png');
  const name = (projectNameEl?.value || '').trim();
  const fname = name ? `plano-${name.replace(/\s+/g,'_')}.png` : 'plano-cortes.png';
  download(fname, dataUrl);
}

async function exportPDF() {
  const result = await buildExportCanvasForPdf();
  if (!result) return;
  const { canvas, projectName } = result;
  const dataUrl = canvas.toDataURL('image/png');
  const win = window.open('', '_blank');
  if (!win) {
    const name = (projectName || 'cortes').trim();
    download(name ? `plano-${name.replace(/\s+/g, '_')}.png` : 'plano-cortes.png', dataUrl);
    return;
  }
  win.document.write(`<html><head><title>Plano de cortes</title><style>body{margin:0} img{width:100%;}</style></head><body><img src="${dataUrl}" onload="setTimeout(()=>window.print(), 250)" /></body></html>`);
  win.document.close();
}

function canvasToPdfBlob(canvas) {
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.94);
  const base64 = jpegDataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pdfBytes = buildPdfFromJpeg(bytes, canvas.width, canvas.height);
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

function buildPdfFromJpeg(jpegBytes, widthPx, heightPx) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0];
  let position = 0;

  const push = (data) => {
    parts.push(data);
    position += data.length;
  };

  const pushString = (str) => {
    push(encoder.encode(str));
  };

  pushString('%PDF-1.3\n');

  offsets[1] = position;
  pushString('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');

  offsets[2] = position;
  pushString('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n');

  const widthPt = Math.round(widthPx * 72 / 96);
  const heightPt = Math.round(heightPx * 72 / 96);

  offsets[3] = position;
  pushString(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >> endobj\n`);

  offsets[4] = position;
  pushString(`4 0 obj << /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >> stream\n`);
  push(jpegBytes);
  pushString('\nendstream\nendobj\n');

  const contentStream = `q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ\n`;
  const contentBytes = encoder.encode(contentStream);

  offsets[5] = position;
  pushString(`5 0 obj << /Length ${contentBytes.length} >> stream\n`);
  push(contentBytes);
  pushString('endstream\nendobj\n');

  const xrefOffset = position;
  pushString('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) {
    const offset = offsets[i] ?? 0;
    pushString(`${offset.toString().padStart(10, '0')} 00000 n \n`);
  }
  pushString(`trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return concatUint8Arrays(parts);
}

function concatUint8Arrays(arrays) {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  arrays.forEach((arr) => {
    result.set(arr, offset);
    offset += arr.length;
  });
  return result;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      } else {
        reject(new Error('No se pudo leer el archivo adjunto.'));
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo adjunto.'));
    reader.readAsDataURL(blob);
  });
}

function chunkString(str, size = 76) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.substring(i, i + size));
  }
  return chunks.join('\r\n');
}

function toBase64UrlFromUint8(uint8) {
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeMimeWord(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8.length; i++) {
    binary += String.fromCharCode(utf8[i]);
  }
  const base64 = btoa(binary);
  return `=?UTF-8?B?${base64}?=`;
}

async function sendEmailWithAttachment({ token, to, subject, text, filename, blob }) {
  if (!token) throw new Error('Falta el token de acceso para enviar el correo.');
  const pdfBase64 = await blobToBase64(blob);
  const boundary = `mixed_${Math.random().toString(36).slice(2)}`;
  const mimeParts = [
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    `to: ${to}`,
    `subject: ${encodeMimeWord(subject)}`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    chunkString(pdfBase64),
    `--${boundary}--`,
    ''
  ];
  const message = mimeParts.join('\r\n');
  const messageBytes = new TextEncoder().encode(message);
  const raw = toBase64UrlFromUint8(messageBytes);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });
  if (!response.ok) {
    let details = '';
    try {
      const errorBody = await response.json();
      details = errorBody?.error?.message ? `: ${errorBody.error.message}` : '';
    } catch (_) {}
    throw new Error(`Google respondió ${response.status}${details}`);
  }
  return response.json();
}

async function handleSendCuts() {
  if (!sendCutsBtn) return;
  if (sendCutsBtn.disabled) return;
  const projectName = (projectNameEl?.value || '').trim();
  if (!projectName) {
    alert('Ingresá un nombre de proyecto antes de enviar.');
    projectNameEl?.focus();
    return;
  }
  if (!authUser) {
    alert('Iniciá sesión antes de enviar los cortes.');
    return;
  }
  if (!authUser.accessToken) {
    alert('No se encontró el token de Google para enviar el correo. Cerrá sesión e ingresá nuevamente.');
    return;
  }
  sendCutsBtn.disabled = true;
  sendCutsBtn.textContent = 'Enviando…';
  try {
    const result = await buildExportCanvasForPdf();
    if (!result) return;
    const { canvas, projectName: rawName, title } = result;
    const pdfBlob = canvasToPdfBlob(canvas);
    const baseName = (rawName || 'cortes').trim() || 'cortes';
    const slug = baseName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'cortes';
    const filename = `cortes-${slug}.pdf`;
    triggerBlobDownload(filename, pdfBlob);
    const subjectName = rawName || title || 'Plano de cortes';
    const bodyText = `Se adjunta el plano de cortes "${subjectName}" generado desde la aplicación.`;
    await sendEmailWithAttachment({
      token: authUser.accessToken,
      to: 'marcossuhit@gmail.com',
      subject: `Plano de cortes - ${subjectName}`,
      text: bodyText,
      filename,
      blob: pdfBlob
    });
    alert(`Se envió ${filename} a marcossuhit@gmail.com.`);
  } catch (err) {
    console.error(err);
    alert(`No se pudo enviar el correo: ${err?.message || err}`);
  } finally {
    sendCutsBtn.disabled = false;
    sendCutsBtn.textContent = sendCutsDefaultLabel;
  }
}

if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportPDF);
if (sendCutsBtn) {
  sendCutsBtn.addEventListener('click', () => {
    handleSendCuts();
  });
}
if (resetAllBtn) {
  resetAllBtn.addEventListener('click', () => {
    clearAllPlates();
    clearAllRows();
    if (projectNameEl) projectNameEl.value = '';
    if (kerfInput) kerfInput.value = '0';
    if (autoRotateToggle) autoRotateToggle.checked = true;
    if (plateMaterialSelect) {
      plateMaterialSelect.selectedIndex = 0;
      currentMaterialName = plateMaterialSelect.value || DEFAULT_MATERIAL;
    } else {
      currentMaterialName = DEFAULT_MATERIAL;
    }
    applyPlatesGate();
    ensureDefaultRows();
    resetSummaryUI();
  });
}

// Cálculo de Cantidad de cubre canto (suma de lados seleccionados)
function recalcEdgebanding() {
  const rows = getRows();
  let totalMeters = 0;
  let totalCost = 0;
  const items = [];
  const edgeTotals = new Map();
  const showCosts = !!isBackofficeAllowed;
  const priceMap = new Map(edgeCatalog.map((item) => [item.name.toLocaleLowerCase(), Number.isFinite(item.pricePerMeter) ? item.pricePerMeter : 0]));
  lastEdgebandByRow = new Map();

  const addEdgeUsage = (edgeName, mm) => {
    if (!(mm > 0)) return;
    const name = (edgeName || '').trim();
    if (!name) return;
    const key = name.toLocaleLowerCase();
    const entry = edgeTotals.get(key) || { name, mm: 0 };
    entry.mm += mm;
    edgeTotals.set(key, entry);
  };

  rows.forEach((row, idx) => {
    const [qtyInput, widthInput, heightInput] = getRowCoreInputs(row);
    if (!qtyInput || !widthInput || !heightInput) return;
    const qty = parseFloat(qtyInput.value);
    const w = parseFloat(widthInput.value);
    const h = parseFloat(heightInput.value);
    if (!(qty >= 1 && w > 0 && h > 0)) return;

    const counts = row._computeEdgeCounts
      ? row._computeEdgeCounts()
      : (() => {
          const edges = row.querySelectorAll('line.edge');
          const edgeArr = Array.from(edges);
          const topSelected = edgeArr[0]?.dataset.selected === '1';
          const rightSelected = edgeArr[1]?.dataset.selected === '1';
          const bottomSelected = edgeArr[2]?.dataset.selected === '1';
          const leftSelected = edgeArr[3]?.dataset.selected === '1';
          const previewVertical = (leftSelected ? 1 : 0) + (rightSelected ? 1 : 0);
          const previewHorizontal = (topSelected ? 1 : 0) + (bottomSelected ? 1 : 0);
          const parseTier = (input) => {
            if (!input) return 0;
            const val = parseInt(input.value, 10);
            if (!Number.isFinite(val)) return 0;
            return clamp(val, 0, 2);
          };
          const widthTierVal = parseTier(row.querySelector('input[data-role="width-tier"]'));
          const heightTierVal = parseTier(row.querySelector('input[data-role="height-tier"]'));
          return {
            previewVertical,
            previewHorizontal,
            verticalCount: Math.max(previewVertical, widthTierVal),
            horizontalCount: Math.max(previewHorizontal, heightTierVal),
            widthTierVal,
            heightTierVal
          };
        })();
    const rot = row._getRotation ? row._getRotation() : false;
    const effW = rot ? h : w;
    const effH = rot ? w : h;
    const widthTierVal = Number.isFinite(counts?.widthTierVal) ? counts.widthTierVal : 0;
    const heightTierVal = Number.isFinite(counts?.heightTierVal) ? counts.heightTierVal : 0;
    const horizontalMm = widthTierVal * effW * qty;
    const verticalMm = heightTierVal * effH * qty;
    const subtotal = horizontalMm + verticalMm;
    if (subtotal > 0) {
      items.push({ idx: idx + 1, subtotal, color: getRowColor(idx) });
      lastEdgebandByRow.set(idx, subtotal);
      const widthEdgeSelect = row._edgeSelects?.width || row.querySelector('select[data-role="width-edge"]');
      const heightEdgeSelect = row._edgeSelects?.height || row.querySelector('select[data-role="height-edge"]');
      const widthEdgeName = widthEdgeSelect?.value || '';
      const heightEdgeName = heightEdgeSelect?.value || '';
      addEdgeUsage(widthEdgeName, horizontalMm);
      addEdgeUsage(heightEdgeName, verticalMm);
    }
  });

  const fmt = (n, decimals = 2) => formatNumber(Number(n) || 0, decimals);
  if (summaryTotalEl) {
    const lines = [];
    const summaryEntries = Array.from(edgeTotals.values()).sort((a, b) => b.mm - a.mm);
    summaryEntries.forEach((entry) => {
      const meters = entry.mm / 1000;
      const normalized = entry.name ? entry.name.toLocaleLowerCase() : '';
      const hasCatalogPrice = normalized ? priceMap.has(normalized) : false;
      const price = hasCatalogPrice ? (priceMap.get(normalized) || 0) : 0;
      const cost = meters * price;
      const label = entry.name && !hasCatalogPrice ? `${entry.name} (no catalogado)` : entry.name;
      totalMeters += meters;
      if (showCosts) totalCost += cost;
      lines.push({ label, meters, cost: showCosts ? cost : null });
    });
    if (lines.length) {
      summaryTotalEl.textContent = '';
      const totalLine = document.createElement('div');
      totalLine.textContent = showCosts
        ? `Cubre canto total: ${fmt(totalMeters, 3)} m — $${fmt(totalCost, 2)}`
        : `Cubre canto total: ${fmt(totalMeters, 3)} m`;
      summaryTotalEl.appendChild(totalLine);
      lines.forEach(({ label, meters, cost }) => {
        const lineDiv = document.createElement('div');
        const costText = showCosts && Number.isFinite(cost) ? ` — $${fmt(cost, 2)}` : '';
        lineDiv.textContent = `${label}: ${fmt(meters, 3)} m${costText}`;
        summaryTotalEl.appendChild(lineDiv);
      });
    } else {
      summaryTotalEl.textContent = '';
    }
  }
  // Actualizar lista combinada (con datos de colocación)
  updateRowSummaryUI();
}

// Render de la placa completa al pie
function renderSheetOverview() {
  if (!sheetCanvasEl) return;
  sheetCanvasEl.innerHTML = '';
  const solution = solveCutLayoutInternal();
  if (!solution) {
    captureFeasibleState();
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Configure la placa para ver la vista';
    sheetCanvasEl.appendChild(hint);
    resetSummaryUI();
    return;
  }

  if (Array.isArray(solution.leftoverPieces) && solution.leftoverPieces.length) {
    scheduleAutoPlateCheck();
  } else {
    captureFeasibleState();
  }

  const {
    instances,
    placementsByPlate,
    placements: allPlaced,
    totalRequested,
    usedArea,
    totalArea,
    leftoverPieces = [],
    pieces: solvedPieces = []
  } = solution;
  const pieceMetaMap = new Map(Array.isArray(solvedPieces) ? solvedPieces.map((p) => [p.id, p]) : []);
  const rowElements = getRows();
  const svgNS = 'http://www.w3.org/2000/svg';
  const holder = document.createElement('div');
  holder.className = 'sheet-multi';

  instances.forEach((instance, plateIdx) => {
    const placed = placementsByPlate[plateIdx] || [];
    const trim = instance.trim || { mm: 0, top: false, right: false, bottom: false, left: false };
    const trimValue = Math.max(0, trim.mm || 0);
    const leftT = trim.left ? trimValue : 0;
    const rightT = trim.right ? trimValue : 0;
    const topT = trim.top ? trimValue : 0;
    const bottomT = trim.bottom ? trimValue : 0;

    const VIEW_W = 1000;
    const LABEL_EXTRA_H = 24;
    const PAD_X = 16;
    const PAD_BOTTOM = 16;
    const PAD_TOP = PAD_BOTTOM + LABEL_EXTRA_H;
    const innerW = VIEW_W - PAD_X * 2;
    const scale = instance.sw > 0 ? innerW / instance.sw : 0;
    const contentH = instance.sh * scale;
    const baseViewH = Math.round(contentH + PAD_TOP + PAD_BOTTOM);
    const noticeExtra = leftoverPieces.length ? 20 : 0;
    const VIEW_H = Math.max(1, baseViewH + noticeExtra);

  const wrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'plate-title';
  const caret = document.createElement('span');
  caret.className = 'caret';
  const isCollapsed = collapsedPlates.has(plateIdx);
  caret.textContent = isCollapsed ? '►' : '▼';
  const titleText = document.createElement('span');
  titleText.textContent = `Placa ${plateIdx + 1} de ${instances.length}` + (currentMaterialName ? ` · ${currentMaterialName}` : '');
    title.appendChild(caret);
    title.appendChild(titleText);
    wrap.appendChild(title);

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('class', 'sheet-outline');
    rect.setAttribute('x', String(PAD_X));
    rect.setAttribute('y', String(PAD_TOP));
    rect.setAttribute('width', String(innerW));
    rect.setAttribute('height', String(contentH));
    rect.setAttribute('rx', '6');
    svg.appendChild(rect);

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('class', 'sheet-dims');
    label.setAttribute('x', String(VIEW_W / 2));
    label.setAttribute('y', String(PAD_TOP - LABEL_EXTRA_H + 20));
    label.setAttribute('text-anchor', 'middle');
    label.textContent = `${formatNumber(instance.sw, 0)} × ${formatNumber(instance.sh, 0)} mm`;
    svg.appendChild(label);

    const ox = PAD_X;
    const oy = PAD_TOP;

    const defs = document.createElementNS(svgNS, 'defs');
    const pattern = document.createElementNS(svgNS, 'pattern');
    const patId = `hatch-${plateIdx}`;
    pattern.setAttribute('id', patId);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '10');
    pattern.setAttribute('height', '10');
    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', 'M0 10 L10 0');
    const isLightTheme = document.body.classList.contains('theme-light');
    line.setAttribute('stroke', isLightTheme ? '#64748b26' : '#94a3b822');
    line.setAttribute('stroke-width', '1');
    pattern.appendChild(line);
    defs.appendChild(pattern);
    svg.appendChild(defs);
    const occupied = [];

    const drawTrim = (x, y, w, h) => {
      if (w <= 0 || h <= 0) return;
      const r = document.createElementNS(svgNS, 'rect');
      r.setAttribute('class', 'trim-band');
      r.setAttribute('x', String(ox + x * scale));
      r.setAttribute('y', String(oy + y * scale));
      r.setAttribute('width', String(Math.max(1, w * scale)));
      r.setAttribute('height', String(Math.max(1, h * scale)));
      r.setAttribute('fill', '#f59e0b33');
      r.setAttribute('stroke', 'none');
      svg.appendChild(r);
    };

    const eps = 2.5 / Math.max(0.0001, scale);
    if (topT) { drawTrim(0, -eps, instance.sw, topT + eps); occupied.push({ x: 0, y: -eps, w: instance.sw, h: topT + eps }); }
    if (bottomT) { drawTrim(0, instance.sh - bottomT, instance.sw, bottomT + eps); occupied.push({ x: 0, y: instance.sh - bottomT, w: instance.sw, h: bottomT + eps }); }
    if (leftT) { drawTrim(-eps, 0, leftT + eps, instance.sh); occupied.push({ x: -eps, y: 0, w: leftT + eps, h: instance.sh }); }
    if (rightT) { drawTrim(instance.sw - rightT, 0, rightT + eps, instance.sh); occupied.push({ x: instance.sw - rightT, y: 0, w: rightT + eps, h: instance.sh }); }

    for (const r of placed) {
      const pxX = ox + r.x * scale;
      const pxY = oy + r.y * scale;
      const pxW = Math.max(1, r.w * scale);
      const pxH = Math.max(1, r.h * scale);
      const outer = document.createElementNS(svgNS, 'rect');
      outer.setAttribute('class', 'piece-rect');
      outer.setAttribute('x', String(pxX));
      outer.setAttribute('y', String(pxY));
      outer.setAttribute('width', String(pxW));
      outer.setAttribute('height', String(pxH));
      outer.setAttribute('rx', '3');
      outer.setAttribute('fill', '#ef444428');
      outer.setAttribute('stroke', r.color);
      outer.setAttribute('stroke-width', '1');
      svg.appendChild(outer);
      occupied.push({ x: r.x, y: r.y, w: r.w, h: r.h });

      const innerW = Math.max(1, r.rawW * scale);
      const innerH = Math.max(1, r.rawH * scale);
      const inner = document.createElementNS(svgNS, 'rect');
      inner.setAttribute('class', 'piece-inner');
      inner.setAttribute('x', String(pxX + (pxW - innerW) / 2));
      inner.setAttribute('y', String(pxY + (pxH - innerH) / 2));
      inner.setAttribute('width', String(innerW));
      inner.setAttribute('height', String(innerH));
      inner.setAttribute('rx', '2');
      inner.setAttribute('fill', r.color);
      inner.setAttribute('fill-opacity', '0.35');
      inner.setAttribute('stroke', r.color);
      inner.setAttribute('stroke-width', '1');
      svg.appendChild(inner);

      if (pxW >= 40 && pxH >= 28) {
        const fs = clamp(Math.min(pxW, pxH) * 0.16, 9, 15);

        const widthLabel = document.createElementNS(svgNS, 'text');
        widthLabel.setAttribute('class', 'piece-label');
        widthLabel.dataset.label = 'width';
        widthLabel.setAttribute('text-anchor', 'middle');
        widthLabel.setAttribute('dominant-baseline', 'alphabetic');
        widthLabel.setAttribute('x', String(pxX + pxW / 2));
        widthLabel.setAttribute('y', String(pxY + pxH - 21));
        widthLabel.setAttribute('font-size', String(fs));
        widthLabel.textContent = `${formatNumber(r.rawW, 0)}`;
        svg.appendChild(widthLabel);

        const heightLabel = document.createElementNS(svgNS, 'text');
        heightLabel.setAttribute('class', 'piece-label');
        heightLabel.dataset.label = 'height';
        heightLabel.setAttribute('text-anchor', 'end');
        heightLabel.setAttribute('x', String(pxX + pxW - 25));
        heightLabel.setAttribute('y', String(pxY + pxH / 2));
        heightLabel.setAttribute('font-size', String(fs));
        heightLabel.setAttribute('dominant-baseline', 'middle');
        heightLabel.textContent = `${formatNumber(r.rawH, 0)}`;
        svg.appendChild(heightLabel);
      }
      const rowEl = rowElements[r.rowIdx];
      let selection = { top: false, right: false, bottom: false, left: false };
      if (rowEl) {
        const edgeEls = rowEl.querySelectorAll('line.edge');
        if (edgeEls.length >= 4) {
          selection = {
            top: edgeEls[0].dataset.selected === '1',
            right: edgeEls[1].dataset.selected === '1',
            bottom: edgeEls[2].dataset.selected === '1',
            left: edgeEls[3].dataset.selected === '1'
          };
        }
      }
      const pieceMeta = pieceMetaMap.get(r.id);
      const baseRot = !!(pieceMeta && pieceMeta.rot);
      const finalRot = !!r.rot;
      if (pieceMeta && baseRot !== finalRot) {
        selection = {
          top: selection.left,
          right: selection.top,
          bottom: selection.right,
          left: selection.bottom
        };
      }

      const bandGroup = document.createElementNS(svgNS, 'g');
      bandGroup.setAttribute('class', 'edge-band-lines');
      const drawLine = (x1, y1, x2, y2) => {
        const lineEl = document.createElementNS(svgNS, 'line');
        lineEl.setAttribute('class', 'edge-band-line');
        lineEl.setAttribute('x1', String(x1));
        lineEl.setAttribute('y1', String(y1));
        lineEl.setAttribute('x2', String(x2));
        lineEl.setAttribute('y2', String(y2));
        lineEl.setAttribute('stroke', '#ffffff');
        lineEl.setAttribute('stroke-width', '1.2');
        lineEl.setAttribute('stroke-linecap', 'round');
        bandGroup.appendChild(lineEl);
      };
      const halfW = pxW / 2;
      const halfH = pxH / 2;
      if (selection.top && halfW > 4) {
        const len = halfW;
        const xStart = pxX + (pxW - len) / 2;
        const yPos = pxY + 8;
        drawLine(xStart, yPos, xStart + len, yPos);
      }
      if (selection.bottom && halfW > 4) {
        const len = halfW;
        const xStart = pxX + (pxW - len) / 2;
        const yPos = pxY + pxH - 8;
        drawLine(xStart, yPos, xStart + len, yPos);
      }
      if (selection.left && halfH > 4) {
        const len = halfH;
        const yStart = pxY + (pxH - len) / 2;
        const xPos = pxX + 8;
        drawLine(xPos, yStart, xPos, yStart + len);
      }
      if (selection.right && halfH > 4) {
        const len = halfH;
        const yStart = pxY + (pxH - len) / 2;
        const xPos = pxX + pxW - 8;
        drawLine(xPos, yStart, xPos, yStart + len);
      }
      if (bandGroup.childNodes.length) svg.appendChild(bandGroup);
      if (r.rot) {
        const t = document.createElementNS(svgNS, 'text');
        t.setAttribute('class', 'piece-rot');
        t.setAttribute('x', String(pxX + 4));
        t.setAttribute('y', String(pxY + 12));
        t.textContent = '90°';
        svg.appendChild(t);
      }
    }

    const mask = document.createElementNS(svgNS, 'mask');
    const maskId = `occ-mask-${plateIdx}`;
    mask.setAttribute('id', maskId);
    const baseWhite = document.createElementNS(svgNS, 'rect');
    baseWhite.setAttribute('x', String(ox));
    baseWhite.setAttribute('y', String(oy));
    baseWhite.setAttribute('width', String(instance.sw * scale));
    baseWhite.setAttribute('height', String(instance.sh * scale));
    baseWhite.setAttribute('fill', 'white');
    mask.appendChild(baseWhite);
    for (const o of occupied) {
      const rOcc = document.createElementNS(svgNS, 'rect');
      rOcc.setAttribute('x', String(ox + o.x * scale));
      rOcc.setAttribute('y', String(oy + o.y * scale));
      rOcc.setAttribute('width', String(Math.max(0, o.w * scale)));
      rOcc.setAttribute('height', String(Math.max(0, o.h * scale)));
      rOcc.setAttribute('fill', 'black');
      mask.appendChild(rOcc);
    }
    defs.appendChild(mask);
    const hatchRect = document.createElementNS(svgNS, 'rect');
    hatchRect.setAttribute('data-hatch', '1');
    hatchRect.setAttribute('x', String(ox));
    hatchRect.setAttribute('y', String(oy));
    hatchRect.setAttribute('width', String(instance.sw * scale));
    hatchRect.setAttribute('height', String(instance.sh * scale));
    hatchRect.setAttribute('fill', `url(#${patId})`);
    hatchRect.setAttribute('mask', `url(#${maskId})`);
    hatchRect.setAttribute('stroke', 'none');
    svg.insertBefore(hatchRect, label.nextSibling);

    if (plateIdx === instances.length - 1 && leftoverPieces.length) {
      const warn = document.createElementNS(svgNS, 'text');
      warn.setAttribute('class', 'sheet-dims');
      warn.setAttribute('x', String(PAD_X + 8));
      warn.setAttribute('y', String(baseViewH + 4));
      warn.textContent = `No entran ${leftoverPieces.length} pieza(s)`;
      svg.appendChild(warn);
    }

    wrap.appendChild(svg);
    if (isCollapsed) wrap.classList.add('plate-collapsed');

    title.addEventListener('click', () => {
      const nowCollapsed = wrap.classList.toggle('plate-collapsed');
      caret.textContent = nowCollapsed ? '►' : '▼';
      if (nowCollapsed) collapsedPlates.add(plateIdx); else collapsedPlates.delete(plateIdx);
    });
    holder.appendChild(wrap);
  });

  sheetCanvasEl.appendChild(holder);

  const piecesCount = allPlaced.length;
  const areaMm2 = usedArea;
  const wasteMm2 = Math.max(0, solution.wasteArea);
  const areaM2 = areaMm2 / 1e6;
  const fmt = (n, decimals = 2) => formatNumber(Number(n) || 0, decimals);
  const hasSummaryData = totalRequested > 0 || piecesCount > 0;
  if (!hasSummaryData) {
    resetSummaryUI();
    return;
  }
  if (summaryPiecesEl) summaryPiecesEl.textContent = `Piezas colocadas: ${piecesCount}`;
  if (summaryReqEl) summaryReqEl.textContent = `Cortes pedidos: ${totalRequested}`;
  if (summaryPlacedEl) summaryPlacedEl.textContent = `Colocados: ${piecesCount}`;
  if (summaryLeftEl) summaryLeftEl.textContent = `Fuera: ${Math.max(0, totalRequested - piecesCount)}`;
  if (summaryAreaEl) summaryAreaEl.textContent = `Área utilizada: ${fmt(areaM2, 2)} m²`;
  if (summaryUtilEl) {
    const plateM2 = totalArea / 1e6;
    const pct = plateM2 > 0 ? Math.min(100, Math.max(0, (areaM2 / plateM2) * 100)) : 0;
    summaryUtilEl.textContent = `Aprovechamiento: ${fmt(pct, 2)}%`;
    if (summaryWasteEl) {
      const wasteM2 = Math.max(0, wasteMm2 / 1e6);
      const wastePct = plateM2 > 0 ? Math.min(100, Math.max(0, 100 - pct)) : 0;
      summaryWasteEl.textContent = `Desperdicio: ${fmt(wasteM2, 2)} m² (${fmt(wastePct, 2)}%)`;
    }
  }

  lastPlacementByRow = new Map();
  const placedByRow = new Map();
  const requestedByRow = new Map();
  getRows().forEach((row, idx) => {
    const [qtyInput, widthInput, heightInput] = getRowCoreInputs(row);
    if (!qtyInput || !widthInput || !heightInput) return;
    const qty = parseInt(qtyInput.value, 10);
    const w = parseFloat(widthInput.value);
    const h = parseFloat(heightInput.value);
    if (!(qty >= 1 && w > 0 && h > 0)) return;
    requestedByRow.set(idx, qty);
  });
  allPlaced.forEach((p) => {
    placedByRow.set(p.rowIdx, (placedByRow.get(p.rowIdx) || 0) + 1);
  });
  const rows = getRows();
  for (let i = 0; i < rows.length; i++) {
    const req = requestedByRow.get(i) || 0;
    const plc = placedByRow.get(i) || 0;
    const left = Math.max(0, req - plc);
    lastPlacementByRow.set(i, { requested: req, placed: plc, left });
  }
  updateRowSummaryUI();
}


// Inicializar vista de placa al cargar
renderSheetOverview();

function tryLoadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return false;
    loadState(data);
    return true;
  } catch (_) {
    return false;
  }
}

// Registrar Service Worker para PWA (si el navegador lo soporta)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Botón de instalación PWA (Android/desktop)
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = 'inline-flex';
});
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(()=>{});
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });
}
window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.style.display = 'none';
});

// Tema claro/oscuro
const THEME_KEY = 'cortes_theme_v1';
const VISITS_KEY = 'cortes_visits_v1';
const getThemeStorage = () => {
  try {
    return window.sessionStorage;
  } catch (_) {
    return null;
  }
};
const readStoredTheme = () => {
  const storage = getThemeStorage();
  if (storage) {
    try {
      const value = storage.getItem(THEME_KEY);
      if (value) return value;
    } catch (_) {}
  }
  try { localStorage.removeItem(THEME_KEY); } catch (_) {}
  return null;
};
const writeStoredTheme = (value) => {
  const storage = getThemeStorage();
  if (!storage) return;
  try { storage.setItem(THEME_KEY, value); } catch (_) {}
};
function clearStoredTheme() {
  const storage = getThemeStorage();
  if (storage) {
    try { storage.removeItem(THEME_KEY); } catch (_) {}
  }
  try { localStorage.removeItem(THEME_KEY); } catch (_) {}
}
window.__clearThemePreference = clearStoredTheme;
function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('theme-light', isLight);
  if (themeToggleBtn) themeToggleBtn.textContent = isLight ? 'Modo oscuro' : 'Modo claro';
}
function loadTheme() {
  const saved = readStoredTheme();
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved);
    return;
  }
  applyTheme('dark');
  writeStoredTheme('dark');
}
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const isLight = document.body.classList.contains('theme-light');
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    writeStoredTheme(next);
    // Recolorear y redibujar
    reindexRows();
    recalcEdgebanding();
    renderSheetOverview();
    updateRowSummaryUI();
  });
}
loadTheme();

// --- Analytics opcional (GA4) ---
(function initGA(){
  const lsId = localStorage.getItem('ga_measurement_id') || '';
  const id = (lsId || window.GA_MEASUREMENT_ID || '').trim();
  if (!id || window.__gaInit) return;
  const s = document.createElement('script');
  s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id, { send_page_view: true, debug_mode: true, anonymize_ip: true });
  gtag('event', 'page_view', { page_title: document.title, page_location: location.href, page_path: location.pathname });
  gtag('event', 'visit', {
    user_agent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language
  });
  window.__gaInit = true;
})();

// --- Registro local de visitas + panel oculto ---
function recordVisit() {
  const logs = JSON.parse(localStorage.getItem(VISITS_KEY) || '[]');
  logs.push({ t: new Date().toISOString(), ua: navigator.userAgent, pf: navigator.platform });
  localStorage.setItem(VISITS_KEY, JSON.stringify(logs.slice(-500))); // mantener últimos 500
}
function renderVisits() {
  const panel = document.getElementById('adminPanel');
  if (!panel || panel.style.display === 'none') return;
  const logs = JSON.parse(localStorage.getItem(VISITS_KEY) || '[]');
  const sum = document.getElementById('visitSummary');
  if (sum) sum.textContent = `Registros locales: ${logs.length}`;
  const tbody = document.querySelector('#visitTable tbody');
  if (tbody) {
    tbody.innerHTML = '';
    logs.slice().reverse().forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="padding:4px;">${r.t}</td><td style="padding:4px;">${r.ua}</td><td style="padding:4px;">${r.pf}</td>`;
      tbody.appendChild(tr);
    });
  }
}
function toggleAdminPanel() {
  const panel = document.getElementById('adminPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
  renderVisits();
}
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
    e.preventDefault(); toggleAdminPanel();
  }
});
const clearBtn = document.getElementById('clearVisitsBtn');
if (clearBtn) clearBtn.addEventListener('click', () => { localStorage.removeItem(VISITS_KEY); renderVisits(); });
recordVisit();

// Guardar GA ID desde panel oculto
const saveGaBtn = document.getElementById('saveGaIdBtn');
const gaIdInput = document.getElementById('gaIdInput');
if (gaIdInput) {
  const current = localStorage.getItem('ga_measurement_id') || (window.GA_MEASUREMENT_ID || '');
  gaIdInput.value = current;
}
if (saveGaBtn && gaIdInput) {
  saveGaBtn.addEventListener('click', () => {
    const val = (gaIdInput.value || '').trim();
    localStorage.setItem('ga_measurement_id', val);
    alert('GA4 ID guardado localmente. Recargá la página para iniciar el tracking.');
  });
}
