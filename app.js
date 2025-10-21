const MAX_ROWS = Number.MAX_SAFE_INTEGER;

// Flag para indicar si estamos mostrando el plano del optimizador avanzado
let showingAdvancedOptimization = false;

// Cache para evitar optimizaciones innecesarias
let lastOptimizationHash = null;
let lastOptimizationResult = null;

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
const edgeCatalogSelect = document.getElementById('edgeCatalogSelect');
const manageStockBtn = document.getElementById('manageStockBtn');
const themeToggleBtn = document.getElementById('themeToggle');
const generateLayoutBtn = document.getElementById('generateLayoutBtn');
const stackSection = document.querySelector('.stack');
const platesControlsEl = document.querySelector('.plates-controls');
const plateLimitNoteEl = platesControlsEl?.querySelector('.limit-note') || null;
const rowsSectionEl = document.getElementById('rows');
const rowsHeaderSection = document.querySelector('.rows-header');
// Placas dinámicas (lista)
const platesEl = document.getElementById('plates');
const addPlateBtn = document.getElementById('addPlateBtn');
let kerfInput = document.getElementById('kerfInput');
let kerfFieldWrapper = kerfInput ? kerfInput.closest('.kerf-field') : null;
let pendingKerfValue = kerfInput && kerfInput.value ? kerfInput.value : '5';
const summaryTotalEl = document.getElementById('summaryTotal');
const summaryPlatesValueEl = document.getElementById('summaryPlatesValue');
const summaryGrandTotalEl = document.getElementById('summaryGrandTotal');
const summaryListEl = document.getElementById('summaryList');
const sheetCanvasEl = document.getElementById('sheetCanvas');
const sheetOverviewSection = document.querySelector('.sheet-overview');
const summaryPiecesEl = document.getElementById('summaryPieces');
const summaryPlatesEl = document.getElementById('summaryPlates');
const summaryPlateCostEl = document.getElementById('summaryPlateCost');
const summaryAreaEl = document.getElementById('summaryArea');
const summaryWasteEl = document.getElementById('summaryWaste');
const summaryUtilEl = document.getElementById('summaryUtil');
const summaryReqEl = document.getElementById('summaryReq');
const summaryPlacedEl = document.getElementById('summaryPlaced');
const summaryLeftEl = document.getElementById('summaryLeft');
const recalcLayoutBtn = document.getElementById('recalcLayoutBtn');
const userSessionEl = document.getElementById('userSession');
const userGreetingEl = document.getElementById('userGreeting');
const userEmailEl = document.getElementById('userEmail');
const userAvatarEl = document.getElementById('userAvatar');
const signOutBtn = document.getElementById('signOutBtn');
const sendCutsBtn = document.getElementById('sendCutsBtn');
const whatsappLink = document.getElementById('whatsAppLink');
const WHATSAPP_NUMBER = '542494605850';
const WHATSAPP_MESSAGE = 'PCAMOBLAMIENTOS te envia la planificacion de cortes.';
const sendCutsDefaultLabel = sendCutsBtn?.textContent || 'Enviar cortes';
const StockSync = window.StockSync || null;
const REMOTE_STOCK_SYNC_ENABLED = !!(StockSync && typeof StockSync.isConfigured === 'function' && StockSync.isConfigured());
const DEFAULT_PLATE_WIDTH = 2750;
const DEFAULT_PLATE_HEIGHT = 1830;
const EMAIL_PROVIDER_ENDPOINT = typeof window.EMAIL_PROVIDER_ENDPOINT === 'string' ? window.EMAIL_PROVIDER_ENDPOINT : '';

const LS_KEY = 'cortes_proyecto_v1';
const DEFAULT_MATERIAL = 'MDF Blanco';
const LAST_MATERIAL_KEY = 'selected_material_v1';
const EDGE_STORAGE_KEY = 'edgeband_items_v1';

try { localStorage.removeItem(LS_KEY); } catch (_) {}
try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}

let collapsedPlates = new Set();
let edgeCatalog = [];

// Estado para sincronizar resumen por fila
let lastEdgebandByRow = new Map(); // rowIdx -> mm subtotal
let lastPlacementByRow = new Map(); // rowIdx -> { requested, placed, left }
let currentMaterialName = plateMaterialSelect?.value || '';
const STOCK_STORAGE_KEY = 'stock_items_v1';
const ADMIN_STORAGE_KEY = 'admin_items_v1';
const STOCK_TEXT_FALLBACK = 'stock.txt';
let lastFetchedStockItems = [];
let lastFeasibleStateSnapshot = null;
let autoPlateAllocationInProgress = false;
let pendingAutoPlateAllocation = false;
let lastStockAlertTs = 0;
const STOCK_ALERT_COOLDOWN_MS = 1500;
let remoteStockSnapshot = null;
let remoteEdgeSnapshot = null;
let lastPlateCostSummary = { unit: 0, total: 0, count: 0, material: '' };
let lastEdgeCostSummary = { totalMeters: 0, totalCost: 0, entries: [] };

const LAYOUT_RECALC_DEBOUNCE_MS = 800; // Aumentado de 400ms a 800ms para mejor performance
let layoutRecalcTimer = null;
let layoutRecalcPending = false;
let layoutRecalcBusy = false;
let immediateRecalcNeeded = false;
let deferredRecalcTimer = null;

// Cache para evitar recálculos innecesarios
let solverCache = new Map();
let cacheVersion = 0;
let lastSuccessfulSolution = null; // Cache de emergencia
let forceStopSolver = false;

// Web Worker para el solver
class SolverWorker {
  constructor() {
    this.worker = null;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.currentProgress = 0;
    this.initWorker();
  }

  initWorker() {
    try {
      this.worker = new Worker('./solver-worker.js');
      this.worker.onmessage = (e) => this.handleMessage(e);
      this.worker.onerror = (error) => this.handleError(error);
      
      // Agregar más logging para debugging
      this.worker.onmessageerror = (error) => {
        console.error('❌ Error de mensaje del worker:', error);
      };
      
      console.log('✅ Worker inicializado correctamente');
    } catch (error) {
      console.error('❌ Error al inicializar worker:', error);
      this.worker = null;
    }
  }

  handleMessage(e) {
    const { id, type, success, result, error, progress } = e.data;
    console.log('📨 Worker message:', { id, type, success, progress });
    
    if (type === 'progress' && typeof progress === 'number') {
      this.currentProgress = progress;
      this.updateProgressUI(progress);
      this.updateProgressBar(progress);  // Asegurar que se llame
      return;
    }
    
    const request = this.pendingRequests.get(id);
    if (!request) return;
    
    this.pendingRequests.delete(id);
    
    if (success && result) {
      // Progreso completo al recibir resultado
      this.updateProgressBar(1.0);
      request.resolve(result);
    } else {
      request.reject(new Error(error || 'Error en el solver'));
    }
  }

  handleError(error) {
    console.error('Error del worker:', error);
    // Rechazar todas las promesas pendientes
    for (const [id, request] of this.pendingRequests) {
      request.reject(new Error('Worker error: ' + error.message));
    }
    this.pendingRequests.clear();
  }

  updateProgressUI(progress) {
    console.log('📊 Actualizando progreso:', progress);
    if (recalcLayoutBtn) {
      const percentage = Math.round(progress * 100);
      recalcLayoutBtn.textContent = `Calculando... ${percentage}%`;
      
      // Agregar barra de progreso visual
      this.updateProgressBar(progress);
    }
  }

  updateProgressBar(progress) {
    console.log('📈 Actualizando barra:', progress);
    
    // Crear o actualizar barra de progreso
    let progressBar = document.getElementById('solver-progress-bar');
    if (!progressBar) {
      console.log('🔨 Creando barra de progreso');
      progressBar = document.createElement('div');
      progressBar.id = 'solver-progress-bar';
      progressBar.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 8px !important;
        background: rgba(0,0,0,0.3) !important;
        z-index: 999999 !important;
        transition: opacity 0.3s ease !important;
        border: none !important;
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
      `;
      
      const progressFill = document.createElement('div');
      progressFill.id = 'solver-progress-fill';
      progressFill.style.cssText = `
        height: 100% !important;
        background: linear-gradient(90deg, #2196F3, #4CAF50) !important;
        width: 0% !important;
        transition: width 0.5s ease !important;
        box-shadow: 0 0 15px rgba(33, 150, 243, 0.8) !important;
        border: none !important;
        margin: 0 !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: flex-end !important;
        color: white !important;
        font-size: 11px !important;
        font-weight: bold !important;
        padding-right: 8px !important;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.5) !important;
      `;
      
      progressBar.appendChild(progressFill);
      document.body.appendChild(progressBar);
      
      // Asegurar que esté visible
      setTimeout(() => {
        progressBar.style.opacity = '1';
      }, 10);
    }
    
    const progressFill = document.getElementById('solver-progress-fill');
    if (progressFill) {
      const percentage = Math.round(progress * 100);
      progressFill.style.width = `${percentage}%`;
      progressFill.textContent = `${percentage}%`;
      console.log(`📏 Barra actualizada: ${percentage}%`);
    }
    
    // NO auto-ocultar hasta que termine completamente
    if (progress >= 1) {
      setTimeout(() => {
        if (progressBar && progressBar.parentNode) {
          console.log('🗑️ Removiendo barra completada');
          progressBar.style.opacity = '0';
          setTimeout(() => {
            if (progressBar.parentNode) {
              progressBar.remove();
            }
          }, 300);
        }
      }, 2000); // Mantener visible 2 segundos más
    }
  }

  // Función de prueba para mostrar la barra manualmente
  testProgressBar() {
    console.log('🧪 Testing progress bar...');
    let progress = 0;
    const interval = setInterval(() => {
      progress += 0.1;
      this.updateProgressBar(progress);
      if (progress >= 1) {
        clearInterval(interval);
      }
    }, 200);
  }

  async solve(inputs) {
    if (!this.worker) {
      throw new Error('Worker no disponible');
    }

    console.log('🚀 Enviando trabajo al worker');

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      
      console.log('📤 Enviando mensaje al worker con ID:', id);
      this.worker.postMessage({ 
        id, 
        type: 'solve', 
        data: inputs 
      });
      
      // Timeout de seguridad (30 segundos)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          console.log('⏰ Timeout del solver');
          this.pendingRequests.delete(id);
          reject(new Error('Timeout del solver (30s)'));
        }
      }, 30000);
    });
  }

  cancel() {
    // Cancelar todas las peticiones pendientes
    for (const [id, request] of this.pendingRequests) {
      this.worker.postMessage({ id, type: 'cancel' });
      request.reject(new Error('Cancelado por el usuario'));
    }
    this.pendingRequests.clear();
    
    // Reiniciar worker
    if (this.worker) {
      this.worker.terminate();
      this.initWorker();
    }
  }

  isWorking() {
    return this.pendingRequests.size > 0;
  }
}

// Instancia global del worker
let solverWorker;

// Inicializar worker al cargar
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔄 Inicializando Web Worker...');
  solverWorker = new SolverWorker();
  
  // Exponer función de test para la consola
  window.testProgressBar = () => {
    if (solverWorker) {
      solverWorker.testProgressBar();
    } else {
      console.error('❌ SolverWorker no está inicializado');
    }
  };
  
  // Exponer worker para debugging
  window.solverWorker = solverWorker;
});

// Estados de loading centralizados
class LoadingManager {
  constructor() {
    this.loadingElements = new Map();
  }

  showLoading(id, element, message = 'Cargando...') {
    if (!element) return;
    
    const loadingEl = document.createElement('div');
    loadingEl.className = 'loading-overlay';
    loadingEl.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255,255,255,0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      font-size: 14px;
      color: #666;
    `;
    loadingEl.textContent = message;
    
    // Hacer el contenedor relativo si no lo es
    const originalPosition = element.style.position;
    if (!originalPosition || originalPosition === 'static') {
      element.style.position = 'relative';
    }
    
    element.appendChild(loadingEl);
    this.loadingElements.set(id, { loadingEl, element, originalPosition });
  }

  updateLoading(id, message) {
    const entry = this.loadingElements.get(id);
    if (entry && entry.loadingEl) {
      entry.loadingEl.textContent = message;
    }
  }

  hideLoading(id) {
    const entry = this.loadingElements.get(id);
    if (!entry) return;
    
    const { loadingEl, element, originalPosition } = entry;
    
    if (loadingEl && loadingEl.parentNode) {
      loadingEl.remove();
    }
    
    // Restaurar posición original si fue cambiada
    if (originalPosition) {
      element.style.position = originalPosition;
    } else {
      element.style.position = '';
    }
    
    this.loadingElements.delete(id);
  }

  hideAllLoading() {
    for (const id of this.loadingElements.keys()) {
      this.hideLoading(id);
    }
  }
}

const loadingManager = new LoadingManager();

function updateRecalcButtonState({ pending = layoutRecalcPending, busy = layoutRecalcBusy } = {}) {
  if (!recalcLayoutBtn) return;
  
  console.log('🔄 updateRecalcButtonState:', { pending, busy });
  
  if (busy) {
    recalcLayoutBtn.disabled = false; // Permitir cancelar
    recalcLayoutBtn.textContent = 'Cancelar cálculo';
    recalcLayoutBtn.classList.add('btn-busy');
    recalcLayoutBtn.style.backgroundColor = '#f44336';
    recalcLayoutBtn.style.color = '#white';
    recalcLayoutBtn.onclick = (e) => {
      e.preventDefault();
      console.log('🛑 Cancelación solicitada por usuario');
      emergencyStopSolver();
    };
  } else {
    recalcLayoutBtn.disabled = false;
    recalcLayoutBtn.textContent = pending ? 'Actualizar layout (pendiente)' : 'Actualizar layout';
    recalcLayoutBtn.classList.remove('btn-busy');
    recalcLayoutBtn.style.backgroundColor = '';
    recalcLayoutBtn.style.color = '';
    recalcLayoutBtn.onclick = () => scheduleLayoutRecalc({ immediate: true });
    
    if (pending) {
      recalcLayoutBtn.classList.add('btn-pending');
    } else {
      recalcLayoutBtn.classList.remove('btn-pending');
    }
  }
}

async function performLayoutRecalc() {
  if (layoutRecalcTimer) {
    clearTimeout(layoutRecalcTimer);
    layoutRecalcTimer = null;
  }
  layoutRecalcPending = false;
  layoutRecalcBusy = true;
  updateRecalcButtonState({ pending: false, busy: true });
  
  try {
    // Actualizar previews primero (síncronos)
    refreshAllPreviews();
    recalcEdgebanding();
    
    // SIEMPRE usar el optimizador avanzado
    await renderWithAdvancedOptimizer();
  } catch (error) {
    console.error('Error en performLayoutRecalc:', error);
  } finally {
    layoutRecalcBusy = false;
    updateRecalcButtonState({ pending: false, busy: false });
  }
}

async function scheduleLayoutRecalc({ immediate = false, priority = 'normal', defer = false } = {}) {
  if (immediate) {
    await performLayoutRecalc();
    return;
  }
  
  // Modo diferido para inputs muy frecuentes
  if (defer || shouldUsePerformanceMode()) {
    immediateRecalcNeeded = true;
    
    if (deferredRecalcTimer) {
      clearTimeout(deferredRecalcTimer);
    }
    
    deferredRecalcTimer = setTimeout(() => {
      if (immediateRecalcNeeded) {
        immediateRecalcNeeded = false;
        performLayoutRecalc();
      }
    }, 1500); // 1.5 segundos de delay en modo performance
    return;
  }
  
  // Cancelar recálculos pendientes no críticos
  if (priority === 'low' && layoutRecalcTimer) {
    return; // No programar si ya hay uno pendiente
  }
  
  layoutRecalcPending = true;
  updateRecalcButtonState({ pending: true, busy: layoutRecalcBusy });
  if (layoutRecalcTimer) clearTimeout(layoutRecalcTimer);
  
  // Ajustar delay según prioridad
  const delay = priority === 'high' ? 200 : LAYOUT_RECALC_DEBOUNCE_MS;
  layoutRecalcTimer = setTimeout(() => {
    performLayoutRecalc();
  }, delay);
}

updateRecalcButtonState();

function shouldUsePerformanceMode() {
  const rows = getRows();
  const totalPieces = rows.reduce((acc, row) => {
    const [qtyInput] = getRowCoreInputs(row);
    const qty = parseInt(qtyInput?.value || '0', 10);
    return acc + (qty || 0);
  }, 0);
  return totalPieces > 30;
}

function invalidateSolverCache() {
  cacheVersion++;
  // Limpiar cache si crece mucho
  if (solverCache.size > 10) {
    solverCache.clear();
    clearPersistentCache();
  }
}

function savePersistentCache(key, result) {
  try {
    const cacheData = {
      key,
      result,
      timestamp: Date.now(),
      version: cacheVersion
    };
    localStorage.setItem(`solver_cache_${key}`, JSON.stringify(cacheData));
  } catch (error) {
    // Ignorar errores de localStorage (puede estar lleno)
    console.warn('No se pudo guardar cache persistente:', error);
  }
}

function loadPersistentCache(key) {
  try {
    const stored = localStorage.getItem(`solver_cache_${key}`);
    if (!stored) return null;
    
    const cacheData = JSON.parse(stored);
    
    // Verificar que no sea muy viejo (24 horas)
    const maxAge = 24 * 60 * 60 * 1000;
    if (Date.now() - cacheData.timestamp > maxAge) {
      localStorage.removeItem(`solver_cache_${key}`);
      return null;
    }
    
    // Verificar versión
    if (cacheData.version !== cacheVersion) {
      localStorage.removeItem(`solver_cache_${key}`);
      return null;
    }
    
    return cacheData.result;
  } catch (error) {
    console.warn('Error al cargar cache persistente:', error);
    return null;
  }
}

function clearPersistentCache() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('solver_cache_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.warn('Error al limpiar cache persistente:', error);
  }
}

function getCacheKey(instances, pieces, options) {
  // Crear clave más específica que incluya rotaciones y bordes
  const instancesKey = instances.map(i => 
    `${i.sw}x${i.sh}x${i.trim?.mm || 0}x${[i.trim?.top, i.trim?.right, i.trim?.bottom, i.trim?.left].join('')}`
  ).join('|');
  
  const piecesKey = pieces.map(p => 
    `${p.rawW}x${p.rawH}x${p.qty || 1}x${p.rot || 0}x${p.rowIdx}`
  ).join('|');
  
  const edgesKey = pieces.map(p => {
    const rows = getRows();
    const row = rows[p.rowIdx];
    if (!row) return '0000';
    const edges = Array.from(row.querySelectorAll('line.edge')).map(e => e.dataset.selected === '1' ? '1' : '0').join('');
    return edges;
  }).join('|');
  
  return `${cacheVersion}:${instancesKey}:${piecesKey}:${edgesKey}:${options.kerf}:${options.allowAutoRotate}`;
}

function emergencyStopSolver() {
  forceStopSolver = true;
  
  // Cancelar worker si está funcionando
  if (solverWorker && solverWorker.isWorking()) {
    solverWorker.cancel();
  }
  
  // Limpiar timers
  if (layoutRecalcTimer) {
    clearTimeout(layoutRecalcTimer);
    layoutRecalcTimer = null;
  }
  if (deferredRecalcTimer) {
    clearTimeout(deferredRecalcTimer);
    deferredRecalcTimer = null;
  }
  
  // Limpiar estados visuales
  loadingManager.hideAllLoading();
  
  // Remover barra de progreso si existe
  const progressBar = document.getElementById('solver-progress-bar');
  if (progressBar) {
    progressBar.remove();
  }
  
  layoutRecalcBusy = false;
  layoutRecalcPending = false;
  updateRecalcButtonState({ pending: false, busy: false });
  
  // Resetear después de un momento
  setTimeout(() => {
    forceStopSolver = false;
  }, 2000);
}

function showAppDialog({ title = 'Aviso', message = '', tone = 'info' } = {}) {
  const normalizedTone = ['success', 'error', 'warning'].includes(tone) ? tone : 'info';
  const existing = document.querySelector('.app-dialog-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'app-dialog-overlay';
  const dialog = document.createElement('div');
  dialog.className = `app-dialog app-dialog-${normalizedTone}`;
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;

  const header = document.createElement('header');
  header.className = 'app-dialog-header';
  if (title) {
    const h2 = document.createElement('h2');
    h2.textContent = title;
    header.appendChild(h2);
  }

  const body = document.createElement('div');
  body.className = 'app-dialog-body';
  const linesSource = Array.isArray(message) ? message : String(message ?? '').split(/\n+/);
  const lines = linesSource.map((line) => String(line || '').trim()).filter((line) => line.length > 0);
  if (!lines.length) {
    lines.push('');
  }
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    body.appendChild(p);
  }

  const actions = document.createElement('footer');
  actions.className = 'app-dialog-actions';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = normalizedTone === 'success' ? 'btn primary' : 'btn';
  closeBtn.textContent = 'Aceptar';

  function closeDialog() {
    overlay.remove();
    document.body.classList.remove('dialog-open');
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    }
  }

  closeBtn.addEventListener('click', () => closeDialog());
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeDialog();
    }
  });

  document.addEventListener('keydown', onKeyDown);

  actions.appendChild(closeBtn);
  dialog.append(header, body, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  document.body.classList.add('dialog-open');

  dialog.focus();
  setTimeout(() => closeBtn.focus(), 0);

  return closeDialog;
}

function attachNumericFilter(input, { allowBlank = true } = {}) {
  if (!input) return;
  input.inputMode = 'numeric';
  input.addEventListener('keydown', (event) => {
    const blocked = ['e', 'E', '+', '-', ',','.'];
    if (blocked.includes(event.key)) {
      event.preventDefault();
    }
  });
  input.addEventListener('input', () => {
    const digits = input.value.replace(/[^0-9]/g, '');
    if (digits === '' && !allowBlank) {
      input.value = '0';
    } else {
      input.value = digits;
    }
  });
}

function normalizeStockEntries(items) {
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

function normalizeEdgeEntries(items) {
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

function stockEntriesEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].material !== b[i].material || a[i].price !== b[i].price) return false;
  }
  return true;
}

function edgeEntriesEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].pricePerMeter !== b[i].pricePerMeter) return false;
  }
  return true;
}
let remoteStockUnsubscribe = null;
let remoteEdgeUnsubscribe = null;
let remoteAdminUnsubscribe = null;

function resetSummaryUI() {
  lastEdgebandByRow.clear();
  lastPlacementByRow.clear();
  if (summaryPiecesEl) summaryPiecesEl.textContent = '';
  if (summaryReqEl) summaryReqEl.textContent = '';
  if (summaryPlacedEl) summaryPlacedEl.textContent = '';
  if (summaryLeftEl) summaryLeftEl.textContent = '';
  if (summaryPlatesEl) summaryPlatesEl.textContent = '';
  if (summaryPlateCostEl) summaryPlateCostEl.textContent = '';
  if (summaryAreaEl) summaryAreaEl.textContent = '';
  if (summaryWasteEl) summaryWasteEl.textContent = '';
  if (summaryUtilEl) summaryUtilEl.textContent = '';
  if (summaryTotalEl) summaryTotalEl.textContent = '';
  if (summaryListEl) summaryListEl.innerHTML = '';
  if (summaryPlatesValueEl) summaryPlatesValueEl.innerHTML = '';
  if (summaryGrandTotalEl) summaryGrandTotalEl.innerHTML = '';
  
  // Resetear flag de optimización avanzada y cache
  showingAdvancedOptimization = false;
  lastOptimizationHash = null;
  lastOptimizationResult = null;
}

/**
 * Actualiza el resumen con datos del optimizador avanzado
 */
function updateSummaryWithAdvancedReport(report) {
  if (!report || !report.summary) return;
  
  const summary = report.summary;
  
  // NO actualizar los elementos numéricos del resumen (se ocultan en CSS)
  // Solo actualizar la sección de detalles por placa
  
  // Actualizar información de costo de placas
  const plateCount = summary.plateCount || 0;
  const materialPrice = getMaterialPrice(currentMaterialName);
  const totalPlateCost = materialPrice * plateCount;
  
  lastPlateCostSummary = {
    unit: materialPrice,
    total: totalPlateCost,
    count: plateCount,
    material: currentMaterialName || ''
  };
  
  // Crear resumen detallado por placa
  if (summaryListEl) {
    summaryListEl.innerHTML = '';
    
    // Resultados por placa
    report.plates.forEach((plate, idx) => {
      // Obtener datos del reporte
      const plateData = report.summary;
      const plateWidth = parseFloat(plate.dimensions.split('×')[0].trim());
      const plateHeight = parseFloat(plate.dimensions.split('×')[1].replace('mm', '').trim());
      const plateAreaMm2 = plateWidth * plateHeight;
      const plateAreaM2 = (plateAreaMm2 / 1_000_000).toFixed(2);
      
      const utilizationPercent = parseFloat(plate.utilization.replace('%', ''));
      const wastePercent = (100 - utilizationPercent).toFixed(2);
      const usedAreaM2 = (parseFloat(plate.usedArea) / 1_000_000).toFixed(3);
      const wasteAreaM2 = ((plateAreaMm2 - parseFloat(plate.usedArea)) / 1_000_000).toFixed(3);
      
      const plateDiv = document.createElement('div');
      plateDiv.style.cssText = 'background:#0e1629;padding:12px;margin-bottom:10px;border-radius:6px;border:1px solid #1e293b;';
      plateDiv.innerHTML = `
        <div style="font-weight:bold;margin-bottom:8px;color:#fbbf24;font-size:1.05em;">📋 Placa ${plate.plateNumber} de ${report.summary.plateCount}</div>
        <div style="font-size:0.9em;color:#94a3b8;line-height:1.6;">
          <div style="margin-bottom:4px;">📐 <span style="color:#cbd5e1;">Dimensiones:</span> ${plate.dimensions} <span style="color:#64748b;">(${plateAreaM2} m²)</span></div>
          <div style="margin-bottom:4px;">📦 <span style="color:#cbd5e1;">Piezas colocadas:</span> ${plate.pieces}</div>
          <div style="margin-bottom:4px;">📊 <span style="color:#cbd5e1;">Utilización:</span> <span style="color:#10b981;font-weight:600;">${plate.utilization}</span></div>
          <div style="margin-bottom:4px;">♻️ <span style="color:#cbd5e1;">Desperdicio:</span> <span style="color:#ef4444;font-weight:600;">${wastePercent}%</span> <span style="color:#64748b;">(${wasteAreaM2} m²)</span></div>
          <div style="margin-bottom:4px;">✅ <span style="color:#cbd5e1;">Área utilizada:</span> ${usedAreaM2} m²</div>
          <div style="margin-bottom:4px;">⚙️ <span style="color:#cbd5e1;">Cortes totales:</span> ${plate.cutSequence.sequence.length} <span style="color:#64748b;">(${plate.cutSequence.vertical.length} vert. + ${plate.cutSequence.horizontal.length} horiz.)</span></div>
        </div>
      `;
      summaryListEl.appendChild(plateDiv);
    });
    
    // Piezas sin colocar
    if (report.remaining.length > 0) {
      const remainingDiv = document.createElement('div');
      remainingDiv.style.cssText = 'background:#7f1d1d;padding:12px;margin-top:10px;border-radius:6px;border:1px solid #991b1b;';
      remainingDiv.innerHTML = `
        <div style="font-weight:bold;color:#fca5a5;margin-bottom:6px;font-size:1.05em;">⚠️ Piezas sin colocar: ${report.remaining.length}</div>
        <div style="font-size:0.85em;color:#fecaca;line-height:1.5;">
          ${report.remaining.map(p => `• ${p.dimensions}`).join('<br>')}
        </div>
      `;
      summaryListEl.appendChild(remainingDiv);
    }
  }
  
  // Actualizar secciones de costos
  updateCostSummary();
}

const authUser = typeof ensureAuthenticated === 'function' ? ensureAuthenticated() : null;

const DEFAULT_ADMIN_EMAILS = ['marcossuhit@gmail.com', 'ludovicots@gmail.com'];
let adminDirectory = [];
let allowedAdminEmailSet = new Set();
let isBackofficeAllowed = false;
let cachedInventoryText = null;

function normalizeAdminRecords(records) {
  if (!Array.isArray(records)) return [];
  return records
    .map((item) => ({
      name: String(item?.name || '').trim(),
      email: String(item?.email || '').trim().toLowerCase()
    }))
    .filter((item) => item.name && item.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email))
    .map((item) => ({ name: item.name, email: item.email }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function loadAdminDirectoryFromStorage() {
  try {
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeAdminRecords(parsed);
  } catch (_) {
    return [];
  }
}

function persistAdminDirectory(records) {
  try {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(records));
  } catch (_) {}
}

function updateAllowedAdminEmails(records, { persist = false } = {}) {
  const normalized = normalizeAdminRecords(records);
  adminDirectory = normalized;
  allowedAdminEmailSet = new Set(DEFAULT_ADMIN_EMAILS.map((email) => email.toLowerCase()));
  normalized.forEach((record) => {
    allowedAdminEmailSet.add(record.email);
  });
  if (persist) {
    persistAdminDirectory(normalized);
  }
}

function computeBackofficeAccess() {
  const email = (authUser?.email || '').trim().toLowerCase();
  return !!email && allowedAdminEmailSet.has(email);
}

function applyBackofficeVisibility() {
  if (manageStockBtn) manageStockBtn.style.display = isBackofficeAllowed ? '' : 'none';
  if (exportPdfBtn) exportPdfBtn.style.display = isBackofficeAllowed ? '' : 'none';
  if (sheetOverviewSection) sheetOverviewSection.style.display = isBackofficeAllowed ? '' : 'none';
  if (stackSection) stackSection.style.display = '';
  if (platesEl) platesEl.style.display = '';
  if (rowsSectionEl) rowsSectionEl.style.display = '';
  if (rowsHeaderSection) rowsHeaderSection.style.display = '';
  if (plateLimitNoteEl) plateLimitNoteEl.style.display = '';
}

function refreshBackofficeAccess() {
  const previous = isBackofficeAllowed;
  isBackofficeAllowed = computeBackofficeAccess();
  applyBackofficeVisibility();
  if (previous !== isBackofficeAllowed && typeof updateMaterialDropdownState === 'function') {
    updateMaterialDropdownState();
  }
}

async function fetchInventoryText() {
  if (cachedInventoryText) return cachedInventoryText;
  const response = await fetch(STOCK_TEXT_FALLBACK, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Inventario respondió ${response.status}`);
  }
  const text = await response.text();
  cachedInventoryText = parseInventoryText(text);
  return cachedInventoryText;
}

async function ensureAdminDirectoryFromText() {
  if (REMOTE_STOCK_SYNC_ENABLED) return;
  const inventory = await fetchInventoryText();
  updateAllowedAdminEmails(inventory.adminItems, { persist: true });
  refreshBackofficeAccess();
}

updateAllowedAdminEmails(loadAdminDirectoryFromStorage());
refreshBackofficeAccess();
if (typeof updateMaterialDropdownState === 'function') {
  updateMaterialDropdownState();
}
if (!REMOTE_STOCK_SYNC_ENABLED) {
  ensureAdminDirectoryFromText().catch((err) => {
    console.error('App: no se pudo cargar administradores desde stock.txt', err);
  });
}
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

function handleRemoteStockUpdate(items) {
  const normalized = normalizeStockEntries(items);
  const changed = !stockEntriesEqual(remoteStockSnapshot || [], normalized);
  remoteStockSnapshot = normalized.slice();
  if (isBackofficeAllowed) {
    try { localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}
  }
  if (changed || !lastFetchedStockItems.length) {
    refreshMaterialOptions(normalized);
  } else {
    lastFetchedStockItems = normalized.slice();
  }
}

function handleRemoteEdgeUpdate(items) {
  const normalized = normalizeEdgeEntries(items);
  const changed = !edgeEntriesEqual(remoteEdgeSnapshot || [], normalized);
  remoteEdgeSnapshot = normalized.slice();
  if (changed || !edgeCatalog.length) {
    refreshEdgeCatalog({ catalog: normalized });
  }
  if (isBackofficeAllowed) {
    try { localStorage.setItem(EDGE_STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}
  }
}

function handleRemoteAdminUpdate(items) {
  updateAllowedAdminEmails(items, { persist: true });
  refreshBackofficeAccess();
}

function initRemoteSynchronisation() {
  if (!REMOTE_STOCK_SYNC_ENABLED) return;
  try {
    StockSync.ensureReady?.();
    if (isBackofficeAllowed && typeof StockSync.requiresAuth === 'function' && StockSync.requiresAuth() && typeof StockSync.ensureFirebaseAuth === 'function') {
      StockSync.ensureFirebaseAuth();
    }
  } catch (_) {}
  if (typeof remoteStockUnsubscribe === 'function') remoteStockUnsubscribe();
  if (typeof remoteEdgeUnsubscribe === 'function') remoteEdgeUnsubscribe();
  if (typeof remoteAdminUnsubscribe === 'function') remoteAdminUnsubscribe();
  remoteStockUnsubscribe = StockSync.watchStock(handleRemoteStockUpdate);
  remoteEdgeUnsubscribe = StockSync.watchEdges(handleRemoteEdgeUpdate);
  remoteAdminUnsubscribe = typeof StockSync.watchAdmins === 'function'
    ? StockSync.watchAdmins(handleRemoteAdminUpdate)
    : null;
  window.addEventListener('beforeunload', () => {
    if (typeof remoteStockUnsubscribe === 'function') remoteStockUnsubscribe();
    if (typeof remoteEdgeUnsubscribe === 'function') remoteEdgeUnsubscribe();
    if (typeof remoteAdminUnsubscribe === 'function') remoteAdminUnsubscribe();
  }, { once: true });
  if (typeof StockSync.getStockSnapshot === 'function') {
    StockSync.getStockSnapshot().then((items) => {
      if (Array.isArray(items)) handleRemoteStockUpdate(items);
    }).catch((err) => {
      console.error('App: error obteniendo snapshot inicial de stock', err);
    });
  }
  if (typeof StockSync.getEdgeSnapshot === 'function') {
    StockSync.getEdgeSnapshot().then((items) => {
      if (Array.isArray(items) && items.length) handleRemoteEdgeUpdate(items);
    }).catch((err) => {
      console.error('App: error obteniendo snapshot inicial de cubre cantos', err);
    });
  }
  if (typeof StockSync.getAdminSnapshot === 'function') {
    StockSync.getAdminSnapshot().then((items) => {
      if (Array.isArray(items)) handleRemoteAdminUpdate(items);
    }).catch((err) => {
      console.error('App: error obteniendo administradores remotos', err);
    });
  }
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
      if (name && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
    const materialPart = parts[0];
    if (!materialPart) return;
    const price = Number.parseFloat(parts[1]);
    payload.stockItems.push({ material: materialPart, price: Number.isFinite(price) ? price : 0 });
  });
  return payload;
}

function loadStockFromStorage() {
  if (!isBackofficeAllowed) return null;
  try {
    const raw = localStorage.getItem(STOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeStockEntries(parsed);
  } catch (_) {}
  return null;
}

async function loadStockFromText() {
  try {
    const inventory = await fetchInventoryText();
    if (!REMOTE_STOCK_SYNC_ENABLED) {
      updateAllowedAdminEmails(inventory.adminItems, { persist: true });
      refreshBackofficeAccess();
    }
    return normalizeStockEntries(inventory.stockItems);
  } catch (_) {
    return [];
  }
}

async function fetchStockItems() {
  if (REMOTE_STOCK_SYNC_ENABLED) {
    if (Array.isArray(remoteStockSnapshot)) {
      lastFetchedStockItems = remoteStockSnapshot.slice();
      return lastFetchedStockItems;
    }
    try {
      const remote = await StockSync.getStockSnapshot();
      remoteStockSnapshot = normalizeStockEntries(remote);
      lastFetchedStockItems = remoteStockSnapshot.slice();
      return lastFetchedStockItems;
    } catch (err) {
      console.error('App: no se pudo obtener stock remoto, usando respaldo local', err);
    }
  }
  const fromStorage = loadStockFromStorage();
  if (fromStorage && fromStorage.length) return fromStorage;
  const fallback = await loadStockFromText();
  lastFetchedStockItems = fallback.slice();
  return fallback;
}

function getMaterialStockQuantity(material) {
  return Number.POSITIVE_INFINITY;
}

function getMaterialPrice(material) {
  if (!material) return 0;
  if (!Array.isArray(lastFetchedStockItems) || !lastFetchedStockItems.length) return 0;
  const normalized = material.toLocaleLowerCase();
  const match = lastFetchedStockItems.find((item) => (item.material || '').toLocaleLowerCase() === normalized);
  if (!match) return 0;
  const price = Number.parseFloat(match.price);
  return Number.isFinite(price) ? price : 0;
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
  // DESHABILITADO: La optimización ahora solo se ejecuta con el botón "GENERAR PLANO"
  // if (pendingAutoPlateAllocation || autoPlateAllocationInProgress) return;
  // pendingAutoPlateAllocation = true;
  // requestAnimationFrame(async () => {
  //   pendingAutoPlateAllocation = false;
  //   await ensurePlateCapacity();
  // });
}

async function ensurePlateCapacity() {
  if (autoPlateAllocationInProgress) return;
  autoPlateAllocationInProgress = true;
  try {
    let solution = await solveCutLayoutInternal();
    if (!solution || !Array.isArray(solution.leftoverPieces) || !solution.leftoverPieces.length) return;
    const primaryRow = getPrimaryPlateRow();
    if (!primaryRow) return;
    const material = currentMaterialName || DEFAULT_MATERIAL;
    const stockQty = getMaterialStockQuantity(material);
    const limitedByStock = Number.isFinite(stockQty) && stockQty !== Number.POSITIVE_INFINITY;
    const totalPlates = countCurrentPlates();
    const initialLeftover = solution.leftoverPieces.length;
    const maxAdditional = limitedByStock ? Math.max(0, stockQty - totalPlates) : initialLeftover;
    if (maxAdditional <= 0) {
      if (limitedByStock) {
        showLimitedStockAlert(material);
        revertToLastFeasibleState();
      }
      return;
    }
    const initialQty = getPlateRowQuantity(primaryRow);
    let added = 0;
    let stalled = false;
    let previousLeftover = initialLeftover;
    while (solution.leftoverPieces.length && added < maxAdditional) {
      if (!adjustPlateRowQuantity(primaryRow, 1)) break;
      added += 1;
      const updated = await solveCutLayoutInternal();
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
      } else if (limitedByStock) {
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
  if (REMOTE_STOCK_SYNC_ENABLED && Array.isArray(remoteEdgeSnapshot)) {
    return remoteEdgeSnapshot.slice();
  }
  try {
    const raw = localStorage.getItem(EDGE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeEdgeEntries(parsed);
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

function updateEdgeCatalogSelectTitle(select) {
  if (!select) return;
  const value = (select.value || '').trim();
  if (!value) {
    select.title = edgeCatalog.length ? 'Seleccioná un cubre canto del listado' : 'No hay cubre cantos cargados';
    return;
  }
  const match = edgeCatalog.find((item) => item.name.localeCompare(value, undefined, { sensitivity: 'accent' }) === 0);
  if (!match) {
    select.title = value;
    return;
  }
  const hasPrice = Number.isFinite(match.pricePerMeter) && match.pricePerMeter > 0;
  select.title = hasPrice ? `${match.name} — $${formatNumber(match.pricePerMeter, 2)}/m` : match.name;
}

function populateEdgeCatalogViewer({ preserveValue = true } = {}) {
  if (!edgeCatalogSelect) return;
  const previousValue = preserveValue ? (edgeCatalogSelect.value || '') : '';
  edgeCatalogSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = edgeCatalog.length ? 'Seleccioná un cubre canto' : 'Sin cubre cantos cargados';
  placeholder.dataset.placeholder = '1';
  edgeCatalogSelect.appendChild(placeholder);

  if (!edgeCatalog.length) {
    edgeCatalogSelect.disabled = true;
    edgeCatalogSelect.value = '';
    updateEdgeCatalogSelectTitle(edgeCatalogSelect);
    return;
  }

  edgeCatalog.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = formatEdgeLabel(item);
    if (Number.isFinite(item.pricePerMeter)) {
      option.dataset.pricePerMeter = String(item.pricePerMeter);
    }
    edgeCatalogSelect.appendChild(option);
  });

  edgeCatalogSelect.disabled = false;
  if (previousValue) {
    edgeCatalogSelect.value = previousValue;
    if (edgeCatalogSelect.value !== previousValue) {
      edgeCatalogSelect.value = '';
    }
  } else {
    edgeCatalogSelect.value = '';
  }
  updateEdgeCatalogSelectTitle(edgeCatalogSelect);
}

function populateEdgeSelectOptions(select, selectedValue) {
  if (!select) return;
  const datasetValue = (select.dataset?.value || '').trim();
  const valueHint = selectedValue !== undefined ? selectedValue : (datasetValue || select.value);
  const value = valueHint != null ? String(valueHint).trim() : '';
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

  if (value) {
    select.value = value;
    if (select.value !== value) {
      // value no coincidió con ninguna opción; crear fallback explícito
      const fallback = document.createElement('option');
      fallback.value = value;
      fallback.textContent = `${value} (no listado)`;
      fallback.dataset.missing = '1';
      select.appendChild(fallback);
      select.value = value;
    }
  } else {
    select.value = '';
  }
  const active = select.selectedOptions?.[0];
  if (active && active.value) {
    const raw = (active.textContent || '').trim();
    const [base] = raw.split('—');
    select.dataset.label = (base || raw).trim();
    select.dataset.value = active.value || '';
  } else {
    if (!value) {
      delete select.dataset.label;
      delete select.dataset.value;
    }
  }
}

function refreshEdgeCatalog({ updateRows = true, catalog } = {}) {
  const source = Array.isArray(catalog) ? normalizeEdgeEntries(catalog) : loadEdgeCatalog();
  edgeCatalog = source.slice();
  populateEdgeCatalogViewer();
  if (updateRows) {
    getRows().forEach((row) => {
      if (row._refreshEdgeSelects) row._refreshEdgeSelects();
    });
  }
  scheduleLayoutRecalc({ immediate: true });
}

refreshEdgeCatalog({ updateRows: false });

function updateMaterialDropdownState() {
  if (!addPlateBtn || !plateMaterialSelect) return;
  const hasSelection = !!plateMaterialSelect.value;
  const plateCount = platesEl ? platesEl.querySelectorAll('.plate-row').length : 0;
  const limitReached = isBackofficeAllowed ? plateCount >= 1 : false;
  const shouldDisable = !hasSelection || limitReached;
  addPlateBtn.disabled = shouldDisable;
  addPlateBtn.classList.toggle('disabled-btn', shouldDisable);
  if (!hasSelection) {
    addPlateBtn.title = 'Seleccioná un material para agregar placas';
  } else if (limitReached) {
    addPlateBtn.title = 'Ya agregaste la placa disponible para este proyecto';
  } else {
    addPlateBtn.title = '';
  }
}

function rebuildMaterialOptions(names, { placeholder = false } = {}) {
  if (!plateMaterialSelect) return;
  const previous = currentMaterialName;
  plateMaterialSelect.innerHTML = '';
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'Seleccione';
  placeholderOption.dataset.placeholder = '1';
  plateMaterialSelect.appendChild(placeholderOption);
  if (!names.length) {
    placeholderOption.textContent = placeholder ? placeholder : 'Agregá materiales en el backoffice';
    plateMaterialSelect.disabled = true;
    if (currentMaterialName) {
      currentMaterialName = '';
      try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}
      applyPlatesGate();
    }
    plateMaterialSelect.value = '';
    updateMaterialDropdownState();
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
  let nextSelection = '';
  if (previous) {
    nextSelection = findInsensitive(names, previous) || '';
  }
  if (!nextSelection) {
    try {
      const stored = localStorage.getItem(LAST_MATERIAL_KEY);
      if (stored) nextSelection = findInsensitive(names, stored) || '';
    } catch (_) {}
  }
  if (!nextSelection && findInsensitive(names, DEFAULT_MATERIAL) && previous === DEFAULT_MATERIAL) {
    nextSelection = DEFAULT_MATERIAL;
  }
  if (nextSelection) {
    plateMaterialSelect.value = nextSelection;
    currentMaterialName = nextSelection;
    try { localStorage.setItem(LAST_MATERIAL_KEY, currentMaterialName); } catch (_) {}
  } else {
    plateMaterialSelect.value = '';
    currentMaterialName = '';
    try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}
  }
  updateMaterialDropdownState();
  applyPlatesGate();
}

async function refreshMaterialOptions(prefetchedItems) {
  if (!plateMaterialSelect) return;
  let items = Array.isArray(prefetchedItems) ? prefetchedItems : await fetchStockItems();
  const normalized = normalizeStockEntries(items);
  lastFetchedStockItems = normalized.slice();
  const available = normalized.slice();
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

function maybeAutoAppendRow() {
  if (!addRowBtn || addRowBtn.disabled) return;
  if (!isSheetComplete()) return;
  const rows = getRows();
  if (!rows.length) return;
  if (rows.length >= MAX_ROWS) return;
  const lastRow = rows[rows.length - 1];
  if (!isRowCompleteEl(lastRow)) return;
  addRowBtn.click();
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

function parsePlateRow(row) {
  if (!row) return null;
  const sw = parseFloat(row.querySelector('input.plate-w')?.value ?? '');
  const sh = parseFloat(row.querySelector('input.plate-h')?.value ?? '');
  const sc = parseInt(row.querySelector('input.plate-c')?.value ?? '', 10);
  const tmm = parseInt(row.querySelector('input.trim-mm')?.value ?? '0', 10) || 0;
  const sides = row.querySelectorAll('.trim-controls .side input');
  const top = !!sides[0]?.checked;
  const right = !!sides[1]?.checked;
  const bottom = !!sides[2]?.checked;
  const left = !!sides[3]?.checked;
  if (!(sw > 0 && sh > 0 && sc >= 1)) return null;
  return {
    sw,
    sh,
    sc,
    trim: { mm: tmm, top, right, bottom, left },
    rowEl: row
  };
}

function getPlateRowsWithRefs() {
  const rows = [];
  if (!platesEl) return rows;
  platesEl.querySelectorAll('.plate-row').forEach((row) => {
    const parsed = parsePlateRow(row);
    if (parsed) rows.push(parsed);
  });
  return rows;
}

function getPlates() {
  return getPlateRowsWithRefs().map(({ rowEl, ...rest }) => rest);
}

function getPrimaryPlateDims() {
  const list = getPlates();
  return list.length ? { sw: list[0].sw, sh: list[0].sh } : null;
}

function isSheetComplete() {
  return getPlates().length > 0;
}

function toggleActionButtons(isReady) {
  const setState = (btn, enabled) => {
    if (!btn) return;
    if (btn.dataset.busy === '1') return;
    if (enabled) {
      btn.disabled = false;
      btn.classList.remove('disabled-btn');
    } else {
      btn.disabled = true;
      btn.classList.add('disabled-btn');
    }
  };

  setState(saveJsonBtn, isReady);
  setState(exportPdfBtn, isReady && isBackofficeAllowed);
  
  // Habilitar botones de limpiar solo si hay filas
  const hasRows = currentRowCount() > 0;
  setState(clearAllBtn, hasRows);
  setState(resetAllBtn, isReady || hasRows);
  
  if (sendCutsBtn) {
    if (sendCutsBtn.dataset.busy === '1') return;
    if (isReady) {
      sendCutsBtn.disabled = false;
      sendCutsBtn.classList.remove('disabled-btn');
      sendCutsBtn.textContent = sendCutsDefaultLabel;
    } else {
      sendCutsBtn.disabled = true;
      sendCutsBtn.classList.add('disabled-btn');
      sendCutsBtn.textContent = sendCutsDefaultLabel;
    }
  }
}

function buildWhatsappUrl() {
  const text = encodeURIComponent(WHATSAPP_MESSAGE);
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
}

function getKerfMm() {
  const v = parseInt(kerfInput?.value ?? pendingKerfValue ?? '0', 10);
  if (isNaN(v) || v < 0) return 0;
  // El input ya está en milímetros
  return v;
}

function buildWorkerPayload(inputs) {
  if (!inputs) return null;

  const sanitizeTrim = (trim) => {
    if (!trim || typeof trim !== 'object') {
      return { mm: 0, top: false, right: false, bottom: false, left: false };
    }
    return {
      mm: Number.isFinite(trim.mm) ? trim.mm : 0,
      top: !!trim.top,
      right: !!trim.right,
      bottom: !!trim.bottom,
      left: !!trim.left
    };
  };

  const sanitizeInstance = (instance) => {
    if (!instance || typeof instance !== 'object') return null;
    return {
      sw: Number.isFinite(instance.sw) ? instance.sw : 0,
      sh: Number.isFinite(instance.sh) ? instance.sh : 0,
      trim: sanitizeTrim(instance.trim),
      trimTop: Number.isFinite(instance.trimTop) ? instance.trimTop : undefined,
      trimRight: Number.isFinite(instance.trimRight) ? instance.trimRight : undefined,
      trimBottom: Number.isFinite(instance.trimBottom) ? instance.trimBottom : undefined,
      trimLeft: Number.isFinite(instance.trimLeft) ? instance.trimLeft : undefined,
      material: typeof instance.material === 'string' ? instance.material : undefined,
      plateRow: Number.isFinite(instance.plateRow) ? instance.plateRow : undefined
    };
  };

  const sanitizePiece = (piece) => {
    if (!piece || typeof piece !== 'object') return null;
    return {
      id: piece.id,
      rowIdx: Number.isFinite(piece.rowIdx) ? piece.rowIdx : 0,
      rawW: Number.isFinite(piece.rawW) ? piece.rawW : 0,
      rawH: Number.isFinite(piece.rawH) ? piece.rawH : 0,
      color: typeof piece.color === 'string' ? piece.color : '#ccc',
      rot: !!piece.rot,
      area: Number.isFinite(piece.area) ? piece.area : (Number(piece.rawW) * Number(piece.rawH)) || 0,
      dimKey: typeof piece.dimKey === 'string' ? piece.dimKey : undefined
    };
  };

  const instances = Array.isArray(inputs.instances)
    ? inputs.instances.map(sanitizeInstance).filter(Boolean)
    : [];
  const pieces = Array.isArray(inputs.pieces)
    ? inputs.pieces.map(sanitizePiece).filter(Boolean)
    : [];

  return {
    instances,
    pieces,
    totalRequested: Number.isFinite(inputs.totalRequested) ? inputs.totalRequested : pieces.length,
    allowAutoRotate: !!inputs.allowAutoRotate,
    kerf: Number.isFinite(inputs.kerf) ? inputs.kerf : 0
  };
}

const PACKING_EPSILON = 0.0001;

function computeTrimOffsetsLocal(instance) {
  const offsets = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!instance || typeof instance !== 'object') return offsets;
  const trim = instance.trim || {};
  const mm = Number.isFinite(trim.mm) ? Math.max(0, trim.mm) : null;
  const pick = (flag, fallbackValue) => {
    if (flag) {
      if (mm != null) return mm;
      if (Number.isFinite(flag)) return Math.max(0, flag);
    }
    if (Number.isFinite(fallbackValue)) return Math.max(0, fallbackValue);
    return 0;
  };
  offsets.top = pick(trim.top, instance.trimTop);
  offsets.right = pick(trim.right, instance.trimRight);
  offsets.bottom = pick(trim.bottom, instance.trimBottom);
  offsets.left = pick(trim.left, instance.trimLeft);
  return offsets;
}

function createPlateStateLocal(instance, kerf) {
  const offsets = computeTrimOffsetsLocal(instance);
  const usableW = Math.max(0, instance.sw - offsets.left - offsets.right);
  const usableH = Math.max(0, instance.sh - offsets.top - offsets.bottom);

  return {
    instance,
    kerf,
    usableW,
    usableH,
    offX: offsets.left,
    offY: offsets.top
  };
}

function getOrientationChoicesLocal(piece, allowAutoRotate) {
  const orientations = [{
    width: piece.rawW,
    height: piece.rawH,
    rotated: false
  }];

  if (allowAutoRotate && Math.abs(piece.rawW - piece.rawH) > PACKING_EPSILON) {
    orientations.push({
      width: piece.rawH,
      height: piece.rawW,
      rotated: true
    });
  }

  return orientations;
}

function hasUnplacedPiecesLocal(pool) {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].placed) return true;
  }
  return false;
}

function pickStripStarterLocal(state, pool, allowAutoRotate, remainingWidth) {
  if (remainingWidth <= PACKING_EPSILON) return null;
  let best = null;

  for (let idx = 0; idx < pool.length && !forceStopSolver; idx++) {
    const entry = pool[idx];
    if (entry.placed) continue;
    const orientations = getOrientationChoicesLocal(entry, allowAutoRotate);
    for (const orientation of orientations) {
      if (orientation.width > state.usableW + PACKING_EPSILON) continue;
      if (orientation.height > state.usableH + PACKING_EPSILON) continue;
      if (orientation.width > remainingWidth + PACKING_EPSILON) continue;
      const gap = remainingWidth - orientation.width;
      if (!best ||
          gap < best.gap - PACKING_EPSILON ||
          (Math.abs(gap - best.gap) <= PACKING_EPSILON && orientation.width > best.orientation.width + PACKING_EPSILON) ||
          (Math.abs(gap - best.gap) <= PACKING_EPSILON && Math.abs(orientation.width - best.orientation.width) <= PACKING_EPSILON &&
           orientation.height > best.orientation.height + PACKING_EPSILON)) {
        best = {
          index: idx,
          orientation,
          gap
        };
      }
    }
  }

  return best;
}

function pickPieceForStripLocal(pool, targetWidth, allowAutoRotate, maxHeight) {
  if (maxHeight <= PACKING_EPSILON) return null;
  let best = null;

  for (let idx = 0; idx < pool.length && !forceStopSolver; idx++) {
    const entry = pool[idx];
    if (entry.placed) continue;
    const orientations = getOrientationChoicesLocal(entry, allowAutoRotate);
    for (const orientation of orientations) {
      if (Math.abs(orientation.width - targetWidth) > PACKING_EPSILON) continue;
      if (orientation.height > maxHeight + PACKING_EPSILON) continue;
      if (!best ||
          orientation.height > best.orientation.height + PACKING_EPSILON ||
          (Math.abs(orientation.height - best.orientation.height) <= PACKING_EPSILON && entry.area > best.entry.area + PACKING_EPSILON)) {
        best = {
          index: idx,
          entry,
          orientation
        };
      }
    }
  }

  return best;
}

function recordPlacementLocal(strip, y, entry, orientation, plateIdx, placements, placementsByPlate, bestOrder, metrics) {
  const placement = {
    id: entry.id,
    piece: entry.source,
    plateIdx,
    x: strip.x,
    y,
    w: orientation.width,
    h: orientation.height,
    usedW: orientation.width,
    usedH: orientation.height,
    rawW: orientation.width,
    rawH: orientation.height,
    rot: orientation.rotated ? !entry.rot : !!entry.rot,
    color: entry.color,
    rowIdx: entry.rowIdx
  };

  placements.push(placement);
  placementsByPlate[plateIdx].push(placement);
  bestOrder.push(entry.id);

  entry.placed = true;
  entry.finalRotated = orientation.rotated;
  metrics.usedArea += orientation.width * orientation.height;
}

function fillStripWithPiecesLocal(state, strip, pool, allowAutoRotate, kerf, plateIdx, placements, placementsByPlate, bestOrder, metrics) {
  while (!forceStopSolver) {
    const remainingHeight = state.offY + state.usableH - strip.nextY;
    const effectiveMax = remainingHeight - kerf;
    if (effectiveMax <= PACKING_EPSILON) break;

    const candidate = pickPieceForStripLocal(pool, strip.width, allowAutoRotate, effectiveMax);
    if (!candidate) break;

    strip.nextY += kerf;
    const y = strip.nextY;
    recordPlacementLocal(strip, y, candidate.entry, candidate.orientation, plateIdx, placements, placementsByPlate, bestOrder, metrics);
    strip.nextY = y + candidate.orientation.height;
  }
}

function solveWithGuillotineLocal(instances, pieces, options = {}) {
  if (!Array.isArray(instances) || !instances.length) return null;

  const allowAutoRotate = !!options.allowAutoRotate;
  const kerf = Number.isFinite(options.kerf) ? options.kerf : 0;

  const states = instances.map(inst => createPlateStateLocal(inst, kerf));
  const pool = pieces.map(piece => ({
    id: piece.id,
    rowIdx: piece.rowIdx,
    rawW: piece.rawW,
    rawH: piece.rawH,
    color: piece.color,
    rot: piece.rot,
    area: piece.rawW * piece.rawH,
    dimKey: piece.dimKey,
    source: piece,
    placed: false
  }));

  const placements = [];
  const placementsByPlate = states.map(() => []);
  const bestOrder = [];
  const metrics = { usedArea: 0 };

  for (let plateIdx = 0; plateIdx < states.length && !forceStopSolver; plateIdx++) {
    if (!hasUnplacedPiecesLocal(pool)) break;
    const state = states[plateIdx];
    if (state.usableW <= PACKING_EPSILON || state.usableH <= PACKING_EPSILON) continue;

    let xCursor = state.offX;
    let strips = 0;

    while (!forceStopSolver && hasUnplacedPiecesLocal(pool)) {
      let remainingWidth = state.offX + state.usableW - xCursor;
      if (strips > 0) {
        remainingWidth -= kerf;
        if (remainingWidth <= PACKING_EPSILON) break;
      }

      const starter = pickStripStarterLocal(state, pool, allowAutoRotate, remainingWidth);
      if (!starter) break;

      if (strips > 0) {
        xCursor += kerf;
      }

      if (xCursor + starter.orientation.width > state.offX + state.usableW + PACKING_EPSILON) {
        if (strips > 0) {
          xCursor -= kerf;
        }
        break;
      }

      const strip = {
        width: starter.orientation.width,
        x: xCursor,
        nextY: state.offY
      };

      const entry = pool[starter.index];
      const firstY = strip.nextY;
      recordPlacementLocal(strip, firstY, entry, starter.orientation, plateIdx, placements, placementsByPlate, bestOrder, metrics);
      strip.nextY = firstY + starter.orientation.height;

      fillStripWithPiecesLocal(state, strip, pool, allowAutoRotate, kerf, plateIdx, placements, placementsByPlate, bestOrder, metrics);

      xCursor += strip.width;
      strips += 1;
    }
  }

  const leftovers = pool
    .filter(entry => !entry.placed)
    .map(entry => ({
      id: entry.id,
      rowIdx: entry.rowIdx,
      rawW: entry.rawW,
      rawH: entry.rawH,
      color: entry.color,
      rot: entry.rot,
      area: entry.rawW * entry.rawH,
      dimKey: entry.dimKey
    }));

  const totalArea = instances.reduce((acc, inst) => acc + (inst.sw * inst.sh), 0);
  const usedArea = metrics.usedArea;
  const wasteArea = Math.max(0, totalArea - usedArea);
  const penalty = leftovers.length > 0 ? totalArea * leftovers.length * 100 : 0;

  return {
    placements,
    placementsByPlate,
    leftovers,
    usedArea,
    wasteArea,
    totalArea,
    bestOrder,
    score: wasteArea + penalty,
    iterationsUsed: 0,
    acceptedMoves: 0,
    baseScore: wasteArea
  };
}

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
  const plateRows = getPlateRowsWithRefs();
  if (!plateRows.length) return null;

  const instances = [];
  const instanceMeta = [];
  plateRows.forEach((p, plateRowIdx) => {
    for (let i = 0; i < p.sc; i++) {
      instances.push({ sw: p.sw, sh: p.sh, trim: p.trim || { mm: 0, top: false, right: false, bottom: false, left: false } });
      instanceMeta.push({ plateRowIdx });
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
    instanceMeta,
    plateRows,
    pieces,
    totalRequested,
    allowAutoRotate,
    kerf
  };
}

function reducePlateUsageIfPossible({ instances, instanceMeta, plateRows, initialSolution, initialPieces, runSolver }) {
  if (!Array.isArray(instances) || instances.length <= 1) return null;
  if (!Array.isArray(instanceMeta) || instanceMeta.length !== instances.length) return null;
  if (!Array.isArray(plateRows) || !plateRows.length) return null;

  let workingInstances = instances.slice();
  let workingMeta = instanceMeta.slice();
  let workingSolution = initialSolution;
  let workingPieces = initialPieces;
  const rowUsage = plateRows.map((row) => Math.max(0, Number.isFinite(row?.sc) ? row.sc : 0));
  let improved = false;

  while (workingInstances.length > 1) {
    const removalIdx = workingMeta.length - 1;
    if (removalIdx < 0) break;
    const removedMeta = workingMeta[removalIdx];
    const candidateInstances = workingInstances.slice(0, -1);
    const attempt = runSolver(candidateInstances, workingPieces);
    if (attempt.solution.leftovers.length) break;

    const rowIdx = removedMeta?.plateRowIdx;
    if (rowIdx != null && rowIdx >= 0 && rowIdx < rowUsage.length) {
      rowUsage[rowIdx] = Math.max(0, rowUsage[rowIdx] - 1);
    }

    workingInstances = candidateInstances;
    workingMeta = workingMeta.slice(0, -1);
    workingSolution = attempt.solution;
    workingPieces = attempt.pieces;
    improved = true;
  }

  if (!improved) return null;

  const usageCounts = new Map();
  workingMeta.forEach((meta) => {
    const idx = meta?.plateRowIdx ?? 0;
    usageCounts.set(idx, (usageCounts.get(idx) || 0) + 1);
  });

  plateRows.forEach((row, idx) => {
    const used = usageCounts.has(idx) ? usageCounts.get(idx) : 0;
    const target = Math.max(1, Math.max(used, rowUsage[idx] || 0));
    row.sc = target;
    if (row.rowEl) {
      const input = row.rowEl.querySelector('input.plate-c');
      if (input) {
        const currentVal = parseInt(input.value, 10);
        if (!Number.isFinite(currentVal) || currentVal !== target) {
          input.value = String(target);
        }
      }
    }
  });

  return {
    instances: workingInstances,
    instanceMeta: workingMeta,
    solution: workingSolution,
    pieces: workingPieces,
    plateUsage: usageCounts
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

async function solveCutLayoutInternal() {
  const inputs = collectSolverInputs();
  if (!inputs) return lastSuccessfulSolution;

  console.log('🔍 Iniciando solveCutLayoutInternal con', inputs.pieces.length, 'piezas');

  const cacheKey = getCacheKey(inputs.instances, inputs.pieces, {
    kerf: inputs.kerf,
    allowAutoRotate: inputs.allowAutoRotate
  });
  
  // Verificar cache en memoria primero (incluye soluciones guardadas del JSON)
  if (solverCache.has(cacheKey)) {
    const cached = solverCache.get(cacheKey);
    if (cached.timestamp) {
      console.log('💾 Usando solución guardada del JSON');
    } else {
      console.log('💾 Usando cache en memoria');
    }
    lastSuccessfulSolution = cached;
    return cached;
  }
  
  // Verificar cache persistente
  const persistentCached = loadPersistentCache(cacheKey);
  if (persistentCached) {
    console.log('💾 Usando cache persistente (puede ser de solución guardada anterior)');
    solverCache.set(cacheKey, persistentCached);
    lastSuccessfulSolution = persistentCached;
    return persistentCached;
  }

  // Usar worker si está disponible, sino fallback al método original
  try {
    if (solverWorker && solverWorker.worker) {
      const workerPayload = buildWorkerPayload(inputs);
      const result = await solverWorker.solve(workerPayload);
      if (result) {
        lastSuccessfulSolution = result;
        solverCache.set(cacheKey, result);
        savePersistentCache(cacheKey, result);
      }
      return result || lastSuccessfulSolution;
    } else {
      // Fallback al método original si no hay worker
      const result = solveCutLayoutInternalUncached(inputs);
      if (result) {
        lastSuccessfulSolution = result;
        solverCache.set(cacheKey, result);
      }
      return result || lastSuccessfulSolution;
    }
  } catch (error) {
    console.error('Error en solver:', error);
    
    // Fallback al método original en caso de error
    try {
      const result = solveCutLayoutInternalUncached(inputs);
      if (result) {
        lastSuccessfulSolution = result;
        solverCache.set(cacheKey, result);
        savePersistentCache(cacheKey, result);
      }
      return result || lastSuccessfulSolution;
    } catch (fallbackError) {
      console.error('Error en fallback:', fallbackError);
      return lastSuccessfulSolution;
    }
  }
}

function solveCutLayoutInternalUncached(inputs) {
  if (!inputs) return null;

  let { instances, instanceMeta, plateRows, pieces, totalRequested, allowAutoRotate, kerf } = inputs;
  const clonePieces = (src) => src.map(piece => ({ ...piece }));
  const runSolverWithFallback = (instSubset, pieceSource) => {
    let workingPieces = clonePieces(pieceSource);
    const options = {
      allowAutoRotate,
      kerf: Number.isFinite(kerf) ? kerf : 0
    };

    let sol = solveWithGuillotineLocal(instSubset, workingPieces, options);

    if (!sol) {
      return {
        solution: {
          placements: [],
          placementsByPlate: instSubset.map(() => []),
          leftovers: workingPieces.slice(),
          usedArea: 0,
          wasteArea: 0,
          totalArea: instSubset.reduce((acc, inst) => acc + (inst.sw * inst.sh), 0),
          bestOrder: [],
          score: Infinity,
          iterationsUsed: 0,
          acceptedMoves: 0,
          baseScore: Infinity
        },
        pieces: workingPieces
      };
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
      // Para cortes guillotina, una reorganización que priorice placas posteriores
      // no cambiará el ancho de las tiras; se mantiene la solución actual.
    }
  }

  const reduced = reducePlateUsageIfPossible({
    instances,
    instanceMeta,
    plateRows,
    initialSolution: solution,
    initialPieces: solverPieces,
    runSolver: runSolverWithFallback
  });
  if (reduced) {
    instances = reduced.instances;
    instanceMeta = reduced.instanceMeta;
    solution = reduced.solution;
    solverPieces = reduced.pieces;
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
      baseScore: solution.baseScore != null ? solution.baseScore : (solution.score != null ? solution.score : 0),
      iterations: solution.iterationsUsed || 0,
      acceptedMoves: solution.acceptedMoves || 0
    }
  };
}

async function computePlacement() {
  const result = await solveCutLayoutInternal();
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
  row._edgeNames = { horizontal: '', vertical: '' };

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
  attachNumericFilter(iQty, { allowBlank: true });
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
  attachNumericFilter(iW, { allowBlank: true });
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
  attachNumericFilter(iWLevel, { allowBlank: true });
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
  attachNumericFilter(iH, { allowBlank: true });
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
  attachNumericFilter(iHLevel, { allowBlank: true });
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
      verticalCount: Math.max(previewVertical, heightTierVal),
      horizontalCount: Math.max(previewHorizontal, widthTierVal),
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
    scheduleLayoutRecalc({ priority: 'normal' });
    persistState && persistState();
  };
  const handleTierInputChange = (input) => {
    let parsed = parseInt(input.value.trim(), 10);
    if (!Number.isFinite(parsed)) parsed = 0;
    parsed = clamp(parsed, 0, 2);
    if (String(parsed) !== input.value) input.value = String(parsed);
    
    // Auto-seleccionar el valor del combo principal cuando el valor es mayor a 0
    if (parsed > 0) {
      const isWidthInput = input === iWLevel;
      const select = isWidthInput ? wEdgeSelect : hEdgeSelect;
      
      // Si no tiene selección o tiene "sin cubre canto", usar el combo principal o BLANCO
      const currentValue = (select?.value || '').trim();
      if (!currentValue || /^sin\s+cubre\s*canto/i.test(currentValue)) {
        // Primero intentar usar el valor del combo principal
        const catalogValue = edgeCatalogSelect?.value || '';
        if (catalogValue) {
          // Buscar opción que coincida con el combo principal
          const catalogOption = Array.from(select?.options || []).find(opt => 
            opt.value === catalogValue
          );
          if (catalogOption) {
            select.value = catalogOption.value;
            handleEdgeSelectChange();
          }
        } else {
          // Fallback: buscar opción que contenga "BLANCO"
          const blancoOption = Array.from(select?.options || []).find(opt => 
            opt.textContent.toUpperCase().includes('BLANCO')
          );
          if (blancoOption) {
            select.value = blancoOption.value;
            handleEdgeSelectChange();
          }
        }
      }
    }
    
    syncEdgesFromTierInputs({ emitChange: true });
  };
  tierInputs.forEach((input) => {
    input.addEventListener('input', () => handleTierInputChange(input));
  });
  const deriveEdgeDisplayName = (select) => {
    if (!select) return '';
    const directValue = (select.value || '').trim();
    if (directValue && !/^sin\s+cubre\s*canto/i.test(directValue)) return directValue;
    const datasetLabel = (select.dataset?.label || '').trim();
    if (datasetLabel && !/^sin\s+cubre\s*canto/i.test(datasetLabel)) return datasetLabel;
    const datasetValue = (select.dataset?.value || '').trim();
    if (datasetValue && !/^sin\s+cubre\s*canto/i.test(datasetValue)) return datasetValue;
    const option = select.selectedOptions?.[0];
    if (!option) return '';
    const raw = (option.textContent || '').trim();
    if (!raw || /^sin\s+cubre\s*canto/i.test(raw)) return '';
    const [base] = raw.split('—');
    return (base || raw).trim();
  };

  const syncStoredEdgeNames = () => {
    if (!row._edgeNames) row._edgeNames = { horizontal: '', vertical: '' };
    row._edgeNames.horizontal = deriveEdgeDisplayName(wEdgeSelect);
    row._edgeNames.vertical = deriveEdgeDisplayName(hEdgeSelect);
  };

  const handleEdgeSelectChange = () => {
    const syncLabelDataset = (select) => {
      if (!select) return;
      const active = select.selectedOptions?.[0];
      if (active && active.value) {
        const raw = (active.textContent || '').trim();
        const [base] = raw.split('—');
        select.dataset.label = (base || raw).trim();
        select.dataset.value = active.value || '';
      } else {
        delete select.dataset.label;
        delete select.dataset.value;
      }
    };
    syncLabelDataset(wEdgeSelect);
    syncLabelDataset(hEdgeSelect);
    syncStoredEdgeNames();
    updateEdgeColors();
    scheduleLayoutRecalc({ priority: 'normal' });
    if (typeof persistState === 'function') persistState();
  };

  const updateEdgeColors = () => {
    // Obtener el texto completo de la opción seleccionada
    const getSelectedText = (select) => {
      if (!select) return '';
      const option = select.selectedOptions?.[0];
      if (!option) return '';
      return (option.textContent || '').trim().toUpperCase();
    };
    
    const wEdgeText = getSelectedText(wEdgeSelect);
    const hEdgeText = getSelectedText(hEdgeSelect);
    
    console.log('🎨 updateEdgeColors:', {
      wEdgeText,
      hEdgeText,
      widthHasBlanco: wEdgeText.includes('BLANCO'),
      heightHasBlanco: hEdgeText.includes('BLANCO')
    });
    
    // Determinar color según nueva lógica:
    // - Sin selección o "sin cubre canto" → ROJO
    // - BLANCO seleccionado → BLANCO
    // - Cualquier otro color → AMARILLO
    const getEdgeColor = (text) => {
      if (!text || text === '' || text.includes('SIN CUBRE')) {
        return '#ef4444'; // Rojo para sin selección o "sin cubre canto"
      }
      if (text.includes('BLANCO')) {
        return '#ffffff'; // Blanco para BLANCO
      }
      return '#fbbf24'; // Amarillo para otros colores
    };
    
    const horizontalColor = getEdgeColor(wEdgeText);
    const verticalColor = getEdgeColor(hEdgeText);
    
    // Solo aplicar color a los bordes que están SELECCIONADOS
    // Bordes horizontales (top/bottom)
    if (edges.top && edges.top.dataset.selected === '1') {
      edges.top.style.stroke = horizontalColor;
    } else if (edges.top) {
      edges.top.style.stroke = '#ef4444';
    }
    
    if (edges.bottom && edges.bottom.dataset.selected === '1') {
      edges.bottom.style.stroke = horizontalColor;
    } else if (edges.bottom) {
      edges.bottom.style.stroke = '#ef4444';
    }
    
    // Bordes verticales (left/right)
    if (edges.left && edges.left.dataset.selected === '1') {
      edges.left.style.stroke = verticalColor;
    } else if (edges.left) {
      edges.left.style.stroke = '#ef4444';
    }
    
    if (edges.right && edges.right.dataset.selected === '1') {
      edges.right.style.stroke = verticalColor;
    } else if (edges.right) {
      edges.right.style.stroke = '#ef4444';
    }
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
    const hasHorizontalEdges = horizontalCount > 0;
    const hasVerticalEdges = verticalCount > 0;
    const states = [
      // Selector colocado en la columna "Ancho" (bordes superiores/inferiores)
      { select: wEdgeSelect, enable: hasHorizontalEdges },
      // Selector en la columna "Alto" (bordes izquierdos/derechos)
      { select: hEdgeSelect, enable: hasVerticalEdges }
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
    const widthCount = (edges.top.dataset.selected === '1' ? 1 : 0) + (edges.bottom.dataset.selected === '1' ? 1 : 0);
    const heightCount = (edges.left.dataset.selected === '1' ? 1 : 0) + (edges.right.dataset.selected === '1' ? 1 : 0);
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

    const topSelected = edges.top.dataset.selected === '1';
    const bottomSelected = edges.bottom.dataset.selected === '1';
    if (widthVal === 0) {
      setEdgeSelected(edges.top, false, true);
      setEdgeSelected(edges.bottom, false, true);
    } else if (widthVal === 1) {
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

    const leftSelected = edges.left.dataset.selected === '1';
    const rightSelected = edges.right.dataset.selected === '1';
    if (heightVal === 0) {
      setEdgeSelected(edges.left, false, true);
      setEdgeSelected(edges.right, false, true);
    } else if (heightVal === 1) {
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

    updateTierInputsFromEdges();
    updatePreview();
    if (emitChange) applyTierChange();
  }

  const handleEdgeToggle = (edge) => {
    const newSelected = edge.dataset.selected !== '1';
    setEdgeSelected(edge, newSelected);
    scheduleLayoutRecalc({ priority: 'normal' });
    persistState && persistState();
  };

  for (const key of Object.keys(edges)) {
    const el = edges[key];
    el.setAttribute('class', 'edge');
    el.dataset.selected = '0';
    el.style.stroke = '#ef4444';
    el.setAttribute('stroke-width', '3');
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
    // Obtener valor por defecto del combo principal si existe
    const defaultEdgeValue = edgeCatalogSelect?.value || '';
    populateEdgeSelectOptions(wEdgeSelect, defaultEdgeValue);
    populateEdgeSelectOptions(hEdgeSelect, defaultEdgeValue);
    syncStoredEdgeNames();
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
      updateEdgeColors();
    } else {
      // Al bloquear, limpiar selección de bordes
      for (const key of Object.keys(edges)) {
        const el = edges[key];
        el.dataset.selected = '0';
        el.classList.remove('selected');
        el.style.stroke = '#ef4444';
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

  iW.addEventListener('input', () => { 
    invalidateSolverCache();
    updatePreview(); 
    toggleAddButton(); 
    scheduleLayoutRecalc({ priority: 'low', defer: true }); 
    persistState && persistState(); 
    maybeAutoAppendRow(); 
  });
  iH.addEventListener('input', () => { 
    invalidateSolverCache();
    updatePreview(); 
    toggleAddButton(); 
    scheduleLayoutRecalc({ priority: 'low', defer: true }); 
    persistState && persistState(); 
    maybeAutoAppendRow(); 
  });
  iRot.addEventListener('change', () => {
    row._manualRotWanted = iRot.checked;
    updatePreview();
    scheduleLayoutRecalc({ priority: 'normal' });
    persistState && persistState();
  });

  // Cambios de cantidad no afectan la vista previa, pero validamos
  iQty.addEventListener('input', () => {
    if (iQty.value !== '') {
      const v = parseInt(iQty.value, 10);
      if (isNaN(v) || v < 1) iQty.value = '1';
    }
    invalidateSolverCache();
    updatePreview();
    toggleAddButton();
    scheduleLayoutRecalc({ priority: 'low', defer: true });
    persistState && persistState();
    maybeAutoAppendRow();
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
  clearAllRows();
  rowsEl.appendChild(makeRow(currentRowCount()));
  reindexRows();
  applyPlatesGate();
  
  // Resetear optimización avanzada y cache
  showingAdvancedOptimization = false;
  lastOptimizationHash = null;
  lastOptimizationResult = null;
  if (sheetCanvasEl) {
    sheetCanvasEl.innerHTML = '';
  }
});

// Crear filas iniciales si no hay (cuando no hay proyecto guardado)
function ensureDefaultRows() {
  if (!isSheetComplete()) return;
  if (currentRowCount() === 0) {
    rowsEl.appendChild(makeRow(0));
    toggleAddButton();
  }
}

// Asegurar que la rotación automática esté habilitada por defecto
if (autoRotateToggle) autoRotateToggle.checked = true;

// Actualizar todas las filas cuando cambian las placas
function refreshAllPreviews() {
  getRows().forEach(r => r._updatePreview && r._updatePreview());
}

function ensureKerfField() {
  if (!isBackofficeAllowed) return;
  if (!platesEl) return;
  const firstRow = platesEl.querySelector('.plate-row');
  if (!firstRow) return;
  const kerfSlot = firstRow.querySelector('.kerf-slot');
  if (!kerfSlot) return;

  if (!kerfInput) {
    kerfInput = document.createElement('input');
    kerfInput.id = 'kerfInput';
    kerfInput.type = 'number';
    kerfInput.min = '0';
    kerfInput.step = '1';
    kerfInput.value = pendingKerfValue != null ? pendingKerfValue : '5';
  }

  if (!kerfFieldWrapper) {
    kerfFieldWrapper = document.createElement('div');
    kerfFieldWrapper.className = 'field kerf-field';
    const label = document.createElement('label');
    label.setAttribute('for', 'kerfInput');
    label.textContent = 'Desp. de Sierra (mm)';
    kerfFieldWrapper.appendChild(label);
    kerfFieldWrapper.appendChild(kerfInput);
  }

  if (!kerfFieldWrapper.contains(kerfInput)) {
    kerfFieldWrapper.appendChild(kerfInput);
  }

  if (kerfSlot.firstChild && kerfSlot.firstChild !== kerfFieldWrapper) {
    kerfSlot.innerHTML = '';
  }
  if (kerfFieldWrapper.parentElement !== kerfSlot) {
    kerfSlot.appendChild(kerfFieldWrapper);
  }

  if (pendingKerfValue != null) {
    kerfInput.value = pendingKerfValue;
  } else if (!kerfInput.value) {
    kerfInput.value = '5';
  }
  pendingKerfValue = kerfInput.value;

  if (!kerfInput._kerfListenerAttached) {
    kerfInput.addEventListener('input', () => {
      pendingKerfValue = kerfInput.value;
      applyPlatesGate();
    });
    kerfInput._kerfListenerAttached = true;
  }
}

function makePlateRow(options = {}) {
  const readOnlySize = !!options.readOnlySize;
  const widthValue = options.width != null ? options.width : (readOnlySize ? DEFAULT_PLATE_WIDTH : '');
  const heightValue = options.height != null ? options.height : (readOnlySize ? DEFAULT_PLATE_HEIGHT : '');

  const row = document.createElement('div');
  row.className = 'plate-row';

  const fW = document.createElement('div'); fW.className = 'field';
  const lW = document.createElement('label'); lW.textContent = 'Ancho (mm)';
  const iW = document.createElement('input'); iW.className = 'plate-w'; iW.type = 'number'; iW.min = '0'; iW.step = '1'; iW.placeholder = 'Ej: 2440';
  attachNumericFilter(iW, { allowBlank: false });
  if (widthValue !== '') iW.value = String(widthValue);
  if (readOnlySize) {
    iW.disabled = true;
    iW.classList.add('readonly-input');
  }
  fW.appendChild(lW); fW.appendChild(iW);

  const fH = document.createElement('div'); fH.className = 'field';
  const lH = document.createElement('label'); lH.textContent = 'Alto (mm)';
  const iH = document.createElement('input'); iH.className = 'plate-h'; iH.type = 'number'; iH.min = '0'; iH.step = '1'; iH.placeholder = 'Ej: 1220';
  attachNumericFilter(iH, { allowBlank: false });
  if (heightValue !== '') iH.value = String(heightValue);
  if (readOnlySize) {
    iH.disabled = true;
    iH.classList.add('readonly-input');
  }
  fH.appendChild(lH); fH.appendChild(iH);

  const iC = document.createElement('input');
  iC.className = 'plate-c';
  iC.type = 'hidden';
  iC.value = '1';

  const trim = document.createElement('div');
  trim.className = 'trim-wrap';
  const trimControls = document.createElement('div');
  trimControls.className = 'trim-controls';
  const trimLabel = document.createElement('div'); trimLabel.className = 'trim-label'; trimLabel.innerHTML = 'Refilado <span class="trim-badge">naranja</span> (mm) + lados';
  const trimMm = document.createElement('input'); trimMm.className = 'trim-mm'; trimMm.type = 'number'; trimMm.min = '0'; trimMm.step = '1'; trimMm.value = '13'; trimMm.title = 'Refilado en milímetros';
  attachNumericFilter(trimMm, { allowBlank: false });
  const sideTop = document.createElement('label'); sideTop.className = 'side'; const cTop = document.createElement('input'); cTop.type = 'checkbox'; sideTop.appendChild(cTop); sideTop.appendChild(document.createTextNode('Arriba'));
  const sideRight = document.createElement('label'); sideRight.className = 'side'; const cRight = document.createElement('input'); cRight.type = 'checkbox'; sideRight.appendChild(cRight); sideRight.appendChild(document.createTextNode('Derecha'));
  const sideBottom = document.createElement('label'); sideBottom.className = 'side'; const cBottom = document.createElement('input'); cBottom.type = 'checkbox'; cBottom.checked = true; sideBottom.appendChild(cBottom); sideBottom.appendChild(document.createTextNode('Abajo'));
  const sideLeft = document.createElement('label'); sideLeft.className = 'side'; const cLeft = document.createElement('input'); cLeft.type = 'checkbox'; cLeft.checked = true; sideLeft.appendChild(cLeft); sideLeft.appendChild(document.createTextNode('Izquierda'));
  trimControls.appendChild(trimLabel);
  trimControls.appendChild(trimMm);
  trimControls.appendChild(sideTop);
  trimControls.appendChild(sideRight);
  trimControls.appendChild(sideBottom);
  trimControls.appendChild(sideLeft);
  trim.appendChild(trimControls);

  if (!isBackofficeAllowed) {
    trim.style.display = 'none';
    trimMm.disabled = true;
    [cTop, cRight, cBottom, cLeft].forEach((input) => {
      input.disabled = true;
    });
  }

  const del = document.createElement('button'); del.className = 'btn remove'; del.textContent = 'Eliminar';
  del.addEventListener('click', () => {
    row.remove();
    applyPlatesGate();
    ensureKerfField();
  });

  const actions = document.createElement('div');
  actions.className = 'plate-actions';
  actions.appendChild(del);

  const kerfSlot = document.createElement('div');
  kerfSlot.className = 'kerf-slot';

  const onChange = () => { applyPlatesGate(); };
  iW.addEventListener('input', onChange);
  iH.addEventListener('input', onChange);
  iC.addEventListener('input', onChange);
  trimMm.addEventListener('input', onChange);
  [cTop, cRight, cBottom, cLeft].forEach(ch => ch.addEventListener('change', onChange));

  row.appendChild(fW);
  row.appendChild(fH);
  row.appendChild(actions);
  row.appendChild(trim);
  row.appendChild(kerfSlot);
  row.appendChild(iC);

  onChange();

  return row;
}

function applyPlatesGate() {
  const enabled = isSheetComplete();
  const autoEnabled = !!(autoRotateToggle && autoRotateToggle.checked);
  getRows().forEach((r) => {
    if (r._setInputsEnabled) r._setInputsEnabled(enabled);
    if (r._applyAutoRotateForced) r._applyAutoRotateForced(autoEnabled);
  });
  updateMaterialDropdownState();
  toggleAddButton();
  scheduleLayoutRecalc({ priority: 'high' });
  ensureKerfField();
  toggleActionButtons(enabled);
  persistState && persistState();
}

function enforceDefaultPlateSize(row) {
  if (isBackofficeAllowed || !row) return;
  const widthInput = row.querySelector('input.plate-w');
  const heightInput = row.querySelector('input.plate-h');
  const quantityInput = row.querySelector('input.plate-c');
  if (widthInput) {
    widthInput.value = String(DEFAULT_PLATE_WIDTH);
    widthInput.disabled = true;
    widthInput.classList.add('readonly-input');
  }
  if (heightInput) {
    heightInput.value = String(DEFAULT_PLATE_HEIGHT);
    heightInput.disabled = true;
    heightInput.classList.add('readonly-input');
  }
  if (quantityInput) {
    const sanitized = Math.max(1, parseInt(quantityInput.value, 10) || 1);
    quantityInput.value = String(sanitized);
    quantityInput.readOnly = true;
    quantityInput.classList.add('readonly-input');
    const quantityFieldWrapper = quantityInput.closest('.field');
    if (quantityFieldWrapper) {
      quantityFieldWrapper.style.display = 'none';
    }
  }
}

if (platesEl && addPlateBtn) {
  const appendPlateRow = () => {
    const row = makePlateRow(isBackofficeAllowed ? {} : {
      readOnlySize: true,
      width: DEFAULT_PLATE_WIDTH,
      height: DEFAULT_PLATE_HEIGHT
    });
    platesEl.appendChild(row);
    enforceDefaultPlateSize(row);
    ensureKerfField();
    applyPlatesGate();
    return row;
  };

  addPlateBtn.addEventListener('click', () => {
    if (!plateMaterialSelect || !plateMaterialSelect.value) return;
    appendPlateRow();
  });
  ensureDefaultRows();
}

initRemoteSynchronisation();
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

toggleActionButtons(isSheetComplete());

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
  const widthEdgeLabel = widthEdgeSelect?.dataset?.label || row._edgeNames?.horizontal || widthEdgeSelect?.value || '';
  const heightEdgeLabel = heightEdgeSelect?.dataset?.label || row._edgeNames?.vertical || heightEdgeSelect?.value || '';
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
      heightEdge: heightEdgeSelect && heightEdgeSelect.value ? heightEdgeSelect.value : null,
      widthEdgeLabel: widthEdgeLabel || null,
      heightEdgeLabel: heightEdgeLabel || null
    };
  });
  const name = (projectNameEl?.value || '').trim();
  const kerfMm = parseInt(kerfInput?.value ?? pendingKerfValue ?? '0', 10) || 0;
  const autoRotate = !!(autoRotateToggle && autoRotateToggle.checked);
  const material = currentMaterialName || '';
  
  // ✅ NUEVO: Incluir la solución calculada
  const currentSolution = lastSuccessfulSolution;
  const savedSolution = currentSolution ? {
    instances: currentSolution.instances,
    placements: currentSolution.placements,
    placementsByPlate: currentSolution.placementsByPlate,
    leftoverGroups: currentSolution.leftoverGroups,
    leftoverPieces: currentSolution.leftoverPieces,
    totalRequested: currentSolution.totalRequested,
    usedArea: currentSolution.usedArea,
    wasteArea: currentSolution.wasteArea,
    totalArea: currentSolution.totalArea,
    timestamp: Date.now() // Para validar que no sea muy vieja
  } : null;
  
  return { name, plates, rows, kerfMm, autoRotate, material, savedSolution };
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
  
  // Log informativo sobre si se guardó la planificación
  if (state.savedSolution) {
    console.log('💾 Guardando JSON con planificación calculada - al cargar mantendrá el mismo diseño');
  } else {
    console.log('💾 Guardando JSON sin planificación - al cargar recalculará automáticamente');
  }
  
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const name = (projectNameEl?.value || '').trim();
  const fname = name ? `proyecto-${name.replace(/\s+/g,'_')}.json` : 'proyecto-cortes.json';
  download(fname, url);
  URL.revokeObjectURL(url);
}

function cloneSvgForExport(svgEl) {
  const clone = svgEl.cloneNode(true);
  const svgNS = 'http://www.w3.org/2000/svg';

  const injectPlateDimensions = (targetSvg) => {
    const outline = targetSvg.querySelector('.sheet-outline');
    if (!outline) return;
    const widthMm = parseFloat(targetSvg.getAttribute('data-plate-width-mm') || targetSvg.dataset?.plateWidthMm || '');
    const heightMm = parseFloat(targetSvg.getAttribute('data-plate-height-mm') || targetSvg.dataset?.plateHeightMm || '');
    const x = parseFloat(outline.getAttribute('x') || '0');
    const y = parseFloat(outline.getAttribute('y') || '0');
    const w = parseFloat(outline.getAttribute('width') || '0');
    const h = parseFloat(outline.getAttribute('height') || '0');
    if (![x, y, w, h].every(Number.isFinite)) return;
    if (w <= 0 || h <= 0) return;

    const offset = 28;
    const diag = 8;
    const group = document.createElementNS(svgNS, 'g');
    group.setAttribute('class', 'export-dimension-guides');
    group.setAttribute('stroke', '#111827');
    group.setAttribute('stroke-width', '1');
    group.setAttribute('fill', 'none');
    group.setAttribute('stroke-linecap', 'square');
    targetSvg.appendChild(group);

    const addLine = (x1, y1, x2, y2) => {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      group.appendChild(line);
    };
    const addDiag = (x1, y1, x2, y2) => {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      group.appendChild(line);
    };

    const widthLineY = y + h + offset;
    addLine(x, y + h, x, widthLineY);
    addLine(x + w, y + h, x + w, widthLineY);
    addLine(x, widthLineY, x + w, widthLineY);
    addDiag(x, widthLineY, x + diag, widthLineY + diag);
    addDiag(x + w, widthLineY, x + w - diag, widthLineY + diag);

    if (Number.isFinite(widthMm) && widthMm > 0) {
      const widthText = document.createElementNS(svgNS, 'text');
      widthText.setAttribute('x', String(x + w / 2));
      widthText.setAttribute('y', String(widthLineY - 6));
      widthText.setAttribute('text-anchor', 'middle');
      widthText.setAttribute('font-size', '14');
      widthText.setAttribute('font-weight', '600');
      widthText.setAttribute('fill', '#111827');
      widthText.setAttribute('stroke', 'none');
      widthText.setAttribute('pointer-events', 'none');
      widthText.textContent = `${formatNumber(widthMm, 0)} mm`;
      targetSvg.appendChild(widthText);
    }

    const heightLineX = x + w + offset;
    addLine(x + w, y, heightLineX, y);
    addLine(x + w, y + h, heightLineX, y + h);
    addLine(heightLineX, y, heightLineX, y + h);
    addDiag(heightLineX, y, heightLineX + diag, y + diag);
    addDiag(heightLineX, y + h, heightLineX + diag, y + h - diag);

    if (Number.isFinite(heightMm) && heightMm > 0) {
      const heightText = document.createElementNS(svgNS, 'text');
      heightText.setAttribute('x', String(heightLineX + 10));
      heightText.setAttribute('y', String(y + h / 2));
      heightText.setAttribute('text-anchor', 'start');
      heightText.setAttribute('dominant-baseline', 'middle');
      heightText.setAttribute('font-size', '14');
      heightText.setAttribute('font-weight', '600');
      heightText.setAttribute('fill', '#111827');
      heightText.setAttribute('stroke', 'none');
      heightText.setAttribute('pointer-events', 'none');
      heightText.textContent = `${formatNumber(heightMm, 0)} mm`;
      targetSvg.appendChild(heightText);
    }
  };

  const injectEdgeLabels = (targetSvg) => {
    const svgNS = 'http://www.w3.org/2000/svg';
    const lines = targetSvg.querySelectorAll('.edge-band-line');
    if (!lines.length) return;
    lines.forEach((line) => {
      const name = (line.getAttribute('data-edge-name') || '').trim();
      if (!name) return;
      const orientation = (line.getAttribute('data-edge-orientation') || '').trim();
      const position = (line.getAttribute('data-edge-position') || '').trim();
      if (!orientation || !position) return;

      const x1 = parseFloat(line.getAttribute('x1') || '0');
      const y1 = parseFloat(line.getAttribute('y1') || '0');
      const x2 = parseFloat(line.getAttribute('x2') || '0');
      const y2 = parseFloat(line.getAttribute('y2') || '0');
      if (![x1, y1, x2, y2].every(Number.isFinite)) return;

      const rawW = parseFloat(line.getAttribute('data-piece-raww') || '0');
      const rawH = parseFloat(line.getAttribute('data-piece-rawh') || '0');
      const minDim = Math.min(rawW > 0 ? rawW : Infinity, rawH > 0 ? rawH : Infinity);
      const isSmall = Number.isFinite(minDim) && minDim < 200;
      const fontSize = isSmall ? 6 : 9;

      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('class', 'edge-band-label');
      label.setAttribute('font-size', String(fontSize));
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', '#111827');
      label.setAttribute('stroke', 'none');
      label.setAttribute('pointer-events', 'none');
      label.setAttribute('dominant-baseline', 'middle');
      label.textContent = name;

      if (orientation === 'horizontal') {
        const centerX = (x1 + x2) / 2;
        const baseYTop = Math.min(y1, y2);
        const baseYBottom = Math.max(y1, y2);
        const topOffset = isSmall ? -4 : -4;
        const bottomOffset = isSmall ? 5 : 5;
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('x', String(centerX));
        if (position === 'top') {
          label.setAttribute('y', String(baseYTop + topOffset));
        } else if (position === 'bottom') {
          label.setAttribute('y', String(baseYBottom + bottomOffset));
        } else {
          return;
        }
      } else if (orientation === 'vertical') {
        const centerY = (y1 + y2) / 2;
        const offset = isSmall ? 9 : 14;
        const baseLeft = Math.min(x1, x2);
        const baseRight = Math.max(x1, x2);
        label.setAttribute('text-anchor', 'middle');
        if (position === 'left') {
          const x = baseLeft - 4;
          label.setAttribute('x', String(x));
          label.setAttribute('y', String(centerY));
          label.setAttribute('transform', `rotate(-90 ${x} ${centerY})`);
        } else if (position === 'right') {
          const x = baseRight + 3;
          label.setAttribute('x', String(x));
          label.setAttribute('y', String(centerY));
          label.setAttribute('transform', `rotate(90 ${x} ${centerY})`);
        } else {
          return;
        }
      } else {
        return;
      }

      targetSvg.appendChild(label);
    });
  };

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

  injectPlateDimensions(clone);
  injectEdgeLabels(clone);

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
  ensureKerfField();
}

function loadState(state) {
  clearAllPlates();
  if (projectNameEl && typeof state.name === 'string') projectNameEl.value = state.name;
  if (typeof state.kerfMm === 'number') {
    pendingKerfValue = String(state.kerfMm);
    if (kerfInput) kerfInput.value = pendingKerfValue;
  }
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
      try { localStorage.setItem(LAST_MATERIAL_KEY, currentMaterialName); } catch (_) {}
    } else {
      if (plateMaterialSelect.querySelector('option[value=""]')) {
        plateMaterialSelect.value = '';
      } else {
        plateMaterialSelect.selectedIndex = 0;
      }
      currentMaterialName = '';
      try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}
    }
    updateMaterialDropdownState();
  } else {
    currentMaterialName = state.material && typeof state.material === 'string'
      ? state.material
      : currentMaterialName;
  }
  // Cargar placas
  if (platesEl && Array.isArray(state.plates)) {
    state.plates.forEach((p, plateIdx) => {
      if (!isBackofficeAllowed && plateIdx > 0) return; // Solo una placa para usuarios finales
      const rowOptions = isBackofficeAllowed
        ? {}
        : { readOnlySize: true, width: DEFAULT_PLATE_WIDTH, height: DEFAULT_PLATE_HEIGHT };
      const r = makePlateRow(rowOptions);
      const widthInput = r.querySelector('input.plate-w');
      const heightInput = r.querySelector('input.plate-h');
      const countInput = r.querySelector('input.plate-c');
      if (widthInput) {
        if (isBackofficeAllowed) {
          widthInput.value = String(p.sw || '');
        } else {
          widthInput.value = String(DEFAULT_PLATE_WIDTH);
          widthInput.disabled = true;
          widthInput.classList.add('readonly-input');
        }
      }
      if (heightInput) {
        if (isBackofficeAllowed) {
          heightInput.value = String(p.sh || '');
        } else {
          heightInput.value = String(DEFAULT_PLATE_HEIGHT);
          heightInput.disabled = true;
          heightInput.classList.add('readonly-input');
        }
      }
      if (countInput) countInput.value = String(p.sc || 1);
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
    if (!isBackofficeAllowed) {
      const plateRows = platesEl.querySelectorAll('.plate-row');
      if (!plateRows.length) {
        const fallbackRow = makePlateRow({ readOnlySize: true, width: DEFAULT_PLATE_WIDTH, height: DEFAULT_PLATE_HEIGHT });
        platesEl.appendChild(fallbackRow);
      }
    }
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
      if (r._updateEdgeSelectState) r._updateEdgeSelectState();
      const syncSelectDatasets = (select) => {
        if (!select) return;
        const active = select.selectedOptions?.[0];
        if (active && active.value) {
          const raw = (active.textContent || '').trim();
          const [base] = raw.split('—');
          select.dataset.label = (base || raw).trim();
          select.dataset.value = active.value || '';
        }
      };
      syncSelectDatasets(widthEdgeSelect);
      syncSelectDatasets(heightEdgeSelect);
      rowsEl.appendChild(r);
    });
  }

  ensureKerfField();
  applyPlatesGate();
  
  // ✅ NUEVO: Restaurar solución guardada DESPUÉS de aplicar placas
  console.log('🔍 DEBUG: Verificando solución guardada después de applyPlatesGate...');
  
  if (state.savedSolution && isValidSavedSolutionWithCurrentPlates(state.savedSolution)) {
    console.log('🔄 Usando solución guardada del JSON');
    lastSuccessfulSolution = state.savedSolution;
    
    // Marcar que tenemos una solución precalculada
    const currentPlates = getPlates(); // Usar placas actuales
    const inputs = {
      instances: currentPlates.map(p => ({
        sw: p.sw,
        sh: p.sh,
        trim: p.trim || { mm: 0, top: false, right: false, bottom: false, left: false }
      })),
      pieces: collectPiecesFromState(state),
      kerf: state.kerfMm || 0,
      allowAutoRotate: state.autoRotate !== false
    };
    
    console.log('🔍 DEBUG: Usando placas actuales para cache key:', {
      currentPlatesCount: currentPlates.length,
      piecesCount: inputs.pieces?.length,
      kerf: inputs.kerf,
      autoRotate: inputs.allowAutoRotate
    });
    
    const cacheKey = getCacheKey(inputs.instances, inputs.pieces, {
      kerf: inputs.kerf,
      allowAutoRotate: inputs.allowAutoRotate
    });
    
    console.log('🔍 DEBUG: Cache key generado:', cacheKey);
    
    solverCache.set(cacheKey, state.savedSolution);
    
    console.log('🔍 DEBUG: Solución añadida al cache, tamaño del cache:', solverCache.size);
    
    // Renderizar inmediatamente la solución guardada
    setTimeout(() => {
      console.log('🔍 DEBUG: Iniciando renderizado de solución guardada...');
      renderSheetOverview();
    }, 100);
  } else if (state.savedSolution) {
    console.log('❌ Solución guardada no es válida con placas actuales, recalculando...');
  } else {
    console.log('ℹ️ No hay solución guardada en el JSON');
  }
  
  persistState();
}

// ✅ NUEVAS FUNCIONES AUXILIARES PARA SOLUCIONES GUARDADAS

// Validar que la solución guardada sea compatible con el estado actual
function isValidSavedSolution(savedSolution, state) {
  console.log('🔍 DEBUG: Validando solución guardada...', {
    savedSolution: !!savedSolution,
    savedSolutionType: typeof savedSolution,
    state: !!state
  });
  
  if (!savedSolution || typeof savedSolution !== 'object') {
    console.log('❌ DEBUG: Solución no es un objeto válido');
    return false;
  }
  
  // Verificar que no sea muy vieja (opcional, ej: máximo 30 días)
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 días
  if (savedSolution.timestamp && Date.now() - savedSolution.timestamp > maxAge) {
    console.log('❌ DEBUG: Solución muy antigua:', {
      timestamp: savedSolution.timestamp,
      age: Date.now() - savedSolution.timestamp,
      maxAge
    });
    return false;
  }
  
  // Verificar que tenga la estructura correcta
  const required = ['instances', 'placements', 'placementsByPlate'];
  const hasRequired = required.every(prop => Array.isArray(savedSolution[prop]));
  console.log('🔍 DEBUG: Verificando estructura requerida:', {
    required,
    hasAll: hasRequired,
    structure: required.map(prop => ({
      prop,
      exists: prop in savedSolution,
      isArray: Array.isArray(savedSolution[prop]),
      length: savedSolution[prop]?.length
    }))
  });
  
  if (!hasRequired) {
    console.log('❌ DEBUG: Estructura requerida faltante');
    return false;
  }
  
  // Verificar que la cantidad de placas coincida
  const currentPlates = state.plates?.length || 0;
  const savedPlates = savedSolution.instances?.length || 0;
  console.log('🔍 DEBUG: Comparando placas:', {
    currentPlates,
    savedPlates,
    match: currentPlates === savedPlates
  });
  
  if (currentPlates !== savedPlates) {
    console.log('❌ DEBUG: Cantidad de placas no coincide');
    return false;
  }
  
  // Verificar que las dimensiones de placas coincidan
  for (let i = 0; i < currentPlates; i++) {
    const current = state.plates[i];
    const saved = savedSolution.instances[i];
    
    console.log(`🔍 DEBUG: Placa ${i}:`, {
      current: current ? { sw: current.sw, sh: current.sh } : null,
      saved: saved ? { sw: saved.sw, sh: saved.sh } : null
    });
    
    if (!current || !saved) {
      console.log(`❌ DEBUG: Placa ${i} faltante`);
      return false;
    }
    
    const swDiff = Math.abs(current.sw - saved.sw);
    const shDiff = Math.abs(current.sh - saved.sh);
    
    if (swDiff > 0.1 || shDiff > 0.1) {
      console.log(`❌ DEBUG: Dimensiones de placa ${i} no coinciden:`, {
        swDiff,
        shDiff,
        threshold: 0.1
      });
      return false;
    }
  }
  
  console.log('✅ DEBUG: Solución guardada es válida');
  return true;
}

// Nueva función que valida con las placas actuales (después de applyPlatesGate)
function isValidSavedSolutionWithCurrentPlates(savedSolution) {
  console.log('🔍 DEBUG: Validando solución con placas actuales...');
  
  if (!savedSolution || typeof savedSolution !== 'object') {
    console.log('❌ DEBUG: Solución no es un objeto válido');
    return false;
  }
  
  // Verificar que tenga la estructura correcta
  const required = ['instances', 'placements', 'placementsByPlate'];
  const hasRequired = required.every(prop => Array.isArray(savedSolution[prop]));
  console.log('🔍 DEBUG: Verificando estructura requerida:', {
    required,
    hasAll: hasRequired,
    structure: required.map(prop => ({
      prop,
      exists: prop in savedSolution,
      isArray: Array.isArray(savedSolution[prop]),
      length: savedSolution[prop]?.length
    }))
  });
  
  if (!hasRequired) {
    console.log('❌ DEBUG: Estructura requerida faltante');
    return false;
  }
  
  // Verificar que la cantidad de placas coincida con las placas actuales
  const currentPlates = getPlates();
  const savedPlates = savedSolution.instances?.length || 0;
  console.log('🔍 DEBUG: Comparando con placas actuales:', {
    currentPlates: currentPlates.length,
    savedPlates,
    match: currentPlates.length === savedPlates,
    currentPlatesDetails: currentPlates.map((p, i) => ({ i, sw: p.sw, sh: p.sh, sc: p.sc })),
    savedInstancesDetails: savedSolution.instances?.map((inst, i) => ({ i, sw: inst.sw, sh: inst.sh }))
  });
  
  if (currentPlates.length !== savedPlates) {
    console.log('❌ DEBUG: Cantidad de placas no coincide con placas actuales');
    
    // INTENTO DE ARREGLO: Verificar si es un problema de instancias vs placas únicas
    console.log('🔧 DEBUG: Intentando arreglo alternativo...');
    
    // Calcular total de instancias en placas actuales
    const totalCurrentInstances = currentPlates.reduce((sum, plate) => sum + (plate.sc || 1), 0);
    console.log('🔧 DEBUG: Total instancias actuales vs guardadas:', {
      totalCurrentInstances,
      savedPlates,
      match: totalCurrentInstances === savedPlates
    });
    
    // Si el total de instancias coincide, intentar hacer la validación más flexible
    if (totalCurrentInstances === savedPlates) {
      console.log('✅ DEBUG: Coincidencia por total de instancias, continuando validación...');
    } else {
      return false;
    }
  }
  
  // Verificar que las dimensiones de placas coincidan con las actuales
  // Si tenemos instancias individuales vs placas con cantidad, necesitamos validación especial
  let instanceIndex = 0;
  for (let plateIndex = 0; plateIndex < currentPlates.length; plateIndex++) {
    const currentPlate = currentPlates[plateIndex];
    const plateCount = currentPlate.sc || 1;
    
    console.log(`🔍 DEBUG: Validando placa ${plateIndex} con ${plateCount} instancias...`);
    
    // Verificar cada instancia de esta placa
    for (let instInPlate = 0; instInPlate < plateCount; instInPlate++) {
      if (instanceIndex >= savedSolution.instances.length) {
        console.log(`❌ DEBUG: No hay suficientes instancias guardadas (faltan a partir de ${instanceIndex})`);
        return false;
      }
      
      const saved = savedSolution.instances[instanceIndex];
      
      console.log(`🔍 DEBUG: Instancia ${instanceIndex} (placa ${plateIndex}.${instInPlate}):`, {
        current: { sw: currentPlate.sw, sh: currentPlate.sh },
        saved: saved ? { sw: saved.sw, sh: saved.sh } : null
      });
      
      if (!saved) {
        console.log(`❌ DEBUG: Instancia ${instanceIndex} faltante`);
        return false;
      }
      
      const swDiff = Math.abs(currentPlate.sw - saved.sw);
      const shDiff = Math.abs(currentPlate.sh - saved.sh);
      
      if (swDiff > 0.1 || shDiff > 0.1) {
        console.log(`❌ DEBUG: Dimensiones de instancia ${instanceIndex} no coinciden:`, {
          swDiff,
          shDiff,
          threshold: 0.1
        });
        return false;
      }
      
      instanceIndex++;
    }
  }
  
  console.log('✅ DEBUG: Solución guardada es válida con placas actuales');
  return true;
}

// Convertir el estado de rows a pieces para comparación
function collectPiecesFromState(state) {
  const pieces = [];
  let totalRequested = 0;
  
  if (!Array.isArray(state.rows)) return pieces;
  
  state.rows.forEach((row, idx) => {
    const qty = row.qty || 0;
    const w = row.w || 0;
    const h = row.h || 0;
    if (!(qty >= 1 && w > 0 && h > 0)) return;
    
    const rot = row.rot || false;
    const rawW = rot ? h : w;
    const rawH = rot ? w : h;
    const color = getRowColor(idx);
    const baseId = totalRequested;
    
    // Capturar información de cubre cantos
    const edges = row.edges || [false, false, false, false]; // [top, right, bottom, left]
  const widthTier = row.widthTier;
  const heightTier = row.heightTier;
  const widthEdge = row.widthEdge || '';
  const heightEdge = row.heightEdge || '';
  const widthEdgeLabel = row.widthEdgeLabel || widthEdge;
  const heightEdgeLabel = row.heightEdgeLabel || heightEdge;
    
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
        dimKey: dimensionKeyNormalized(rawW, rawH),
        edges: edges,
        widthTier: widthTier,
        heightTier: heightTier,
        widthEdge: widthEdge,
        heightEdge: heightEdge,
        widthEdgeLabel,
        heightEdgeLabel
      });
    }
    totalRequested += qty;
  });
  
  return pieces;
}

/**
 * Renderiza con el optimizador avanzado (se ejecuta automáticamente)
 */
async function renderWithAdvancedOptimizer() {
  try {
    // Obtener las piezas actuales
    const pieces = gatherPiecesFromRows();
    
    if (!pieces || pieces.length === 0) {
      // Si no hay piezas, mostrar mensaje
      if (sheetCanvasEl) {
        sheetCanvasEl.innerHTML = '';
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = 'Agregá piezas para ver el plano optimizado';
        sheetCanvasEl.appendChild(hint);
      }
      return;
    }
    
    // Obtener especificaciones de la placa
    const plateRows = getPlates();
    if (!plateRows || plateRows.length === 0) {
      if (sheetCanvasEl) {
        sheetCanvasEl.innerHTML = '';
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = 'Configurá una placa para ver el plano optimizado';
        sheetCanvasEl.appendChild(hint);
      }
      return;
    }
    
    const firstPlate = plateRows[0];
    const plateWidth = firstPlate.sw || 2750;
    const plateHeight = firstPlate.sh || 1830;
    const trimMm = firstPlate.trim?.mm || 0;
    const trimLeft = firstPlate.trim?.left ? trimMm : 0;
    const trimTop = firstPlate.trim?.top ? trimMm : 0;
    const trimRight = firstPlate.trim?.right ? trimMm : 0;
    const trimBottom = firstPlate.trim?.bottom ? trimMm : 0;
    
    const plateSpec = {
      width: plateWidth,
      height: plateHeight
    };
    
    // Opciones de optimización
    const kerf = getKerfMm();
    const options = {
      algorithm: 'simulated-annealing',
      iterations: 500,
      kerf: kerf,
      trimLeft: trimLeft,
      trimTop: trimTop,
      trimRight: trimRight,
      trimBottom: trimBottom,
      allowRotation: autoRotateToggle ? autoRotateToggle.checked : true
    };
    
    // Calcular hash de los datos para detectar cambios
    const dataHash = JSON.stringify({
      pieces: pieces.map(p => ({
        w: p.width,
        h: p.height,
        id: p.id,
        edges: Array.isArray(p.edges) ? p.edges : null,
        widthEdge: p.widthEdge || '',
        heightEdge: p.heightEdge || '',
        widthEdgeLabel: p.widthEdgeLabel || '',
        heightEdgeLabel: p.heightEdgeLabel || '',
        widthTier: Number.isFinite(p.widthTier) ? p.widthTier : null,
        heightTier: Number.isFinite(p.heightTier) ? p.heightTier : null
      })),
      plate: { w: plateWidth, h: plateHeight },
      options: { kerf, trimLeft, trimTop, trimRight, trimBottom, rot: options.allowRotation }
    });
    
    // Si los datos no han cambiado y ya tenemos una solución, reutilizarla
    if (lastOptimizationHash === dataHash && lastOptimizationResult) {
      console.log('✅ Reutilizando optimización anterior (sin cambios en datos)');
      const { optimizeCutLayout, generateReport } = await import('./advanced-optimizer.js');
      const report = generateReport(lastOptimizationResult);
      updateSummaryWithAdvancedReport(report);
      renderAdvancedSolution(lastOptimizationResult, plateSpec);
      return;
    }
    
    // Los datos cambiaron, ejecutar nueva optimización
    console.log('🔄 Ejecutando nueva optimización (datos modificados)');
    const { optimizeCutLayout, generateReport } = await import('./advanced-optimizer.js');
    const result = optimizeCutLayout(pieces, plateSpec, options);
    const report = generateReport(result);
    
    // Guardar en cache
    lastOptimizationHash = dataHash;
    lastOptimizationResult = result;
    
    // Actualizar resumen con datos del optimizador avanzado
    updateSummaryWithAdvancedReport(report);
    
    // Renderizar visualización
    renderAdvancedSolution(result, plateSpec);
    
  } catch (error) {
    console.error('Error en renderWithAdvancedOptimizer:', error);
    
    // Fallback: mostrar mensaje de error
    if (sheetCanvasEl) {
      sheetCanvasEl.innerHTML = '';
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'background:#fee;color:#c00;padding:12px;border-radius:6px;';
      errorDiv.textContent = '⚠️ Error al optimizar: ' + error.message;
      sheetCanvasEl.appendChild(errorDiv);
    }
  }
}

/**
 * Recopila piezas desde las filas actuales (para optimizador)
 */
function gatherPiecesFromRows() {
  const state = serializeState();
  const pieces = collectPiecesFromState(state);
  
  // Convertir al formato esperado por el optimizador
  return pieces.map(p => ({
    id: p.id,
    width: p.rawW,
    height: p.rawH,
    color: p.color,
    label: `${p.rawW}×${p.rawH}`,
    quantity: 1,
    rowIndex: p.rowIdx,
    edges: p.edges || [false, false, false, false],
    widthTier: p.widthTier,
    heightTier: p.heightTier,
    widthEdge: p.widthEdge || '',
    heightEdge: p.heightEdge || '',
    widthEdgeLabel: p.widthEdgeLabel || '',
    heightEdgeLabel: p.heightEdgeLabel || ''
  }));
}

/**
 * Renderiza visualmente la solución del optimizador avanzado
 */
function renderAdvancedSolution(optimizationResult, plateSpec) {
  if (!sheetCanvasEl) return;
  
  // Activar flag para prevenir que renderSheetOverview sobrescriba
  showingAdvancedOptimization = true;
  
  // IMPORTANTE: Limpiar completamente el canvas
  sheetCanvasEl.innerHTML = '';
  
  const { plates, remaining } = optimizationResult;
  const svgNS = 'http://www.w3.org/2000/svg';
  
  const holder = document.createElement('div');
  holder.className = 'sheet-multi';
  
  plates.forEach((plate, plateIdx) => {
    const placedPieces = plate.getPlacedPiecesWithCoords();
    
    const VIEW_W = 1000;
    const LABEL_EXTRA_H = 24;
    const PAD_X = 16;
    const PAD_BOTTOM = 16;
    const PAD_TOP = PAD_BOTTOM + LABEL_EXTRA_H;
    const innerW = VIEW_W - PAD_X * 2;
    const scale = plateSpec.width > 0 ? innerW / plateSpec.width : 0;
    const contentH = plateSpec.height * scale;
    const baseViewH = Math.round(contentH + PAD_TOP + PAD_BOTTOM);
    const noticeExtra = remaining.length ? 20 : 0;
    const VIEW_H = Math.max(1, baseViewH + noticeExtra);
    
    const wrap = document.createElement('div');
    
    // Título de la placa
    const title = document.createElement('div');
    title.className = 'plate-title';
    const titleText = document.createElement('span');
    titleText.textContent = `Placa ${plateIdx + 1} de ${plates.length} · ${plate.utilization.toFixed(2)}% utilización`;
    title.appendChild(titleText);
    wrap.appendChild(title);
    
    // SVG de la placa
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.dataset.plateWidthMm = String(plateSpec.width);
    svg.dataset.plateHeightMm = String(plateSpec.height);
    svg.dataset.scale = String(scale);
    
    // Rectángulo de la placa
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('class', 'sheet-outline');
    rect.setAttribute('x', String(PAD_X));
    rect.setAttribute('y', String(PAD_TOP));
    rect.setAttribute('width', String(innerW));
    rect.setAttribute('height', String(contentH));
    rect.setAttribute('rx', '6');
    svg.appendChild(rect);
    
    // Label de dimensiones
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('class', 'sheet-dims');
    label.setAttribute('x', String(VIEW_W / 2));
    label.setAttribute('y', String(PAD_TOP - LABEL_EXTRA_H + 20));
    label.setAttribute('text-anchor', 'middle');
    label.textContent = `${plateSpec.width} × ${plateSpec.height} mm`;
    svg.appendChild(label);
    
    const ox = PAD_X;
    const oy = PAD_TOP;
    
    // Dibujar áreas de trim
    const trimLeft = plate.trimLeft || 0;
    const trimTop = plate.trimTop || 0;
    
    if (trimLeft > 0) {
      const trimRect = document.createElementNS(svgNS, 'rect');
      trimRect.setAttribute('class', 'trim-band');
      trimRect.setAttribute('x', String(ox));
      trimRect.setAttribute('y', String(oy));
      trimRect.setAttribute('width', String(trimLeft * scale));
      trimRect.setAttribute('height', String(contentH));
      trimRect.setAttribute('fill', '#f59e0b33');
      svg.appendChild(trimRect);
    }
    
    if (trimTop > 0) {
      const trimRect = document.createElementNS(svgNS, 'rect');
      trimRect.setAttribute('class', 'trim-band');
      trimRect.setAttribute('x', String(ox));
      trimRect.setAttribute('y', String(oy));
      trimRect.setAttribute('width', String(innerW));
      trimRect.setAttribute('height', String(trimTop * scale));
      trimRect.setAttribute('fill', '#f59e0b33');
      svg.appendChild(trimRect);
    }
    
    // Crear mapa de agrupación por dimensiones para numeración consistente
    const dimensionGroups = new Map();
    let cutTypeCounter = 1;
    
    // Agrupar piezas por dimensiones (ancho x alto)
    placedPieces.forEach((p) => {
      const key = `${p.width.toFixed(0)}x${p.height.toFixed(0)}`;
      if (!dimensionGroups.has(key)) {
        dimensionGroups.set(key, {
          cutNumber: cutTypeCounter++,
          pieces: [],
          width: p.width,
          height: p.height
        });
      }
      dimensionGroups.get(key).pieces.push(p);
    });

    // Dibujar piezas
    placedPieces.forEach((p, idx) => {
      const pxX = ox + p.x * scale;
      const pxY = oy + p.y * scale;
      const pxW = Math.max(1, p.width * scale);
      const pxH = Math.max(1, p.height * scale);
      
      // Obtener número de corte basado en dimensiones
      const dimensionKey = `${p.width.toFixed(0)}x${p.height.toFixed(0)}`;
      const cutNumber = dimensionGroups.get(dimensionKey).cutNumber;
      
      // Rectángulo exterior (borde)
      const outer = document.createElementNS(svgNS, 'rect');
      outer.setAttribute('class', 'piece-rect');
      outer.setAttribute('x', String(pxX));
      outer.setAttribute('y', String(pxY));
      outer.setAttribute('width', String(pxW));
      outer.setAttribute('height', String(pxH));
      outer.setAttribute('rx', '3');
      outer.setAttribute('fill', '#ef444428');
      outer.setAttribute('stroke', p.piece.color || '#ef4444');
      outer.setAttribute('stroke-width', '2');
      svg.appendChild(outer);
      
      // Rectángulo interior (relleno)
      const inner = document.createElementNS(svgNS, 'rect');
      inner.setAttribute('class', 'piece-inner');
      inner.setAttribute('x', String(pxX + 2));
      inner.setAttribute('y', String(pxY + 2));
      inner.setAttribute('width', String(Math.max(1, pxW - 4)));
      inner.setAttribute('height', String(Math.max(1, pxH - 4)));
      inner.setAttribute('rx', '2');
      inner.setAttribute('fill', p.piece.color || '#ef4444');
      inner.setAttribute('fill-opacity', '0.35');
      svg.appendChild(inner);
      
      // Labels de dimensiones
      if (pxW >= 40 && pxH >= 28) {
        const fontSize = Math.max(8, Math.min(pxW, pxH) * 0.12);
        
        // Label de ancho
        const widthLabel = document.createElementNS(svgNS, 'text');
        widthLabel.setAttribute('class', 'piece-label');
        widthLabel.setAttribute('text-anchor', 'middle');
        widthLabel.setAttribute('x', String(pxX + pxW / 2));
        widthLabel.setAttribute('y', String(pxY + pxH - 8));
        widthLabel.setAttribute('font-size', String(fontSize));
        widthLabel.setAttribute('fill', '#fff');
        widthLabel.textContent = `${p.width.toFixed(0)}`;
        svg.appendChild(widthLabel);
        
        // Label de alto (ROTADO VERTICALMENTE)
        const heightLabel = document.createElementNS(svgNS, 'text');
        heightLabel.setAttribute('class', 'piece-label');
        heightLabel.setAttribute('text-anchor', 'middle');
        heightLabel.setAttribute('x', String(pxX + pxW - 8));
        heightLabel.setAttribute('y', String(pxY + pxH / 2));
        heightLabel.setAttribute('font-size', String(fontSize));
        heightLabel.setAttribute('fill', '#fff');
        heightLabel.setAttribute('transform', `rotate(-90 ${pxX + pxW - 8} ${pxY + pxH / 2})`);
        heightLabel.textContent = `${p.height.toFixed(0)}`;
        svg.appendChild(heightLabel);
        
        // Número de corte en el centro
        const cutNumberFontSize = Math.max(10, Math.min(pxW, pxH) * 0.15);
        const cutNumberLabel = document.createElementNS(svgNS, 'text');
        cutNumberLabel.setAttribute('class', 'piece-cut-number');
        cutNumberLabel.setAttribute('text-anchor', 'middle');
        cutNumberLabel.setAttribute('x', String(pxX + pxW / 2));
        cutNumberLabel.setAttribute('y', String(pxY + pxH / 2 + cutNumberFontSize / 3));
        cutNumberLabel.setAttribute('font-size', String(cutNumberFontSize));
        cutNumberLabel.setAttribute('fill', '#fff');
        cutNumberLabel.setAttribute('font-weight', 'bold');
        cutNumberLabel.setAttribute('stroke', '#000');
        cutNumberLabel.setAttribute('stroke-width', '0.5');
        cutNumberLabel.textContent = String(cutNumber);
        svg.appendChild(cutNumberLabel);
        
        // Indicador de rotación
        if (p.piece.rotated) {
          const rotLabel = document.createElementNS(svgNS, 'text');
          rotLabel.setAttribute('class', 'piece-label');
          rotLabel.setAttribute('text-anchor', 'start');
          rotLabel.setAttribute('x', String(pxX + 8));
          rotLabel.setAttribute('y', String(pxY + 16));
          rotLabel.setAttribute('font-size', String(fontSize));
          rotLabel.setAttribute('fill', '#fbbf24');
          rotLabel.setAttribute('font-weight', 'bold');
          rotLabel.textContent = '↻';
          svg.appendChild(rotLabel);
        }
      } else {
        // Para piezas pequeñas, solo mostrar el número de corte
        const cutNumberFontSize = Math.max(8, Math.min(pxW, pxH) * 0.25);
        const cutNumberLabel = document.createElementNS(svgNS, 'text');
        cutNumberLabel.setAttribute('class', 'piece-cut-number');
        cutNumberLabel.setAttribute('text-anchor', 'middle');
        cutNumberLabel.setAttribute('x', String(pxX + pxW / 2));
        cutNumberLabel.setAttribute('y', String(pxY + pxH / 2 + cutNumberFontSize / 3));
        cutNumberLabel.setAttribute('font-size', String(cutNumberFontSize));
        cutNumberLabel.setAttribute('fill', '#fff');
        cutNumberLabel.setAttribute('font-weight', 'bold');
        cutNumberLabel.setAttribute('stroke', '#000');
        cutNumberLabel.setAttribute('stroke-width', '0.5');
        cutNumberLabel.textContent = String(cutNumber);
        svg.appendChild(cutNumberLabel);
      }
      
      // Dibujar indicadores de cubre cantos
      {
        const edgeFlags = Array.isArray(p.piece.edges) ? p.piece.edges : [];
        const widthTierCount = Number.isFinite(p.piece.widthTier) ? p.piece.widthTier : null;
        const heightTierCount = Number.isFinite(p.piece.heightTier) ? p.piece.heightTier : null;

        const resolveFlag = (flag, fallback) => (typeof flag === 'boolean' ? flag : fallback);
        const hasTopEdge = resolveFlag(edgeFlags[0], widthTierCount != null ? widthTierCount >= 1 : false);
        const hasRightEdge = resolveFlag(edgeFlags[1], heightTierCount != null ? heightTierCount >= 1 : false);
        const hasBottomEdge = resolveFlag(edgeFlags[2], widthTierCount != null ? widthTierCount >= 2 : false);
        const hasLeftEdge = resolveFlag(edgeFlags[3], heightTierCount != null ? heightTierCount >= 2 : false);

  const edgeLabelFontSize = Math.max(6, Math.min(pxW, pxH) * 0.08);
  const lineLength = 0.6; // 60% de la longitud total
  const lineOffset = 20; // Separación dentro del borde de la pieza
  const widthEdgeName = (p.piece.widthEdgeLabel || p.piece.widthEdge || '').trim();
  const heightEdgeName = (p.piece.heightEdgeLabel || p.piece.heightEdge || '').trim();

        // Borde superior (horizontal)
        if (hasTopEdge && widthEdgeName) {
          const lineCenterX = pxX + pxW / 2;
          const lineStartX = lineCenterX - (pxW * lineLength) / 2;
          const lineEndX = lineCenterX + (pxW * lineLength) / 2;
          const lineY = pxY + lineOffset;

          const edgeLine = document.createElementNS(svgNS, 'line');
          edgeLine.setAttribute('class', 'edge-indicator');
          edgeLine.setAttribute('x1', String(lineStartX));
          edgeLine.setAttribute('y1', String(lineY));
          edgeLine.setAttribute('x2', String(lineEndX));
          edgeLine.setAttribute('y2', String(lineY));
          edgeLine.setAttribute('stroke', '#fff');
          edgeLine.setAttribute('stroke-width', '1');
          svg.appendChild(edgeLine);

          const edgeLabel = document.createElementNS(svgNS, 'text');
          edgeLabel.setAttribute('class', 'edge-label');
          edgeLabel.setAttribute('text-anchor', 'middle');
          edgeLabel.setAttribute('x', String(lineCenterX));
          edgeLabel.setAttribute('y', String(lineY - 2));
          edgeLabel.setAttribute('font-size', String(edgeLabelFontSize));
          edgeLabel.setAttribute('fill', '#fff');
          edgeLabel.setAttribute('font-weight', 'bold');
          edgeLabel.textContent = widthEdgeName;
          svg.appendChild(edgeLabel);
        }

        // Borde derecho (vertical)
        if (hasRightEdge && heightEdgeName) {
          const lineCenterY = pxY + pxH / 2;
          const lineStartY = lineCenterY - (pxH * lineLength) / 2;
          const lineEndY = lineCenterY + (pxH * lineLength) / 2;
          const lineX = pxX + pxW - lineOffset;

          const edgeLine = document.createElementNS(svgNS, 'line');
          edgeLine.setAttribute('class', 'edge-indicator');
          edgeLine.setAttribute('x1', String(lineX));
          edgeLine.setAttribute('y1', String(lineStartY));
          edgeLine.setAttribute('x2', String(lineX));
          edgeLine.setAttribute('y2', String(lineEndY));
          edgeLine.setAttribute('stroke', '#fff');
          edgeLine.setAttribute('stroke-width', '1');
          svg.appendChild(edgeLine);

          const edgeLabel = document.createElementNS(svgNS, 'text');
          edgeLabel.setAttribute('class', 'edge-label');
          edgeLabel.setAttribute('text-anchor', 'middle');
          edgeLabel.setAttribute('x', String(lineX - 2));
          edgeLabel.setAttribute('y', String(lineCenterY));
          edgeLabel.setAttribute('font-size', String(edgeLabelFontSize));
          edgeLabel.setAttribute('fill', '#fff');
          edgeLabel.setAttribute('font-weight', 'bold');
          edgeLabel.setAttribute('transform', `rotate(-90 ${lineX - 2} ${lineCenterY})`);
          edgeLabel.textContent = heightEdgeName;
          svg.appendChild(edgeLabel);
        }

        // Borde inferior (horizontal)
        if (hasBottomEdge && widthEdgeName) {
          const lineCenterX = pxX + pxW / 2;
          const lineStartX = lineCenterX - (pxW * lineLength) / 2;
          const lineEndX = lineCenterX + (pxW * lineLength) / 2;
          const bottomInset = Math.min(pxH / 2, lineOffset + Math.max(10, edgeLabelFontSize * 0.9));
          const lineY = pxY + pxH - bottomInset;

          const edgeLine = document.createElementNS(svgNS, 'line');
          edgeLine.setAttribute('class', 'edge-indicator');
          edgeLine.setAttribute('x1', String(lineStartX));
          edgeLine.setAttribute('y1', String(lineY));
          edgeLine.setAttribute('x2', String(lineEndX));
          edgeLine.setAttribute('y2', String(lineY));
          edgeLine.setAttribute('stroke', '#fff');
          edgeLine.setAttribute('stroke-width', '1');
          svg.appendChild(edgeLine);

          const edgeLabel = document.createElementNS(svgNS, 'text');
          edgeLabel.setAttribute('class', 'edge-label');
          edgeLabel.setAttribute('text-anchor', 'middle');
          edgeLabel.setAttribute('x', String(lineCenterX));
          edgeLabel.setAttribute('y', String(lineY - 4));
          edgeLabel.setAttribute('font-size', String(edgeLabelFontSize));
          edgeLabel.setAttribute('fill', '#fff');
          edgeLabel.setAttribute('font-weight', 'bold');
          edgeLabel.textContent = widthEdgeName;
          svg.appendChild(edgeLabel);
        }

        // Borde izquierdo (vertical)
        if (hasLeftEdge && heightEdgeName) {
          const lineCenterY = pxY + pxH / 2;
          const lineStartY = lineCenterY - (pxH * lineLength) / 2;
          const lineEndY = lineCenterY + (pxH * lineLength) / 2;
          const lineX = pxX + lineOffset;
          const labelInset = Math.max(6, edgeLabelFontSize * 0.4);
          const labelX = lineX - labelInset;

          const edgeLine = document.createElementNS(svgNS, 'line');
          edgeLine.setAttribute('class', 'edge-indicator');
          edgeLine.setAttribute('x1', String(lineX));
          edgeLine.setAttribute('y1', String(lineStartY));
          edgeLine.setAttribute('x2', String(lineX));
          edgeLine.setAttribute('y2', String(lineEndY));
          edgeLine.setAttribute('stroke', '#fff');
          edgeLine.setAttribute('stroke-width', '1');
          svg.appendChild(edgeLine);

          const edgeLabel = document.createElementNS(svgNS, 'text');
          edgeLabel.setAttribute('class', 'edge-label');
          edgeLabel.setAttribute('text-anchor', 'middle');
          edgeLabel.setAttribute('x', String(labelX));
          edgeLabel.setAttribute('y', String(lineCenterY));
          edgeLabel.setAttribute('font-size', String(edgeLabelFontSize));
          edgeLabel.setAttribute('fill', '#fff');
          edgeLabel.setAttribute('font-weight', 'bold');
          edgeLabel.setAttribute('transform', `rotate(-90 ${labelX} ${lineCenterY})`);
          edgeLabel.textContent = heightEdgeName;
          svg.appendChild(edgeLabel);
        }
      }
    });
    
    // Líneas de corte guillotina
    const cuts = plate.getCutSequence();
    
    // Cortes verticales
    cuts.vertical.forEach(cut => {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('class', 'cut-line');
      line.setAttribute('x1', String(ox + cut.position * scale));
      line.setAttribute('y1', String(oy));
      line.setAttribute('x2', String(ox + cut.position * scale));
      line.setAttribute('y2', String(oy + contentH));
      line.setAttribute('stroke', '#10b981');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '5,5');
      line.setAttribute('opacity', '0.5');
      svg.appendChild(line);
    });
    
    // Cortes horizontales
    cuts.horizontal.forEach(cut => {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('class', 'cut-line');
      line.setAttribute('x1', String(ox + cut.x * scale));
      line.setAttribute('y1', String(oy + cut.position * scale));
      line.setAttribute('x2', String(ox + (cut.x + cut.width) * scale));
      line.setAttribute('y2', String(oy + cut.position * scale));
      line.setAttribute('stroke', '#3b82f6');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '5,5');
      line.setAttribute('opacity', '0.5');
      svg.appendChild(line);
    });
    
    wrap.appendChild(svg);
    holder.appendChild(wrap);
  });
  
  sheetCanvasEl.appendChild(holder);
  
  // Mensaje de piezas sin colocar
  if (remaining.length > 0) {
    const notice = document.createElement('div');
    notice.className = 'leftover-notice';
    notice.style.cssText = 'background:#fef3c7;color:#92400e;padding:12px;margin:16px 0;border-radius:6px;';
    notice.textContent = `⚠️ ${remaining.length} pieza${remaining.length > 1 ? 's' : ''} no colocada${remaining.length > 1 ? 's' : ''}`;
    sheetCanvasEl.appendChild(notice);
  }
  
  console.log('✅ Visualización renderizada con', plates.length, 'placa(s)');
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
if (edgeCatalogSelect) {
  edgeCatalogSelect.addEventListener('change', () => updateEdgeCatalogSelectTitle(edgeCatalogSelect));
}
if (plateMaterialSelect) {
  plateMaterialSelect.addEventListener('change', () => {
    const value = plateMaterialSelect.value;
    if (value) {
      currentMaterialName = value;
      try { localStorage.setItem(LAST_MATERIAL_KEY, currentMaterialName); } catch (_) {}
    } else {
      currentMaterialName = '';
      try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}
    }
    updateMaterialDropdownState();
    applyPlatesGate();
  });
}

updateMaterialDropdownState();
if (manageStockBtn) {
  manageStockBtn.addEventListener('click', () => {
    window.open('stock.html', '_blank');
  });
}
if (projectNameEl) projectNameEl.addEventListener('input', () => { persistState(); });

// -------- Exportar PNG/PDF --------
async function buildExportCanvasForPdf() {
  // Primero asegurar que tenemos una solución
  try {
    const solution = await solveCutLayoutInternal();
    if (!solution || !solution.instances || solution.instances.length === 0) {
      alert('No hay placas para exportar');
      return null;
    }
  } catch (error) {
    console.error('Error obteniendo solución para exportar:', error);
    alert('Error al preparar la exportación');
    return null;
  }
  
  await scheduleLayoutRecalc({ immediate: true });
  
  // Esperar un poco para que se renderice
  await new Promise(resolve => setTimeout(resolve, 100));
  
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

  // Si hay múltiples placas, crear una página por placa
  if (scaled.length > 1) {
    return buildMultiPagePdf(scaled, svgs);
  }

  // Si hay una sola placa, usar el formato original
  const summaryTexts = [];
  const addSummary = (text) => {
    const trimmed = (text || '').trim();
    if (trimmed) summaryTexts.push(trimmed);
  };
  
  // Agregar material si existe
  if (currentMaterialName) {
    addSummary(`Material: ${currentMaterialName}`);
    addSummary('');
  }
  
  // Extraer información de las tarjetas de placas en summaryListEl y cubre cantos de los SVGs
  if (summaryListEl && summaryListEl.children) {
    const plateCards = [];
    for (let i = 0; i < summaryListEl.children.length; i++) {
      const child = summaryListEl.children[i];
      // Buscar por el fondo oscuro (puede estar como rgb(14, 22, 41) o #0e1629)
      if (child.style.background && (
        child.style.background.includes('rgb(14, 22, 41)') || 
        child.style.background.includes('#0e1629') ||
        child.style.background.includes('0e1629')
      )) {
        plateCards.push(child);
      }
    }
    
    if (plateCards.length > 0) {
      addSummary('DETALLE DE PLACAS:');
      plateCards.forEach((card, plateIndex) => {
        addSummary('');
        // Extraer todo el texto de la tarjeta y procesarlo línea por línea
        const fullText = card.textContent || '';
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        lines.forEach((line) => {
          // Limpiar emojis pero mantener estructura
          const cleaned = line
            .replace(/📋|📐|📦|📊|♻️|✅|⚙️|💰|💵/g, '')
            .trim();
          if (cleaned) {
            // Si es el título (contiene "Placa"), no indentar
            if (cleaned.startsWith('Placa')) {
              addSummary(cleaned);
            } else {
              addSummary(`  ${cleaned}`);
            }
          }
        });
        
        // Extraer información de cubre cantos del SVG correspondiente
        if (svgs[plateIndex]) {
          const svg = svgs[plateIndex];
          const edgeBandLines = svg.querySelectorAll('.edge-band-line');
          if (edgeBandLines.length > 0) {
            // Agrupar por nombre de cubre canto y calcular metros totales
            const edgesByName = {};
            edgeBandLines.forEach((line) => {
              const name = (line.getAttribute('data-edge-name') || '').trim();
              if (!name || name.toUpperCase() === 'BLANCO') return; // Ignorar BLANCO
              
              // Obtener dimensiones reales de la pieza en mm
              const pieceW = parseFloat(line.getAttribute('data-piece-raww') || '0');
              const pieceH = parseFloat(line.getAttribute('data-piece-rawh') || '0');
              const orientation = (line.getAttribute('data-edge-orientation') || '').trim();
              
              // La longitud real del cubre canto es la dimensión de la pieza en esa dirección
              let lengthMm = 0;
              if (orientation === 'horizontal') {
                lengthMm = pieceW; // Ancho de la pieza
              } else if (orientation === 'vertical') {
                lengthMm = pieceH; // Alto de la pieza
              }
              
              const lengthM = lengthMm / 1000;
              
              if (lengthM > 0) {
                if (!edgesByName[name]) {
                  edgesByName[name] = 0;
                }
                edgesByName[name] += lengthM;
              }
            });
            
            // Si hay cubre cantos, agregarlos al resumen
            const edgeNames = Object.keys(edgesByName).sort();
            if (edgeNames.length > 0) {
              addSummary(`  Cubre Cantos:`);
              edgeNames.forEach(name => {
                const meters = edgesByName[name];
                addSummary(`    - ${name}: ${meters.toFixed(2)} m`);
              });
            }
          }
        }
      });
      addSummary('');
    }
  }
  
  // Extraer información de costos de placas
  if (summaryPlatesValueEl && summaryPlatesValueEl.textContent.trim()) {
    addSummary('COSTO DE PLACAS:');
    const platesCostText = summaryPlatesValueEl.textContent || '';
    const lines = platesCostText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    lines.forEach((line) => {
      const cleaned = line.replace(/💰/g, '').trim();
      if (cleaned && !cleaned.startsWith('Costo de Placas')) {
        addSummary(`  ${cleaned}`);
      }
    });
    addSummary('');
  }
  
  // Extraer información de costos de cubre canto
  if (summaryTotalEl && summaryTotalEl.textContent.trim()) {
    addSummary('COSTO DE CUBRE CANTO:');
    const edgeCostText = summaryTotalEl.textContent || '';
    const lines = edgeCostText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    lines.forEach((line) => {
      const cleaned = line.replace(/💰/g, '').trim();
      if (cleaned && !cleaned.startsWith('Costo de Cubre Canto')) {
        addSummary(`  ${cleaned}`);
      }
    });
    addSummary('');
  }
  
  // Extraer total general
  if (summaryGrandTotalEl && summaryGrandTotalEl.textContent.trim()) {
    const grandTotalText = summaryGrandTotalEl.textContent || '';
    const cleaned = grandTotalText.replace(/💵/g, '').trim();
    if (cleaned) {
      addSummary(cleaned);
    }
  }
  
  // Agregar información de piezas sin colocar si existe
  const remainingCard = summaryListEl?.querySelector('div[style*="background:#7f1d1d"]');
  if (remainingCard) {
    const remainingText = remainingCard.textContent?.trim();
    if (remainingText) {
      addSummary(remainingText.replace(/⚠️/g, '!').trim());
      addSummary('');
    }
  }
  
  // Agregar costo de placas si existe
  if (summaryPlatesValueEl && summaryPlatesValueEl.innerHTML) {
    addSummary('COSTO DE PLACAS:');
    const platesCostText = summaryPlatesValueEl.textContent?.trim();
    if (platesCostText) {
      const lines = platesCostText.split('\n').filter(l => l.trim());
      lines.slice(1).forEach(line => { // Skip title
        const cleaned = line.replace(/💰|•/g, '').trim();
        if (cleaned) addSummary(`  ${cleaned}`);
      });
      addSummary('');
    }
  }
  
  // Agregar costo de cubre canto si existe
  if (summaryTotalEl && summaryTotalEl.innerHTML) {
    addSummary('COSTO DE CUBRE CANTO:');
    const edgeText = summaryTotalEl.textContent?.trim();
    if (edgeText) {
      const lines = edgeText.split('\n').filter(l => l.trim());
      lines.slice(1).forEach(line => { // Skip title
        const cleaned = line.replace(/💰|•/g, '').trim();
        if (cleaned) addSummary(`  ${cleaned}`);
      });
      addSummary('');
    }
  }
  
  // Agregar total general si existe
  if (summaryGrandTotalEl && summaryGrandTotalEl.innerHTML) {
    const totalText = summaryGrandTotalEl.textContent?.trim();
    if (totalText) {
      const lines = totalText.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        const cleaned = line.replace(/💵|💰/g, '').trim();
        if (cleaned) addSummary(cleaned);
      });
    }
  }

  const rowSummaries = [];

  const summaryLineHeight = 20;
  const headingHeight = 20;
  const columnGap = 40;
  const contentGap = 6;
  const summaryStartY = margin + 44;
  const leftBottom = summaryTexts.length
    ? summaryStartY + headingHeight + contentGap + summaryTexts.length * summaryLineHeight
    : summaryStartY + headingHeight;
  const summaryBlockBottom = leftBottom;
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

  const leftX = margin;
  const headingYOffset = summaryStartY;
  const bodyStartY = headingYOffset + headingHeight + contentGap;

  ctx.font = 'bold 16px system-ui';
  ctx.fillText('Detalle de Placas', leftX, headingYOffset);

  ctx.font = '14px system-ui';
  summaryTexts.forEach((line, idx) => {
    ctx.fillText(line, leftX, bodyStartY + idx * summaryLineHeight);
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

// Función para crear PDF multi-página
async function buildMultiPagePdf(scaledImages, svgs) {
  const pages = [];
  const margin = 20;
  const targetW = 1200;
  
  for (let plateIndex = 0; plateIndex < scaledImages.length; plateIndex++) {
    const { img, w, h } = scaledImages[plateIndex];
    const svg = svgs[plateIndex];
    
    // Crear resumen específico para esta placa
    const summaryTexts = [];
    const addSummary = (text) => {
      summaryTexts.push(text);
    };
    
    // Crear detalle de cortes para esta placa
    const cutsTexts = [];
    const addCuts = (text) => {
      cutsTexts.push(text);
    };
    
    // Obtener elementos del DOM
    const projectNameEl = document.getElementById('projectName');
    const summaryListEl = document.getElementById('summaryList');
    const summaryPlatesValueEl = document.getElementById('summaryPlatesValue');
    const summaryTotalEl = document.getElementById('summaryTotal');
    const summaryGrandTotalEl = document.getElementById('summaryGrandTotal');
    
    // Extraer información específica de esta placa
    if (summaryListEl && summaryListEl.children) {
      const plateCards = [];
      for (let i = 0; i < summaryListEl.children.length; i++) {
        const child = summaryListEl.children[i];
        if (child.style.background && (
          child.style.background.includes('rgb(14, 22, 41)') || 
          child.style.background.includes('#0e1629') ||
          child.style.background.includes('0e1629')
        )) {
          plateCards.push(child);
        }
      }
      
      // Solo mostrar información de la placa actual
      if (plateCards[plateIndex]) {
        const card = plateCards[plateIndex];
        addSummary('DETALLE DE PLACA:');
        
        const fullText = card.textContent || '';
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        lines.forEach((line) => {
          const cleaned = line.replace(/📋|📐|📦|📊|♻️|✅|⚙️|💰|💵/g, '').trim();
          if (cleaned) {
            if (cleaned.startsWith('Placa')) {
              addSummary(cleaned);
            } else {
              addSummary(`  ${cleaned}`);
            }
          }
        });
        
        // Extraer información de cubre cantos del SVG de esta placa
        const edgeBandLines = svg.querySelectorAll('.edge-band-line');
        if (edgeBandLines.length > 0) {
          const edgesByName = {};
          edgeBandLines.forEach((line) => {
            const name = (line.getAttribute('data-edge-name') || '').trim();
            if (!name || name.toUpperCase() === 'BLANCO') return;
            
            const pieceW = parseFloat(line.getAttribute('data-piece-raww') || '0');
            const pieceH = parseFloat(line.getAttribute('data-piece-rawh') || '0');
            const orientation = (line.getAttribute('data-edge-orientation') || '').trim();
            
            let lengthMm = 0;
            if (orientation === 'horizontal') {
              lengthMm = pieceW;
            } else if (orientation === 'vertical') {
              lengthMm = pieceH;
            }
            
            const lengthM = lengthMm / 1000;
            
            if (lengthM > 0) {
              if (!edgesByName[name]) {
                edgesByName[name] = 0;
              }
              edgesByName[name] += lengthM;
            }
          });
          
          const edgeNames = Object.keys(edgesByName).sort();
          if (edgeNames.length > 0) {
            addSummary(`  Cubre Cantos:`);
            edgeNames.forEach(name => {
              const meters = edgesByName[name];
              addSummary(`    - ${name}: ${meters.toFixed(2)} m`);
            });
          }
        }
        addSummary('');
      }
    }
    
    // Extraer información de cortes de esta placa específica
    addCuts('DETALLE DE CORTES:');
    addCuts('');
    
    // Obtener las piezas colocadas en esta placa desde el SVG
    const pieceRects = svg.querySelectorAll('.piece-rect');
    if (pieceRects.length > 0) {
      // Crear mapa para agrupar cortes por dimensiones
      const cutGroups = new Map();
      
      pieceRects.forEach((rect) => {
        // Obtener las dimensiones de la pieza desde los elementos de texto
        const svgElement = rect.closest('svg');
        if (!svgElement) return;
        
        // Buscar los labels de dimensiones asociados a esta pieza
        const rectX = parseFloat(rect.getAttribute('x') || '0');
        const rectY = parseFloat(rect.getAttribute('y') || '0');
        const rectW = parseFloat(rect.getAttribute('width') || '0');
        const rectH = parseFloat(rect.getAttribute('height') || '0');
        
        // Buscar los textos de dimensiones cerca de esta pieza
        const allTexts = svgElement.querySelectorAll('text.piece-label');
        let width = 0, height = 0;
        let hasRotation = false;
        
        allTexts.forEach((text) => {
          const textX = parseFloat(text.getAttribute('x') || '0');
          const textY = parseFloat(text.getAttribute('y') || '0');
          
          // Verificar si el texto está dentro del área de la pieza
          if (textX >= rectX && textX <= rectX + rectW && 
              textY >= rectY && textY <= rectY + rectH) {
            const textContent = text.textContent?.trim();
            
            // Identificar si es indicador de rotación
            if (textContent === '↻') {
              hasRotation = true;
            } else if (textContent && /^\d+$/.test(textContent)) {
              const dimension = parseInt(textContent);
              
              // Determinar si es ancho o alto basado en la posición
              const relativeY = textY - rectY;
              const relativeHeight = rectH;
              
              if (relativeY > relativeHeight * 0.7) {
                // Texto en la parte inferior = ancho
                width = dimension;
              } else {
                // Texto en otra posición = alto
                height = dimension;
              }
            }
          }
        });
        
        // Si no encontramos dimensiones en los textos, calcular desde atributos del SVG
        if (width === 0 || height === 0) {
          const scale = parseFloat(svgElement.dataset.scale || '1');
          if (scale > 0) {
            width = Math.round(rectW / scale);
            height = Math.round(rectH / scale);
          }
        }
        
        // Extraer información de cubre cantos para esta pieza específica
        const pieceEdges = [];
        const edgeLines = svgElement.querySelectorAll('.edge-band-line');
        edgeLines.forEach((line) => {
          const lineX = parseFloat(line.getAttribute('x1') || line.getAttribute('x') || '0');
          const lineY = parseFloat(line.getAttribute('y1') || line.getAttribute('y') || '0');
          
          // Verificar si la línea está dentro del área de esta pieza
          if (lineX >= rectX && lineX <= rectX + rectW && 
              lineY >= rectY && lineY <= rectY + rectH) {
            const edgeName = line.getAttribute('data-edge-name');
            const orientation = line.getAttribute('data-edge-orientation');
            if (edgeName && edgeName.toUpperCase() !== 'BLANCO') {
              pieceEdges.push(`${orientation === 'horizontal' ? 'H' : 'V'}: ${edgeName}`);
            }
          }
        });
        
        // Agrupar por dimensiones
        if (width > 0 && height > 0) {
          const dimensionKey = `${width}x${height}`;
          if (!cutGroups.has(dimensionKey)) {
            cutGroups.set(dimensionKey, {
              width: width,
              height: height,
              count: 0,
              hasRotation: hasRotation,
              edges: [...pieceEdges] // Copia de los cubre cantos
            });
          }
          const group = cutGroups.get(dimensionKey);
          group.count++;
          
          // Actualizar rotación si alguna pieza está rotada
          if (hasRotation) {
            group.hasRotation = true;
          }
          
          // Combinar cubre cantos únicos
          pieceEdges.forEach(edge => {
            if (!group.edges.includes(edge)) {
              group.edges.push(edge);
            }
          });
        }
      });
      
      // Generar la lista agrupada
      let cutTypeNumber = 1;
      const sortedGroups = Array.from(cutGroups.entries()).sort((a, b) => {
        // Ordenar por área (ancho × alto)
        const areaA = a[1].width * a[1].height;
        const areaB = b[1].width * b[1].height;
        return areaB - areaA; // De mayor a menor área
      });
      
      sortedGroups.forEach(([dimensionKey, group]) => {
        addCuts(`Corte ${cutTypeNumber}:`);
        addCuts(`  Dimensiones: ${group.width} × ${group.height} mm`);
        addCuts(`  Cantidad: ${group.count} pieza${group.count > 1 ? 's' : ''}`);
        if (group.hasRotation) {
          addCuts(`  Estado: Algunas rotadas`);
        }
        if (group.edges.length > 0) {
          addCuts(`  Cubre Cantos:`);
          group.edges.forEach(edge => {
            addCuts(`    ${edge}`);
          });
        }
        addCuts('');
        cutTypeNumber++;
      });
      
      // Verificar si no se encontraron cortes válidos
      if (cutGroups.size === 0) {
        addCuts('No se encontraron cortes en esta placa.');
      }
    } else {
      addCuts('No se encontraron cortes en esta placa.');
    }
    
    // Configurar dimensiones para esta página con múltiples columnas para cortes
    const summaryLineHeight = 20;
    const cutsLineHeight = 16; // Menor altura para las líneas de cortes
    const headingHeight = 20;
    const contentGap = 6;
    const summaryStartY = margin + 44;
    const bodyStartY = summaryStartY + headingHeight + contentGap;
    
    // Organizar cortes en grupos de 3 por columna
    const cutsPerColumn = 3;
    const cutsColumns = [];
    let currentColumn = [];
    let currentCutCount = 0;
    
    // Procesar las líneas de cortes para agruparlas
    for (let i = 0; i < cutsTexts.length; i++) {
      const line = cutsTexts[i];
      
      // Si la línea empieza con "Corte", es un nuevo corte
      if (line.startsWith('Corte ')) {
        // Si ya tenemos 3 cortes en la columna actual, crear nueva columna
        if (currentCutCount >= cutsPerColumn) {
          cutsColumns.push([...currentColumn]);
          currentColumn = [];
          currentCutCount = 0;
        }
        currentCutCount++;
      }
      
      currentColumn.push(line);
    }
    
    // Agregar la última columna si tiene contenido
    if (currentColumn.length > 0) {
      cutsColumns.push(currentColumn);
    }
    
    // Si no hay cortes, crear una columna con el mensaje
    if (cutsColumns.length === 0) {
      cutsColumns.push(['DETALLE DE CORTES:', '', 'No se encontraron cortes en esta placa.']);
    }
    
    // Calcular dimensiones de las columnas
    const plateColumnWidth = Math.min(300, targetW * 0.25); // Columna de detalle de placa más estrecha
    const cutsColumnWidth = Math.min(250, (targetW - plateColumnWidth - margin * 2) / cutsColumns.length);
    const leftColumnHeight = summaryTexts.length * summaryLineHeight;
    
    // Calcular altura máxima de todas las columnas de cortes con el nuevo espaciado
    const maxCutsColumnHeight = Math.max(...cutsColumns.map(col => col.length * cutsLineHeight));
    const maxColumnHeight = Math.max(leftColumnHeight, maxCutsColumnHeight);
    const summaryBlockBottom = bodyStartY + maxColumnHeight;
    const headerH = Math.max(120, summaryBlockBottom + margin);
    
    const totalH = headerH + margin + h + margin;
    const canvas = document.createElement('canvas');
    canvas.width = targetW + margin * 2;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');
    
    // Fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Título
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 20px system-ui';
    const projectName = (projectNameEl?.value || '').trim();
    const title = `${projectName || 'Plano de cortes'} - Placa ${plateIndex + 1}`;
    ctx.fillText(title, margin, 34);
    
    // Configurar posiciones de columnas
    const leftX = margin;
    
    // Columna izquierda: Detalle de la placa
    ctx.font = 'bold 16px system-ui';
    ctx.fillText('Detalle de Placa', leftX, summaryStartY);
    
    ctx.font = '14px system-ui';
    summaryTexts.forEach((line, idx) => {
      ctx.fillText(line, leftX, bodyStartY + idx * summaryLineHeight);
    });
    
    // Columnas de cortes: una por cada grupo de 3 cortes
    cutsColumns.forEach((columnTexts, columnIndex) => {
      const columnX = leftX + plateColumnWidth + 20 + (columnIndex * (cutsColumnWidth + 15));
      
      // Título de la columna de cortes
      ctx.font = 'bold 12px system-ui';
      if (columnIndex === 0) {
        ctx.fillText('Detalle de Cortes', columnX, summaryStartY);
      } else {
        ctx.fillText('Cortes (cont.)', columnX, summaryStartY);
      }
      
      // Contenido de la columna
      ctx.font = '11px system-ui';
      let lineIndex = 0;
      
      columnTexts.forEach((line, idx) => {
        // Para columnas adicionales, saltar el título "DETALLE DE CORTES:" y su línea vacía
        if (columnIndex > 0 && idx < 2 && (line === 'DETALLE DE CORTES:' || line === '')) {
          return;
        }
        
        ctx.fillText(line, columnX, bodyStartY + lineIndex * cutsLineHeight);
        lineIndex++;
      });
    });
    
    // Dibujar la placa
    ctx.drawImage(img, margin, headerH, w, h);
    
    pages.push({
      canvas,
      title,
      projectName: projectName || 'Plano de cortes'
    });
  }
  
  return pages;
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
  const sPlates = (summaryPlatesEl?.textContent || '').trim();
  const sPlateCost = (summaryPlateCostEl?.textContent || '').trim();
  const sArea = (summaryAreaEl?.textContent || '').trim();
  const sUtil = (summaryUtilEl?.textContent || '').trim();
  const sWaste = (summaryWasteEl?.textContent || '').trim();
  ctx.font = '16px system-ui';
  if (sMaterial) ctx.fillText(sMaterial, margin, 52);
  const leftStats = [sPieces, sPlates, sPlateCost, sArea].filter(Boolean);
  leftStats.forEach((text, idx) => {
    ctx.fillText(text, margin, 64 + idx * 12);
  });
  const rightStats = [sUtil, sWaste].filter(Boolean);
  rightStats.forEach((text, idx) => {
    ctx.fillText(text, targetW - 360, 64 + idx * 12);
  });
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
  
  // Si el resultado es un array (múltiples páginas), manejar cada página
  if (Array.isArray(result)) {
    // Múltiples páginas - abrir en nueva ventana con todas las páginas
    const win = window.open('', '_blank');
    if (!win) {
      // Si no se puede abrir ventana, descargar la primera página como PNG
      const { canvas, projectName } = result[0];
      const dataUrl = canvas.toDataURL('image/png');
      const name = (projectName || 'cortes').trim();
      download(name ? `plano-${name.replace(/\s+/g, '_')}-placa-1.png` : 'plano-cortes-placa-1.png', dataUrl);
      return;
    }
    
    // Crear HTML con todas las páginas
    let htmlContent = `
      <html>
        <head>
          <title>Plano de cortes - Múltiples placas</title>
          <style>
            body { margin: 0; padding: 20px; font-family: system-ui; }
            .page { page-break-after: always; margin-bottom: 20px; }
            .page:last-child { page-break-after: auto; }
            img { width: 100%; max-width: 100%; height: auto; }
            h2 { margin-top: 0; color: #111827; }
            @media print {
              body { padding: 0; }
              .page { margin-bottom: 0; }
            }
          </style>
        </head>
        <body>
    `;
    
    result.forEach((page, index) => {
      const { canvas, title } = page;
      const dataUrl = canvas.toDataURL('image/png');
      htmlContent += `
        <div class="page">
          <h2>${title}</h2>
          <img src="${dataUrl}" />
        </div>
      `;
    });
    
    htmlContent += `
          <script>
            window.onload = function() {
              setTimeout(() => window.print(), 500);
            };
          </script>
        </body>
      </html>
    `;
    
    win.document.write(htmlContent);
    win.document.close();
  } else {
    // Página única - comportamiento original
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

// Función para el reporte del ADMINISTRADOR (CON precios)
function buildSummaryReportAdmin() {
  const lines = [];
  const pushLine = (text = '') => {
    if (text === null || text === undefined) return;
    const normalized = String(text).trim();
    lines.push(normalized);
  };
  const fmt = (n, decimals = 2) => formatNumber(Number(n) || 0, decimals);

  const projectName = (projectNameEl?.value || '').trim() || 'Sin nombre';
  pushLine(`Proyecto: ${projectName}`);
  const materialLabel = (currentMaterialName || '').trim() || 'Sin material seleccionado';
  pushLine(`Material: ${materialLabel}`);

  const summaryElements = [
    summaryPiecesEl,
    summaryPlatesEl,
    summaryPlateCostEl,
    summaryAreaEl,
    summaryUtilEl,
    summaryWasteEl,
    summaryReqEl,
    summaryPlacedEl,
    summaryLeftEl
  ];

  const summaryLines = summaryElements
    .map((el) => (el?.textContent || '').trim())
    .filter(Boolean);

  if (summaryLines.length) {
    lines.push('');
    lines.push('Resumen general:');
    summaryLines.forEach((line) => pushLine(`- ${line}`));
  }

  // Información de placas CON PRECIOS (solo admin)
  if (lastPlateCostSummary.count > 0) {
    lines.push('');
    lines.push('💵 Costo de placas:');
    const mat = lastPlateCostSummary.material ? lastPlateCostSummary.material : materialLabel;
    pushLine(`- 📏 Material: ${mat || 'Sin material seleccionado'}`);
    pushLine(`- 💲 Valor unitario: $${fmt(lastPlateCostSummary.unit, 2)}`);
    pushLine(`- 📦 Placas utilizadas: ${lastPlateCostSummary.count}`);
    pushLine(`- 💰 Total placas: $${fmt(lastPlateCostSummary.total, 2)}`);
  }

  // Información de cubre canto CON PRECIOS (solo admin)
  if (lastEdgeCostSummary.totalMeters > 0 || (lastEdgeCostSummary.entries || []).length) {
    lines.push('');
    lines.push('📐 Costo cubre canto:');
    pushLine(`- 📊 Total: ${fmt(lastEdgeCostSummary.totalMeters, 3)} m — 💰 $${fmt(lastEdgeCostSummary.totalCost, 2)}`);
    (lastEdgeCostSummary.entries || []).forEach(({ label, meters, cost }) => {
      const costText = Number.isFinite(cost) ? ` — $${fmt(cost, 2)}` : '';
      pushLine(`- 🎨 ${label}: ${fmt(meters, 3)} m${costText}`);
    });
  }

  // COSTO TOTAL GENERAL (placas + cubre canto)
  const totalPlates = lastPlateCostSummary.total || 0;
  const totalEdge = lastEdgeCostSummary.totalCost || 0;
  const grandTotal = totalPlates + totalEdge;
  
  if (grandTotal > 0) {
    lines.push('');
    lines.push('💵 TOTAL GENERAL:');
    pushLine(`- Placas: $${fmt(totalPlates, 2)}`);
    pushLine(`- Cubre canto: $${fmt(totalEdge, 2)}`);
    pushLine(`- ═══════════════════`);
    pushLine(`- TOTAL: $${fmt(grandTotal, 2)}`);
  }

  return buildSummaryReportCommon(lines, pushLine, fmt);
}

// Función para el reporte del CLIENTE (SIN precios)
function buildSummaryReportClient() {
  const lines = [];
  const pushLine = (text = '') => {
    if (text === null || text === undefined) return;
    const normalized = String(text).trim();
    lines.push(normalized);
  };
  const fmt = (n, decimals = 2) => formatNumber(Number(n) || 0, decimals);

  const projectName = (projectNameEl?.value || '').trim() || 'Sin nombre';
  pushLine(`Proyecto: ${projectName}`);
  const materialLabel = (currentMaterialName || '').trim() || 'Sin material seleccionado';
  pushLine(`Material: ${materialLabel}`);

  const summaryElements = [
    summaryPiecesEl,
    summaryPlatesEl,
    summaryPlateCostEl,
    summaryAreaEl,
    summaryUtilEl,
    summaryWasteEl,
    summaryReqEl,
    summaryPlacedEl,
    summaryLeftEl
  ];

  const summaryLines = summaryElements
    .map((el) => (el?.textContent || '').trim())
    .filter(Boolean);

  if (summaryLines.length) {
    lines.push('');
    lines.push('Resumen general:');
    summaryLines.forEach((line) => pushLine(`- ${line}`));
  }

  // Información de placas SIN PRECIOS (cliente)
  if (lastPlateCostSummary.count > 0) {
    lines.push('');
    lines.push('📦 Placas utilizadas:');
    const mat = lastPlateCostSummary.material ? lastPlateCostSummary.material : materialLabel;
    pushLine(`- 📏 Material: ${mat || 'Sin material seleccionado'}`);
    pushLine(`- 📋 Cantidad de placas: ${lastPlateCostSummary.count}`);
  }

  // Información de cubre canto SIN PRECIOS (cliente)
  if (lastEdgeCostSummary.totalMeters > 0 || (lastEdgeCostSummary.entries || []).length) {
    lines.push('');
    lines.push('📐 Cubre canto:');
    pushLine(`- 📊 Total: ${fmt(lastEdgeCostSummary.totalMeters, 3)} m`);
    (lastEdgeCostSummary.entries || []).forEach(({ label, meters }) => {
      pushLine(`- 🎨 ${label}: ${fmt(meters, 3)} m`);
    });
  }

  return buildSummaryReportCommon(lines, pushLine, fmt);
}

// Función común que construye el resto del reporte
function buildSummaryReportCommon(lines, pushLine, fmt) {

  const plates = getPlates();
  if (plates.length) {
    lines.push('');
    lines.push('Placas configuradas:');
    plates.forEach((plate, idx) => {
      const qty = Number.isFinite(plate.sc) ? plate.sc : 0;
      const dims = `${fmt(plate.sw, 0)} × ${fmt(plate.sh, 0)} mm`;
      const trims = [];
      if (plate.trim && Number.isFinite(plate.trim.mm) && plate.trim.mm > 0) {
        trims.push(`desbaste ${fmt(plate.trim.mm, 0)} mm`);
        const trimSides = [];
        if (plate.trim.top) trimSides.push('superior');
        if (plate.trim.right) trimSides.push('derecha');
        if (plate.trim.bottom) trimSides.push('inferior');
        if (plate.trim.left) trimSides.push('izquierda');
        if (trimSides.length) trims.push(`lados: ${trimSides.join(', ')}`);
      }
      const trimText = trims.length ? ` (${trims.join('; ')})` : '';
      pushLine(`- Placa ${idx + 1}: ${qty} unidad(es) de ${dims}${trimText}`);
    });
  }

  const rows = getRows();
  const rowDetails = [];
  rows.forEach((row, idx) => {
    const [qtyInput, widthInput, heightInput] = getRowCoreInputs(row);
    if (!qtyInput || !widthInput || !heightInput) return;
    const qty = parseInt(qtyInput.value, 10);
    const w = parseFloat(widthInput.value);
    const h = parseFloat(heightInput.value);
    if (!(qty >= 1 && w > 0 && h > 0)) return;

    let rotationLabel = 'Automática';
    if (row._manualRotWanted === true) rotationLabel = 'Manual 90°';
    else if (row._manualRotWanted === false) rotationLabel = 'Manual 0°';
    else if (row._getRotation && row._getRotation()) rotationLabel = 'Automática (rotada)';

    const edgeLines = row.querySelectorAll('line.edge');
    const sideNames = ['superior', 'derecha', 'inferior', 'izquierda'];
    const selectedSides = [];
    edgeLines.forEach((edge, i) => {
      if (edge.dataset.selected === '1') selectedSides.push(sideNames[i] || `lado ${i + 1}`);
    });

    const sanitizeEdgeLabel = (select) => {
      if (!select) return 'Sin selección';
      const option = select.selectedOptions?.[0];
      if (!option) return 'Sin selección';
      return (option.textContent || '').trim() || 'Sin selección';
    };

    const widthEdgeSelect = row._edgeSelects?.width || row.querySelector('select[data-role="width-edge"]');
    const heightEdgeSelect = row._edgeSelects?.height || row.querySelector('select[data-role="height-edge"]');
    const horizontalEdgeLabel = sanitizeEdgeLabel(widthEdgeSelect);
    const verticalEdgeLabel = sanitizeEdgeLabel(heightEdgeSelect);
    const rowEdgebandMm = lastEdgebandByRow.get(idx) || 0;
    const rowEdgebandMeters = rowEdgebandMm / 1000;

    const parts = [];
    parts.push(`${qty} corte(s) de ${fmt(w, 0)} × ${fmt(h, 0)} mm`);
    parts.push(`rotación: ${rotationLabel}`);
    parts.push(`bordes seleccionados: ${selectedSides.length ? selectedSides.join(', ') : 'ninguno'}`);
    parts.push(`cubre canto fila: ${fmt(rowEdgebandMeters, 3)} m`);
    parts.push(`cubre canto horizontal: ${horizontalEdgeLabel}`);
    parts.push(`cubre canto vertical: ${verticalEdgeLabel}`);
    rowDetails.push(`- Fila ${idx + 1}: ${parts.join(' | ')}`);
  });

  if (rowDetails.length) {
    lines.push('');
    lines.push('Detalle de cortes:');
    rowDetails.forEach((line) => pushLine(line));
  }

  return lines.join('\n');
}

async function sendEmailViaProvider({ from, to, subject, text, attachments = [], replyTo }) {
  if (!to) throw new Error('El destinatario es obligatorio.');
  const senderOverride = (window.EMAIL_PROVIDER_CONFIG?.fromOverride || '').trim();
  const normalizedFrom = senderOverride || from;
  if (!normalizedFrom) throw new Error('No hay remitente configurado para el correo.');
  const payload = {
    from: normalizedFrom,
    to,
    subject,
    text,
    attachments
  };
  if (window.EMAIL_PROVIDER_CONFIG?.fromName) {
    payload.fromName = window.EMAIL_PROVIDER_CONFIG.fromName;
  }
  const effectiveReplyTo = replyTo || (senderOverride && from && from !== senderOverride ? from : undefined);
  if (effectiveReplyTo) {
    payload.replyTo = effectiveReplyTo;
  }

  if (typeof window.sendViaApi === 'function') {
    const result = await window.sendViaApi(payload);
    return result ?? null;
  }

  if (typeof window.GenericMailProvider === 'function') {
    const result = await window.GenericMailProvider(payload);
    return result ?? null;
  }

  if (EMAIL_PROVIDER_ENDPOINT) {
    const response = await fetch(EMAIL_PROVIDER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      let details = '';
      try {
        const errJson = await response.json();
        details = errJson?.error ? `: ${errJson.error}` : '';
      } catch (_) {}
      throw new Error(`El proveedor respondió ${response.status}${details}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json().catch(() => null);
    }
    return null;
  }

  console.warn('No hay proveedor de email configurado. Definí window.GenericMailProvider o window.EMAIL_PROVIDER_ENDPOINT.', payload);
  throw new Error('Proveedor de email no configurado.');
}

async function sendPlainEmail({ from, to, subject, text }) {
  return sendEmailViaProvider({ from, to, subject, text, attachments: [], replyTo: from });
}

async function sendEmailWithAttachment({ from, to, subject, text, filename, blob, attachments = [] }) {
  const emailAttachments = [];
  
  // Si se pasa un blob individual (para compatibilidad)
  if (blob && filename) {
    const base64 = await blobToBase64(blob);
    emailAttachments.push({ filename, content: base64, mimeType: 'application/pdf' });
  }
  
  // Agregar adjuntos adicionales
  for (const att of attachments) {
    if (att.blob && att.filename) {
      const base64 = await blobToBase64(att.blob);
      const mimeType = att.mimeType || 'application/octet-stream';
      emailAttachments.push({ filename: att.filename, content: base64, mimeType });
    }
  }
  
  return sendEmailViaProvider({ from, to, subject, text, attachments: emailAttachments, replyTo: from });
}

async function handleSendCuts() {
  if (!sendCutsBtn) return;
  if (sendCutsBtn.disabled) return;
  const projectName = (projectNameEl?.value || '').trim();
  if (!projectName) {
    showAppDialog({ title: 'Falta el nombre del proyecto', message: 'Ingresá un nombre de proyecto antes de enviar.', tone: 'error' });
    projectNameEl?.focus();
    return;
  }
  if (!authUser) {
    showAppDialog({ title: 'Necesitás iniciar sesión', message: 'Iniciá sesión antes de enviar los cortes.', tone: 'warning' });
    return;
  }
  const fromEmail = (authUser.email || '').trim();
  if (!fromEmail) {
    showAppDialog({ title: 'Correo faltante', message: 'Tu usuario no tiene un correo configurado. Cerrá sesión e ingresá nuevamente.', tone: 'error' });
    return;
  }
  sendCutsBtn.disabled = true;
  sendCutsBtn.textContent = 'Enviando…';
  sendCutsBtn.dataset.busy = '1';
  sendCutsBtn.classList.add('disabled-btn');
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
    const jsonState = serializeState();
    const jsonBlob = new Blob([JSON.stringify(jsonState, null, 2)], { type: 'application/json' });
    const jsonFilename = `${slug || 'cortes'}-proyecto.json`;
    // NO descargar localmente, solo adjuntar a emails
    const subjectName = rawName || title || 'Plano de cortes';
    const adminBodyText = `Se adjunta el plano de cortes "${subjectName}" generado desde la aplicación.`;
    const clientBodyText = `Se adjunta la configuración de cortes "${subjectName}" generado desde la aplicación. Para su futuro uso.`;
    const adminEmail = 'ludovicots@gmail.com';
    const recipientsSent = [];
    const sendErrors = [];

    const buildAdminBody = () => `${adminBodyText}\n\n${buildSummaryReportAdmin()}`;
    const buildClientBody = () => `${clientBodyText}\n\n${buildSummaryReportClient()}`;
    
    const sendTo = async (to, text, { attachPdf = true, attachJson = true } = {}) => {
      const attachments = [];
      
      // Adjuntar PDF si se solicita
      if (attachPdf && pdfBlob) {
        attachments.push({ blob: pdfBlob, filename, mimeType: 'application/pdf' });
      }
      
      // Adjuntar JSON si se solicita
      if (attachJson && jsonBlob) {
        attachments.push({ blob: jsonBlob, filename: jsonFilename, mimeType: 'application/json' });
      }
      
      if (attachments.length === 0) {
        await sendPlainEmail({ from: fromEmail, to, subject: `Plano de cortes - ${subjectName}`, text });
        return;
      }
      
      await sendEmailWithAttachment({
        from: fromEmail,
        to,
        subject: `Plano de cortes - ${subjectName}`,
        text,
        attachments
      });
    };

    if (adminEmail) {
      try {
        await sendTo(adminEmail, buildAdminBody(), { attachPdf: true, attachJson: true });
        recipientsSent.push(adminEmail);
      } catch (err) {
        console.error('No se pudo enviar al administrador', err);
        sendErrors.push(`No se pudo enviar a ${adminEmail}: ${err?.message || err}`);
      }
    }

    const userEmail = (authUser.email || '').trim();
    if (userEmail) {
      const greeting = authUser.name ? `Hola ${authUser.name.trim()},` : 'Hola,';
      const userText = `${greeting}\n\n${buildClientBody()}\n\nSe adjunta el archivo JSON del proyecto para que puedas importarlo nuevamente en la app.`;
      try {
        await sendTo(userEmail, userText, { attachPdf: false, attachJson: true });
        recipientsSent.push(userEmail);
      } catch (err) {
        console.error('No se pudo enviar al usuario final', err);
        sendErrors.push(`No se pudo enviar a ${userEmail}: ${err?.message || err}`);
      }
    }

    const downloadNotice = 'Los archivos se enviaron por correo electrónico.';
    if (sendErrors.length) {
      if (sendErrors.some(msg => /Proveedor de email no configurado/.test(String(msg)))) {
        sendErrors.push('Configurá window.EMAIL_PROVIDER_ENDPOINT o window.GenericMailProvider para habilitar el envío automático de correos.');
      }
      const successNote = recipientsSent.length ? `Se envió correctamente a: ${recipientsSent.join(', ')}.` : 'No se pudo completar ningún envío.';
      showAppDialog({
        title: 'Envío de correo con advertencias',
        message: `${sendErrors.join('\n')}\n${successNote}\n${downloadNotice}`,
        tone: 'warning'
      });
    } else {
      const recipientLabel = recipientsSent.length ? recipientsSent.join(', ') : 'los destinatarios configurados';
      showAppDialog({
        title: 'Correo enviado',
        message: `Se envió ${filename} a ${recipientLabel}.\n${downloadNotice}`,
        tone: 'success'
      });
    }
  } catch (err) {
    console.error(err);
    showAppDialog({
      title: 'Error al enviar',
      message: `No se pudo enviar el correo: ${err?.message || err}`,
      tone: 'error'
    });
  } finally {
    delete sendCutsBtn.dataset.busy;
    sendCutsBtn.textContent = sendCutsDefaultLabel;
    sendCutsBtn.disabled = false;
    sendCutsBtn.classList.remove('disabled-btn');
    toggleActionButtons(isSheetComplete());
  }
}

async function handleWhatsAppShare(event) {
  event.preventDefault();
  const fallback = () => {
    window.open(buildWhatsappUrl(), '_blank', 'noopener,noreferrer');
  };

  if (!(whatsappLink && isBackofficeAllowed)) {
    fallback();
    return;
  }

  if (whatsappLink.dataset.busy === '1') return;

  if (!isSheetComplete()) {
    fallback();
    return;
  }

  whatsappLink.dataset.busy = '1';
  whatsappLink.classList.add('disabled-btn');
  try {
    const result = await buildExportCanvasForPdf();
    if (!result) {
      fallback();
      return;
    }
    const { canvas, projectName, title } = result;
    const pdfBlob = canvasToPdfBlob(canvas);
    const baseName = (projectName || title || 'planificación').trim() || 'planificacion';
    const slug = baseName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'planificacion';
    const fileName = `planificacion-${slug}.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

    let shared = false;
    if (navigator.share) {
      const shareData = { text: WHATSAPP_MESSAGE, files: [pdfFile], title: fileName };
      if (!navigator.canShare || navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share(shareData);
          shared = true;
        } catch (shareErr) {
          if (shareErr?.name !== 'AbortError') {
            console.warn('WhatsApp share fallback', shareErr);
          }
        }
      }
    }

    if (!shared) {
      triggerBlobDownload(fileName, pdfBlob);
      fallback();
    }
  } catch (err) {
    console.error('No se pudo preparar el PDF para WhatsApp', err);
    fallback();
  } finally {
    delete whatsappLink.dataset.busy;
    whatsappLink.classList.remove('disabled-btn');
  }
}

if (exportPdfBtn) {
  exportPdfBtn.addEventListener('click', () => {
    if (!isBackofficeAllowed) return;
    exportPDF();
  });
}
if (sendCutsBtn) {
  sendCutsBtn.addEventListener('click', () => {
    handleSendCuts();
  });
}
if (recalcLayoutBtn) {
  recalcLayoutBtn.addEventListener('click', () => {
    scheduleLayoutRecalc({ immediate: true });
  });
}
if (whatsappLink) {
  whatsappLink.href = buildWhatsappUrl();
  whatsappLink.addEventListener('click', handleWhatsAppShare);
}
if (resetAllBtn) {
  resetAllBtn.addEventListener('click', () => {
    clearAllPlates();
    clearAllRows();
    if (projectNameEl) projectNameEl.value = '';
    pendingKerfValue = '5';
    if (kerfInput) kerfInput.value = '5';
    if (autoRotateToggle) autoRotateToggle.checked = true;
    if (plateMaterialSelect) {
      if (plateMaterialSelect.querySelector('option[value=""]')) {
        plateMaterialSelect.value = '';
      }
      currentMaterialName = '';
      try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}
      updateMaterialDropdownState();
    } else {
      currentMaterialName = DEFAULT_MATERIAL;
    }
    
    // Resetear optimización avanzada y cache
    showingAdvancedOptimization = false;
    lastOptimizationHash = null;
    lastOptimizationResult = null;
    if (sheetCanvasEl) {
      sheetCanvasEl.innerHTML = '';
    }
    
    applyPlatesGate();
    toggleAddButton();
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
  const showCosts = true;
  const priceMap = new Map(edgeCatalog.map((item) => [item.name.toLocaleLowerCase(), Number.isFinite(item.pricePerMeter) ? item.pricePerMeter : 0]));
  lastEdgebandByRow = new Map();
  lastEdgeCostSummary = { totalMeters: 0, totalCost: 0, entries: [] };

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
  const summaryEntries = Array.from(edgeTotals.values()).sort((a, b) => b.mm - a.mm);
  const lines = [];
  summaryEntries.forEach((entry) => {
      const meters = entry.mm / 1000;
      const normalized = entry.name ? entry.name.toLocaleLowerCase() : '';
      const hasCatalogPrice = normalized ? priceMap.has(normalized) : false;
      const price = hasCatalogPrice ? (priceMap.get(normalized) || 0) : 0;
      const cost = meters * price;
      const label = entry.name && !hasCatalogPrice ? `${entry.name} (no catalogado)` : entry.name;
      totalMeters += meters;
      if (showCosts) totalCost += cost;
      lines.push({ label, meters, cost });
  });
  if (summaryTotalEl) {
    if (lines.length) {
      summaryTotalEl.innerHTML = '';
      
      // Título de la sección (igual que Costo de Placas)
      const titleDiv = document.createElement('div');
      titleDiv.style.cssText = 'font-weight:600;margin-bottom:8px;color:#cbd5e1;';
      titleDiv.textContent = '💰 Costo de Cubre Canto';
      summaryTotalEl.appendChild(titleDiv);
      
      // Contenido con estilo similar
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = 'font-size:0.9em;color:#94a3b8;';
      
      const totalLine = document.createElement('div');
      totalLine.style.cssText = 'margin-bottom:4px;';
      const costLabel = showCosts ? ` — $${fmt(totalCost, 2)}` : '';
      totalLine.textContent = `• Total: ${fmt(totalMeters, 3)} m${costLabel}`;
      contentDiv.appendChild(totalLine);
      
      lines.forEach(({ label, meters, cost }) => {
        const lineDiv = document.createElement('div');
        lineDiv.style.cssText = 'margin-left:12px;font-size:0.95em;';
        const costText = showCosts && Number.isFinite(cost) ? ` — $${fmt(cost, 2)}` : '';
        lineDiv.textContent = `${label}: ${fmt(meters, 3)} m${costText}`;
        contentDiv.appendChild(lineDiv);
      });
      
      summaryTotalEl.appendChild(contentDiv);
    } else {
      summaryTotalEl.innerHTML = '';
    }
  }
  lastEdgeCostSummary = {
    totalMeters,
    totalCost: showCosts ? totalCost : 0,
    entries: lines.map(({ label, meters, cost }) => ({ label, meters, cost }))
  };
  
  // Actualizar secciones de costos
  updateCostSummary();
  
  // Actualizar lista combinada (con datos de colocación)
  updateRowSummaryUI();
}

/**
 * Actualiza las secciones de costo de placas y total general
 */
function updateCostSummary() {
  const fmt = (n, decimals = 2) => formatNumber(Number(n) || 0, decimals);
  
  const plateCost = lastPlateCostSummary.total || 0;
  const plateCount = lastPlateCostSummary.count || 0;
  const plateUnit = lastPlateCostSummary.unit || 0;
  
  const edgeCost = lastEdgeCostSummary.totalCost || 0;
  const edgeMeters = lastEdgeCostSummary.totalMeters || 0;
  
  // Actualizar sección de costo de placas
  if (summaryPlatesValueEl) {
    if (plateCost > 0 && plateCount > 0) {
      summaryPlatesValueEl.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;color:#cbd5e1;">💰 Costo de Placas</div>
        <div style="font-size:0.9em;color:#94a3b8;">
          <div>• Placas utilizadas: ${plateCount}</div>
          <div>• Valor unitario: $${fmt(plateUnit, 2)}</div>
          <div style="margin-top:4px;font-weight:600;color:#10b981;">Total placas: $${fmt(plateCost, 2)}</div>
        </div>
      `;
      summaryPlatesValueEl.style.display = '';
    } else {
      summaryPlatesValueEl.style.display = 'none';
    }
  }
  
  // Actualizar total general
  if (summaryGrandTotalEl) {
    const grandTotal = plateCost + edgeCost;
    if (grandTotal > 0) {
      summaryGrandTotalEl.innerHTML = `
        <div class="grand-total-label">💵 Total General</div>
        <div class="grand-total-amount">$${fmt(grandTotal, 2)}</div>
        <div style="font-size:0.85em;color:#fbbf24;opacity:0.85;margin-top:4px;">
          Placas: $${fmt(plateCost, 2)} + Cubre canto: $${fmt(edgeCost, 2)}
        </div>
      `;
      summaryGrandTotalEl.style.display = '';
    } else {
      summaryGrandTotalEl.style.display = 'none';
    }
  }
}

// Render de la placa completa al pie
async function renderSheetOverview() {
  // Si estamos mostrando la visualización del optimizador avanzado, no sobrescribir
  if (showingAdvancedOptimization) {
    console.log('⏸️ renderSheetOverview omitido (mostrando optimización avanzada)');
    return;
  }
  
  if (!sheetCanvasEl) return;
  sheetCanvasEl.innerHTML = '';
  lastPlateCostSummary = { unit: 0, total: 0, count: 0, material: currentMaterialName || '' };
  
  // Mostrar loading usando LoadingManager
  loadingManager.showLoading('sheet-overview', sheetCanvasEl, 'Calculando optimización...');
  
  try {
    const solution = await solveCutLayoutInternal();
    loadingManager.hideLoading('sheet-overview');
    
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
  const allowRender = true;
  const totalPlates = Array.isArray(instances) ? instances.length : 0;
  const usedPlateCount = Array.isArray(placementsByPlate)
    ? placementsByPlate.reduce((acc, plate) => acc + (Array.isArray(plate) && plate.length ? 1 : 0), 0)
    : 0;

  if (allowRender) {
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
      svg.dataset.plateWidthMm = String(instance.sw || 0);
      svg.dataset.plateHeightMm = String(instance.sh || 0);
      svg.dataset.scale = String(scale || 0);

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
        const baseFs = clamp(Math.min(pxW, pxH) * 0.16, 9, 15);
        const isSmallPiece = Math.min(r.rawW, r.rawH) < 200;
        const fontSize = isSmallPiece ? Math.max(5, Math.round(baseFs / 2)) : baseFs;

        const widthLabel = document.createElementNS(svgNS, 'text');
        widthLabel.setAttribute('class', 'piece-label');
        widthLabel.dataset.label = 'width';
        widthLabel.setAttribute('text-anchor', 'middle');
        widthLabel.setAttribute('dominant-baseline', 'alphabetic');
        widthLabel.setAttribute('x', String(pxX + pxW / 2));
        widthLabel.setAttribute('y', String(pxY + pxH - 21));
        widthLabel.setAttribute('font-size', String(fontSize));
        widthLabel.textContent = `${formatNumber(r.rawW, 0)}`;
        svg.appendChild(widthLabel);

        const heightLabel = document.createElementNS(svgNS, 'text');
        heightLabel.setAttribute('class', 'piece-label');
        heightLabel.dataset.label = 'height';
        heightLabel.setAttribute('text-anchor', 'end');
        heightLabel.setAttribute('x', String(pxX + pxW - 25));
        heightLabel.setAttribute('y', String(pxY + pxH / 2));
        heightLabel.setAttribute('font-size', String(fontSize));
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

      const widthEdgeSelect = rowEl?._edgeSelects?.width || rowEl?.querySelector('select[data-role="width-edge"]');
      const heightEdgeSelect = rowEl?._edgeSelects?.height || rowEl?.querySelector('select[data-role="height-edge"]');
      const storedEdgeNames = rowEl?._edgeNames || null;
      const labelForEdgeSelect = (selectEl) => {
        if (!selectEl) return '';
        const directValue = (selectEl.value || '').trim();
        if (directValue && !/^sin\s+cubre\s*canto/i.test(directValue)) return directValue;
        const datasetLabel = (selectEl.dataset?.label || '').trim();
        if (datasetLabel && !/^sin\s+cubre\s*canto/i.test(datasetLabel)) return datasetLabel;
        const datasetValue = (selectEl.dataset?.value || '').trim();
        if (datasetValue && !/^sin\s+cubre\s*canto/i.test(datasetValue)) return datasetValue;
        const option = selectEl.selectedOptions?.[0];
        if (!option) return '';
        const raw = (option.textContent || '').trim();
        if (!raw || /^sin\s+cubre\s*canto/i.test(raw)) return '';
        const [base] = raw.split('—');
        return (base || raw).trim();
      };

      let horizontalEdgeName = labelForEdgeSelect(widthEdgeSelect) || storedEdgeNames?.horizontal || '';
      let verticalEdgeName = labelForEdgeSelect(heightEdgeSelect) || storedEdgeNames?.vertical || '';

      if (pieceMeta && baseRot !== finalRot) {
        const swap = horizontalEdgeName;
        horizontalEdgeName = verticalEdgeName;
        verticalEdgeName = swap;
      }

      const bandGroup = document.createElementNS(svgNS, 'g');
      bandGroup.setAttribute('class', 'edge-band-lines');
      const drawLine = (x1, y1, x2, y2, meta = {}) => {
        const lineEl = document.createElementNS(svgNS, 'line');
        lineEl.setAttribute('class', 'edge-band-line');
        lineEl.setAttribute('x1', String(x1));
        lineEl.setAttribute('y1', String(y1));
        lineEl.setAttribute('x2', String(x2));
        lineEl.setAttribute('y2', String(y2));
        lineEl.setAttribute('stroke', '#ffffff');
        lineEl.setAttribute('stroke-width', '1.2');
        lineEl.setAttribute('stroke-linecap', 'round');
        if (meta.name) {
          lineEl.setAttribute('data-edge-name', meta.name);
        }
        if (meta.orientation) {
          lineEl.setAttribute('data-edge-orientation', meta.orientation);
        }
        if (meta.position) {
          lineEl.setAttribute('data-edge-position', meta.position);
        }
        if (Number.isFinite(meta.rawWidth)) {
          lineEl.setAttribute('data-piece-raww', String(meta.rawWidth));
        }
        if (Number.isFinite(meta.rawHeight)) {
          lineEl.setAttribute('data-piece-rawh', String(meta.rawHeight));
        }
        bandGroup.appendChild(lineEl);
      };
      const halfW = pxW / 2;
      const halfH = pxH / 2;
      const rawWidth = Number(r.rawW) || 0;
      const rawHeight = Number(r.rawH) || 0;

      if (selection.top && halfW > 4) {
        const len = halfW;
        const xStart = pxX + (pxW - len) / 2;
        const yPos = pxY + 8;
        drawLine(xStart, yPos, xStart + len, yPos, {
          name: horizontalEdgeName,
          orientation: 'horizontal',
          position: 'top',
          rawWidth,
          rawHeight
        });
      }
      if (selection.bottom && halfW > 4) {
        const len = halfW;
        const xStart = pxX + (pxW - len) / 2;
        const yPos = pxY + pxH - 8;
        drawLine(xStart, yPos, xStart + len, yPos, {
          name: horizontalEdgeName,
          orientation: 'horizontal',
          position: 'bottom',
          rawWidth,
          rawHeight
        });
      }
      if (selection.left && halfH > 4) {
        const len = halfH;
        const yStart = pxY + (pxH - len) / 2;
        const xPos = pxX + 8;
        drawLine(xPos, yStart, xPos, yStart + len, {
          name: verticalEdgeName,
          orientation: 'vertical',
          position: 'left',
          rawWidth,
          rawHeight
        });
      }
      if (selection.right && halfH > 4) {
        const len = halfH;
        const yStart = pxY + (pxH - len) / 2;
        const xPos = pxX + pxW - 8;
        drawLine(xPos, yStart, xPos, yStart + len, {
          name: verticalEdgeName,
          orientation: 'vertical',
          position: 'right',
          rawWidth,
          rawHeight
        });
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
  }

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
  if (summaryPlatesEl) {
    const platesSummaryText = totalPlates && totalPlates !== usedPlateCount
      ? `Placas utilizadas: ${usedPlateCount} de ${totalPlates}`
      : `Placas utilizadas: ${usedPlateCount}`;
    summaryPlatesEl.textContent = platesSummaryText;
  }
  if (summaryPlateCostEl) {
    const materialPrice = getMaterialPrice(currentMaterialName);
    const totalCost = materialPrice * usedPlateCount;
    lastPlateCostSummary = {
      unit: materialPrice,
      total: totalCost,
      count: usedPlateCount,
      material: currentMaterialName || ''
    };
    if (usedPlateCount > 0) {
      summaryPlateCostEl.style.display = '';
      summaryPlateCostEl.textContent = `Costo placas: $${fmt(totalCost, 2)} (valor unitario: $${fmt(materialPrice, 2)})`;
    } else {
      summaryPlateCostEl.style.display = '';
      summaryPlateCostEl.textContent = 'Costo placas: $0 (sin placas utilizadas)';
    }
  }
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
  
  } catch (error) {
    console.error('Error en renderSheetOverview:', error);
    loadingManager.hideLoading('sheet-overview');
    
    // Mostrar mensaje de error
    const errorEl = document.createElement('div');
    errorEl.className = 'error-indicator';
    errorEl.style.cssText = 'text-align: center; padding: 20px; color: #d32f2f; background: #ffebee; border-radius: 4px; margin: 10px 0;';
    errorEl.textContent = 'Error al calcular optimización. Intente nuevamente.';
    sheetCanvasEl.appendChild(errorEl);
    
    resetSummaryUI();
  }
}


// Inicializar vista de placa al cargar
scheduleLayoutRecalc({ immediate: true });

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
    scheduleLayoutRecalc({ immediate: true });
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

// ===== BOTÓN RECALCULAR OPTIMIZACIÓN =====
if (generateLayoutBtn) {
  generateLayoutBtn.addEventListener('click', async () => {
    try {
      console.log('🔄 Recalculando optimización...');
      
      // Simplemente forzar un recálculo
      generateLayoutBtn.disabled = true;
      generateLayoutBtn.textContent = '⏳ Optimizando...';
      
      await renderWithAdvancedOptimizer();
      
      console.log('✅ Optimización recalculada');
      
    } catch (error) {
      console.error('❌ Error en optimización:', error);
      alert('Error al recalcular: ' + error.message);
    } finally {
      generateLayoutBtn.disabled = false;
      generateLayoutBtn.textContent = '🔄 Recalcular Optimización';
    }
  });
}


/**
 * Aplica la solución optimizada a la interfaz
 */
async function applySolutionToUI(optimizationResult, plateSpec, options) {
  // Aquí se conectará con solveCutLayoutInternal para actualizar la visualización
  // Por ahora, forzar actualización manual
  console.log('📍 Aplicando solución a UI...');
  
  // Convertir formato de advanced-optimizer al formato esperado por renderSolution
  const { plates, remaining } = optimizationResult;
  
  const instances = plates.map((plate, idx) => ({
    id: `plate-${idx}`,
    width: plateSpec.width,
    height: plateSpec.height,
    material: currentMaterialName || DEFAULT_MATERIAL
  }));
  
  const placements = [];
  const placementsByPlate = plates.map(plate => {
    const piecesData = plate.getPlacedPiecesWithCoords();
    return piecesData.map(pd => ({
      piece: pd.piece,
      x: pd.x,
      y: pd.y,
      width: pd.width,
      height: pd.height,
      rotated: pd.piece.rotated || false
    }));
  });
  
  placementsByPlate.forEach(platePlacements => {
    placements.push(...platePlacements);
  });
  
  const totalRequested = plates.reduce((sum, p) => sum + p.placedPieces.length, 0) + remaining.length;
  const usedArea = plates.reduce((sum, p) => sum + p.usedArea, 0);
  const totalArea = plates.reduce((sum, p) => sum + p.totalArea, 0);
  
  const solution = {
    instances,
    placementsByPlate,
    placements,
    totalRequested,
    usedArea,
    totalArea,
    leftoverPieces: remaining,
    pieces: placements.map(p => p.piece)
  };
  
  renderSolution(solution);
  console.log('✅ Solución aplicada a UI');
}
