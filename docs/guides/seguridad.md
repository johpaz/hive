# Seguridad

## Autenticación

En el primer arranque, Hive genera un token criptográfico y lo guarda en `HIVE_HOME/.auth_token` con permisos `0600`. También puede recibirse mediante `HIVE_AUTH_TOKEN`; esa variable tiene prioridad.

Las rutas protegidas y el WebSocket aceptan:

```http
Authorization: Bearer <token>
```

La UI permite configurar correo y contraseña después de autenticarse con el token. La clave de recuperación es el propio token, por lo que debe guardarse fuera del equipo. Cambiar la contraseña no sustituye esa clave.

## Exposición de red

- El host predeterminado es `127.0.0.1`.
- Para contenedores puede usarse `HIVE_HOST=0.0.0.0`, pero debe existir un proxy TLS y control de acceso.
- No publiques `18790`, `/ws` ni `/meeting-stream` directamente en Internet.
- Restringe CORS y orígenes permitidos cuando despliegues detrás de un dominio.

## Secretos

- Guarda claves de proveedores en variables de entorno o `HIVE_HOME/.env`.
- No incluyas `.env`, `.auth_token`, credenciales de WhatsApp ni el directorio HiveDB en repositorios o reportes.
- `hive config show` redacta claves sensibles; aun así, revisa la salida antes de compartirla.
- Los logs y proof packets deben contener evidencia saneada, no headers de autorización ni cookies.

## Herramientas y agentes

El coordinador no entrega todas las tools a cada agente. La delegación expande una allowlist, aplica el scope del workspace y adquiere leases para servidores MCP. Los agentes de catálogo no pueden delegar de nuevo ni ampliar su propio alcance.

Las acciones destructivas o externas deben estar autorizadas por la solicitud original. El verificador comprueba el estado final, pero nunca repara ni repite una mutación.

## Auditoría

```bash
hive security audit
hive doctor
```

Revisa periódicamente permisos de `HIVE_HOME`, agentes habilitados, canales, servidores MCP y modelos configurados.

Para reportar una vulnerabilidad, evita abrir un issue con secretos o un exploit activo; usa un canal privado del mantenedor indicado en el repositorio.
