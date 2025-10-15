/**
 * Test del optimizador avanzado con layout-test-1.json
 */

import { optimizeCutLayout, generateReport } from './advanced-optimizer.js';
import fs from 'fs';

// Cargar test case
const testData = JSON.parse(fs.readFileSync('./test-cases/layout-test-1.json', 'utf-8'));

console.log('='.repeat(60));
console.log('TEST OPTIMIZADOR AVANZADO');
console.log('='.repeat(60));
console.log();

// Extraer piezas del test case
const pieces = [];
testData.pieces.forEach((pieceSpec, idx) => {
  const qty = pieceSpec.quantity || 1;
  for (let i = 0; i < qty; i++) {
    pieces.push({
      id: `piece-${idx}-${i}`,
      width: pieceSpec.width,
      height: pieceSpec.height,
      label: pieceSpec.label || `${pieceSpec.width}×${pieceSpec.height}`,
      rowIndex: idx
    });
  }
});

console.log(`📦 Piezas a optimizar: ${pieces.length}`);
pieces.forEach(p => {
  console.log(`   - ${p.label} (${p.width} × ${p.height} mm)`);
});
console.log();

// Especificaciones de la placa
const plateSpec = {
  width: testData.plateConfig.width,
  height: testData.plateConfig.height
};

console.log(`📋 Placa: ${plateSpec.width} × ${plateSpec.height} mm`);
console.log();

// Opciones de optimización
const options = {
  algorithm: 'simulated-annealing',
  iterations: 500,
  kerf: testData.plateConfig.kerf,
  trimLeft: testData.plateConfig.trimLeft,
  trimTop: testData.plateConfig.trimTop,
  allowRotation: true
};

console.log('⚙️  Opciones:');
console.log(`   - Algoritmo: ${options.algorithm}`);
console.log(`   - Iteraciones: ${options.iterations}`);
console.log(`   - Kerf: ${options.kerf} mm`);
console.log(`   - Trim: ${options.trimLeft} mm (L), ${options.trimTop} mm (T)`);
console.log(`   - Rotación: ${options.allowRotation ? 'Sí' : 'No'}`);
console.log();

// Ejecutar optimización
console.log('🚀 Ejecutando optimización...');
console.time('Tiempo de optimización');

const result = optimizeCutLayout(pieces, plateSpec, options);
const report = generateReport(result);

console.timeEnd('Tiempo de optimización');
console.log();

// Mostrar resultados
console.log('='.repeat(60));
console.log('RESULTADOS');
console.log('='.repeat(60));
console.log();

console.log('📊 RESUMEN:');
console.log(`   - Placas necesarias: ${report.summary.plateCount}`);
console.log(`   - Piezas colocadas: ${report.summary.totalPieces} / ${pieces.length}`);
console.log(`   - Piezas sin colocar: ${report.summary.remainingPieces}`);
console.log(`   - Área total: ${report.summary.totalArea.toFixed(0)} mm²`);
console.log(`   - Área usada: ${report.summary.usedArea.toFixed(0)} mm²`);
console.log(`   - Área desperdiciada: ${report.summary.wasteArea.toFixed(0)} mm²`);
console.log(`   - Utilización: ${report.summary.utilization}`);
console.log();

// Detalles de cada placa
report.plates.forEach((plate, idx) => {
  console.log(`\n📐 PLACA ${plate.plateNumber}:`);
  console.log(`   - Dimensiones: ${plate.dimensions}`);
  console.log(`   - Piezas: ${plate.pieces}`);
  console.log(`   - Área usada: ${plate.usedArea} mm²`);
  console.log(`   - Utilización: ${plate.utilization}`);
  
  console.log('\n   🔪 Secuencia de cortes:');
  console.log(`      - Cortes verticales: ${plate.cutSequence.vertical.length}`);
  console.log(`      - Cortes horizontales: ${plate.cutSequence.horizontal.length}`);
  console.log(`      - Total de cortes: ${plate.cutSequence.sequence.length}`);
  
  console.log('\n   📦 Piezas colocadas:');
  plate.placedPieces.forEach((p, pidx) => {
    const piece = p.piece;
    console.log(`      ${pidx + 1}. ${piece.label} en (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) - ${p.width.toFixed(0)}×${p.height.toFixed(0)} mm${piece.rotated ? ' [ROTADA]' : ''}`);
  });
});

// Piezas sin colocar
if (report.remaining.length > 0) {
  console.log('\n❌ PIEZAS SIN COLOCAR:');
  report.remaining.forEach((p, idx) => {
    console.log(`   ${idx + 1}. ${p.dimensions} (${p.area} mm²)`);
  });
}

console.log();
console.log('='.repeat(60));

// Verificar si pasó el test
const testPassed = report.summary.plateCount === 1 && 
                   report.summary.remainingPieces === 0 &&
                   parseFloat(report.summary.utilization) > 90;

if (testPassed) {
  console.log('✅ TEST PASADO');
  console.log('   - Todas las piezas caben en 1 placa');
  console.log('   - Utilización > 90%');
} else {
  console.log('❌ TEST FALLIDO');
  if (report.summary.plateCount > 1) {
    console.log(`   - Esperado: 1 placa, Obtenido: ${report.summary.plateCount}`);
  }
  if (report.summary.remainingPieces > 0) {
    console.log(`   - Piezas sin colocar: ${report.summary.remainingPieces}`);
  }
  if (parseFloat(report.summary.utilization) <= 90) {
    console.log(`   - Utilización: ${report.summary.utilization} (esperado >90%)`);
  }
}

console.log('='.repeat(60));
