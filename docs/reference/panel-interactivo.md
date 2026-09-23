# Panel interactivo

El Panel interactivo es la superficie donde los agentes presentan resultados,
formularios, dashboards, confirmaciones y flujos de varios pasos. Internamente
utiliza el protocolo A2UI v0.9.

Se abre desde `/a2ui`. No es una segunda oficina ni un editor libre: cada
contenido pertenece a una superficie creada por un agente. La observación del
enjambre vive exclusivamente en `/office`.

## Flujo de una superficie

El orden normal de las herramientas es:

1. `a2ui_create_surface`
2. `a2ui_update_components`
3. `a2ui_update_data_model`
4. `a2ui_delete_surface`

`a2ui_delete_surface` sólo se usa cuando la superficie deja de ser útil. Los
componentes y el modelo pueden actualizarse varias veces mientras la superficie
permanece activa.

Cada superficie necesita:

- un `surfaceId` estable dentro de la sesión;
- el catálogo A2UI v0.9;
- IDs de componente únicos;
- un componente raíz con ID `root`;
- una lista plana de componentes, enlazados por referencias;
- paths JSON Pointer para enlazar valores dinámicos al data model.

Las referencias deben formar un árbol: un componente no puede contenerse a sí
mismo ni contener a uno de sus ancestros (por ejemplo, una `Card` con
`"child": "<su propio id>"`). `a2ui_update_components` revisa el árbol completo
—lo ya publicado más la actualización— y, si encuentra un ciclo, no publica
nada y devuelve un error con la cadena que lo forma para que el agente lo
corrija. Si aun así llega un ciclo al navegador, el panel lo dibuja una sola
vez y muestra en su lugar «Componente "…" omitido: se contiene a sí mismo».
Antes un ciclo congelaba la pestaña hasta que el navegador la cerraba.

## Sesión, replay y acciones

Hive conserva en memoria la creación, los componentes y el data model vigente
de cada superficie. Las actualizaciones de componentes se combinan por ID, igual
que en el navegador, así que el replay reproduce la misma superficie que se
estaba viendo. Cuando el navegador se conecta después de iniciada una tarea,
recibe el snapshot actual. Eliminar una superficie también la elimina del
replay. Ese estado vive solo en la memoria del gateway: al reiniciarlo, las
superficies desaparecen.

Las acciones de botones, campos y selectores regresan por WebSocket al
coordinador con su `surfaceId`, nombre y contexto. El coordinador decide cómo
continuar la tarea o delegarla; el agente constructor de A2UI no debe asumir por
sí solo una aprobación del usuario.

Cada acción se convierte en un turno del coordinador en la misma conversación.
Si el coordinador todavía está trabajando (por ejemplo, resumiendo una ronda de
especialistas), la acción espera su turno en la cola en lugar de ejecutarse en
paralelo. Un botón que pide repetir una tarea completa la repite una sola vez,
con todos sus efectos: si esa tarea envía correos o crea archivos, volverá a
hacerlo.

Para operaciones destructivas, el agente debe obtener una confirmación
explícita en el Panel interactivo antes de ejecutar la herramienta que produce
el cambio.

## Responsabilidades

| Superficie | Propósito | Ruta |
|---|---|---|
| Panel interactivo | Resultados, formularios, dashboards, confirmaciones y flujos generados por agentes | `/a2ui` |
| Oficina 3D | Estado del enjambre, delegaciones y herramientas en ejecución | `/office` |

No existe una ruta de producto `/canvas`. Algunos nombres internos del
transporte WebSocket conservan `canvas` por compatibilidad, pero no representan
una capacidad ni una pantalla disponible para el usuario.

## Capacidades retiradas

El agente `canvas_presenter`, las skills `canvas_report`, `canvas_dashboard` y
`canvas_interact`, y las herramientas `canvas_*` clásicas fueron retirados. El
arranque elimina del catálogo las copias sembradas por versiones anteriores.
Las integraciones nuevas deben usar exclusivamente las cuatro herramientas
`a2ui_*`.

## Prueba manual

Con el gateway y la UI activos:

```bash
bun scripts/a2ui-test.ts
```

El script solicita un formulario de ejemplo y permite comprobar creación,
actualización del modelo y replay en el Panel interactivo.
