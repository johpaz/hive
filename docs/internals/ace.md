# Playbook ACE

ACE es el playbook operativo que inyecta reglas relevantes en un turno. Las reglas se almacenan en HiveDB y se seleccionan por similitud con el contexto actual.

Hive 1.0 siembra ocho reglas que cubren, entre otros temas, descubrimiento, evidencia, delegación y manejo seguro de efectos. La cifra se valida desde los tests de seed; el prompt no recibe necesariamente las ocho.

## Flujo

1. El selector recibe objetivo, estado y señales del turno.
2. Busca reglas relevantes.
3. Deduplica y aplica el presupuesto de contexto.
4. El prompt builder presenta las reglas seleccionadas como restricciones operativas.
5. El tracer registra qué reglas influyeron en el turno.

ACE no sustituye las políticas de seguridad ni la autorización del usuario. Una regla aprendida tampoco puede ampliar tools, workspace o recursos MCP.
