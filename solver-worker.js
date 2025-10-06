// Web Worker para el solver de optimización de placas
// Este worker ejecuta los algoritmos de optimización sin bloquear la UI

let shouldStop = false;

// Configuración del algoritmo
const PACKING_EPSILON = 0.0001;
const META_SETTINGS = {
  maxIterations: 200,
  randomRestarts: 5,
  maxGlobalLoops: 30,
  seedOrderSamples: 6,
  perPieceFactor: 4.0,
  temperatureStart: 1.8,
  temperatureCool: 0.92,
  temperatureMin: 0.08,
  minPerturbation: 0.08,
  maxPerturbation: 0.45,
  missingAreaWeight: 10000,
  missingPiecePenaltyFactor: 50
};

// Funciones auxiliares del algoritmo
function dimensionKeyNormalized(wVal, hVal) {
  const safeW = Number.isFinite(wVal) ? wVal : 0;
  const safeH = Number.isFinite(hVal) ? hVal : 0;
  const minDim = Math.min(safeW, safeH);
  const maxDim = Math.max(safeW, safeH);
  return `${minDim.toFixed(1)}x${maxDim.toFixed(1)}`;
}

function createPlateState(instance, kerf, allowAutoRotate) {
  const trim = instance.trim || { top: 0, right: 0, bottom: 0, left: 0 };
  const usableW = Math.max(0, instance.sw - trim.left - trim.right);
  const usableH = Math.max(0, instance.sh - trim.top - trim.bottom);
  
  return {
    instance,
    trim,
    usableW,
    usableH,
    allowAutoRotate,
    kerf,
    freeRects: [{ x: 0, y: 0, w: usableW, h: usableH }],
    placements: []
  };
}

function tryPlacePieceOnPlate(state, piece) {
  if (shouldStop) return null;
  
  const { freeRects, kerf } = state;
  const reqW = piece.rawW + kerf;
  const reqH = piece.rawH + kerf;

  for (let i = 0; i < freeRects.length; i++) {
    const rect = freeRects[i];
    
    // Verificar si cabe
    if (rect.w >= reqW && rect.h >= reqH) {
      // Colocar pieza
      const placement = {
        piece,
        x: rect.x,
        y: rect.y,
        w: piece.rawW,
        h: piece.rawH,
        usedW: reqW,
        usedH: reqH
      };

      // Actualizar rectángulos libres
      freeRects.splice(i, 1);
      
      // Crear nuevos rectángulos libres
      const remainingW = rect.w - reqW;
      const remainingH = rect.h - reqH;
      
      if (remainingW > PACKING_EPSILON) {
        freeRects.push({
          x: rect.x + reqW,
          y: rect.y,
          w: remainingW,
          h: rect.h
        });
      }
      
      if (remainingH > PACKING_EPSILON) {
        freeRects.push({
          x: rect.x,
          y: rect.y + reqH,
          w: reqW,
          h: remainingH
        });
      }

      state.placements.push(placement);
      return placement;
    }
  }
  
  return null;
}

function cleanupFreeRectsList(freeRects) {
  // Eliminar rectángulos contenidos dentro de otros
  for (let i = freeRects.length - 1; i >= 0; i--) {
    const rect1 = freeRects[i];
    for (let j = 0; j < freeRects.length; j++) {
      if (i === j) continue;
      const rect2 = freeRects[j];
      
      if (rect1.x >= rect2.x && rect1.y >= rect2.y &&
          rect1.x + rect1.w <= rect2.x + rect2.w &&
          rect1.y + rect1.h <= rect2.y + rect2.h) {
        freeRects.splice(i, 1);
        break;
      }
    }
  }
}

function runGreedyGuillotine(instances, order, options) {
  if (shouldStop) return null;
  
  const states = instances.map(inst => createPlateState(inst, options.kerf, options.allowAutoRotate));
  const remaining = order.slice();
  const placements = [];
  const placementsByPlate = states.map(() => []);

  // Algoritmo greedy guillotine
  for (let plateIdx = 0; plateIdx < states.length && remaining.length && !shouldStop; plateIdx++) {
    const state = states[plateIdx];
    let progress = true;
    
    while (progress && remaining.length && !shouldStop) {
      progress = false;
      
      for (let i = 0; i < remaining.length; i++) {
        if (shouldStop) break;
        
        const piece = remaining[i];
        const placement = tryPlacePieceOnPlate(state, piece);
        
        if (!placement) continue;

        placements.push(placement);
        placementsByPlate[plateIdx].push(placement);
        remaining.splice(i, 1);
        progress = true;
        break;
      }
      
      // Limpiar rectángulos libres ocasionalmente
      if (state.freeRects.length > 20) {
        cleanupFreeRectsList(state.freeRects);
      }
    }
  }

  const usedArea = placements.reduce((acc, p) => acc + (p.w * p.h), 0);
  const totalArea = instances.reduce((acc, inst) => acc + (inst.sw * inst.sh), 0);
  const wasteArea = totalArea - usedArea;
  const missingArea = remaining.reduce((acc, p) => acc + (p.rawW * p.rawH), 0);
  
  return {
    placements,
    placementsByPlate,
    leftovers: remaining,
    usedArea,
    wasteArea,
    totalArea,
    missingArea,
    score: wasteArea + missingArea * 10000
  };
}

function buildGreedyOrder(pieces) {
  // Agrupar por dimensiones
  const groups = new Map();
  
  pieces.forEach(piece => {
    const key = dimensionKeyNormalized(piece.rawW, piece.rawH);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(piece);
  });

  const result = [];
  
  // Ordenar grupos por área decreciente
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const areaA = a[1][0].rawW * a[1][0].rawH;
    const areaB = b[1][0].rawW * b[1][0].rawH;
    return areaB - areaA;
  });

  sortedGroups.forEach(([key, groupPieces]) => {
    // Ordenar dentro del grupo
    groupPieces.sort((a, b) => {
      const areaA = a.rawW * a.rawH;
      const areaB = b.rawW * b.rawH;
      if (Math.abs(areaA - areaB) > PACKING_EPSILON) return areaB - areaA;
      
      const maxDimA = Math.max(a.rawW, a.rawH);
      const maxDimB = Math.max(b.rawW, b.rawH);
      return maxDimB - maxDimA;
    });
    
    result.push(...groupPieces);
  });

  return result;
}

function generateSeedOrders(pieces, sampleCount = 4) {
  const orders = [];
  
  // Orden greedy base
  const greedyOrder = buildGreedyOrder(pieces);
  orders.push(greedyOrder);
  orders.push([...greedyOrder].reverse());
  
  // Orden por lado más largo
  const longestSideOrder = [...pieces].sort((a, b) => {
    const maxA = Math.max(a.rawW, a.rawH);
    const maxB = Math.max(b.rawW, b.rawH);
    return maxB - maxA;
  });
  orders.push(longestSideOrder);
  
  // Órdenes aleatorios adicionales
  for (let i = orders.length; i < sampleCount; i++) {
    const randomOrder = [...pieces];
    for (let j = randomOrder.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [randomOrder[j], randomOrder[k]] = [randomOrder[k], randomOrder[j]];
    }
    orders.push(randomOrder);
  }
  
  return orders;
}

function perturbOrder(order, minPerturbation, maxPerturbation) {
  const result = [...order];
  const perturbationStrength = minPerturbation + Math.random() * (maxPerturbation - minPerturbation);
  const numSwaps = Math.max(1, Math.floor(result.length * perturbationStrength));
  
  for (let i = 0; i < numSwaps; i++) {
    const idx1 = Math.floor(Math.random() * result.length);
    const idx2 = Math.floor(Math.random() * result.length);
    [result[idx1], result[idx2]] = [result[idx2], result[idx1]];
  }
  
  return result;
}

function getAdaptiveMetaSettings(pieceCount) {
  const settings = { ...META_SETTINGS };
  
  if (pieceCount > 50) {
    // Ultra conservador para 50+ piezas
    settings.maxIterations = 40;
    settings.randomRestarts = 1;
    settings.maxGlobalLoops = 8;
    settings.seedOrderSamples = 2;
    settings.perPieceFactor = 1.5;
    settings.temperatureStart = 0.8;
    settings.temperatureCool = 0.85;
    settings.missingPiecePenaltyFactor = 20;
  } else if (pieceCount > 35) {
    settings.maxIterations = 60;
    settings.randomRestarts = 2;
    settings.maxGlobalLoops = 12;
    settings.seedOrderSamples = 3;
    settings.perPieceFactor = 2.0;
    settings.temperatureStart = 1.0;
    settings.temperatureCool = 0.87;
  } else if (pieceCount > 25) {
    settings.maxIterations = 80;
    settings.randomRestarts = 2;
    settings.maxGlobalLoops = 15;
    settings.perPieceFactor = 2.5;
  } else if (pieceCount > 20) {
    settings.maxIterations = 100;
    settings.randomRestarts = 3;
    settings.perPieceFactor = 3.0;
  }
  
  return settings;
}

function solveWithMetaHeuristics(instances, pieces, options) {
  if (shouldStop) return null;
  
  const metaSettings = getAdaptiveMetaSettings(pieces.length);
  const seedOrders = generateSeedOrders(pieces, metaSettings.seedOrderSamples);
  
  let globalBest = null;
  let globalBestOrder = null;
  let totalIterations = 0;
  let totalAccepted = 0;
  let lowestBaseScore = Infinity;

  // Progreso para el worker
  const totalWork = metaSettings.randomRestarts * metaSettings.maxGlobalLoops;
  let completedWork = 0;

  for (let restart = 0; restart < metaSettings.randomRestarts && !shouldStop; restart++) {
    const seedOrder = seedOrders[restart % seedOrders.length];
    let currentOrder = [...seedOrder];
    let currentSolution = runGreedyGuillotine(instances, currentOrder, options);
    
    if (!currentSolution || shouldStop) continue;

    let temperature = metaSettings.temperatureStart;
    
    for (let loop = 0; loop < metaSettings.maxGlobalLoops && !shouldStop; loop++) {
      completedWork++;
      
      // Enviar progreso ocasionalmente
      if (completedWork % 5 === 0) {
        self.postMessage({
          type: 'progress',
          progress: completedWork / totalWork
        });
      }
      
      for (let iter = 0; iter < metaSettings.maxIterations && !shouldStop; iter++) {
        totalIterations++;
        
        const perturbedOrder = perturbOrder(currentOrder, metaSettings.minPerturbation, metaSettings.maxPerturbation);
        const newSolution = runGreedyGuillotine(instances, perturbedOrder, options);
        
        if (!newSolution || shouldStop) continue;

        const improvement = currentSolution.score - newSolution.score;
        const acceptProbability = improvement > 0 ? 1 : Math.exp(improvement / temperature);
        
        if (Math.random() < acceptProbability) {
          currentOrder = perturbedOrder;
          currentSolution = newSolution;
          totalAccepted++;
          
          if (currentSolution.score < lowestBaseScore) {
            lowestBaseScore = currentSolution.score;
          }
        }
      }
      
      temperature *= metaSettings.temperatureCool;
      if (temperature < metaSettings.temperatureMin) break;
    }
    
    if (!globalBest || (currentSolution && currentSolution.score < globalBest.score)) {
      globalBest = { ...currentSolution };
      globalBestOrder = [...currentOrder];
    }
  }

  if (!globalBest || shouldStop) {
    return runGreedyGuillotine(instances, pieces, options);
  }

  return {
    ...globalBest,
    bestOrder: globalBestOrder,
    iterationsUsed: totalIterations,
    acceptedMoves: totalAccepted,
    baseScore: lowestBaseScore
  };
}

function solveCutLayoutWorker(inputs) {
  shouldStop = false;
  
  let { instances, pieces, totalRequested, allowAutoRotate, kerf } = inputs;
  
  // Progreso inicial
  sendProgress(0.15);
  
  const clonePieces = (src) => src.map(piece => ({ ...piece }));
  const computeLeftoverArea = (leftovers) => leftovers.reduce((acc, p) => acc + (p.rawW * p.rawH), 0);
  
  const runSolverWithFallback = (instSubset, pieceSource) => {
    let workingPieces = clonePieces(pieceSource);
    
    // Progreso en el solver principal
    sendProgress(0.3);
    
    let sol = solveWithMetaHeuristics(instSubset, workingPieces, { allowAutoRotate, kerf });
    
    if (shouldStop) return null;
    
    // Progreso después del primer intento
    sendProgress(0.6);
    
    if (allowAutoRotate && sol && sol.leftovers.length) {
      const leftoverIds = new Set(sol.leftovers.map(p => p.id));
      if (leftoverIds.size) {
        const flippedPieces = workingPieces.map(piece => {
          if (!leftoverIds.has(piece.id)) return { ...piece };
          return {
            ...piece,
            rawW: piece.rawH,
            rawH: piece.rawW
          };
        });
        
        // Progreso en el intento con rotación
        sendProgress(0.8);
        
        const solFlipped = solveWithMetaHeuristics(instSubset, flippedPieces, { allowAutoRotate, kerf });
        if (solFlipped && solFlipped.score < sol.score) {
          sol = solFlipped;
        }
      }
    }
    
    return sol;
  };

  // Resolver con todas las instancias
  const solution = runSolverWithFallback(instances, pieces);
  
  if (shouldStop || !solution) {
    return null;
  }

  // Calcular resultados finales
  const instanceMeta = instances.map(inst => ({
    plateRow: inst.plateRow || null,
    material: inst.material || ''
  }));

  // Progreso final antes de devolver resultados
  sendProgress(0.95);

  return {
    instances,
    instanceMeta,
    placements: solution.placements || [],
    placementsByPlate: solution.placementsByPlate || [],
    leftovers: solution.leftovers || [],
    usedArea: solution.usedArea || 0,
    wasteArea: solution.wasteArea || 0,
    totalArea: solution.totalArea || 0,
    totalRequested,
    bestOrder: solution.bestOrder || [],
    iterationsUsed: solution.iterationsUsed || 0,
    acceptedMoves: solution.acceptedMoves || 0,
    baseScore: solution.baseScore || 0
  };
}

// Manejador de mensajes del worker
self.onmessage = function(e) {
  const { id, type, data } = e.data;
  
  console.log('🔧 Worker recibió:', { id, type, dataKeys: Object.keys(data || {}) });
  
  try {
    if (type === 'solve') {
      console.log('🚀 Worker iniciando solve...');
      
      // Enviar progreso inicial
      console.log('📤 Worker enviando progreso inicial');
      self.postMessage({ id, type: 'progress', progress: 0.1 });
      
      console.log('🔄 Worker ejecutando algoritmo...');
      const result = solveCutLayoutWorker(data);
      
      console.log('✅ Worker algoritmo completado');
      
      // Enviar progreso final antes del resultado
      console.log('📤 Worker enviando progreso final');
      self.postMessage({ id, type: 'progress', progress: 1.0 });
      
      console.log('📤 Worker enviando resultado');
      self.postMessage({ 
        id, 
        type: 'result',
        success: true, 
        result 
      });
      
      console.log('✅ Worker terminó exitosamente');
    } else if (type === 'cancel') {
      console.log('🛑 Worker cancelando...');
      shouldStop = true;
      self.postMessage({ 
        id, 
        type: 'cancelled',
        success: false 
      });
    }
  } catch (error) {
    console.error('❌ Worker error:', error);
    self.postMessage({ 
      id, 
      type: 'error',
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
};

// Función para enviar progreso desde dentro del algoritmo
function sendProgress(progress) {
  self.postMessage({ type: 'progress', progress });
}
