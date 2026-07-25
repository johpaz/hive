# Canales

Hive puede recibir y responder mensajes por webchat, Telegram, Discord, Slack y WhatsApp. Cada cuenta se asocia a un usuario y puede vincularse a un agente.

## Flujo común

1. Completa el onboarding y confirma que el gateway funciona.
2. Abre **Canales** en la UI.
3. Añade las credenciales de la plataforma.
4. Activa la cuenta y verifica su estado.
5. Envía un mensaje de prueba.

Las credenciales se almacenan en `HIVE_HOME`, nunca en el repositorio.

## Políticas de mensajes directos

Los canales aceptan políticas `open`, `pairing` o `allowlist`. Usa `pairing` o `allowlist` para instalaciones expuestas. Los límites de longitud se aplican por canal antes de entrar al runtime.

## WhatsApp

WhatsApp usa Baileys y una sesión persistente:

1. Crea una cuenta WhatsApp desde la UI.
2. Escanea el código QR con **Dispositivos vinculados**.
3. Espera el estado conectado.
4. Conserva el directorio de credenciales dentro de `HIVE_HOME`.

La UI permite consultar detalles, actualizar configuración, desconectar y reconectar una cuenta. Si se revoca la sesión desde el teléfono, será necesario vincular de nuevo.

## Voz

La voz sigue disponible como configuración de canal y API de producto. No existe una categoría de herramientas `voice_*` para agentes en 1.0. Los proveedores TTS/STT se configuran en la UI y se prueban antes de activarlos por canal.

## Resolución de problemas

```bash
hive status
hive logs --follow
hive doctor
```

Comprueba reloj del sistema, conectividad, scopes del bot y que el agente vinculado esté habilitado.
