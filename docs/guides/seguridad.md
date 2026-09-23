# Seguridad

## Autenticación

En el primer arranque, Hive genera un token criptográfico y lo guarda en `HIVE_HOME/.auth_token` con permisos `0600`. También puede recibirse mediante `HIVE_AUTH_TOKEN`; esa variable tiene prioridad.

Las rutas protegidas y el WebSocket aceptan:

```http
Authorization: Bearer <token>
```

El correo se configura durante el onboarding y forma parte del perfil del usuario, pero por sí solo no habilita el inicio de sesión. Después de autenticarse con el token, **Configuración → Perfil → Acceso y seguridad** permite activar la protección desde un modal; Hive reutiliza el mismo correo del perfil como identidad de acceso. La clave de recuperación es el propio token, por lo que debe guardarse fuera del equipo. Cambiar la contraseña no sustituye esa clave.

Mientras no exista una contraseña, el endpoint público de estado no expone el correo guardado. El correo propio solo se incorpora al contexto del coordinador para resolver solicitudes como «envíame»; los agentes trabajadores no lo reciben automáticamente.

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

## Datos enviados a Jev

Jev solo funciona con una clave de OpenRouter. Mientras esté activo, en cada decisión Hive envía a `openrouter.ai/api/alpha/decisions` extractos de la conversación en curso:

| Dato | Límite por decisión |
|---|---|
| Objetivo del turno (mensaje del usuario o tarea delegada) | 3.500 caracteres |
| Mensajes anteriores de la conversación que podrían omitirse | 450 caracteres por mensaje |
| Resultados recientes de herramientas | 650 caracteres por resultado |
| Argumentos de herramientas que podrían correr en paralelo | 700 caracteres por llamada |
| Notas y reglas del playbook | 350 caracteres por elemento |
| Nombres y descripciones de herramientas, skills y especialistas; nombre y estado de cada servidor MCP | 240 caracteres por descripción |

No se envían claves de proveedores, tokens de canales, archivos completos ni mensajes anteriores a los 15 más recientes de la conversación. Los últimos dos intercambios de la conversación no se le preguntan a Jev (siempre se incluyen), pero la decisión sí recibe el objetivo del turno. Quitar la clave o desactivar OpenRouter detiene el envío de inmediato.

Trata este flujo como el de cualquier proveedor de modelos: si una conversación contiene datos que no deben salir del equipo, no actives Jev o usa un modelo local sin clave de OpenRouter.

## Herramientas y agentes

El coordinador no entrega todas las tools a cada agente. La delegación expande una allowlist y aplica el scope del workspace. Un especialista MCP es la excepción explícita: después de la autorización del usuario recibe todas las tools de un único servidor persistido, adquiere su lease durante la tarea y no puede acceder a otros servidores. Los agentes de catálogo no pueden delegar de nuevo ni ampliar su propio alcance.

Las acciones destructivas o externas deben estar autorizadas por la solicitud original. Los checks de aceptación comprueban el estado final, pero nunca reparan ni repiten una mutación; una corrección solo ocurre si el coordinador la reencola explícitamente con `task_revise`.

## Auditoría

```bash
hive security audit
hive doctor
```

Revisa periódicamente permisos de `HIVE_HOME`, agentes habilitados, canales, servidores MCP y modelos configurados.

Para reportar una vulnerabilidad, evita abrir un issue con secretos o un exploit activo; usa un canal privado del mantenedor indicado en el repositorio.
