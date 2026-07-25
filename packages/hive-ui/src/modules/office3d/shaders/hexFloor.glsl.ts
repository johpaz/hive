/**
 * Suelo de rejilla hexagonal holográfica con pulsos radiales de actividad.
 * uPulses: hasta 8 emisores (xz = posición, z = fase, w = intensidad).
 */
export const hexFloorVertex = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const hexFloorFragment = /* glsl */ `
  #define MAX_PULSES 8
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec4 uPulses[MAX_PULSES];

  // Distancia a aristas de un tiling hexagonal (pointy-top).
  float hexEdge(vec2 p) {
    p.x *= 0.57735 * 2.0;
    p.y += mod(floor(p.x), 2.0) * 0.5;
    p = abs(fract(p) - 0.5);
    return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
  }

  void main() {
    vec2 uv = vWorldPos.xz;
    float dist = length(uv);

    // Rejilla hexagonal base (dos escalas para profundidad)
    float g1 = hexEdge(uv * 0.55);
    float g2 = hexEdge(uv * 2.2);
    float lines = smoothstep(0.08, 0.0, g1) * 0.9 + smoothstep(0.05, 0.0, g2) * 0.12;

    // Pulsos radiales desde agentes activos
    float pulse = 0.0;
    for (int i = 0; i < MAX_PULSES; i++) {
      vec4 pl = uPulses[i];
      if (pl.w < 0.01) continue;
      float d = distance(uv, pl.xy);
      float wave = fract(d * 0.08 - uTime * 0.45 + pl.z);
      pulse += smoothstep(0.18, 0.0, abs(wave - 0.5) - 0.02) * pl.w * exp(-d * 0.045);
      pulse += exp(-d * 0.5) * 0.35 * pl.w; // halo local
    }

    // Onda de barrido global lenta desde el núcleo
    float sweep = fract(dist * 0.02 - uTime * 0.06);
    float ring = smoothstep(0.03, 0.0, abs(sweep - 0.5) - 0.005) * 0.35;

    // Fade radial hacia el vacío
    float fade = smoothstep(46.0, 14.0, dist);
    float centerGlow = exp(-dist * 0.09) * 0.5;

    vec3 col = uColor * (lines * 0.5 + pulse * 1.6 + ring + centerGlow);
    float alpha = clamp((lines * 0.35 + pulse + ring + centerGlow) * fade, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha * 0.85);
  }
`;

export const MAX_FLOOR_PULSES = 8;
