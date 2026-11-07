# Changelog — 1.1.4

Panel interactivo (A2UI) más fiable: el agente que lo construye deja de publicar superficies vacías o a medio hacer.

## Corregido

- **Superficies A2UI que quedaban vacías.** `a2ui_create_surface` sobre una superficie que ya tenía componentes la reiniciaba a vacío (cliente y caché de reproducción). Un agente que repetía la llamada tras armar el formulario dejaba al usuario un panel en blanco. Ahora responde `status: "exists"` con el número de componentes y no la recrea; para cambiarla indica `a2ui_update_components` (reemplaza por id) o `a2ui_update_data_model`, y para empezar de cero, `a2ui_delete_surface` y luego crear. A propósito no hay un indicador «reemplazar»: ofrecido, el modelo lo usaba de inmediato.
- **Componentes publicados como esqueleto.** Un componente con solo `id` y `component` se publicaba, el panel salía en blanco y el agente daba la tarea por terminada. `a2ui_update_components` ahora comprueba que cada componente traiga lo que necesita para dibujarse (por ejemplo `children` en `Column`/`Row`, `text` en `Text`, `options` en `ChoicePicker`, `url` en `Image`) y, si falta algo, rechaza el lote entero con un error que lista cada componente y la propiedad que le falta. No se publica nada. Los tipos desconocidos no se comprueban (el cliente dibuja un marcador). Entiende tanto la forma plana como la anidada (`{ Card: {...} }`).
- **Esquema de la herramienta.** El esquema de `a2ui_update_components` ahora exige `id` y `component` y admite propiedades adicionales. Antes, un modelo con la salida acotada al esquema solo podía emitir las tres claves declaradas y todos los componentes llegaban vacíos.

## Cambiado

- **El agente de interfaces (A2UI) recibe instrucciones más estrictas:** crear la superficie una sola vez; enviar en una sola llamada todos los componentes completos y después el modelo de datos; y la respuesta de la creación avisa de que la superficie está vacía y de que falta enviar los componentes antes de dar la tarea por terminada.

## Pruebas

- Pruebas nuevas de A2UI (`tests/a2ui-complete.test.ts`) para la detección de componentes incompletos y la protección de superficies existentes.
- Pruebas de compactación e historial de conversación que respaldan la memoria de la 1.1.3.
