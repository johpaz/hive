# Guía de Desarrollo — Hive

Referencia para desarrollar, probar y construir Hive localmente.

---

## Índice

1. [Requisitos](#requisitos)
2. [Modo desarrollo (bun run dev)](#modo-desarrollo)
3. [Pruebas con Docker Compose local](#docker-compose-local)
4. [Build de la imagen Docker](#build-imagen)
5. [Variables de entorno de desarrollo](#variables-de-entorno)
6. [Flujos comunes](#flujos-comunes)

---

## Requisitos

- **Bun** >= 1.0
- **Docker** y **Docker Compose** (para pruebas con imagen)
- **Node.js** >= 20 (para servidores MCP externos)

---

## Modo Desarrollo

El modo desarrollo usa `~/.hive-dev` en lugar de `~/.hive`, manteniendo el entorno de producción intacto.

### Iniciar con hot-reload

```bash
bun run dev
```

- Usa `HIVE_HOME=$HOME/.hive-dev` y `HIVE_DEV=true`
- Si es la primera vez, ejecuta el onboarding automáticamente
- La DB se crea en `~/.hive-dev/data/hive.db`
- El gateway escucha en `http://127.0.0.1:18790`

### Iniciar sin limpiar estado entre reinicios

```bash
bun run dev:keep
```

Equivale a `dev` pero con `HIVE_DEV_CLEAN=false` — útil cuando ya configuraste el onboarding y no quieres repetirlo.

### Diagnóstico del entorno dev

```bash
bun run doctor:dev
```

Corre `hive doctor` apuntando a `~/.hive-dev`.

### Diferencias entre `dev` y producción

| Aspecto | `bun run dev` | `bun run start` / Docker |
|---------|--------------|--------------------------|
| Directorio datos | `~/.hive-dev` | `~/.hive` |
| Variable `HIVE_DEV` | `true` | no definida |
| Hot-reload | sí | no |
| Imagen compilada | no | sí |

---

## Docker Compose Local

Para probar los cambios del repo con la misma configuración que producción, usa los dos archivos compose en conjunto.

### Archivos involucrados

| Archivo | Propósito |
|---------|-----------|
| `docker-compose.yml` | Configuración base (producción, imagen publicada) |
| `docker-compose.local.yml` | Override local: puertos, volumen aislado, build desde el repo |

### Construir y levantar

```bash
# Construir imagen desde el repo y levantar
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

### Construir sin levantar

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml build
```

### Levantar con imagen ya construida

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up
```

### Detener y limpiar

```bash
# Solo detener
docker compose -f docker-compose.yml -f docker-compose.local.yml down

# Detener y borrar volumen de datos local
docker compose -f docker-compose.yml -f docker-compose.local.yml down -v
```

### Diferencias respecto al compose de producción

| Aspecto | `docker-compose.yml` | Con override local |
|---------|---------------------|--------------------|
| Imagen | `johpaz/hive:1.7.x` (pull) | `hive:local` (build local) |
| Puerto expuesto | ninguno (Traefik) | `18790:18790` |
| Volumen datos | `hive-data` | `hive-data-local` |
| Red | `n8n_evoapi` (externa) | no requiere red externa |

> La imagen local se etiqueta como `hive:local` para no sobreescribir la imagen publicada en caché.

### Acceso a la UI

Una vez levantado, la UI está disponible en:

```
http://localhost:18790
```

---

## Build de la Imagen Docker

El `Dockerfile` usa un build multi-stage:

| Stage | Base | Qué hace |
|-------|------|----------|
| `ui-builder` | `oven/bun:1` | Compila el frontend (`packages/hive-ui`) con Vite |
| `binary-builder` | `oven/bun:1` | Compila el binario standalone para Linux musl (Alpine) |
| runtime | `alpine:3.21` | Imagen final mínima con el binario y la UI |

### Build manual de la imagen

```bash
docker build -t hive:local .
```

### Resultado de la imagen

- Binario en `/app/hive-server` (autónomo, sin runtime externo)
- UI estática en `/app/ui`
- Datos persistidos en volumen `/root/.hive`
- Puerto `18790` expuesto

### Build del binario standalone (sin Docker)

```bash
bun run build:binary
# Salida: packages/cli/dist/hive-binary
```

### Build del bundle JS (sin compilar a binario)

```bash
bun run build
# Salida: dist/hive.js
```

---

## Variables de Entorno

### Variables de desarrollo

| Variable | Descripción | Valor en `dev` |
|----------|-------------|----------------|
| `HIVE_HOME` | Directorio base de Hive | `~/.hive-dev` |
| `HIVE_DEV` | Activa modo desarrollo | `true` |
| `HIVE_DEV_CLEAN` | Limpia estado al reiniciar | `true` (omitir con `dev:keep`) |

### Variables del contenedor

| Variable | Descripción | Default |
|----------|-------------|---------|
| `HIVE_HOST` | Bind del gateway | `0.0.0.0` |
| `HIVE_PORT` | Puerto del gateway | `18790` |
| `HIVE_UI_DIR` | Directorio de la UI estática | `/app/ui` |
| `NODE_ENV` | Entorno Node | `production` |

### Pasar variables al contenedor local

```bash
# Inline con docker compose
HIVE_PORT=18791 docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# O con un archivo .env junto a docker-compose.local.yml
```

---

## Flujos Comunes

### Desarrollo normal (sin Docker)

```bash
# Primera vez
bun run dev         # Hace onboarding + levanta gateway

# Siguientes veces
bun run dev:keep    # Levanta sin limpiar estado

# En otra terminal
bun run lint        # Verificar tipos
bun test            # Correr tests
```

### Validar cambios antes de publicar imagen

```bash
# 1. Hacer cambios en el código

# 2. Construir imagen y levantar
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# 3. Probar en http://localhost:18790

# 4. Ver logs del contenedor
docker compose -f docker-compose.yml -f docker-compose.local.yml logs -f

# 5. Bajar
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

### Iterar rápido con Docker

```bash
# Reconstruir solo si cambiaron dependencias (bun.lock / package.json)
docker compose -f docker-compose.yml -f docker-compose.local.yml build

# Si solo cambia código TypeScript, el build de Bun es incremental
# Reconstruir y reemplazar contenedor corriendo
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build --force-recreate
```

### Inspeccionar la DB del contenedor local

```bash
# El volumen hive-data-local está en Docker; para acceder:
docker compose -f docker-compose.yml -f docker-compose.local.yml exec hive sh

# Dentro del contenedor:
# /root/.hive/data/hive.db
```

---

**Última actualización**: Marzo 2026
