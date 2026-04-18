# A2UI v0.9 — Referencia de Implementación en Hive

Protocolo open-source de Google para interfaces declarativas generadas por agentes.
Spec oficial: https://a2ui.org/specification/v0.9-a2ui/

---

## Arquitectura del flujo

```
Agente (LLM)
  │
  │  a2ui_create_surface / a2ui_update_components / a2ui_update_data_model
  ▼
canvasManager (backend)
  │  registra sesión al recibir canvas_subscribe
  │  cachea superficies para replay en reconexión
  ▼
WebSocket → frontend (useWebSocketStore)
  │
  ▼
canvasStore (Zustand)
  │  crea/actualiza a2uiSurfaces Map
  ▼
CanvasContainer → Tab "A2UI"
  │
  ▼
A2UIRenderer → árbol de componentes
```

### Eventos de retorno (interacciones del usuario)

```
Usuario interactúa (click, selección, Enter, blur)
  ▼
Componente A2UI dispara ctx.onAction(name, context, componentId)
  ▼
canvasStore.sendA2UIAction → WebSocket → gateway
  ▼
handler "a2ui:action" en server.ts
  ▼
runner.generate() → agente recibe el turno como:
  [a2ui:action] surface=X action=Y component=Z context={...}
  ▼
Agente responde con a2ui_update_data_model / a2ui_update_components
```

---

## Mensajes del protocolo (servidor → cliente)

Todos se envían como `{ type: "a2ui:<tipo>", data: { ... } }` via WebSocket.

### a2ui:createSurface
```json
{
  "type": "a2ui:createSurface",
  "data": {
    "surfaceId": "mi_superficie",
    "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json",
    "theme": {
      "primaryColor": "#3B82F6",
      "agentDisplayName": "Mi Agente",
      "iconUrl": "https://..."
    },
    "sendDataModel": false
  }
}
```

### a2ui:updateComponents
```json
{
  "type": "a2ui:updateComponents",
  "data": {
    "surfaceId": "mi_superficie",
    "components": [ /* flat list */ ]
  }
}
```

### a2ui:updateDataModel
```json
{
  "type": "a2ui:updateDataModel",
  "data": {
    "surfaceId": "mi_superficie",
    "path": "/user/name",
    "value": "John"
  }
}
```
Si `path` se omite o es `"/"`, reemplaza todo el modelo.

### a2ui:deleteSurface
```json
{
  "type": "a2ui:deleteSurface",
  "data": { "surfaceId": "mi_superficie" }
}
```

---

## Estructura de componentes (adjacency list)

Los componentes se envían como **lista plana** con referencias por ID. El renderer reconstruye el árbol en el cliente.

```json
[
  { "id": "root", "component": "Column", "children": { "explicitList": ["header", "body"] } },
  { "id": "header", "component": "Text", "text": "Hola", "usageHint": "h1" },
  { "id": "body", "component": "Card", "child": "content" },
  { "id": "content", "component": "Text", "text": { "path": "/user/name" } }
]
```

### Reglas de la lista

- **`id: "root"`** es el punto de entrada del renderer. Si no existe, se auto-detecta el componente que no es hijo de ningún otro.
- Cada componente tiene `id` único y `component` (nombre del tipo).
- Los tipos de componente son **case-sensitive** y solo ASCII (el renderer limpia caracteres extra que el LLM pueda agregar).

### Formatos de `children`

| Formato | Spec | Descripción |
|---------|------|-------------|
| `{ "explicitList": ["id1", "id2"] }` | v0.9 oficial | Lista estática de hijos |
| `{ "array": ["id1", "id2"] }` | legacy Hive | Equivalente, soportado |
| `{ "template": { "dataBinding": "/items", "componentId": "item_tmpl" } }` | v0.9 oficial | Itera sobre array del data model |
| `{ "path": "/items", "componentId": "item_tmpl" }` | legacy Hive | Equivalente, soportado |
| `"hijo_id"` | ambos | String directo = único hijo |
| `["id1", "id2"]` | fallback | Array crudo, soportado |

---

## Data Binding

Las propiedades dinámicas aceptan tres formatos:

```json
"text": "Valor literal"
"text": { "path": "/user/name" }
"text": { "call": "formatDate", "args": { "value": { "path": "/date" }, "format": "dd/MM/yyyy" } }
```

Los paths usan **JSON Pointer** (RFC 6901): `/segmento/subsegmento`.

### Two-way binding (inputs)

`TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput` actualizan el data model local en tiempo real usando el path especificado en `value` o `selections`.

---

## Componentes disponibles

### Layout

| Componente | Props clave | Notas |
|------------|-------------|-------|
| `Column` | `children`, `distribution`, `alignment`, `weight` | Flex vertical |
| `Row` | `children`, `distribution`, `alignment`, `weight` | Flex horizontal |
| `Card` | `child`, `weight` | Un único hijo |
| `List` | `children` (template), `weight` | Ideal para arrays |
| `Tabs` | `tabItems: [{title, child}]`, `weight` | Navegación por pestañas |
| `Modal` | `entryPointChild`, `contentChild` | Dialog overlay |
| `Divider` | `axis` (`horizontal`/`vertical`) | Separador |

### Display

| Componente | Props clave | Notas |
|------------|-------------|-------|
| `Text` | `text`, `usageHint` | usageHint: `h1`–`h5`, `body`, `caption`, `code` |
| `Image` | `url`, `fit`, `alt`, `width`, `height` | |
| `Icon` | `name` | Ver catálogo de iconos |
| `Video` | `src`, `width`, `height` | |
| `AudioPlayer` | `src` | |

### Inputs interactivos

| Componente | Props clave | Cuándo dispara acción |
|------------|-------------|----------------------|
| `Button` | `child`/`text`, `variant`, `action`, `checks` | Al hacer click |
| `TextField` | `label`, `value`, `textFieldType`, `checks`, `action` | Al perder foco o presionar Enter |
| `CheckBox` | `label`, `value` | Al cambiar estado |
| `ChoicePicker` | `options`, `selections`, `variant`, `maxAllowedSelections`, `action` | Al seleccionar/deseleccionar |
| `Slider` | `value`, `minValue`, `maxValue`, `step`, `action` | Al soltar el slider |
| `DateTimeInput` | `value`, `enableDate`, `enableTime` | Al cambiar valor |

#### Variantes de Button
- `"primary"` — sólido azul
- `"secondary"` — fondo sutil
- `"borderless"` — sin borde

#### Variantes de TextField
- `"shortText"` — input de línea
- `"longText"` — textarea
- `"number"` — numérico
- `"obscured"` — password
- `"code"` — monospace

#### Variantes de ChoicePicker
- `"mutuallyExclusive"` — selección única (radio)
- omitir — selección múltiple (checkbox)

---

## Acciones

Las acciones conectan la interacción del usuario con el agente.

### Formato en el componente

```json
"action": {
  "event": {
    "name": "submit_form",
    "context": {
      "email": { "path": "/form/email" },
      "nombre": { "path": "/form/name" }
    }
  }
}
```

**El renderer también acepta** el formato compacto (sin wrapper `event`):
```json
"action": {
  "name": "submit_form",
  "context": { "email": { "path": "/form/email" } }
}
```

### Qué recibe el agente

El gateway reenvía la acción al agente como nuevo turno:
```
[a2ui:action] surface=booking_form action=submit_form component=submit_btn context={"email":"john@example.com","nombre":"John"}
```

El agente procesa este mensaje y puede responder con `a2ui_update_data_model`, `a2ui_update_components`, o texto de respuesta.

---

## Validación (checks)

Para `TextField` y `Button` (deshabilitar si inválido):

```json
"checks": [
  { "call": "required", "args": { "value": { "path": "/form/email" } }, "message": "Campo obligatorio" },
  { "call": "email",    "args": { "value": { "path": "/form/email" } }, "message": "Email inválido" },
  { "call": "regex",    "args": { "value": { "path": "/form/phone" }, "pattern": "^\\d{10}$" }, "message": "10 dígitos" },
  { "call": "length",   "args": { "value": { "path": "/form/bio" }, "min": 10, "max": 500 }, "message": "Entre 10 y 500 caracteres" }
]
```

---

## Sesiones y reconexión

- El frontend envía `canvas_subscribe` al abrir el tab Canvas.
- El backend llama `canvasManager.registerSession("canvas:{userId}", ws)`.
- El `canvasManager` cachea todas las superficies A2UI activas.
- Al reconectar, se hace **replay automático** de las superficies cacheadas.
- El heartbeat del `canvasManager` envía `canvas:ping` cada 30s para mantener la conexión viva.

---

## UI: Tab A2UI en el Canvas

Las superficies A2UI se muestran en el tab **"A2UI"** del Canvas, separado del tab "Sistema" (grafo de agentes y componentes shadcn).

- El tab muestra un badge con el número de superficies activas.
- **Auto-switch**: el canvas cambia automáticamente al tab A2UI cuando el agente crea una nueva superficie.
- El color del borde de cada superficie refleja el `primaryColor` del tema.
- El tab "Sistema" queda limpio: solo agentes, MCP y componentes canvas clásicos.

---

## Ejemplo completo: Formulario con respuesta del agente

```json
// 1. Crear superficie
a2ui_create_surface(
  surfaceId: "reserva_form",
  catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
  theme: { primaryColor: "#8B5CF6", agentDisplayName: "Asistente de Reservas" }
)

// 2. Enviar componentes
a2ui_update_components(surfaceId: "reserva_form", components: [
  { "id": "root", "component": "Column", "children": { "explicitList": ["title", "service_picker", "date_field", "submit_btn"] } },
  { "id": "title", "component": "Text", "text": "Nueva Reserva", "usageHint": "h2" },
  { "id": "service_picker", "component": "ChoicePicker",
    "variant": "mutuallyExclusive",
    "selections": { "path": "/form/service" },
    "options": [
      { "label": "Consulta General", "value": "general" },
      { "label": "Especialista", "value": "specialist" }
    ],
    "action": { "name": "service_selected", "context": { "service": { "path": "/form/service" } } }
  },
  { "id": "date_field", "component": "DateTimeInput", "value": { "path": "/form/date" }, "enableDate": true, "enableTime": false },
  { "id": "submit_label", "component": "Text", "text": "Confirmar Reserva" },
  { "id": "submit_btn", "component": "Button", "child": "submit_label", "variant": "primary",
    "action": { "name": "confirm_booking", "context": { "service": { "path": "/form/service" }, "date": { "path": "/form/date" } } }
  }
])

// 3. Inicializar data model
a2ui_update_data_model(surfaceId: "reserva_form", path: "/form", value: { service: "", date: "" })

// 4. [Usuario selecciona servicio → agente recibe a2ui:action → responde]
// 5. [Usuario hace click en Confirmar → agente recibe a2ui:action → procesa reserva]
// 6. Limpiar
a2ui_delete_surface(surfaceId: "reserva_form")
```

---

## Herramientas del agente

| Tool | Parámetros obligatorios | Descripción |
|------|------------------------|-------------|
| `a2ui_create_surface` | `surfaceId`, `catalogId` | Crea la superficie y la registra en el canvas |
| `a2ui_update_components` | `surfaceId`, `components[]` | Envía/actualiza el árbol de componentes |
| `a2ui_update_data_model` | `surfaceId` | Actualiza datos (con `path` y `value`) |
| `a2ui_delete_surface` | `surfaceId` | Elimina la superficie del canvas |

El `sessionId` se auto-resuelve del contexto del usuario si no se especifica.

---

## Errores comunes

| Síntoma | Causa | Solución |
|---------|-------|----------|
| Superficie aparece vacía ("Sin contenido") | No hay componente `id:"root"` o no es hijo raíz | El renderer auto-detecta el root, pero conviene usar `id:"root"` explícito |
| Superficie no aparece | Canvas no estaba abierto cuando el agente envió los mensajes | Se hace replay automático al abrir el canvas |
| "Unknown component: Text项" | LLM agrega caracteres chinos al tipo | El renderer los limpia automáticamente |
| Botón no dispara acción | `action.name` faltante | Usar `action: { name: "...", context: {...} }` o `action: { event: { name: "...", context: {...} } }` |
| ChoicePicker no hace two-way binding | Se usa `value` en lugar de `selections` | Usar `selections: { path: "/ruta" }` para binding de selecciones |
