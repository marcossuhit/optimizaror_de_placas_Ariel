const MAX_ROWS = Number.MAX_SAFE_INTEGER;

const rowsEl = document.getElementById('rows');
const addRowBtn = document.getElementById('addRowBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const projectNameEl = document.getElementById('projectName');
const saveJsonBtn = document.getElementById('saveJsonBtn');
const loadJsonBtn = document.getElementById('loadJsonBtn');
const exportPngBtn = document.getElementById('exportPngBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const resetAllBtn = document.getElementById('resetAllBtn');
const installBtn = document.getElementById('installBtn');
const autoRotateToggle = document.getElementById('autoRotateToggle');
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

const LS_KEY = 'cortes_proyecto_v1';
let collapsedPlates = new Set();

// Estado para sincronizar resumen por fila
let lastEdgebandByRow = new Map(); // rowIdx -> mm subtotal
let lastPlacementByRow = new Map(); // rowIdx -> { requested, placed, left }

function updateRowSummaryUI() {
  if (!summaryListEl) return;
  summaryListEl.innerHTML = '';
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

function getRows() {
  return Array.from(rowsEl.querySelectorAll('.row'));
}

function isRowCompleteEl(row) {
  const inputs = row.querySelectorAll('.field input');
  if (inputs.length < 3) return false;
  const qty = parseInt(inputs[0].value, 10);
  const w = parseFloat(inputs[1].value);
  const h = parseFloat(inputs[2].value);
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

function makeRow(index) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.rowIdx = String(index);

  // Índice de fila
  const fIdx = document.createElement('div');
  fIdx.className = 'idx';
  fIdx.textContent = String(index + 1);

  // Cantidad
  const fQty = document.createElement('div');
  fQty.className = 'field';
  const lQty = document.createElement('label');
  lQty.textContent = 'Cantidad';
  const iQty = document.createElement('input');
  iQty.type = 'number';
  iQty.placeholder = 'Ej: 7';
  iQty.min = '1';
  iQty.value = '';
  fQty.appendChild(lQty);
  fQty.appendChild(iQty);

  // Ancho
  const fW = document.createElement('div');
  fW.className = 'field';
  const lW = document.createElement('label');
  lW.textContent = 'Ancho (mm)';
  const iW = document.createElement('input');
  iW.type = 'number';
  iW.placeholder = 'Ej: 600';
  iW.min = '0';
  iW.step = '1';
  fW.appendChild(lW);
  fW.appendChild(iW);

  // Alto
  const fH = document.createElement('div');
  fH.className = 'field';
  const lH = document.createElement('label');
  lH.textContent = 'Alto (mm)';
  const iH = document.createElement('input');
  iH.type = 'number';
  iH.placeholder = 'Ej: 720';
  iH.min = '0';
  iH.step = '1';
  fH.appendChild(lH);
  fH.appendChild(iH);

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
    toggleAddButton();
    reindexRows();
    recalcEdgebanding();
    renderSheetOverview();
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
  for (const key of Object.keys(edges)) {
    const el = edges[key];
    el.setAttribute('class', 'edge');
    el.dataset.selected = '0';
    el.addEventListener('click', () => {
      const sel = el.dataset.selected === '1';
      el.dataset.selected = sel ? '0' : '1';
      el.classList.toggle('selected', !sel);
      recalcEdgebanding();
      renderSheetOverview();
      persistState && persistState();
    });
    g.appendChild(el);
  }
  for (const key of Object.keys(edgesHit)) {
    const hot = edgesHit[key];
    hot.setAttribute('class', 'edge-hit');
    hot.addEventListener('click', () => edges[key].dispatchEvent(new Event('click')));
    g.appendChild(hot);
  }

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

  function setInputsEnabled(enabled) {
    iQty.disabled = !enabled;
    iW.disabled = !enabled;
    iH.disabled = !enabled;
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
  iRot.addEventListener('change', () => { updatePreview(); recalcEdgebanding(); renderSheetOverview(); persistState && persistState(); });

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
  toggleAddButton();
  recalcEdgebanding();
  renderSheetOverview();
  persistState && persistState();
});

clearAllBtn.addEventListener('click', () => {
  rowsEl.innerHTML = '';
  toggleAddButton();
  recalcEdgebanding();
  renderSheetOverview();
  persistState && persistState();
});

// Crear filas iniciales si no hay (cuando no hay proyecto guardado)
function ensureDefaultRows() {
  if (currentRowCount() === 0) {
    for (let i = 0; i < 5; i++) rowsEl.appendChild(makeRow(i));
    toggleAddButton();
  }
}

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
  getRows().forEach(r => r._setInputsEnabled && r._setInputsEnabled(enabled));
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

// -------- Persistencia (Guardar/Cargar) --------
function serializeState() {
  const plates = getPlates();
  const rows = getRows().map((row) => {
    const inputs = row.querySelectorAll('.field input');
    const qty = parseFloat(inputs[0].value) || 0;
    const w = parseFloat(inputs[1].value) || 0;
    const h = parseFloat(inputs[2].value) || 0;
    const rotEl = row.querySelector('.rot-label input');
    const rot = !!(rotEl && rotEl.checked);
    const edges = Array.from(row.querySelectorAll('line.edge')).map(e => e.dataset.selected === '1');
    return { qty, w, h, rot, edges };
  });
  const name = (projectNameEl?.value || '').trim();
  const kerfMm = parseInt(kerfInput?.value ?? '0', 10) || 0;
  const autoRotate = !!(autoRotateToggle && autoRotateToggle.checked);
  return { name, plates, rows, kerfMm, autoRotate };
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

function saveJSON() {
  const state = serializeState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const name = (projectNameEl?.value || '').trim();
  const fname = name ? `proyecto-${name.replace(/\s+/g,'_')}.json` : 'proyecto-cortes.json';
  download(fname, url);
  URL.revokeObjectURL(url);
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
  if (autoRotateToggle && typeof state.autoRotate === 'boolean') autoRotateToggle.checked = !!state.autoRotate;
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
      const inputs = r.querySelectorAll('.field input');
      inputs[0].value = it.qty != null ? String(it.qty) : '';
      inputs[1].value = it.w != null ? String(it.w) : '';
      inputs[2].value = it.h != null ? String(it.h) : '';
      const rotEl = r.querySelector('.rot-label input');
      if (rotEl) rotEl.checked = !!it.rot;
      const edges = r.querySelectorAll('line.edge');
      if (Array.isArray(it.edges)) {
        edges.forEach((e, i) => {
          const sel = !!it.edges[i];
          e.dataset.selected = sel ? '1' : '0';
          e.classList.toggle('selected', sel);
        });
      }
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
if (projectNameEl) projectNameEl.addEventListener('input', () => { persistState(); });

// -------- Exportar PNG/PDF --------
async function exportPNG() {
  // Tomar todos los SVG de la sección de placas y construir una imagen vertical
  const svgs = Array.from(document.querySelectorAll('#sheetCanvas svg'));
  if (!svgs.length) { alert('No hay placas para exportar'); return; }
  const margin = 20;
  const targetW = 1200; // px
  // Calcular alturas escaladas
  const images = await Promise.all(svgs.map(svg => new Promise((resolve) => {
    const xml = new XMLSerializer().serializeToString(svg);
    const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
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
  const sPieces = (summaryPiecesEl?.textContent || '').trim();
  const sArea = (summaryAreaEl?.textContent || '').trim();
  const sUtil = (summaryUtilEl?.textContent || '').trim();
  const sWaste = (summaryWasteEl?.textContent || '').trim();
  ctx.font = '16px system-ui';
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

function exportPDF() {
  // Usa el PNG generado en una ventana nueva y dispara imprimir
  const doExport = async () => {
    const svgs = document.querySelectorAll('#sheetCanvas svg');
    if (!svgs.length) { alert('No hay placas para exportar'); return; }
    // Reutilizamos exportPNG para obtener el data URL, pero sin descargar
    const margin = 20;
    const targetW = 1200;
    const images = await Promise.all(Array.from(svgs).map(svg => new Promise((resolve) => {
      const xml = new XMLSerializer().serializeToString(svg);
      const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
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
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 20px system-ui';
    const title = (projectNameEl?.value || '').trim() || 'Plano de cortes';
    ctx.fillText(title, margin, 34);
    ctx.font = '16px system-ui';
    ctx.fillText((summaryPiecesEl?.textContent || '').trim(), margin, 64);
    ctx.fillText((summaryAreaEl?.textContent || '').trim(), margin, 88);
    ctx.fillText((summaryUtilEl?.textContent || '').trim(), targetW - 360, 64);
    ctx.fillText((summaryWasteEl?.textContent || '').trim(), targetW - 360, 88);
    let y = headerH;
    scaled.forEach(({ img, w, h }, idx) => {
      ctx.fillStyle = '#111827';
      ctx.font = '14px system-ui';
      ctx.fillText(`Placa ${idx + 1}`, margin, y - 6);
      ctx.drawImage(img, margin, y, w, h);
      y += h + margin;
    });
    const dataUrl = canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) { const name = (projectNameEl?.value || '').trim(); download(name?`plano-${name.replace(/\s+/g,'_')}.png`:'plano-cortes.png', dataUrl); return; }
    win.document.write(`<html><head><title>Plano de cortes</title><style>body{margin:0} img{width:100%;}</style></head><body><img src="${dataUrl}" onload="setTimeout(()=>window.print(), 250)" /></body></html>`);
    win.document.close();
  };
  doExport();
}

if (exportPngBtn) exportPngBtn.addEventListener('click', exportPNG);
if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportPDF);
if (resetAllBtn) {
  resetAllBtn.addEventListener('click', () => {
    clearAllPlates();
    clearAllRows();
    if (projectNameEl) projectNameEl.value = '';
    if (kerfInput) kerfInput.value = '0';
    if (autoRotateToggle) autoRotateToggle.checked = false;
    applyPlatesGate();
    ensureDefaultRows();
  });
}

// Cálculo de Cantidad de cubre canto (suma de lados seleccionados)
function recalcEdgebanding() {
  const rows = getRows();
  let totalMm = 0;
  const items = [];
  lastEdgebandByRow = new Map();

  rows.forEach((row, idx) => {
    const inputs = row.querySelectorAll('.field input');
    if (inputs.length < 3) return;
    const qty = parseFloat(inputs[0].value);
    const w = parseFloat(inputs[1].value);
    const h = parseFloat(inputs[2].value);
    if (!(qty >= 1 && w > 0 && h > 0)) return;

    const edges = row.querySelectorAll('line.edge');
    let perPiece = 0;
    const rot = row._getRotation ? row._getRotation() : false;
    const effW = rot ? h : w;
    const effH = rot ? w : h;
    edges.forEach((e) => {
      if (e.dataset.selected === '1') {
        const key = e === edges[0] ? 'top' : e === edges[1] ? 'right' : e === edges[2] ? 'bottom' : 'left';
        if (key === 'top' || key === 'bottom') perPiece += effW;
        else perPiece += effH;
      }
    });
    const subtotal = perPiece * qty;
    if (subtotal > 0) {
      items.push({ idx: idx + 1, subtotal, color: getRowColor(idx) });
      lastEdgebandByRow.set(idx, subtotal);
      totalMm += subtotal;
    }
  });

  const fmt = (n, decimals = 2) => formatNumber(Number(n) || 0, decimals);
  if (summaryTotalEl) {
    const meters = totalMm / 1000;
    summaryTotalEl.textContent = `Cantidad de cubre canto: ${fmt(totalMm, 0)} mm (${fmt(meters, 3)} m)`;
  }
  // Actualizar lista combinada (con datos de colocación)
  updateRowSummaryUI();
}

// Render de la placa completa al pie
function renderSheetOverview() {
  if (!sheetCanvasEl) return;
  sheetCanvasEl.innerHTML = '';
  const plates = getPlates();
  if (!plates.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Configure la placa para ver la vista';
    sheetCanvasEl.appendChild(hint);
    return;
  }
  const sc = plates.reduce((sum, p) => sum + p.sc, 0);
  // Expandir a instancias, preservando refilado por placa
  const instances = [];
  plates.forEach(p => { for (let i = 0; i < p.sc; i++) instances.push({ sw: p.sw, sh: p.sh, trim: p.trim || { mm: 0, top: false, right: false, bottom: false, left: false } }); });
  const svgNS = 'http://www.w3.org/2000/svg';
  const holder = document.createElement('div');
  holder.className = 'sheet-multi';

  // Preparar piezas a ubicar (shelf packing simple)
  const pieces = [];
  const allowAutoRotate = !!(autoRotateToggle && autoRotateToggle.checked);
  const dimensionKey = (wVal, hVal) => {
    const safeW = Number.isFinite(wVal) ? wVal : 0;
    const safeH = Number.isFinite(hVal) ? hVal : 0;
    const normW = Math.round(safeW * 1000) / 1000;
    const normH = Math.round(safeH * 1000) / 1000;
    const minSide = Math.min(normW, normH);
    const maxSide = Math.max(normW, normH);
    return `${minSide}×${maxSide}`;
  };
  let totalRequested = 0;
  getRows().forEach((row, idx) => {
    const inputs = row.querySelectorAll('.field input');
    if (inputs.length < 3) return;
    const qty = parseInt(inputs[0].value, 10);
    const w = parseFloat(inputs[1].value);
    const h = parseFloat(inputs[2].value);
    if (!(qty >= 1 && w > 0 && h > 0)) return;
    const rot = row._getRotation ? row._getRotation() : false;
    const rawW = rot ? h : w;
    const rawH = rot ? w : h;
    const area = rawW * rawH;
    const key = dimensionKey(rawW, rawH);
    const baseIndex = pieces.length;
    for (let i = 0; i < qty; i++) {
      pieces.push({
        rowIdx: idx,
        w: rawW,
        h: rawH,
        rawW,
        rawH,
        color: getRowColor(idx),
        rot,
        area,
        dimKey: key,
        originalIndex: baseIndex + i
      });
    }
    totalRequested += qty;
  });
  // Agrupar piezas por dimensiones y ordenarlas por área (prioriza piezas grandes)
  const groupsMap = new Map();
  pieces.forEach((piece) => {
    if (!groupsMap.has(piece.dimKey)) {
      groupsMap.set(piece.dimKey, { key: piece.dimKey, area: piece.area, maxSide: Math.max(piece.w, piece.h), pieces: [] });
    }
    const group = groupsMap.get(piece.dimKey);
    group.area = Math.max(group.area, piece.area);
    group.maxSide = Math.max(group.maxSide, Math.max(piece.w, piece.h));
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
      return a.originalIndex - b.originalIndex;
    });
  });

  const allPlaced = [];
  let groupQueues = groups.map((group) => ({
    key: group.key,
    area: group.area,
    maxSide: group.maxSide,
    area: group.area,
    pieces: group.pieces.slice()
  }));

  for (let plateIdx = 0; plateIdx < instances.length; plateIdx++) {
    if (!groupQueues.length) break;
    const { sw, sh, trim } = instances[plateIdx];
    // Refilado en milímetros
    const trimValue = Math.max(0, (trim && trim.mm) || 0);
    const leftT = trim && trim.left ? trimValue : 0;
    const rightT = trim && trim.right ? trimValue : 0;
    const topT = trim && trim.top ? trimValue : 0;
    const bottomT = trim && trim.bottom ? trimValue : 0;
    const usableW = Math.max(0, sw - leftT - rightT);
    const usableH = Math.max(0, sh - topT - bottomT);
    const offX = leftT;
    const offY = topT;

    const kerf = getKerfMm();
    const placed = [];
    const EPS = 0.0001;

    let freeRects = [{ x: 0, y: 0, w: usableW, h: usableH }];

    const cleanupFreeRects = () => {
      const pruned = [];
      for (let i = 0; i < freeRects.length; i++) {
        const a = freeRects[i];
        let contained = false;
        for (let j = 0; j < freeRects.length; j++) {
          if (i === j) continue;
          const b = freeRects[j];
          if (a.x >= b.x - EPS && a.y >= b.y - EPS &&
              a.x + a.w <= b.x + b.w + EPS &&
              a.y + a.h <= b.y + b.h + EPS) {
            contained = true;
            break;
          }
        }
        if (!contained) pruned.push(a);
      }
      freeRects = pruned;
    };

    const splitFreeRect = (optionRects) => {
      for (const r of optionRects) {
        if (r.w < EPS || r.h < EPS) continue;
        freeRects.push(r);
      }
      cleanupFreeRects();
    };

    const placePiece = (piece) => {
      if (!freeRects.length) return null;
      const orientations = [
        { w: piece.w, h: piece.h, rot: piece.rot },
        { w: piece.h, h: piece.w, rot: !piece.rot }
      ];

      const candidates = orientations
        .map((o) => ({ ...o, wf: o.w + kerf * 2, hf: o.h + kerf * 2 }))
        .filter((o) => o.wf > 0 && o.hf > 0);

      if (!candidates.length) return null;

      let best = null;
      for (let rIdx = 0; rIdx < freeRects.length; rIdx++) {
        const rect = freeRects[rIdx];
        for (const o of candidates) {
          if (o.wf > rect.w + EPS || o.hf > rect.h + EPS) continue;
          const leftoverX = Math.max(0, rect.w - o.wf);
          const leftoverY = Math.max(0, rect.h - o.hf);
          const hSplit = [];
          if (leftoverY > EPS) hSplit.push({ x: rect.x, y: rect.y + o.hf, w: rect.w, h: leftoverY });
          if (leftoverX > EPS) hSplit.push({ x: rect.x + o.wf, y: rect.y, w: leftoverX, h: o.hf });
          const vSplit = [];
          if (leftoverX > EPS) vSplit.push({ x: rect.x + o.wf, y: rect.y, w: leftoverX, h: rect.h });
          if (leftoverY > EPS) vSplit.push({ x: rect.x, y: rect.y + o.hf, w: o.wf, h: leftoverY });
          const options = [
            { rects: hSplit, waste: hSplit.reduce((acc, r) => acc + r.w * r.h, 0) },
            { rects: vSplit, waste: vSplit.reduce((acc, r) => acc + r.w * r.h, 0) }
          ];
          if (!options[0].rects.length && !options[1].rects.length) options.push({ rects: [], waste: 0 });
          for (const opt of options) {
            const score = opt.waste;
            if (!best || score < best.score ||
                (Math.abs(score - best.score) <= EPS && (rect.y < best.rect.y - EPS ||
                (Math.abs(rect.y - best.rect.y) <= EPS && rect.x < best.rect.x - EPS)))) {
              best = { rectIdx: rIdx, rect, orientation: o, score, optionRects: opt.rects };
            }
          }
        }
      }

      if (!best) return null;

      const rect = freeRects.splice(best.rectIdx, 1)[0];
      const placedRect = {
        x: rect.x,
        y: rect.y,
        w: best.orientation.wf,
        h: best.orientation.hf,
        rawW: best.orientation.w,
        rawH: best.orientation.h,
        rot: best.orientation.rot
      };

      splitFreeRect(best.optionRects || []);
      return placedRect;
    };

    let pendingGroups = groupQueues.slice();
    let madeProgress = true;
    while (madeProgress && pendingGroups.length) {
      madeProgress = false;
      const nextGroupQueues = [];
      for (const entry of pendingGroups) {
        const piecesList = entry.pieces.slice();
        const remaining = [];
        let placedCount = 0;
        for (let i = 0; i < piecesList.length; i++) {
          const piece = piecesList[i];
          const placement = placePiece(piece);
          if (!placement) {
            remaining.push(...piecesList.slice(i));
            break;
          }
          placed.push({
            x: placement.x + offX,
            y: placement.y + offY,
            w: placement.w,
            h: placement.h,
            rawW: placement.rawW,
            rawH: placement.rawH,
            color: piece.color,
            rowIdx: piece.rowIdx,
            rot: placement.rot
          });
          placedCount++;
        }
        if (remaining.length) nextGroupQueues.push({ ...entry, pieces: remaining });
        if (placedCount > 0) madeProgress = true;
      }
      pendingGroups = nextGroupQueues.sort((a, b) => {
        if (b.area !== a.area) return b.area - a.area;
        if (b.maxSide !== a.maxSide) return b.maxSide - a.maxSide;
        return a.key.localeCompare(b.key);
      });
    }

    allPlaced.push(...placed);
    groupQueues = pendingGroups;

    // Render de esta placa
    const VIEW_W = 1000;
    const LABEL_EXTRA_H = 24; // espacio extra para textos por encima de la placa
    const PAD_X = 16;
    const PAD_BOTTOM = 16;
    const PAD_TOP = PAD_BOTTOM + LABEL_EXTRA_H;
    const innerW = VIEW_W - PAD_X * 2;
    const scale = innerW / sw;
    const contentH = sh * scale;
    const VIEW_H = Math.max(1, Math.round(contentH + PAD_TOP + PAD_BOTTOM));

    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'plate-title';
    const caret = document.createElement('span');
    caret.className = 'caret';
    const isCollapsed = collapsedPlates.has(plateIdx);
    caret.textContent = isCollapsed ? '►' : '▼';
    const titleText = document.createElement('span');
    titleText.textContent = `Placa ${plateIdx + 1} de ${instances.length}`;
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
    label.textContent = `${formatNumber(sw, 0)} × ${formatNumber(sh, 0)} mm`;
    svg.appendChild(label);

    const ox = PAD_X;
    const oy = PAD_TOP;

    // Preparar patrón de hachurado para zonas sin uso (se aplicará con máscara)
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
    // Acumulador de áreas ocupadas (trim + footprints de piezas) para enmascarar
    const occupied = [];

    // Dibujar bandas de refilado en naranja translúcido (cubren el hachurado)
    const drawTrim = (x, y, w, h) => {
      if (w <= 0 || h <= 0) return;
      const r = document.createElementNS(svgNS, 'rect');
      r.setAttribute('x', String(ox + x * scale));
      r.setAttribute('y', String(oy + y * scale));
      r.setAttribute('width', String(Math.max(1, w * scale)));
      r.setAttribute('height', String(Math.max(1, h * scale)));
      r.setAttribute('fill', '#f59e0b33');
      r.setAttribute('stroke', 'none');
      svg.appendChild(r);
    };
    // Compensar antialiasing: extender ligeramente hacia el borde exterior
    const eps = 2.5 / Math.max(0.0001, scale); // ~2.5px en coordenadas placa
    if (topT) { drawTrim(0, -eps, sw, topT + eps); occupied.push({ x: 0, y: -eps, w: sw, h: topT + eps }); }
    if (bottomT) { drawTrim(0, sh - bottomT, sw, bottomT + eps); occupied.push({ x: 0, y: sh - bottomT, w: sw, h: bottomT + eps }); }
    if (leftT) { drawTrim(-eps, 0, leftT + eps, sh); occupied.push({ x: -eps, y: 0, w: leftT + eps, h: sh }); }
    if (rightT) { drawTrim(sw - rightT, 0, rightT + eps, sh); occupied.push({ x: sw - rightT, y: 0, w: rightT + eps, h: sh }); }

    for (const r of placed) {
      // Dibujo del footprint (incluye kerf en 4 lados)
      const pxX = ox + r.x * scale;
      const pxY = oy + r.y * scale;
      const pxW = Math.max(1, r.w * scale);
      const pxH = Math.max(1, r.h * scale);
      const outer = document.createElementNS(svgNS, 'rect');
      outer.setAttribute('x', String(pxX));
      outer.setAttribute('y', String(pxY));
      outer.setAttribute('width', String(pxW));
      outer.setAttribute('height', String(pxH));
      outer.setAttribute('rx', '3');
      outer.setAttribute('fill', '#ef444428');
      outer.setAttribute('stroke', r.color);
      outer.setAttribute('stroke-width', '1');
      svg.appendChild(outer);
      // Registrar footprint como ocupado para la máscara de hachurado
      occupied.push({ x: r.x, y: r.y, w: r.w, h: r.h });

      // Dibujo de la pieza real centrada dentro del footprint
      const innerW = Math.max(1, r.rawW * scale);
      const innerH = Math.max(1, r.rawH * scale);
      const inner = document.createElementNS(svgNS, 'rect');
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
        const t = document.createElementNS(svgNS, 'text');
        t.setAttribute('class', 'piece-label');
        const cx = pxX + pxW / 2;
        const cy = pxY + pxH / 2;
        t.setAttribute('x', String(cx));
        t.setAttribute('y', String(cy));
        const fs = clamp(Math.min(pxW, pxH) * 0.18, 10, 16);
        t.setAttribute('font-size', String(fs));
        t.textContent = `${formatNumber(r.rawW, 0)}×${formatNumber(r.rawH, 0)} mm`;
        svg.appendChild(t);
      }
      if (r.rot) {
        const t = document.createElementNS(svgNS, 'text');
        t.setAttribute('class', 'piece-rot');
        t.setAttribute('x', String(pxX + 4));
        t.setAttribute('y', String(pxY + 12));
        t.textContent = '90°';
        svg.appendChild(t);
      }
    }

    // Aplicar hachurado SOLO en zonas sin uso usando máscara
    const mask = document.createElementNS(svgNS, 'mask');
    const maskId = `occ-mask-${plateIdx}`;
    mask.setAttribute('id', maskId);
    const baseWhite = document.createElementNS(svgNS, 'rect');
    baseWhite.setAttribute('x', String(ox));
    baseWhite.setAttribute('y', String(oy));
    baseWhite.setAttribute('width', String(sw * scale));
    baseWhite.setAttribute('height', String(sh * scale));
    baseWhite.setAttribute('fill', 'white');
    mask.appendChild(baseWhite);
    // Pintar de negro zonas ocupadas (se recortan del hachurado)
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
    hatchRect.setAttribute('x', String(ox));
    hatchRect.setAttribute('y', String(oy));
    hatchRect.setAttribute('width', String(sw * scale));
    hatchRect.setAttribute('height', String(sh * scale));
    hatchRect.setAttribute('fill', `url(#${patId})`);
    hatchRect.setAttribute('mask', `url(#${maskId})`);
    hatchRect.setAttribute('stroke', 'none');
    // Insertar hachurado al fondo del contenido de la placa (después de defs y marco)
    svg.insertBefore(hatchRect, label.nextSibling);

    // Si quedan piezas sin ubicar y es la última placa, indicarlo
    const remainingPieces = groupQueues.reduce((sum, entry) => sum + entry.pieces.length, 0);
    if (plateIdx === instances.length - 1 && remainingPieces > 0) {
      const warn = document.createElementNS(svgNS, 'text');
      warn.setAttribute('class', 'sheet-dims');
      warn.setAttribute('x', String(PAD_X + 8));
      // Ubicar el texto justo antes del borde inferior visible
      const yWarn = VIEW_H - 6;
      warn.setAttribute('y', String(yWarn));
      warn.textContent = `No entran ${remainingPieces} pieza(s)`;
      svg.appendChild(warn);
    }

    wrap.appendChild(svg);
    if (isCollapsed) {
      wrap.classList.add('plate-collapsed');
    }

    title.addEventListener('click', () => {
      const nowCollapsed = wrap.classList.toggle('plate-collapsed');
      caret.textContent = nowCollapsed ? '►' : '▼';
      if (nowCollapsed) collapsedPlates.add(plateIdx); else collapsedPlates.delete(plateIdx);
    });
    holder.appendChild(wrap);
  }

  sheetCanvasEl.appendChild(holder);

  // Actualizar resumen: piezas y área usada (solo colocadas)
  const piecesCount = allPlaced.length;
  let areaMm2 = 0;
  for (const r of allPlaced) areaMm2 += r.w * r.h; // footprint incluye kerf en 4 lados
  const areaM2 = areaMm2 / 1e6;
  const fmt = (n, decimals = 2) => formatNumber(Number(n) || 0, decimals);
  if (summaryPiecesEl) summaryPiecesEl.textContent = `Piezas colocadas: ${piecesCount}`;
  if (summaryReqEl) summaryReqEl.textContent = `Cortes pedidos: ${totalRequested}`;
  if (summaryPlacedEl) summaryPlacedEl.textContent = `Colocados: ${piecesCount}`;
  if (summaryLeftEl) summaryLeftEl.textContent = `Fuera: ${Math.max(0, totalRequested - piecesCount)}`;
  if (summaryAreaEl) summaryAreaEl.textContent = `Área utilizada: ${fmt(areaM2, 2)} m²`;
  if (summaryUtilEl) {
    const plateM2 = instances.reduce((acc, p) => acc + (p.sw * p.sh) / 1e6, 0);
    const pct = plateM2 > 0 ? Math.min(100, Math.max(0, (areaM2 / plateM2) * 100)) : 0;
    summaryUtilEl.textContent = `Aprovechamiento: ${fmt(pct, 2)}%`;
    if (summaryWasteEl) {
      const wasteM2 = Math.max(0, plateM2 - areaM2);
      const wastePct = plateM2 > 0 ? Math.min(100, Math.max(0, 100 - pct)) : 0;
      summaryWasteEl.textContent = `Desperdicio: ${fmt(wasteM2, 2)} m² (${fmt(wastePct, 2)}%)`;
    }
  }

  // Guardar métricas por fila para la lista combinada
  lastPlacementByRow = new Map();
  const placedByRow = new Map();
  const requestedByRow = new Map();
  getRows().forEach((row, idx) => {
    const inputs = row.querySelectorAll('.field input');
    if (inputs.length < 3) return;
    const qty = parseInt(inputs[0].value, 10);
    const w = parseFloat(inputs[1].value);
    const h = parseFloat(inputs[2].value);
    if (!(qty >= 1 && w > 0 && h > 0)) return;
    requestedByRow.set(idx, qty);
  });
  allPlaced.forEach(p => {
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
function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('theme-light', isLight);
  if (themeToggleBtn) themeToggleBtn.textContent = isLight ? 'Modo oscuro' : 'Modo claro';
}
function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') { applyTheme(saved); return; }
  // Usa preferencia del sistema como default
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(prefersLight ? 'light' : 'dark');
}
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const isLight = document.body.classList.contains('theme-light');
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
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
