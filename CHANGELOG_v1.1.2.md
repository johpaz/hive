# Changelog — Hive 1.1.2

Fecha: 2026-10-20

Hive 1.1.2 da vida a BIA, el avatar 3D del módulo de voz (`/voz`): ahora mueve la boca al ritmo de lo que dice, parpadea, respira, gesticula con las manos y se puede desplazar por la escena.

## Añadido

- **Sincronía labial (lipsync) en el navegador.** La boca de BIA sigue la voz con visemas reconocidos del propio audio, mediante [HeadAudio](https://github.com/met4citizen/headaudio) 0.1.0 (MIT), un AudioWorklet con ~50 ms de latencia que no necesita servidor.
  - Si el worklet no carga, BIA vuelve a abrir la mandíbula según la amplitud del audio. El enrutamiento del audio no cambia.
- **Modelo 3D con boca y morphs nuevos.** `bia.glb` pasa de 2 a 26 morph targets: 15 visemas, mandíbula (`jaw_open`), sonrisa, parpadeo por ojo (`blink_L`/`blink_R`) y cuatro controles por mano (giro, cierre y separación de dedos, giro de antebrazo).
  - La boca se abrió en la malla original y se añadieron cavidad, lengua y dientes. El archivo original se conserva en `bia.original.glb`.
- **Capa de vida procedural.** Parpadeo con cierre rápido y apertura lenta (con dobles ocasionales), respiración asimétrica y balanceo con ruido aperiódico, para que no se lea como un bucle.
- **Gestos de las manos por estado.** Hablar (las dos manos, una sola, palmas abiertas o contando, con un golpe de énfasis en los picos de la voz), escuchar, pensar y celebrar. Las manos suben y bajan con suavizado exponencial y topes que evitan deformar los dedos.
- **Mover a BIA por la escena.** El botón izquierdo desplaza, el derecho gira y la rueda acerca; en pantallas táctiles, un dedo desplaza y dos acercan y giran. El encuadre no deja que BIA salga del foco. Un doble clic la recentra.
- **Panel de flechas** (`ScenePad`) para desplazar y acercar sin ratón; mantenerlo pulsado repite el movimiento.

## Cambiado

- BIA ya no se agranda y se encoge con el volumen de la voz: ese pulso se leía como un visualizador de audio.
- Los gestos de las manos reemplazan el vaivén que seguía la amplitud y era igual en todos los estados.
- Los dedos en reposo quedan algo separados, porque la malla original los trae pegados por la base.

## Corregido

- **Imagen pixelada y bordes dentados.** El compositor de postproceso tenía el antialiasing en 0; ahora usa MSAA 4×. Con la animación reducida, el canvas activa su propio antialias.
- **Texturas borrosas en ángulo**: se activó el filtrado anisotrópico (hasta 8×).
- **Dedos deformados al gesticular.** Los morphs se mezclan en línea recta y, combinados, aplastaban los dedos sobre la palma. Ahora se limitan (`dedos` ≤ 0.3, `abre` ≤ 0.5, `muneca` ≤ 0.15) y el ademán grande lo lleva el giro de la mano.

## Notas

- El GLB de BIA pesa 3,75 MB, y es el archivo más grande del build. La textura base sigue en 1024 px para todo el cuerpo, así que la cara se ve algo suave de cerca. Comprimir la malla (Draco o meshopt) y subir la textura a 2048 px quedan pendientes.
- El chunk de la escena 3D (`Vignette-*.js`, 942 kB) supera el aviso de 500 kB del build. Es el bundle de three, R3F, drei y postprocessing, y solo se carga al entrar a `/voz` y a la Oficina 3D.
- No se pudo verificar la escena en vivo con un visor headless: la comprobación visual se hizo en Blender y con capturas de la app.
