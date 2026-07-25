# Reuniones

El módulo de reuniones captura audio desde la UI, transmite segmentos al gateway y produce una transcripción y un reporte descargable.

## Uso

1. Abre **Reuniones** en la interfaz.
2. Concede permiso de micrófono.
3. Crea una reunión y comienza la captura.
4. Comprueba que aparecen segmentos en vivo.
5. Detén la reunión y genera el reporte.

El streaming usa `/meeting-stream`; la administración usa `/api/meetings`.

## Datos

Hive conserva metadatos, segmentos y el reporte asociados al usuario. Los límites de duración, tamaño y poda se controlan desde la configuración de reuniones. Trata las transcripciones como información sensible.

## Alcance en 1.0

Reuniones es una función del gateway y la UI. Las antiguas tools y skills `meeting_*` fueron retiradas; un agente no inicia ni controla reuniones mediante su loadout nativo.

## Problemas habituales

- Sin audio: revisa permisos del navegador y el dispositivo seleccionado.
- Stream desconectado: verifica el token, proxy WebSocket y `/meeting-stream`.
- Reporte incompleto: espera a que terminen los segmentos pendientes antes de detener el gateway.
