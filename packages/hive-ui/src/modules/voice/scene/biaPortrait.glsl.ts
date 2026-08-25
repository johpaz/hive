/**
 * Shaders del retrato de BIA.
 *
 * Dos cosas a la vez:
 *
 * 1. VOLUMEN — la foto se proyecta sobre una malla subdividida cuyo relieve se
 *    calcula por regiones: el rostro y las manos sobresalen, las alas quedan
 *    detrás y el fondo al fondo. Con la cámara moviéndose, eso da paralaje real
 *    en lugar de una lámina plana.
 *
 * 2. GESTO — la boca, las manos y las alas se animan deformando las UV según el
 *    audio. No hay geometría facial: cada gesto es un desplazamiento local de
 *    la textura.
 *
 * Las coordenadas salen de medir la imagen real (1024×1536), no de estimarlas:
 * un centro de boca desviado 20 px deforma el mentón en vez de los labios.
 *
 *   ojo izquierdo  (471, 375)      boca   (510, 458)
 *   ojo derecho    (552, 375)      núcleo (512, 672)
 *   mano izquierda (113, 1140)     mano derecha (907, 1140)
 *   alas           (300, 510) y (724, 510)
 *
 * En UV: u = x/1024, v = 1 − y/1536.
 */

/** Compartido por los dos shaders: las regiones tienen que coincidir. */
const REGIONES = /* glsl */ `
  const vec2 OJO_L   = vec2(0.460, 0.7559);
  const vec2 OJO_R   = vec2(0.539, 0.7559);
  const vec2 BOCA    = vec2(0.498, 0.7018);
  const vec2 NUCLEO  = vec2(0.500, 0.5625);
  const vec2 MANO_L  = vec2(0.110, 0.2578);
  const vec2 MANO_R  = vec2(0.886, 0.2578);
  const vec2 ALA_L   = vec2(0.293, 0.6680);
  const vec2 ALA_R   = vec2(0.707, 0.6680);
  const vec2 CABEZA  = vec2(0.500, 0.7450);
  const vec2 TORSO   = vec2(0.500, 0.4900);

  /** Campana elíptica: 1 en el centro de la región, 0 fuera. */
  float campana(vec2 uv, vec2 centro, vec2 radio) {
    vec2 d = (uv - centro) / radio;
    return exp(-dot(d, d) * 2.0);
  }
`;

export const PORTRAIT_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;

  uniform float uRelieve;

  ${REGIONES}

  void main() {
    vUv = uv;

    // Relieve por regiones. Es un bajorrelieve, no una malla escaneada: alcanza
    // para que al mover la cámara el rostro se despegue del fondo.
    float z = 0.0;
    z += campana(uv, CABEZA, vec2(0.085, 0.075)) * 1.00;   // rostro, lo más cerca
    z += campana(uv, TORSO,  vec2(0.150, 0.170)) * 0.75;   // cuerpo
    z += campana(uv, MANO_L, vec2(0.080, 0.055)) * 1.15;   // manos, adelantadas
    z += campana(uv, MANO_R, vec2(0.080, 0.055)) * 1.15;
    z -= campana(uv, ALA_L,  vec2(0.130, 0.095)) * 0.45;   // alas, detrás
    z -= campana(uv, ALA_R,  vec2(0.130, 0.095)) * 0.45;

    vDepth = z;

    vec3 p = position;
    p.z += z * uRelieve;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const PORTRAIT_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uMap;
  /** Nivel de voz de BIA (0–1): abre la boca y enciende el núcleo. */
  uniform float uVoice;
  /** Nivel del micrófono: la hace "escuchar" — ojos y leve inclinación. */
  uniform float uMic;
  /** 0 abierto, 1 cerrado. */
  uniform float uBlink;
  /** Trabajo de la colmena en curso. */
  uniform float uWork;
  uniform float uTime;
  /** Aparición de la sesión (0 en reposo, 1 en llamada). */
  uniform float uLive;
  /** Tinte del estado actual, para los acentos luminosos. */
  uniform vec3 uAccent;

  varying vec2 vUv;
  varying float vDepth;

  ${REGIONES}

  /** Gira las UV alrededor de un pivote (para el gesto de las manos). */
  vec2 girar(vec2 uv, vec2 pivote, float ang) {
    vec2 p = uv - pivote;
    float s = sin(ang), c = cos(ang);
    return pivote + vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  void main() {
    vec2 uv = vUv;

    // ── Boca ────────────────────────────────────────────────────────────────
    // La apertura se dibuja con SOMBRA, no estirando la piel.
    //
    // El primer intento desplazaba el labio inferior 0.030 de UV y con la voz
    // alta convertía la boca en un embudo de carne (comprobado renderizando el
    // remapeo fuera del navegador). Una foto no contiene la cavidad de la boca,
    // así que ningún desplazamiento puede inventarla: lo único que hace es
    // estirar la piel que ya está ahí.
    //
    // Con una sombra que se abre desde la línea de los labios más un
    // desplazamiento casi imperceptible, la boca se lee abierta y la anatomía
    // queda intacta. Es el techo de lo que permite una imagen fija.
    float apertura = uVoice * uLive;
    float boca = campana(uv, BOCA, vec2(0.045, 0.020));
    float mitadInferior = clamp((BOCA.y + 0.004 - uv.y) / 0.022, 0.0, 1.0);
    uv.y += boca * mitadInferior * apertura * 0.008;

    // ── Manos ───────────────────────────────────────────────────────────────
    // Se mueven SIEMPRE, no sólo al hablar: unas manos congeladas delatan al
    // instante que es una foto. En reposo respiran; al hablar, gesticulan.
    // Cada una con su periodo y su fase para que no parezcan un espejo.
    // Radio y amplitud calibrados renderizando el remapeo fuera del navegador:
    // con 0.16 y radio 0.095 las muñecas se estiraban de forma antinatural,
    // porque la campana abarcaba medio antebrazo.
    float manoL = campana(uv, MANO_L, vec2(0.070, 0.052));
    float manoR = campana(uv, MANO_R, vec2(0.070, 0.052));
    float gesto = 0.34 + (uVoice * 1.5 + uMic * 0.35 + uWork * 0.3) * uLive;

    float swingL = (sin(uTime * 0.9) * 0.6 + sin(uTime * 1.7 + 0.8) * 0.4) * gesto;
    float swingR = (sin(uTime * 0.78 + 2.1) * 0.6 + sin(uTime * 1.45 + 3.4) * 0.4) * gesto;

    uv = girar(uv, MANO_L, swingL * 0.085 * manoL);
    uv = girar(uv, MANO_R, -swingR * 0.085 * manoR);
    uv.y += (manoL * swingL + manoR * swingR) * 0.014;
    uv.x += (manoL * swingL - manoR * swingR) * 0.006;

    // ── Alas ────────────────────────────────────────────────────────────────
    // Vibración rápida y de poca amplitud: una abeja, no un pájaro.
    float alas = campana(uv, ALA_L, vec2(0.14, 0.10)) + campana(uv, ALA_R, vec2(0.14, 0.10));
    float aleteo = sin(uTime * 14.0) * (0.25 + uVoice * 0.8) * uLive;
    uv.x += alas * aleteo * 0.004;

    // ── Respiración ─────────────────────────────────────────────────────────
    uv.y += sin(uTime * 0.85) * 0.0016 * (0.5 + uLive * 0.5);

    vec4 color = texture2D(uMap, uv);

    // ── Volumen ─────────────────────────────────────────────────────────────
    // Lo que sobresale recibe algo más de luz. Sin esto el relieve se nota al
    // mover la cámara pero la imagen sigue leyéndose plana.
    color.rgb *= 1.0 + clamp(vDepth, 0.0, 1.2) * 0.16;

    // ── Ojos ────────────────────────────────────────────────────────────────
    // El parpadeo oscurece la zona del ojo en vez de deformar la textura.
    // Colapsar las UV hacia la línea de las pestañas hacía que los ojos
    // "saltaran": la imagen se desplazaba de golpe en lugar de cerrarse.
    float ojos = campana(vUv, OJO_L, vec2(0.030, 0.015)) + campana(vUv, OJO_R, vec2(0.030, 0.015));
    ojos = clamp(ojos, 0.0, 1.0);
    color.rgb *= 1.0 - ojos * uBlink * 0.82;

    // ── Acentos luminosos ───────────────────────────────────────────────────
    // Ojos y núcleo del pecho responden a la voz. Es aditivo sobre lo que ya
    // brilla en la foto, así que refuerza el original en vez de repintarlo.
    float brilloOjos = campana(vUv, OJO_L, vec2(0.026, 0.013)) + campana(vUv, OJO_R, vec2(0.026, 0.013));
    color.rgb += uAccent * brilloOjos * (0.10 + uMic * 0.55 + uVoice * 0.25) * uLive * (1.0 - uBlink);

    float nucleo = campana(vUv, NUCLEO, vec2(0.055, 0.035));
    float latido = 0.35 + uVoice * 1.1 + sin(uTime * 2.2) * 0.08 * uWork;
    color.rgb += uAccent * nucleo * latido * uLive;

    // Sombra de apertura: la elipse crece hacia abajo desde la línea de los
    // labios conforme sube la voz. Es lo que realmente da la sensación de boca
    // abierta; el desplazamiento de arriba sólo la acompaña.
    float altoBoca = 0.006 + apertura * 0.013;
    float interior = campana(vUv, vec2(BOCA.x, BOCA.y - altoBoca * 0.45), vec2(0.028, altoBoca));
    color.rgb *= 1.0 - clamp(interior, 0.0, 1.0) * apertura * 0.72;

    // ── Fundido con la escena ───────────────────────────────────────────────
    // La imagen trae su propio fondo; los bordes se desvanecen para que empalme
    // con el panal 3D en vez de recortarse como una lámina pegada encima.
    vec2 d = (vUv - 0.5) * vec2(2.1, 1.9);
    color.a *= 1.0 - smoothstep(0.62, 1.0, length(d));

    gl_FragColor = color;
  }
`;
