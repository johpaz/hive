# Configuración de Workspace del Agente

## ¿Qué es el Workspace?

El **workspace** es el directorio de trabajo donde tu agente Hive puede:
- ✅ Crear y eliminar carpetas
- ✅ Leer y escribir archivos
- ✅ Ejecutar comandos de shell
- ✅ Gestionar proyectos
- ✅ Almacenar memoria y notas

**Importante**: El workspace es **diferente** de las carpetas del sistema:
- `.hive` (producción) / `.hive-dev` (desarrollo): Carpetas del sistema donde Hive guarda su configuración interna, base de datos, logs, etc.
- **Workspace**: Directorio de trabajo del agente donde opera sobre TUS archivos y proyectos.

### ¿El agente sabe cuál es su workspace?

**Sí**. Cuando configuras un workspace, el agente recibe esta información en su **system prompt** cada vez que es invocado:

```
# WORKSPACE DE TRABAJO

**Directorio de trabajo**: /path/to/workspace

## Instrucciones de Workspace

- Este es tu directorio de trabajo principal donde puedes crear, leer, modificar y eliminar archivos
- Todas las rutas relativas se resuelven desde este directorio
- Al crear nuevos archivos o carpetas, usa este directorio como base a menos que el usuario especifique otro path
- Puedes acceder a archivos fuera del workspace si el usuario lo solicita explícitamente, pero por defecto trabaja dentro de este directorio
```

Esto significa que el agente:
- ✅ **Sabe conscientemente** dónde está su workspace
- ✅ **Lo menciona en sus respuestas** cuando crea archivos
- ✅ **Usa rutas relativas** desde ese directorio por defecto
- ✅ **Puede explicar** al usuario dónde está trabajando
- ✅ **Las herramientas `project_*` operan dentro de este workspace** automáticamente

### ¿Cómo funcionan las herramientas de filesystem?

Las herramientas `project_read`, `project_list`, `project_write`, etc. están configuradas para usar el workspace del agente:

```typescript
// Prioridad de resolución del path:
// 1. Path absoluto explícito (el usuario especifica ruta completa)
// 2. Workspace del agente (desde DB)
// 3. process.cwd() (fallback si no hay workspace configurado)
```

**Ejemplo**:
```
Usuario: "lista los archivos de mi workspace"
Agente: [Ejecuta project_list sin path]
→ Lista archivos de `/run/media/johnpaez/TU PROFE` ✅
```

---

## Configuración en Producción

### Ubicación del Workspace

En producción, el workspace se configura **por agente** y puede ser cualquier directorio accesible en el sistema:

| Tipo | Ejemplo Linux/macOS | Ejemplo Windows |
|------|---------------------|-----------------|
| **Disco local** | `/home/usuario/proyectos` | `D:\Projects` |
| **USB** | `/media/usb/hive-workspace` | `E:\HiveWorkspace` |
| **Disco externo** | `/Volumes/MyPassport/workspace` | `F:\Workspace` |
| **Red/NAS** | `/mnt/nas/hive` | `\\NAS\Hive\Workspace` |
| **Home** | `~/workspace` | `C:\Users\usuario\workspace` |

### Configuración por Defecto

Si no se especifica un workspace, Hive usará por defecto:
```
~/.hive/workspace
```

---

## Cómo Configurar el Workspace

### Desde la UI (Recomendado)

1. **Crear un nuevo agente**:
   - Ve a `Agents` → `Desplegar Nodo`
   - En la sección **"Workspace Directory"**, ingresa el path absoluto
   - El sistema validará automáticamente:
     - 🔵 **Validando...** → Verificando el path
     - 🟢 **Directorio válido y accesible** → Todo OK
     - 🟡 **Sin permisos** → El directorio existe pero no tienes permisos
     - 🟣 **El directorio no existe** → Ofrece botón "Crear directorio"

2. **Editar agente existente**:
   - Ve a `Agents` → Click en el agente → Pestaña de configuración
   - Busca la sección **"Workspace Directory"**
   - Modifica el path y guarda los cambios

### Desde la API

```bash
# Crear agente con workspace
curl -X POST http://localhost:18790/api/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Mi Agente",
    "description": "Agente para proyectos",
    "workspace": "/home/usuario/proyectos"
  }'

# Actualizar workspace de agente existente
curl -X PUT http://localhost:18790/api/agents/{agentId} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "workspace": "/nuevo/path/workspace"
  }'
```

### Validar Workspace

```bash
# Validar si un path es accesible
curl -X POST http://localhost:18790/api/workspace/validate \
  -H "Content-Type: application/json" \
  -d '{"path": "/home/usuario/proyectos"}'

# Respuesta exitosa:
{
  "ok": true,
  "exists": true,
  "accessible": true,
  "isAbsolute": true,
  "message": "Directorio válido y accesible"
}

# Respuesta si no existe:
{
  "ok": true,
  "exists": false,
  "accessible": false,
  "isAbsolute": true,
  "canCreate": true,
  "message": "El directorio no existe. Puede crearlo."
}
```

### Crear Directorio

```bash
curl -X POST http://localhost:18790/api/workspace/create \
  -H "Content-Type: application/json" \
  -d '{"path": "/home/usuario/nuevo-workspace"}'
```

### Abrir en Explorador

```bash
# Abre el directorio en el explorador del sistema operativo
curl -G "http://localhost:18790/api/workspace/open" \
  --data-urlencode "path=/home/usuario/proyectos"
```

---

## Casos de Uso

### 1. Workspace en Disco Local (Recomendado)

```
Path: /home/usuario/hive-workspace
```

**Ventajas**:
- Máximo rendimiento
- Sin dependencias externas
- Ideal para desarrollo diario

**Configuración**:
```bash
mkdir -p /home/usuario/hive-workspace
chmod 755 /home/usuario/hive-workspace
```

### 2. Workspace en USB (Portable)

```
Path Linux: /media/usb/hive
Path macOS: /Volumes/USB/hive
Path Windows: E:\Hive
```

**Ventajas**:
- Portabilidad total
- Lleva tu agente a cualquier equipo
- Aislamiento físico de datos

**Consideraciones**:
- La USB debe estar montada antes de iniciar Hive
- Usar paths absolutos consistentes
- En Linux, configurar mount point fijo en `/etc/fstab`

**Ejemplo `/etc/fstab`** (Linux):
```bash
UUID=1234-5678 /media/usb auto rw,user,auto,exec 0 0
```

### 3. Workspace en Red/NAS

```
Path Linux: /mnt/nas/hive-workspace
Path macOS: /Volumes/NAS/hive-workspace
Path Windows: \\NAS\Hive\Workspace
```

**Ventajas**:
- Acceso multi-dispositivo
- Backup centralizado
- Colaboración

**Consideraciones**:
- Requiere montaje previo del share de red
- Latencia de red puede afectar rendimiento
- Permisos de red deben estar configurados

**Ejemplo montaje NFS** (Linux):
```bash
# /etc/fstab
nas.local:/export/hive /mnt/nas/hive-workspace nfs rw,soft,intr 0 0
```

**Ejemplo montaje SMB/CIFS** (Linux):
```bash
# /etc/fstab
//nas.local/hive /mnt/nas/hive-workspace cifs credentials=/home/user/.smbcreds,iocharset=utf8 0 0
```

### 4. Workspace por Proyecto

Puedes crear múltiples agentes, cada uno con su propio workspace:

| Agente | Workspace | Propósito |
|--------|-----------|-----------|
| `dev-personal` | `~/proyectos/personal` | Proyectos personales |
| `dev-trabajo` | `~/proyectos/trabajo` | Proyectos laborales |
| `analisis` | `~/analisis/datos` | Análisis de datos |
| `automatizacion` | `~/scripts` | Scripts de automatización |

---

## Consideraciones de Seguridad

### Permisos de Archivo

El agente necesita permisos de **lectura y escritura** en el workspace:

```bash
# Verificar permisos
ls -la /path/to/workspace

# Asignar permisos (Linux/macOS)
chmod 755 /path/to/workspace
chown usuario:usuario /path/to/workspace

# Windows (PowerShell)
icacls "D:\Workspace" /grant usuario:(OI)(CI)F
```

### Paths No Permitidos

Por seguridad, el sistema valida que:
- ✅ El path sea **absoluto** (no relativo)
- ❌ No se permitan paths relativos como `./workspace` o `../proyectos`
- ❌ No se permitan paths del sistema crítico (`/`, `C:\Windows`, etc.)

### Validación de Acceso

Antes de guardar un workspace, el sistema verifica:
1. El path es absoluto
2. El directorio existe (o puede ser creado)
3. El usuario tiene permisos de lectura/escritura

---

## Troubleshooting

### Error: "El path debe ser absoluto"

**Causa**: Se ingresó un path relativo.

**Solución**:
```bash
# ❌ Incorrecto
./proyectos
~/workspace (en algunos contextos)

# ✅ Correcto
/home/usuario/proyectos
/Users/usuario/workspace
D:\Projects
```

### Error: "Sin permisos de lectura/escritura"

**Causa**: El usuario que ejecuta Hive no tiene permisos en el directorio.

**Solución** (Linux/macOS):
```bash
# Verificar propietario
ls -la /path/to/workspace

# Cambiar propietario
sudo chown -R $USER:$USER /path/to/workspace

# O dar permisos
chmod 755 /path/to/workspace
```

**Solución** (Windows):
```powershell
# Ejecutar como Administrador
icacls "D:\Workspace" /grant %USERNAME%:(OI)(CI)F
```

### Error: "El directorio no existe"

**Causa**: El path especificado no existe.

**Solución**:
1. Usar el botón **"Crear directorio"** en la UI
2. O crear manualmente:
   ```bash
   mkdir -p /path/to/workspace
   ```

### El workspace no se guarda

**Causa posible**: Base de datos no actualizada.

**Solución**:
```bash
# Reiniciar Hive para aplicar migraciones
bun run start

# O en desarrollo
bun run dev
```

### Agente no puede escribir en el workspace

**Verificar**:
1. Permisos del directorio
2. Que el disco no esté lleno
3. Que no haya procesos bloqueando archivos

```bash
# Verificar espacio en disco
df -h /path/to/workspace

# Verificar procesos usando archivos
lsof +D /path/to/workspace
```

---

## Arquitectura Técnica

### Flujo de Validación

```
┌─────────────┐
│   Usuario   │
│  ingresa    │
│    path     │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│  POST /api/workspace │
│     /validate       │
└──────────┬──────────┘
           │
           ▼
    ┌──────────────┐
    │ ¿Es absoluto?│──No──▶ Error: Path debe ser absoluto
    └──────┬───────┘
           │ Sí
           ▼
    ┌──────────────┐
    │  ¿Existe?    │──No──▶ Ofrecer crear directorio
    └──────┬───────┘
           │ Sí
           ▼
    ┌──────────────┐
    │ ¿Permisos R/W?│──No──▶ Error: Sin permisos
    └──────┬───────┘
           │ Sí
           ▼
    ┌──────────────┐
    │   ✅ Válido  │
    └──────────────┘
```

### Almacenamiento en Base de Datos

El workspace se guarda en la tabla `agents`:

```sql
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  workspace       TEXT,  -- ← Campo agregado
  -- ... otros campos
);
```

### Integración con Herramientas

Las herramientas de filesystem usan el workspace configurado:

```typescript
// Ejemplo: tool project_read
async function project_read({ path }: { path: string }) {
  const agent = await getAgent(agentId);
  const workspace = agent.workspace || getDefaultWorkspace();
  const fullPath = path.join(workspace, path);
  return await fs.readFile(fullPath);
}
```

---

## Mejores Prácticas

### 1. Nomenclatura de Workspaces

```bash
# ✅ Descriptivo
~/hive-workspace
~/proyectos/hive
/Volumes/USB/hive-agent

# ❌ Ambiguo
~/tmp
/data
/workspace
```

### 2. Backup

Configura backup automático del workspace:

```bash
# Ejemplo cron para backup diario (Linux/macOS)
0 2 * * * rsync -av /home/usuario/hive-workspace /backup/hive-workspace-$(date +\%Y-\%m-\%d)
```

### 3. Monitoreo

Verifica regularmente el estado del workspace:

```bash
# Script de verificación
#!/bin/bash
WORKSPACE="/path/to/workspace"

if [ ! -d "$WORKSPACE" ]; then
  echo "❌ Workspace no existe"
  exit 1
fi

if [ ! -w "$WORKSPACE" ]; then
  echo "❌ Sin permisos de escritura"
  exit 1
fi

echo "✅ Workspace OK"
```

### 4. Documentación

Mantén un registro de los workspaces configurados:

| Agente | Workspace | Propósito | Fecha Configuración |
|--------|-----------|-----------|---------------------|
| Bee | `~/proyectos/bee` | Asistente personal | 2026-03-09 |
| Analyst | `/data/analysis` | Análisis de datos | 2026-03-09 |

---

## Referencias

- [ARCHITECTURE.md](ARCHITECTURE.md) - Arquitectura general de Hive
- [CONTRIBUTING.md](CONTRIBUTING.md) - Guía de contribución
- [README.md](README.md) - Documentación principal

---

**Última actualización**: Marzo 2026  
**Versión**: Hive 1.1.0+
