// Web Worker para el solver de optimización de placas
// Este worker ejecuta los algoritmos de optimización sin bloquear la UI

let shouldStop = false;

// Configuración del algoritmo
const PACKING_EPSILON = 0.0001;
// Funciones auxiliares del algoritmo

function computeTrimOffsets(instance) {
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

function createPlateState(instance, kerf) {
  const offsets = computeTrimOffsets(instance);
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

function getOrientationChoices(piece, allowAutoRotate) {
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

function hasUnplacedPieces(pool) {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].placed) return true;
  }
  return false;
}

// Encuentra el mejor ancho de tira basándose en las piezas disponibles
function findOptimalStripWidth(state, pool, allowAutoRotate, remainingWidth) {
  if (remainingWidth <= PACKING_EPSILON) return null;
  
  // Agrupar piezas por ancho disponible
  const widthGroups = new Map();
  
  for (let idx = 0; idx < pool.length && !shouldStop; idx++) {
    const entry = pool[idx];
    if (entry.placed) continue;
    
    const orientations = getOrientationChoices(entry, allowAutoRotate);
    for (const orientation of orientations) {
      if (orientation.width > remainingWidth + PACKING_EPSILON) continue;
      if (orientation.height > state.usableH + PACKING_EPSILON) continue;
      
      const w = orientation.width;
      if (!widthGroups.has(w)) {
        widthGroups.set(w, {
          width: w,
          pieces: [],
          totalHeight: 0,
          totalArea: 0,
          smallerPieces: [] // Piezas más angostas que pueden caber
        });
      }
      
      const group = widthGroups.get(w);
      group.pieces.push({
        index: idx,
        entry,
        orientation,
        height: orientation.height,
        area: orientation.width * orientation.height
      });
      group.totalHeight += orientation.height;
      group.totalArea += orientation.width * orientation.height;
    }
  }
  
  // Para cada grupo, buscar piezas más pequeñas que puedan caber
  for (const [width, group] of widthGroups) {
    for (let idx = 0; idx < pool.length && !shouldStop; idx++) {
      const entry = pool[idx];
      if (entry.placed) continue;
      
      const orientations = getOrientationChoices(entry, allowAutoRotate);
      for (const orientation of orientations) {
        // Buscar piezas más angostas que el ancho del grupo
        if (orientation.width < width - PACKING_EPSILON && 
            orientation.width <= width &&
            orientation.height <= state.usableH + PACKING_EPSILON) {
          group.smallerPieces.push({
            index: idx,
            entry,
            orientation,
            height: orientation.height,
            area: orientation.width * orientation.height
          });
        }
      }
    }
  }
  
  // Encontrar el ancho óptimo (que maximice el área aprovechada)
  let bestGroup = null;
  let bestScore = -1;
  
  for (const [width, group] of widthGroups) {
    // Calcular área potencial incluyendo piezas más pequeñas
    const smallerPiecesArea = group.smallerPieces.reduce((sum, p) => sum + p.area, 0);
    const totalPotentialArea = group.totalArea + smallerPiecesArea * 0.7; // Factor de descuento
    
    // Score: priorizar área total, cantidad de piezas principales y piezas secundarias
    const score = totalPotentialArea * 1000 + 
                  group.pieces.length * 100 + 
                  group.smallerPieces.length * 10;
    
    if (score > bestScore) {
      bestScore = score;
      bestGroup = group;
    }
  }
  
  return bestGroup;
}

function pickStripStarter(state, pool, allowAutoRotate, remainingWidth) {
  if (remainingWidth <= PACKING_EPSILON) return null;
  let best = null;

  for (let idx = 0; idx < pool.length && !shouldStop; idx++) {
    const entry = pool[idx];
    if (entry.placed) continue;
    const orientations = getOrientationChoices(entry, allowAutoRotate);
    for (const orientation of orientations) {
      if (orientation.width > state.usableW + PACKING_EPSILON) continue;
      if (orientation.height > state.usableH + PACKING_EPSILON) continue;
      if (orientation.width > remainingWidth + PACKING_EPSILON) continue;
      
      // Estrategia simple: priorizar por ÁREA primero
      // Esto tiende a colocar piezas grandes primero
      const area = orientation.width * orientation.height;
      const gap = remainingWidth - orientation.width;
      
      // Penalizar ligeramente gaps muy grandes para no desperdiciar
      const gapPenalty = gap > 500 ? gap * 0.1 : 0;
      
      const score = area - gapPenalty;
      
      if (!best || score > best.score) {
        best = {
          index: idx,
          orientation,
          gap,
          score
        };
      }
    }
  }

  return best;
}

// Busca piezas que puedan caber en una tira, permitiendo anchos menores o iguales
function pickPieceForStrip(pool, targetWidth, allowAutoRotate, maxHeight) {
  if (maxHeight <= PACKING_EPSILON) return null;
  let best = null;

  for (let idx = 0; idx < pool.length && !shouldStop; idx++) {
    const entry = pool[idx];
    if (entry.placed) continue;
    const orientations = getOrientationChoices(entry, allowAutoRotate);
    for (const orientation of orientations) {
      // Permitir piezas con ancho igual o menor (más angostas)
      if (orientation.width > targetWidth + PACKING_EPSILON) continue;
      if (orientation.height > maxHeight + PACKING_EPSILON) continue;
      
      // Prioridad: 
      // 1. Piezas que ocupan el ancho completo
      // 2. Mayor altura
      // 3. Menor desperdicio de ancho
      const widthFit = Math.abs(orientation.width - targetWidth) <= PACKING_EPSILON;
      const widthWaste = targetWidth - orientation.width;
      
      if (!best) {
        best = {
          index: idx,
          entry,
          orientation,
          widthFit,
          widthWaste
        };
      } else {
        // Preferir piezas que ocupen el ancho completo
        if (widthFit && !best.widthFit) {
          best = {
            index: idx,
            entry,
            orientation,
            widthFit,
            widthWaste
          };
        } else if ((widthFit === best.widthFit)) {
          // Mismo tipo de ajuste de ancho, comparar por altura y desperdicio
          if (orientation.height > best.orientation.height + PACKING_EPSILON) {
            best = {
              index: idx,
              entry,
              orientation,
              widthFit,
              widthWaste
            };
          } else if (Math.abs(orientation.height - best.orientation.height) <= PACKING_EPSILON) {
            // Misma altura, preferir menor desperdicio de ancho
            if (widthWaste < best.widthWaste - PACKING_EPSILON) {
              best = {
                index: idx,
                entry,
                orientation,
                widthFit,
                widthWaste
              };
            }
          }
        }
      }
    }
  }

  return best;
}

// Estructura para representar una sub-tira (sección dentro de una tira principal)
function createSubStrip(x, y, width, height) {
  return {
    x,
    y,
    width,
    height,
    pieces: [],
    usedHeight: 0
  };
}

// Intenta empacar piezas más angostas en el espacio lateral disponible de una tira
function packNarrowPiecesInStrip(state, strip, pool, allowAutoRotate, kerf, plateIdx, placements, placementsByPlate, bestOrder, metrics) {
  // Crear sub-tiras para piezas más angostas
  const subStrips = [];
  let currentY = state.offY;
  const maxY = state.offY + state.usableH;
  
  // Mientras haya espacio vertical, intentar crear sub-tiras
  while (currentY < maxY - PACKING_EPSILON && !shouldStop) {
    let availableWidth = strip.width;
    let xCursor = strip.x;
    let rowMaxHeight = 0;
    let rowHasPieces = false;
    
    // Buscar piezas que quepan en el espacio disponible
    const candidates = [];
    for (let idx = 0; idx < pool.length && !shouldStop; idx++) {
      const entry = pool[idx];
      if (entry.placed) continue;
      
      const orientations = getOrientationChoices(entry, allowAutoRotate);
      for (const orientation of orientations) {
        if (orientation.width <= availableWidth + PACKING_EPSILON && 
            orientation.height <= maxY - currentY + PACKING_EPSILON) {
          candidates.push({
            index: idx,
            entry,
            orientation,
            area: orientation.width * orientation.height
          });
        }
      }
    }
    
    // Ordenar por área descendente para mejor aprovechamiento
    candidates.sort((a, b) => b.area - a.area);
    
    // Colocar piezas en la fila actual
    for (const candidate of candidates) {
      if (shouldStop) break;
      
      const pieceWidth = candidate.orientation.width;
      const pieceHeight = candidate.orientation.height;
      
      // Si cabe en el ancho disponible
      if (pieceWidth <= availableWidth + PACKING_EPSILON) {
        // Aplicar kerf si no es la primera pieza de la fila
        if (rowHasPieces) {
          xCursor += kerf;
          availableWidth -= kerf;
          if (availableWidth < pieceWidth - PACKING_EPSILON) break;
        }
        
        // Colocar la pieza
        const placement = {
          id: candidate.entry.id,
          piece: candidate.entry.source,
          plateIdx,
          x: xCursor,
          y: currentY,
          w: pieceWidth,
          h: pieceHeight,
          usedW: pieceWidth,
          usedH: pieceHeight,
          rawW: pieceWidth,
          rawH: pieceHeight,
          rot: candidate.orientation.rotated ? !candidate.entry.rot : !!candidate.entry.rot,
          color: candidate.entry.color,
          rowIdx: candidate.entry.rowIdx
        };
        
        placements.push(placement);
        placementsByPlate[plateIdx].push(placement);
        bestOrder.push(candidate.entry.id);
        candidate.entry.placed = true;
        candidate.entry.finalRotated = candidate.orientation.rotated;
        metrics.usedArea += pieceWidth * pieceHeight;
        
        xCursor += pieceWidth;
        availableWidth -= pieceWidth;
        rowMaxHeight = Math.max(rowMaxHeight, pieceHeight);
        rowHasPieces = true;
      }
    }
    
    if (!rowHasPieces) break;
    currentY += rowMaxHeight + kerf;
  }
}

// Llenar una tira usando un enfoque de "filas horizontales" (shelf packing)
// Permite empacar piezas de diferentes anchos de forma más eficiente
function fillStripWithShelfPacking(state, strip, pool, allowAutoRotate, kerf, plateIdx, placements, placementsByPlate, bestOrder, metrics) {
  let yCursor = strip.nextY;
  const maxY = state.offY + state.usableH;
  
  // Crear "estantes" horizontales dentro de la tira vertical
  while (!shouldStop && yCursor < maxY - PACKING_EPSILON) {
    const remainingHeight = maxY - yCursor;
    if (remainingHeight <= PACKING_EPSILON) break;
    
    // Crear un nuevo estante/fila horizontal
    let shelfHeight = 0;
    let xCursor = strip.x;
    const shelfMaxX = strip.x + strip.width;
    let shelfHasPieces = false;
    
    // Llenar el estante horizontalmente con piezas
    while (!shouldStop) {
      const remainingWidth = shelfMaxX - xCursor;
      if (remainingWidth <= PACKING_EPSILON) break;
      
      // Buscar la mejor pieza que quepa en este estante
      let bestPiece = null;
      let bestScore = -1;
      
      for (let idx = 0; idx < pool.length && !shouldStop; idx++) {
        const entry = pool[idx];
        if (entry.placed) continue;
        
        const orientations = getOrientationChoices(entry, allowAutoRotate);
        for (const orientation of orientations) {
          // La pieza debe caber en el ancho restante del estante
          const widthNeeded = orientation.width + (shelfHasPieces ? kerf : 0);
          if (widthNeeded > remainingWidth + PACKING_EPSILON) continue;
          
          // La pieza debe caber en la altura restante de la tira
          const heightNeeded = orientation.height + (yCursor > strip.nextY ? kerf : 0);
          if (heightNeeded > remainingHeight + PACKING_EPSILON) continue;
          
          // Score basado en:
          // 1. Si la altura coincide con el estante actual (MÁXIMA PRIORIDAD)
          // 2. Área de la pieza (mayor = mejor)
          // 3. Utilización del ancho disponible
          const area = orientation.width * orientation.height;
          const widthUtil = orientation.width / Math.max(remainingWidth, 1);
          const heightMatch = shelfHeight > 0 && Math.abs(orientation.height - shelfHeight) <= PACKING_EPSILON;
          
          // NUEVO: Penalizar fuertemente piezas que desperdician altura del shelf
          const heightWaste = shelfHeight > 0 ? Math.max(0, shelfHeight - orientation.height) : 0;
          const heightWastePenalty = heightWaste * 1000;
          
          const score = (heightMatch ? 1000000 : 0) + area * 1000 + widthUtil * 500 - heightWastePenalty;
          
          if (score > bestScore) {
            bestScore = score;
            bestPiece = {
              index: idx,
              entry,
              orientation
            };
          }
        }
      }
      
      if (!bestPiece) break;
      
      // Aplicar kerf horizontal si no es la primera pieza del estante
      if (shelfHasPieces) {
        xCursor += kerf;
        if (xCursor >= shelfMaxX - PACKING_EPSILON) break;
      }
      
      // Actualizar altura del estante (la pieza más alta determina la altura)
      shelfHeight = Math.max(shelfHeight, bestPiece.orientation.height);
      
      // Colocar la pieza
      const placement = {
        id: bestPiece.entry.id,
        piece: bestPiece.entry.source,
        plateIdx,
        x: xCursor,
        y: yCursor,
        w: bestPiece.orientation.width,
        h: bestPiece.orientation.height,
        usedW: bestPiece.orientation.width,
        usedH: bestPiece.orientation.height,
        rawW: bestPiece.orientation.width,
        rawH: bestPiece.orientation.height,
        rot: bestPiece.orientation.rotated ? !bestPiece.entry.rot : !!bestPiece.entry.rot,
        color: bestPiece.entry.color,
        rowIdx: bestPiece.entry.rowIdx
      };
      
      placements.push(placement);
      placementsByPlate[plateIdx].push(placement);
      bestOrder.push(bestPiece.entry.id);
      bestPiece.entry.placed = true;
      bestPiece.entry.finalRotated = bestPiece.orientation.rotated;
      metrics.usedArea += bestPiece.orientation.width * bestPiece.orientation.height;
      
      xCursor += bestPiece.orientation.width;
      shelfHasPieces = true;
    }
    
    if (!shelfHasPieces) break;
    
    // Mover al siguiente estante
    if (yCursor > strip.nextY) {
      yCursor += kerf;
    }
    yCursor += shelfHeight;
  }
  
  strip.nextY = yCursor;
}

function fillStripWithPieces(state, strip, pool, allowAutoRotate, kerf, plateIdx, placements, placementsByPlate, bestOrder, metrics) {
  // Usar el nuevo algoritmo de shelf packing
  fillStripWithShelfPacking(state, strip, pool, allowAutoRotate, kerf, plateIdx, placements, placementsByPlate, bestOrder, metrics);
}

// Estrategias de ordenamiento para probar diferentes configuraciones
function getSortingStrategies() {
  return [
    {
      name: 'area-desc',
      sort: (pool) => pool.sort((a, b) => {
        const areaDiff = b.area - a.area;
        if (Math.abs(areaDiff) > PACKING_EPSILON) return areaDiff;
        const maxDimA = Math.max(a.rawW, a.rawH);
        const maxDimB = Math.max(b.rawW, b.rawH);
        return maxDimB - maxDimA;
      })
    },
    {
      name: 'width-desc',
      sort: (pool) => pool.sort((a, b) => {
        const maxWidthA = Math.max(a.rawW, a.rawH);
        const maxWidthB = Math.max(b.rawW, b.rawH);
        if (Math.abs(maxWidthB - maxWidthA) > PACKING_EPSILON) {
          return maxWidthB - maxWidthA;
        }
        return b.area - a.area;
      })
    },
    {
      name: 'height-desc',
      sort: (pool) => pool.sort((a, b) => {
        const maxHeightA = Math.max(a.rawW, a.rawH);
        const maxHeightB = Math.max(b.rawW, b.rawH);
        if (Math.abs(maxHeightB - maxHeightA) > PACKING_EPSILON) {
          return maxHeightB - maxHeightA;
        }
        return b.area - a.area;
      })
    },
    {
      name: 'perimeter-desc',
      sort: (pool) => pool.sort((a, b) => {
        const perimA = 2 * (a.rawW + a.rawH);
        const perimB = 2 * (b.rawW + b.rawH);
        if (Math.abs(perimB - perimA) > PACKING_EPSILON) {
          return perimB - perimA;
        }
        return b.area - a.area;
      })
    },
    {
      name: 'aspect-ratio',
      sort: (pool) => pool.sort((a, b) => {
        const ratioA = Math.max(a.rawW, a.rawH) / Math.min(a.rawW, a.rawH);
        const ratioB = Math.max(b.rawW, b.rawH) / Math.min(b.rawW, b.rawH);
        if (Math.abs(ratioB - ratioA) > PACKING_EPSILON) {
          return ratioB - ratioA;
        }
        return b.area - a.area;
      })
    }
  ];
}

function solveWithGuillotine(instances, pieces, options = {}) {
  if (!Array.isArray(instances) || !instances.length) return null;

  const allowAutoRotate = !!options.allowAutoRotate;
  const kerf = Number.isFinite(options.kerf) ? options.kerf : 0;
  const states = instances.map(inst => createPlateState(inst, kerf));

  // Probar múltiples estrategias y elegir la mejor
  const strategies = getSortingStrategies();
  let bestSolution = null;
  let bestScore = Infinity;

  for (const strategy of strategies) {
    if (shouldStop) break;

    // Crear una copia del pool para esta estrategia
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

    // Aplicar la estrategia de ordenamiento
    strategy.sort(pool);

    const placements = [];
    const placementsByPlate = states.map(() => []);
    const bestOrder = [];
    const metrics = { usedArea: 0 };

    // Ejecutar el algoritmo de empaquetado
    executePackingAlgorithm(states, pool, allowAutoRotate, kerf, placements, placementsByPlate, bestOrder, metrics);

    // Calcular score de esta solución
    const leftovers = pool.filter(entry => !entry.placed);
    const totalArea = instances.reduce((acc, inst) => acc + (inst.sw * inst.sh), 0);
    const usedArea = metrics.usedArea;
    const wasteArea = Math.max(0, totalArea - usedArea);
    const penalty = leftovers.length > 0 ? totalArea * leftovers.length * 100 : 0;
    const score = wasteArea + penalty;

    // Si esta solución es mejor, guardarla
    if (score < bestScore || !bestSolution) {
      bestScore = score;
      bestSolution = {
        placements,
        placementsByPlate,
        leftovers: leftovers.map(entry => ({
          id: entry.id,
          rowIdx: entry.rowIdx,
          rawW: entry.rawW,
          rawH: entry.rawH,
          color: entry.color,
          rot: entry.rot,
          area: entry.rawW * entry.rawH,
          dimKey: entry.dimKey
        })),
        usedArea,
        wasteArea,
        totalArea,
        bestOrder,
        score,
        iterationsUsed: 0,
        acceptedMoves: 0,
        baseScore: wasteArea,
        strategyUsed: strategy.name
      };
    }

    // Si encontramos una solución perfecta (todas las piezas colocadas), no seguir buscando
    if (leftovers.length === 0) {
      break;
    }
  }

  return bestSolution;
}

// Función que ejecuta el algoritmo de empaquetado
// ESTRATEGIA: Tiras verticales con shelf packing interno
function executePackingAlgorithm(states, pool, allowAutoRotate, kerf, placements, placementsByPlate, bestOrder, metrics) {
  for (let plateIdx = 0; plateIdx < states.length && !shouldStop; plateIdx++) {
    if (!hasUnplacedPieces(pool)) break;
    const state = states[plateIdx];
    if (state.usableW <= PACKING_EPSILON || state.usableH <= PACKING_EPSILON) continue;

    let xCursor = state.offX;
    let stripCount = 0;

    // FASE 1: Crear tiras verticales (cortes de guillotina verticales)
    while (!shouldStop && hasUnplacedPieces(pool)) {
      let remainingWidth = state.offX + state.usableW - xCursor;
      
      // Aplicar kerf entre tiras
      if (stripCount > 0) {
        remainingWidth -= kerf;
        if (remainingWidth <= PACKING_EPSILON) break;
      }

      // Buscar la mejor pieza para iniciar una nueva tira
      const starter = pickStripStarter(state, pool, allowAutoRotate, remainingWidth);
      if (!starter) break;
      
      // Aplicar kerf si no es la primera tira
      if (stripCount > 0) {
        xCursor += kerf;
      }

      if (xCursor + starter.orientation.width > state.offX + state.usableW + PACKING_EPSILON) {
        if (stripCount > 0) {
          xCursor -= kerf;
        }
        break;
      }

      // Crear la tira
      const strip = {
        width: starter.orientation.width,
        x: xCursor,
        nextY: state.offY
      };

      // Colocar la primera pieza de la tira
      const entry = pool[starter.index];
      const firstY = strip.nextY;
      const placement = {
        id: entry.id,
        piece: entry.source,
        plateIdx,
        x: strip.x,
        y: firstY,
        w: starter.orientation.width,
        h: starter.orientation.height,
        usedW: starter.orientation.width,
        usedH: starter.orientation.height,
        rawW: starter.orientation.width,
        rawH: starter.orientation.height,
        rot: starter.orientation.rotated ? !entry.rot : !!entry.rot,
        color: entry.color,
        rowIdx: entry.rowIdx
      };

      placements.push(placement);
      placementsByPlate[plateIdx].push(placement);
      bestOrder.push(entry.id);
      entry.placed = true;
      entry.finalRotated = starter.orientation.rotated;
      metrics.usedArea += starter.orientation.width * starter.orientation.height;
      
      strip.nextY = firstY + starter.orientation.height;

      // FASE 2: Llenar la tira con shelf packing
      fillStripWithPieces(state, strip, pool, allowAutoRotate, kerf, plateIdx, placements, placementsByPlate, bestOrder, metrics);

      xCursor += strip.width;
      stripCount += 1;
    }
  }
}

function solveCutLayoutWorker(inputs) {
  shouldStop = false;
  
  let { instances, pieces, totalRequested, allowAutoRotate, kerf } = inputs;
  
  // Progreso inicial
  sendProgress(0.15);
  
  const clonePieces = (src) => src.map(piece => ({ ...piece }));
  
  const runSolverWithFallback = (instSubset, pieceSource) => {
    let workingPieces = clonePieces(pieceSource);
    const options = {
      allowAutoRotate,
      kerf: Number.isFinite(kerf) ? kerf : 0
    };

    sendProgress(0.3);
    let sol = solveWithGuillotine(instSubset, workingPieces, options) || null;

    if (shouldStop) return null;

    sendProgress(0.6);

    sendProgress(0.8);
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
