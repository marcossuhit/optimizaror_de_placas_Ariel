# 🎯 Nuevo Sistema de Optimización de Cortes Guillotina

## Cambios Implementados

### 1. **Deshabilitada la Optimización Automática**
- ❌ La aplicación **NO optimiza automáticamente** cuando se agregan piezas
- ✅ Ahora solo carga las piezas sin procesarlas
- ✅ Esto permite revisar y ajustar las piezas antes de generar el plano

### 2. **Nuevo Botón "GENERAR PLANO"**
- 🎯 Ubicado en la parte superior junto a los botones de Guardar/Cargar/Exportar
- 🎯 Destaca visualmente con ícono y formato especial
- 🎯 Solo se ejecuta cuando el usuario lo presiona explícitamente

### 3. **Algoritmo de Optimización Avanzado**

El nuevo optimizador implementa técnicas de investigación operativa de última generación:

#### **a) Two-Stage Guillotine Cutting**
- **Primera etapa:** Divide la placa en **tiras verticales** (strips)
- **Segunda etapa:** Dentro de cada tira, crea **filas horizontales** (shelves)
- **Ventaja:** Permite piezas de diferentes anchos en la misma tira

#### **b) Strip Packing + Shelf Packing**
```
┌─────────────────────────────────────────┐
│  Strip 1    │  Strip 2  │   Strip 3    │
│ ┌─────────┐ │ ┌───────┐ │ ┌──────────┐ │
│ │ Pieza 1 │ │ │ Pza 4 │ │ │ Pieza 7  │ │ ← Shelf 1
│ ├─────────┤ │ ├───┬───┤ │ ├──────────┤ │
│ │ Pieza 2 │ │ │P5 │P6 │ │ │ Pieza 8  │ │ ← Shelf 2
│ ├─────────┤ │ └───┴───┘ │ └──────────┘ │
│ │ Pieza 3 │ │           │              │ ← Shelf 3
│ └─────────┘ │           │              │
└─────────────────────────────────────────┘
  ↑           ↑           ↑
  Cortes verticales (longitudinales)
  
  Cortes horizontales (transversales) →
```

#### **c) Simulated Annealing (Temple Simulado)**
- **¿Qué es?** Metaheurística inspirada en el proceso de recocido del acero
- **¿Cómo funciona?**
  1. Genera una solución inicial con FFD (First-Fit Decreasing)
  2. Explora variaciones aleatorias (reordenar, rotar piezas)
  3. Acepta mejoras siempre
  4. Acepta soluciones peores con probabilidad decreciente
  5. Enfría gradualmente la "temperatura" para converger a óptimo local
- **Iteraciones:** 500 por defecto (ajustable)

#### **d) Operaciones de Vecindad**
Durante la optimización, el algoritmo aplica:
- **Swaps:** Intercambia posición de 2-10 piezas aleatoriamente
- **Rotaciones:** Prueba rotar 1-4 piezas (si está permitido)
- **Reordenamiento:** A veces ordena por área descendente
- **Multi-start:** Prueba 4 estrategias iniciales (área, ancho, alto, perímetro)

## Restricciones Implementadas

✅ **Solo cortes guillotina** (rectos, pasantes de borde a borde)  
✅ **Árbol guillotina válido** (cada división es ejecutable por la máquina)  
✅ **Kerf** (5mm de ancho de corte) respetado entre todas las piezas  
✅ **Refilamiento inicial** (13mm top/left) considerado en área útil  
✅ **Rotación automática** (configurable, por defecto activada)  

## Salida Generada

Cuando presionas **"GENERAR PLANO"**, el sistema retorna:

### 1. **Resumen General**
```
📊 Resumen:
- Placas necesarias: 1
- Piezas colocadas: 12
- Piezas sin colocar: 0
- Utilización: 94.69%
- Área desperdiciada: 260,120 mm²
```

### 2. **Secuencia de Cortes por Placa**
```
🔪 Secuencia de cortes:
   - Cortes verticales: 3      (primera etapa)
   - Cortes horizontales: 8    (segunda etapa)
   - Total de cortes: 11
```

### 3. **Lista de Piezas con Coordenadas**
```
📦 Piezas colocadas:
   1. Pieza 1500×450 en (13, 13) - 1500×450 mm
   2. Pieza 1500×450 en (13, 463) - 1500×450 mm
   3. Pieza 363×400 en (1968, 1413) - 400×363 mm [ROTADA]
   ...
```

### 4. **Métricas de Optimización**
- **Área total:** Suma de todas las placas usadas
- **Área usada:** Suma de áreas de piezas colocadas
- **Desperdicio:** Diferencia entre total y usado
- **Utilización:** Porcentaje de aprovechamiento (objetivo >90%)

## Cómo Usar

### Paso 1: Cargar Piezas
1. Configurar placas (dimensiones, material, cantidad)
2. Agregar filas con las medidas de las piezas
3. **No se optimiza automáticamente** → puedes revisar tranquilo

### Paso 2: Generar Plano
1. Presionar el botón **🎯 GENERAR PLANO**
2. El algoritmo ejecutará 500 iteraciones (~20-30ms)
3. Se mostrará un diálogo con el resumen de resultados

### Paso 3: Revisar Resultados
1. Consultar la consola del navegador (F12) para ver detalles completos
2. Revisar la visualización gráfica de las placas
3. Exportar a PDF si es necesario

## Resultados del Test

**Test Case: layout-test-1.json**

✅ **PASADO**
- Input: 12 piezas de diferentes tamaños
- Placa: 2720×1800mm (kerf 5mm, trim 13mm)
- Resultado: **1 placa** con **94.69% de utilización**
- Tiempo: 19ms para 500 iteraciones

### Layout Óptimo Encontrado:
```
Strip 1 (1500mm): 5 piezas apiladas verticalmente
  → 1500×450 (×3) + 1500×300 + 1500×100

Strip 2 (450mm): 2 piezas
  → 450×1500 (rotada) + 400×250

Strip 3 (400mm): 2 piezas  
  → 400×1400 (rotada) + 400×363 (rotada)

Strip 4 (320mm): 3 piezas
  → 320×715 (×2, rotadas) + 290×252
```

## Ventajas del Nuevo Sistema

### vs. Algoritmo Anterior
| Característica | Algoritmo Anterior | Nuevo Sistema |
|----------------|-------------------|---------------|
| Utilización | ~68% | **94.69%** |
| Placas usadas | 2 | **1** |
| Piezas colocadas | 11/12 | **12/12** |
| Desperdicio | ~1.5M mm² | **260K mm²** |
| Control usuario | Automático | **Manual** |

### Técnicas Científicas
- ✅ Basado en papers de investigación operativa
- ✅ Heurísticas constructivas (FFD/BFD)
- ✅ Metaheurísticas (Simulated Annealing)
- ✅ Exploración de espacio de soluciones
- ✅ Multi-start con diferentes estrategias

## Configuración Avanzada

Para ajustar parámetros, editar `app.js` línea ~5741:

```javascript
const options = {
  algorithm: 'simulated-annealing',  // 'ffd', 'bfd', 'simulated-annealing'
  iterations: 500,                   // Más iteraciones = mejor solución (más lento)
  kerf: 5,                          // Ancho de corte (mm)
  trimLeft: 13,                     // Refilamiento izquierdo (mm)
  trimTop: 13,                      // Refilamiento superior (mm)
  allowRotation: true               // Permitir rotar piezas 90°
};
```

## Troubleshooting

### ❓ El botón no aparece
- Verificar que `index.html` tenga el elemento `#generateLayoutBtn`
- Recargar la página (Ctrl+R)

### ❓ Dice "No hay piezas para optimizar"
- Verificar que haya filas agregadas con dimensiones válidas
- Verificar que las filas tengan cantidad > 0

### ❓ No coloca todas las piezas
- Aumentar `iterations` a 1000 o más
- Verificar que las piezas quepan físicamente en la placa
- Activar rotación automática

### ❓ Es muy lento
- Reducir `iterations` a 200-300
- Usar algoritmo 'ffd' en vez de 'simulated-annealing'

## Próximas Mejoras

### Posibles Extensiones:
- [ ] Algoritmos genéticos para exploración más amplia
- [ ] Restricciones de veta de madera
- [ ] Tamaños mínimos de sujeción
- [ ] Prioridades de piezas
- [ ] Exportar secuencia de cortes a formato máquina CNC
- [ ] Visualización 3D del proceso de corte

---

**Desarrollado con:**
- Two-Stage Guillotine Cutting
- Strip Packing + Shelf Packing
- Simulated Annealing
- First-Fit Decreasing (FFD)
- Best-Fit Decreasing (BFD)

**Validado con:** layout-test-1.json (12 piezas, 94.69% utilización, 1 placa)
