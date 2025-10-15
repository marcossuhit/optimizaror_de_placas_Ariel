/**
 * OPTIMIZADOR AVANZADO DE CORTES GUILLOTINA
 * ==========================================
 * 
 * Implementa:
 * 1. Two-Stage Guillotine Cutting (Strip Packing)
 * 2. Shelf Packing dentro de cada strip
 * 3. First-Fit Decreasing (FFD) y Best-Fit Decreasing (BFD)
 * 4. Simulated Annealing para optimización
 * 
 * Objetivo: Minimizar desperdicio y generar secuencia de cortes válida
 */

const EPSILON = 0.0001;

/**
 * Strip (tira vertical) en el empaquetado
 */
class Strip {
  constructor(x, y, width, maxHeight, kerf) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.maxHeight = maxHeight;
    this.kerf = kerf;
    this.shelves = []; // Filas horizontales dentro del strip
    this.currentHeight = 0;
    this.pieces = [];
  }

  /**
   * Intenta agregar una pieza al strip usando shelf packing
   */
  addPiece(piece) {
    // Verificar si la pieza cabe en ancho
    if (piece.width > this.width + EPSILON) {
      return false;
    }

    // Buscar un shelf existente donde quepa
    for (const shelf of this.shelves) {
      if (shelf.addPiece(piece)) {
        this.pieces.push({
          piece,
          x: this.x + shelf.currentWidth - piece.width,
          y: shelf.y,
          width: piece.width,
          height: piece.height
        });
        return true;
      }
    }

    // Si no cabe en ningún shelf, crear uno nuevo
    const shelfY = this.y + this.currentHeight;
    const remainingHeight = this.maxHeight - this.currentHeight;

    if (piece.height > remainingHeight + EPSILON) {
      return false; // No hay altura suficiente
    }

    const newShelf = new Shelf(
      this.x,
      shelfY,
      this.width,
      piece.height,
      this.kerf
    );

    if (newShelf.addPiece(piece)) {
      this.shelves.push(newShelf);
      this.currentHeight += piece.height + (this.shelves.length > 1 ? this.kerf : 0);
      
      this.pieces.push({
        piece,
        x: this.x,
        y: shelfY,
        width: piece.width,
        height: piece.height
      });
      
      return true;
    }

    return false;
  }

  get usedArea() {
    return this.pieces.reduce((sum, p) => sum + p.width * p.height, 0);
  }

  get utilization() {
    const totalArea = this.width * this.maxHeight;
    return totalArea > 0 ? (this.usedArea / totalArea) * 100 : 0;
  }
}

/**
 * Shelf (fila horizontal) dentro de un strip
 */
class Shelf {
  constructor(x, y, maxWidth, height, kerf) {
    this.x = x;
    this.y = y;
    this.maxWidth = maxWidth;
    this.height = height;
    this.kerf = kerf;
    this.currentWidth = 0;
    this.pieces = [];
  }

  addPiece(piece) {
    // Verificar si la pieza cabe en alto
    if (piece.height > this.height + EPSILON) {
      return false;
    }

    // Verificar si hay ancho suficiente
    const requiredWidth = this.currentWidth + piece.width + 
                         (this.pieces.length > 0 ? this.kerf : 0);
    
    if (requiredWidth > this.maxWidth + EPSILON) {
      return false;
    }

    this.pieces.push(piece);
    this.currentWidth = requiredWidth;
    return true;
  }
}

/**
 * Solución de empaquetado para una placa usando Strip + Shelf Packing
 */
class PlateSolution {
  constructor(plateWidth, plateHeight, trimLeft = 0, trimTop = 0, kerf = 0) {
    this.plateWidth = plateWidth;
    this.plateHeight = plateHeight;
    this.trimLeft = trimLeft;
    this.trimTop = trimTop;
    this.kerf = kerf;
    
    this.usableWidth = plateWidth - trimLeft;
    this.usableHeight = plateHeight - trimTop;
    
    this.strips = [];
    this.currentX = trimLeft;
    this.placedPieces = [];
  }

  /**
   * Intenta colocar una pieza en la placa
   */
  place(piece) {
    // Intentar en strips existentes
    for (const strip of this.strips) {
      if (strip.addPiece(piece)) {
        this.placedPieces.push({ piece, strip });
        return true;
      }
    }

    // Crear un nuevo strip
    const remainingWidth = this.usableWidth - (this.currentX - this.trimLeft);
    
    if (piece.width > remainingWidth + EPSILON) {
      return false; // No hay ancho suficiente para un nuevo strip
    }

    const newStrip = new Strip(
      this.currentX,
      this.trimTop,
      piece.width,
      this.usableHeight,
      this.kerf
    );

    if (newStrip.addPiece(piece)) {
      this.strips.push(newStrip);
      this.currentX += piece.width + (this.strips.length > 1 ? this.kerf : 0);
      this.placedPieces.push({ piece, strip: newStrip });
      return true;
    }

    return false;
  }

  /**
   * Calcula el área utilizada
   */
  get usedArea() {
    return this.strips.reduce((sum, strip) => sum + strip.usedArea, 0);
  }

  /**
   * Calcula el área total de la placa
   */
  get totalArea() {
    return this.plateWidth * this.plateHeight;
  }

  /**
   * Calcula el porcentaje de utilización
   */
  get utilization() {
    return (this.usedArea / this.totalArea) * 100;
  }

  /**
   * Obtiene la secuencia de cortes guillotina
   */
  getCutSequence() {
    const verticalCuts = [];
    const horizontalCuts = [];

    // Cortes verticales entre strips
    let currentX = this.trimLeft;
    for (let i = 0; i < this.strips.length; i++) {
      const strip = this.strips[i];
      
      if (i > 0) {
        verticalCuts.push({
          type: 'vertical-cut',
          position: currentX,
          x: currentX,
          y: this.trimTop,
          width: 0,
          height: this.usableHeight
        });
      }

      // Cortes horizontales dentro del strip (entre shelves)
      let currentY = this.trimTop;
      for (let j = 0; j < strip.shelves.length; j++) {
        const shelf = strip.shelves[j];
        
        if (j > 0) {
          horizontalCuts.push({
            type: 'horizontal-cut',
            position: currentY,
            x: strip.x,
            y: currentY,
            width: strip.width,
            height: 0
          });
        }

        currentY += shelf.height + (j < strip.shelves.length - 1 ? this.kerf : 0);
      }

      currentX += strip.width + (i < this.strips.length - 1 ? this.kerf : 0);
    }

    return {
      vertical: verticalCuts,
      horizontal: horizontalCuts,
      sequence: [...verticalCuts, ...horizontalCuts]
    };
  }

  /**
   * Obtiene las piezas colocadas con coordenadas
   */
  getPlacedPiecesWithCoords() {
    const result = [];
    for (const strip of this.strips) {
      result.push(...strip.pieces);
    }
    return result;
  }
}

/**
 * Ordena piezas por diferentes criterios
 */
function sortPieces(pieces, strategy = 'area-desc') {
  const sorted = [...pieces];
  
  switch (strategy) {
    case 'area-desc':
      sorted.sort((a, b) => (b.width * b.height) - (a.width * a.height));
      break;
    case 'width-desc':
      sorted.sort((a, b) => b.width - a.width || b.height - a.height);
      break;
    case 'height-desc':
      sorted.sort((a, b) => b.height - a.height || b.width - a.width);
      break;
    case 'perimeter-desc':
      sorted.sort((a, b) => (2*b.width + 2*b.height) - (2*a.width + 2*a.height));
      break;
    default:
      // area-desc por defecto
      sorted.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  }
  
  return sorted;
}

/**
 * First-Fit Decreasing: coloca cada pieza en la primera placa que quepa
 */
function firstFitDecreasing(pieces, plateSpec, options = {}) {
  const {
    kerf = 5,
    trimLeft = 13,
    trimTop = 13,
    allowRotation = true
  } = options;

  const sorted = sortPieces(pieces, 'area-desc');
  const plates = [];
  const remaining = [];

  for (const piece of sorted) {
    let placed = false;

    // Intentar con orientación original
    const orientations = [
      { ...piece, rotated: false }
    ];

    if (allowRotation && Math.abs(piece.width - piece.height) > EPSILON) {
      orientations.push({
        ...piece,
        width: piece.height,
        height: piece.width,
        rotated: true
      });
    }

    // Intentar colocar en placas existentes
    for (const plate of plates) {
      for (const orientation of orientations) {
        if (plate.place(orientation)) {
          placed = true;
          break;
        }
      }
      if (placed) break;
    }

    // Si no cabe en ninguna, crear nueva placa
    if (!placed) {
      const newPlate = new PlateSolution(
        plateSpec.width,
        plateSpec.height,
        trimLeft,
        trimTop,
        kerf
      );

      let placedInNew = false;
      for (const orientation of orientations) {
        if (newPlate.place(orientation)) {
          placedInNew = true;
          break;
        }
      }

      if (placedInNew) {
        plates.push(newPlate);
      } else {
        // No cabe ni en placa nueva -> pieza demasiado grande
        remaining.push(piece);
      }
    }
  }

  return { plates, remaining };
}

/**
 * Best-Fit Decreasing: coloca cada pieza en la placa con menos espacio sobrante
 */
function bestFitDecreasing(pieces, plateSpec, options = {}) {
  const {
    kerf = 5,
    trimLeft = 13,
    trimTop = 13,
    allowRotation = true
  } = options;

  const sorted = sortPieces(pieces, 'area-desc');
  const plates = [];
  const remaining = [];

  for (const piece of sorted) {
    let placed = false;
    let bestPlate = null;
    let bestOrientation = null;
    let bestWaste = Infinity;

    const orientations = [
      { ...piece, rotated: false }
    ];

    if (allowRotation && Math.abs(piece.width - piece.height) > EPSILON) {
      orientations.push({
        ...piece,
        width: piece.height,
        height: piece.width,
        rotated: true
      });
    }

    // Buscar la mejor placa existente
    for (const plate of plates) {
      for (const orientation of orientations) {
        // Simular colocación para calcular desperdicio
        const testPlate = new PlateSolution(
          plateSpec.width,
          plateSpec.height,
          trimLeft,
          trimTop,
          kerf
        );
        
        // Copiar piezas existentes
        for (const placed of plate.placedPieces) {
          testPlate.place(placed.piece);
        }

        if (testPlate.place(orientation)) {
          const waste = testPlate.totalArea - testPlate.usedArea;
          if (waste < bestWaste) {
            bestWaste = waste;
            bestPlate = plate;
            bestOrientation = orientation;
          }
        }
      }
    }

    // Si encontramos una placa adecuada, colocar
    if (bestPlate) {
      bestPlate.place(bestOrientation);
      placed = true;
    }

    // Si no, crear nueva placa
    if (!placed) {
      const newPlate = new PlateSolution(
        plateSpec.width,
        plateSpec.height,
        trimLeft,
        trimTop,
        kerf
      );

      let placedInNew = false;
      for (const orientation of orientations) {
        if (newPlate.place(orientation)) {
          placedInNew = true;
          break;
        }
      }

      if (placedInNew) {
        plates.push(newPlate);
      } else {
        remaining.push(piece);
      }
    }
  }

  return { plates, remaining };
}

/**
 * Evalúa la calidad de una solución
 */
function evaluateSolution(plates) {
  const totalArea = plates.reduce((sum, p) => sum + p.totalArea, 0);
  const usedArea = plates.reduce((sum, p) => sum + p.usedArea, 0);
  const wasteArea = totalArea - usedArea;
  const utilization = totalArea > 0 ? (usedArea / totalArea) * 100 : 0;

  return {
    plateCount: plates.length,
    totalArea,
    usedArea,
    wasteArea,
    utilization,
    score: usedArea - (plates.length * 10000) // Penalizar número de placas
  };
}

/**
 * Simulated Annealing para optimizar la solución
 */
function simulatedAnnealing(pieces, plateSpec, options = {}, iterations = 100) {
  const {
    kerf = 5,
    trimLeft = 13,
    trimTop = 13,
    allowRotation = true
  } = options;

  // Probar múltiples estrategias iniciales
  const strategies = ['area-desc', 'width-desc', 'height-desc', 'perimeter-desc'];
  let bestInitialSolution = null;
  let bestInitialEval = null;

  for (const strategy of strategies) {
    const sorted = sortPieces(pieces, strategy);
    const solution = firstFitDecreasing(sorted, plateSpec, options);
    const evaluation = evaluateSolution(solution.plates);

    if (!bestInitialSolution || evaluation.score > bestInitialEval.score) {
      bestInitialSolution = solution;
      bestInitialEval = evaluation;
    }
  }

  let currentSolution = bestInitialSolution;
  let currentEval = bestInitialEval;
  
  let bestSolution = currentSolution;
  let bestEval = currentEval;

  let temperature = 2000;
  const coolingRate = 0.92;

  for (let i = 0; i < iterations; i++) {
    // Generar vecino: aplicar varias operaciones aleatorias
    const shuffled = [...pieces];
    
    // Operación 1: Swaps aleatorios (mezclar orden)
    const swaps = Math.floor(Math.random() * 8) + 2;
    for (let j = 0; j < swaps; j++) {
      const idx1 = Math.floor(Math.random() * shuffled.length);
      const idx2 = Math.floor(Math.random() * shuffled.length);
      [shuffled[idx1], shuffled[idx2]] = [shuffled[idx2], shuffled[idx1]];
    }

    // Operación 2: Forzar rotación en algunas piezas (si está permitido)
    if (allowRotation) {
      const rotationCount = Math.floor(Math.random() * 4) + 1;
      for (let j = 0; j < rotationCount; j++) {
        const idx = Math.floor(Math.random() * shuffled.length);
        const temp = shuffled[idx].width;
        shuffled[idx] = {
          ...shuffled[idx],
          width: shuffled[idx].height,
          height: temp,
          rotated: !shuffled[idx].rotated
        };
      }
    }

    // Operación 3: Mover piezas grandes al principio a veces
    if (Math.random() < 0.3) {
      shuffled.sort((a, b) => {
        const areaA = a.width * a.height;
        const areaB = b.width * b.height;
        return areaB - areaA;
      });
    }

    // Generar nueva solución
    const newSolution = firstFitDecreasing(shuffled, plateSpec, options);
    const newEval = evaluateSolution(newSolution.plates);

    // Decidir si aceptar la nueva solución
    const delta = newEval.score - currentEval.score;
    
    const acceptProbability = delta > 0 ? 1 : Math.exp(delta / temperature);
    
    if (Math.random() < acceptProbability) {
      currentSolution = newSolution;
      currentEval = newEval;

      // Actualizar mejor solución si es mejor
      if (newEval.score > bestEval.score) {
        bestSolution = newSolution;
        bestEval = newEval;
        console.log(`   🔥 Mejora encontrada (iter ${i}): ${bestEval.plateCount} placas, ${bestEval.utilization.toFixed(2)}% util`);
      }
    }

    // Enfriar
    temperature *= coolingRate;
  }

  return {
    solution: bestSolution,
    evaluation: bestEval
  };
}

/**
 * Función principal de optimización
 */
export function optimizeCutLayout(pieces, plateSpec, options = {}) {
  const {
    algorithm = 'simulated-annealing', // 'ffd', 'bfd', 'simulated-annealing'
    iterations = 100,
    kerf = 5,
    trimLeft = 13,
    trimTop = 13,
    allowRotation = true
  } = options;

  console.log('🎯 Iniciando optimización avanzada...');
  console.log(`   Piezas: ${pieces.length}`);
  console.log(`   Placa: ${plateSpec.width} × ${plateSpec.height} mm`);
  console.log(`   Algoritmo: ${algorithm}`);

  let result;

  switch (algorithm) {
    case 'ffd':
      result = firstFitDecreasing(pieces, plateSpec, options);
      return {
        plates: result.plates,
        remaining: result.remaining,
        evaluation: evaluateSolution(result.plates)
      };

    case 'bfd':
      result = bestFitDecreasing(pieces, plateSpec, options);
      return {
        plates: result.plates,
        remaining: result.remaining,
        evaluation: evaluateSolution(result.plates)
      };

    case 'simulated-annealing':
      const saResult = simulatedAnnealing(pieces, plateSpec, options, iterations);
      return {
        plates: saResult.solution.plates,
        remaining: saResult.solution.remaining,
        evaluation: saResult.evaluation
      };

    default:
      throw new Error(`Algoritmo desconocido: ${algorithm}`);
  }
}

/**
 * Genera reporte detallado de la solución
 */
export function generateReport(optimizationResult) {
  const { plates, remaining, evaluation } = optimizationResult;

  const report = {
    summary: {
      plateCount: plates.length,
      totalPieces: plates.reduce((sum, p) => sum + p.placedPieces.length, 0),
      remainingPieces: remaining.length,
      totalArea: evaluation.totalArea,
      usedArea: evaluation.usedArea,
      wasteArea: evaluation.wasteArea,
      utilization: evaluation.utilization.toFixed(2) + '%'
    },
    plates: plates.map((plate, idx) => ({
      plateNumber: idx + 1,
      dimensions: `${plate.plateWidth} × ${plate.plateHeight} mm`,
      pieces: plate.placedPieces.length,
      usedArea: plate.usedArea.toFixed(2),
      utilization: plate.utilization.toFixed(2) + '%',
      cutSequence: plate.getCutSequence(),
      placedPieces: plate.getPlacedPiecesWithCoords()
    })),
    remaining: remaining.map(p => ({
      id: p.id,
      dimensions: `${p.width} × ${p.height} mm`,
      area: (p.width * p.height).toFixed(2)
    }))
  };

  return report;
}
