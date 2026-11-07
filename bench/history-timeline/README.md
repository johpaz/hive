# Benchmark de la línea de tiempo del historial

¿Cuánto de lo plantado **fuera de la ventana** (los últimos 15 mensajes) llega, literal, al system prompt que
compila `compileContext`? Compara el modo actual (recuperación fija de 3 mensajes × 500 caracteres) con
`HIVE_HISTORY_TIMELINE=true` (línea de tiempo de 80 caracteres por mensaje + recuperación que llena un
presupuesto). Sin modelo, sin red, determinista. Idea tomada de FlexA-Mem (arXiv 2610.33274).

```bash
bun run bench:history-timeline            # tarda ~6 min: cada consulta compila el contexto completo
bun bench/history-timeline/run.ts --seeds 1 --out resultados.json
```

Usa los escenarios y la puntuación de `bench/compaction` (27 datos plantados entre relleno con señuelos, 3
semillas). El banco fija `HIVE_HISTORY_TIMELINE_MIN_WINDOW=0`: mide el mecanismo con cualquier ventana, sin la
compuerta por tamaño. Tres tipos de consulta:

- **A · una pregunta por dato** (control). Comparte palabras con el dato, y ahí la búsqueda actual ya acierta.
- **B · una consulta vaga** («retoma lo que habíamos acordado antes»), sin palabras del dato.
- **C · una sola consulta que pide todo** («resume todo lo que acordamos» + las 9 preguntas): mide cuánto cabe.

## Resultados (salida cruda en `resultados.txt`)

| Ventana del modelo | Consulta | Actual | Timeline |
|---:|---|---:|---:|
| 8 000 | A | 100 % | 100 % |
| 8 000 | B | 0 % | 7 % |
| 8 000 | C | 33 % | 81 % |
| 32 000 | A | 100 % | 100 % |
| 32 000 | B | 0 % | 56 % |
| 32 000 | C | 33 % | 100 % |
| 128 000 | A | 100 % | 100 % |
| 128 000 | B | 0 % | 85 % |
| 128 000 | C | 33 % | 100 % |

Cuesta prompt: entre ~1 500 y ~7 500 caracteres más, que crecen con la ventana (los presupuestos son un 3 % y
un 4 % de ella). Las retenciones coinciden celda por celda con las de `hive-sdk`, de donde se portó el módulo.

## Qué dice y qué no

- Cuando la pregunta comparte palabras con el dato (A) no cambia nada; cuando no las comparte (B) o hay que
  recordar varias cosas a la vez (C), el modo actual solo recupera 3 mensajes y se queda corto.
- Mide si el dato **está en el contexto**, no si el agente lo usa bien. Los datos son sintéticos y cortos.
- **La prueba con modelo real se hizo en `hive-sdk`, no aquí** (`bench/history-timeline/e2e.ts` de ese repo,
  Gemini 3.8 Flash, 18 preguntas por celda, preguntas indirectas): a 32 000 tokens el modelo acertó 12 frente
  a 6 sin tools y 15 frente a 10 con `conversation_read`; a 8 000 no mejoró y con tool quedó por debajo
  (7 frente a 10). De ahí la compuerta provisional de 32 000 (`memory.historyTimeline.minWindow`). Esas cifras
  no se han repetido sobre el código de `hive`.

## Ablación (`HIVE_HISTORY_TIMELINE_PARTS`) y ruido

`run.ts` ahora compara cuatro modos: `actual`, `solo-recuperacion`, `solo-linea` y `ambas` (la tabla de arriba, «Timeline»,
corresponde a `ambas`). La ablación y su lectura (la línea de tiempo es la única pieza que ayuda con una consulta vaga; la
recuperación adaptativa explica casi toda la mejora cuando se pide todo a la vez, porque el control actual no escala con el
presupuesto) se midieron en `hive-sdk`, ver su `bench/history-timeline/README.md`, sección «Ablación y ruido». **No se ha repetido
la ablación sobre el código de `hive`**; las dos configuraciones que sí se repitieron dieron las mismas retenciones que el SDK.

Aviso sobre las pruebas con modelo citadas arriba: la misma configuración dio 8/18 y 11/18 en dos corridas idénticas, así que
las diferencias de 3–5 casos de «respondió bien» no son concluyentes. La compuerta de 16 000 tokens es una suposición.
