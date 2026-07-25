# Formato TOON

Hive usa `toon-format-parser` como representación compacta para ciertos datos estructurados enviados a modelos. TOON reduce repetición de claves frente a JSON cuando hay listas homogéneas.

## Criterio de uso

- Conserva JSON para APIs, persistencia y tool schemas.
- Usa TOON únicamente en límites internos donde el consumidor lo soporte.
- No conviertas texto libre, binarios o estructuras pequeñas solo por uniformidad.
- Si el parseo falla, el runtime debe conservar una representación legible y reportar el error.

TOON es una optimización de contexto, no una base de datos ni un protocolo público de Hive. Los contratos externos continúan siendo JSON, HTTP y WebSocket.
