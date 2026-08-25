# 📊 Análisis de Capacidad de Usuarios

## Hardware Disponible

```
CPU:     AMD Ryzen AI MAX+ 395 (16 cores / 32 threads)
GPU:     Radeon 8060S (128 GB UMA - Unified Memory Architecture)
RAM:     128 GB total
Storage: NVME para modelos (~200+ GB disponibles)
```

## Limitaciones Actuales de la Arquitectura

### 1. **Un Modelo por Vez en VRAM** ❌

```typescript
// Del código en llama.service.ts línea 65:
export async function loadModel(modelPath: string, cfg: ModelConfig = {}) {
  await unloadModel()  // ← Descarga el anterior
  // ... carga nuevo modelo
}
```

**Implicación:** Solo se puede tener UN modelo cargado en VRAM a la vez.

### 2. **Modelos Grandes Requieren Mucha VRAM**

| Modelo | Tamaño | VRAM |
|--------|--------|------|
| Qwen3.6-35B-A3B-Q4_K_M | 22.7 GB | 22.7 GB |
| Qwen3.8-27B-Q4_K_XL | 17.9 GB | 17.9 GB |
| DeepSeek-V4-Flash-IQ2_XXS | 90.9 GB | 90.9 GB |

El espacio libre para caché y buffers depende del modelo activo: es amplio con
los Qwen y mucho más limitado con DeepSeek V4 Flash.

### 3. **Tiempo de Carga de Modelo** ⏱️

```
Qwen3.6: ~8 segundos
Qwen3.8: ~8 segundos
DeepSeek V4 Flash: ~91 segundos (histórico máximo observado: ~260 s)
```

Son mediciones del 18 de agosto de 2026. El tiempo de cambio equivale a la
descarga del modelo activo más la carga del siguiente; conserva un timeout de
al menos cinco minutos por la variación histórica de DeepSeek.

## Escenarios de Usuarios

### **Escenario 1: Usuarios con UN MISMO modelo** 👥

Si todos usan el mismo modelo:

```
Usuarios simultáneos: ~20-50 usuarios

Justificación:
  - 1 modelo en memoria (17.9-22.7 GB para los Qwen instalados)
  - TTFT: 210-250 ms (Qwen3.6 35B probado)
  - TGS: 57-62 tokens/s (Qwen3.6 35B probado)
  - CPU puede manejar: ~4 requests en paralelo (n_parallel=4)
  - Throughput: ~4 requests / 250ms = 16 req/s potencial
  - Límite práctico: 20-50 usuarios con latencia aceptable
```

### **Escenario 2: Usuarios con DIFERENTES modelos** 🔄

```
Usuarios secuencial: ~5-10 usuarios

Justificación:
  - Cambiar a un Qwen tarda ~8 s; cambiar a DeepSeek, ~91 s en la última medición
  - No hay paralelismo entre modelos
  - Los clientes esperan mientras se descarga el activo y carga el siguiente
  - Viable solo con cambios ocasionales entre modelos
```

### **Escenario 3: Usuarios ocasionales** 📱

```
Usuarios concurrentes: ~100-200 usuarios

Justificación:
  - Si no todos hacen requests simultáneamente
  - Modelo queda en VRAM entre requests
  - Solo requiere 1 cambio de modelo por cada nuevo usuario
  - Con ~100 usuarios * 1-5 requests/usuario = ✅ Posible
```

## Métricas de Rendimiento

### Throughput Máximo (1 modelo)

```
Requests/segundo:     ~16-20 req/s
Usuarios simultáneos: ~20-50 usuarios
Latencia TTFT:        210-250 ms
Token rate:           57-62 tokens/s
```

### Cambio de Modelos

```
Tiempo hacia Qwen:    ~8 segundos más la descarga
Tiempo hacia DeepSeek: ~91 segundos más la descarga (hasta ~260 s observado)
Max cambios/minuto:   depende del modelo de destino
Max usuarios únicos:  ~5-10 con diferentes modelos
```

## Recomendaciones para Escalar

### 1. **Usar un Modelo por Defecto** (Mejora inmediata) ⚡

```
→ Toda la carga en UN modelo
→ Habilita 20-50 usuarios simultáneos
→ Ejemplo: usar Qwen3.6-35B-A3B para agentes y chat rápido
→ Esfuerzo: Bajo (configuración)
→ Costo: $0
```

### 2. **Model Pooling / Multi-GPU** (Requiere cambios) 🔧

**Opción A: Varias instancias de llama-server**
```
- Puerto 8081: Qwen
- Puerto 8082: segundo Qwen
- Puerto 8083: DeepSeek
- API decide cuál usar basado en request
→ Habilita ~50-100 usuarios (modelo específico)
→ Esfuerzo: Medio (código + infra)
→ Costo: Bajo (solo software)
```

**Opción B: Múltiples GPUs** (hardware adicional)
```
- 2 GPUs = 2 modelos en paralelo
- 4 GPUs = 4 modelos en paralelo
→ Duplica/cuadriplica la capacidad
→ Esfuerzo: Alto (hardware + software)
→ Costo: Alto ($$$)
```

### 3. **Model Caching Inteligente** (Software) 🧠

```
Detectar cambios de modelo
Mantener último N modelos en VRAM
→ Habilita ~10-20 usuarios con modelos variados
→ Esfuerzo: Alto (lógica compleja)
→ Costo: $0
```

### 4. **Request Queuing** (Software) 📋

```
Cola de espera para cambios de modelo
Priorizar requests del mismo modelo
→ Mejora UX pero no aumenta throughput real
→ Esfuerzo: Bajo-Medio
→ Costo: $0
```

## Estimación Final por Caso de Uso

| Caso | Usuarios | Modelos | Latencia | Viabilidad |
|------|----------|---------|----------|------------|
| **Prototipo/Demo** | 1-5 | 1-2 | <500ms | ✅ Excelente |
| **Equipo pequeño (startup)** | 5-10 | 1 | 200-500ms | ✅ Excelente |
| **Equipo mediano** | 20-30 | 1 | 200-500ms | ✅ Bueno |
| **Múltiples equipos** | 50+ | 1 | 200-500ms | ⚠️ Límite |
| **Usuarios variados (multi-modelo)** | 5-15 | 2-3 | 1-2s (cambio) | ⚠️ Aceptable |
| **Producción pública** | 100+ | Múltiples | Variable | ❌ No recomendado |

## 🎯 Conclusión

**Usuarios simultáneos recomendados: 20-50 (mismo modelo)**

### ✅ La arquitectura actual está optimizada para:

- Un equipo usando el mismo modelo
- Latencias bajas (< 300ms TTFT)
- Alto throughput (16-20 req/s)
- Contextos variables (8K - 200K tokens)

### ❌ No está optimizada para:

- Múltiples modelos en paralelo
- Miles de usuarios públicos
- Cambios frecuentes de modelo
- Carga altamente variable

## 💡 Recomendación Según Tu Caso

### Si tienes 5-10 usuarios (equipo):
```
✅ Arquitectura actual es adecuada
   - Usa Qwen3.6-35B-A3B para agentes y para la máxima velocidad medida
   - Carga una vez, úsalo todo el día
   - ~200ms latencia por request
```

### Si tienes 20-50 usuarios (múltiples equipos):
```
✅ Arquitectura actual funciona bien
   - Recomienda un modelo
   - Acepta cambios ocasionales
   - Monitorea queue de espera
```

### Si tienes 50-100+ usuarios:
```
⚠️ Considera mejoras:
   1. Agregar segunda GPU (duplica capacidad)
   2. Usar instancias de llama-server múltiples
   3. Load balancer / caché frente
   4. Arquitectura distribuida
```

## 📈 Crecimiento Sugerido

```
Fase 1 (0-10 usuarios):      Actual architecture ✅
Fase 2 (10-50 usuarios):     Agregar modelo por defecto ⚡
Fase 3 (50-100 usuarios):    Multi-GPU o multi-instancia 🔧
Fase 4 (100+ usuarios):      Arquitectura distribuida / cloud 🚀
```

---

**Última actualización:** 2026-08-18
**Hardware:** AMD Ryzen AI MAX+ 395 + Radeon 8060S
**Stack:** llama.cpp + Bun + Elysia
