# Benchmark de modelos instalados — HiveAgents LLM API

**Fecha:** 2026-08-18  
**Hardware:** AMD Ryzen AI MAX+ 395 · Radeon 8060S · 128 GB UMA  
**Backend:** llama.cpp · Vulkan/RADV  
**Inventario actual:** los tres GGUF seleccionables que permanecen en `/data/models`

## Metodología

Cada modelo se cargó mediante `POST /api/load` usando exactamente la
`recommendedConfig` publicada por `GET /api/models`. Tras confirmar
`loaded=true`, se hicieron tres llamadas directas al endpoint nativo
`/completion` de llama-server:

- 128 tokens por corrida
- `temperature=0`
- `ignore_eos=true`
- `cache_prompt=false`
- el mismo prompt corto en todas las corridas

La generación media es el promedio de `timings.predicted_per_second`. El tiempo
de carga se midió desde la aceptación de `/api/load` hasta que `/api/status`
confirmó el modelo activo. El JSON reproducible está en
`/data/models/benchmark-2026-08-18.json` y el ejecutor en
`/data/models/benchmark-installed-models.sh`.

## Resumen

| # | Modelo | Tipo | Tamaño total | Carga | Generación media |
|---:|---|---|---:|---:|---:|
| 1 | Qwen3.6-35B-A3B-UD-Q4_K_M | MoE | 22.7 GB | 8.1 s | **62.7 t/s** |
| 2 | Qwen3.8-27B-UD-Q4_K_XL | Dense+MTP | 17.9 GB | 8.1 s | **25.3 t/s** |
| 3 | DeepSeek-V4-Flash-UD-IQ2_XXS | MoE, 3 shards | 90.9 GB | 90.8 s | **12.8 t/s** |

DeepSeek fue estable en esta medición: las tres corridas quedaron entre **12.64
y 12.87 t/s**. La mejora frente al benchmark del 14 de agosto (4.8 t/s de
promedio y 259.6 s de carga) es grande; por eso se conserva el JSON crudo y no
se extrapola esta prueba corta a contextos largos.

## Resultados por corrida

| Modelo | Corrida 1 | Corrida 2 | Corrida 3 |
|---|---:|---:|---:|
| Qwen3.6-35B-A3B | 62.07 | 62.98 | 63.02 |
| Qwen3.8-27B MTP | 25.94 | 24.38 | 25.63 |
| DeepSeek-V4-Flash | 12.87 | 12.74 | 12.64 |

## Prompt processing

| Modelo | Prompt medio |
|---|---:|
| Qwen3.6-35B-A3B | **137.1 t/s** |
| Qwen3.8-27B MTP | **46.1 t/s** |
| DeepSeek-V4-Flash | **21.0 t/s** |

## Configuraciones usadas

- Qwen3.8 27B: contexto 8192, KV f16, MTP activo, draft máximo 3, Jinja.
- DeepSeek V4 Flash: contexto 32768, KV q4_0, flash attention, 16 threads, Jinja.
- Qwen3.6 35B: contexto 8192, KV f16, flash attention desactivado, Jinja.

El benchmark mide generación de texto plano con el modelo ya cargado. No debe
confundirse con TTFT de chat, calidad de respuesta, tool-calling ni rendimiento
con contexto largo.

## Validación separada de tools a través de la API

DeepSeek V4 Flash completó el 18 de agosto de 2026 un ciclo de extremo a extremo
mediante `POST /v1/chat/completions` en esta API: aceptó `tools` y `tool_choice`,
produjo `finish_reason="tool_calls"` con argumentos JSON válidos, recibió el
mensaje con rol `tool` y terminó con `finish_reason="stop"` incorporando el
resultado. No fue una llamada directa a llama-server. Esta prueba funcional no
forma parte de las cifras de throughput. El ejecutor reproducible está en
`scripts/validate-deepseek-tools.ts` y el resumen capturado en
`deepseek-tool-validation-2026-08-18.json`.
