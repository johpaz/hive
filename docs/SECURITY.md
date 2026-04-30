# Seguridad — Hive

## 1. Autenticación del dashboard (`HIVE_AUTH_TOKEN`)

Por defecto, el dashboard de Hive es accesible sin contraseña. Cualquier persona que alcance el puerto `18790` puede ver la UI y usar el agente.

**Si expones Hive en una red que no controlas totalmente (VPS, servidor, red corporativa), define `HIVE_AUTH_TOKEN`.**

Cuando esta variable está definida, el gateway rechaza todas las peticiones que no incluyan el token correcto. El dashboard muestra una pantalla de autenticación antes de permitir el acceso.

### Cómo configurarlo

**Docker Compose** — edita `docker-compose.yml`:

```yaml
services:
  hive:
    environment:
      HIVE_AUTH_TOKEN: "tu-token-secreto-aqui"
```

**Docker run** — pásalo como variable de entorno:

```bash
docker run -d \
  -p 18790:18790 \
  -v hive-data:/root/.hive \
  -e HIVE_AUTH_TOKEN="tu-token-secreto-aqui" \
  --name hive \
  --restart unless-stopped \
  johpaz/hive:latest
```

**Binario / npm:**

```bash
HIVE_AUTH_TOKEN="tu-token-secreto-aqui" hive start
```

O agrega la variable a tu `.env` o perfil de shell.

### Recomendaciones

- Usa un token aleatorio de al menos 32 caracteres. Puedes generarlo con:
  ```bash
  openssl rand -hex 32
  ```
- No uses el token como contraseña de otra cosa — es específico para Hive.
- **Siempre define `HIVE_AUTH_TOKEN` en producción.**

---

## 2. Firewall y exposición de red

El gateway escucha por defecto en `0.0.0.0:18790`, lo que significa que acepta conexiones desde cualquier interfaz de red.

### Uso local (recomendado para laptops y equipos personales)

Hive binario y npm usan `HIVE_HOST=127.0.0.1` por defecto — solo accesible desde el mismo equipo. No es necesario abrir ningún puerto.

### Uso en servidor o VPS

Si expones Hive en un servidor público:

**Opción A — Reverse proxy con HTTPS (recomendado)**

Pon Hive detrás de nginx, Caddy o Traefik. Así:
- El tráfico va cifrado (HTTPS)
- Puedes usar tu propio dominio
- El puerto `18790` queda cerrado al exterior — solo el proxy lo alcanza internamente

Ejemplo básico con Caddy:

```
hive.tudominio.com {
    reverse_proxy localhost:18790
}
```

Caddy gestiona el certificado TLS automáticamente.

**Opción B — Abrir solo el puerto necesario**

Si accedes directamente por IP (sin proxy), abre únicamente el puerto `18790` en el firewall y cierra el resto. En Hostinger VPS, esto se configura desde el panel de control en **Firewall → Agregar regla → Puerto 18790 TCP**.

No abras puertos adicionales del gateway (el puerto de WebSocket usa la misma conexión que la UI).

### Resumen de recomendaciones

| Escenario | Recomendación |
|-----------|---------------|
| Laptop personal | Sin cambios — `127.0.0.1` por defecto |
| Raspberry Pi en red local | Abrir `18790` solo en la LAN |
| VPS / servidor público | Reverse proxy HTTPS + `HIVE_AUTH_TOKEN` |
| Hostinger / hosting compartido | Firewall del panel + reverse proxy |

---

## 3. Container Docker — usuario de proceso

> **Estado actual:** el proceso dentro del contenedor corre como `root`.

El `Dockerfile` no incluye una instrucción `USER`, por lo que el binario de Hive se ejecuta con privilegios de `root` dentro del contenedor Alpine. Los datos se almacenan en `/root/.hive`.

Esto es habitual en contenedores de uso personal y no representa un riesgo inmediato mientras el contenedor esté correctamente aislado (sin `--privileged`, sin montar sockets de Docker, etc.). El contenedor por defecto no tiene acceso a recursos del host más allá del volumen `hive-data` y el puerto mapeado.

**TODO (versiones futuras):** migrar a un usuario no-root dedicado (`hive`) dentro del contenedor y ajustar los permisos del directorio de datos. Ejemplo de los cambios necesarios en el `Dockerfile`:

```dockerfile
RUN addgroup -S hive && adduser -S hive -G hive
RUN mkdir -p /home/hive/.hive && chown hive:hive /home/hive/.hive
USER hive
VOLUME /home/hive/.hive
ENV HIVE_HOME=/home/hive/.hive
```

---

## 4. Datos — almacenamiento local y privacidad

### Dónde se guardan los datos

Todos los datos de Hive se almacenan **localmente** en el volumen `hive-data` (Docker) o en `~/.hive/` (binario/npm). Nunca se envían a servidores externos de Hive.

```
hive-data (volumen Docker) → montado en /root/.hive dentro del contenedor
  ├── data/hive.db     ← SQLite: agentes, conversaciones, config, API keys cifradas
  ├── logs/
  └── ...
```

Las únicas conexiones de red que Hive realiza son:
- **A los proveedores LLM** que tú configures (OpenAI, Anthropic, Google, etc.) — solo cuando el agente procesa un mensaje.
- **A los canales que actives** (Telegram, Discord) — para recibir y enviar mensajes.

**Hive no envía telemetría, métricas de uso, ni datos de conversación a ningún servidor de Hive o terceros.**

### Backup del volumen

Para hacer backup de todos los datos (configuración, agentes, historial, API keys):

```bash
# Backup
docker run --rm \
  -v hive-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/hive-backup-$(date +%Y%m%d).tar.gz -C /data .

# Restaurar
docker run --rm \
  -v hive-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/hive-backup-20260318.tar.gz -C /data
```

O simplemente copia el archivo de base de datos:

```bash
docker cp hive:/root/.hive/data/hive.db ./hive-backup-$(date +%Y%m%d).db
```

### API keys

Las API keys de los proveedores LLM se almacenan **cifradas** en la base de datos SQLite usando AES-256. La clave de cifrado se deriva del entorno local. Las keys nunca se loggean en texto claro.
