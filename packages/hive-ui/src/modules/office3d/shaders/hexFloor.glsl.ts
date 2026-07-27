/** Suelo hexagonal estático y tenue para orientar sin competir con la actividad. */
export const hexFloorVertex = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const hexFloorFragment = /* glsl */ `
  varying vec3 vWorldPos;
  uniform vec3 uColor;

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

    // Una referencia espacial estable, sin barridos ni pulsos.
    float g1 = hexEdge(uv * 0.55);
    float g2 = hexEdge(uv * 2.2);
    float lines = smoothstep(0.065, 0.0, g1) * 0.42 + smoothstep(0.035, 0.0, g2) * 0.035;

    // Fade radial hacia el vacío
    float fade = smoothstep(46.0, 14.0, dist);
    float centerGlow = exp(-dist * 0.11) * 0.12;

    vec3 col = uColor * (lines + centerGlow);
    float alpha = clamp((lines * 0.22 + centerGlow) * fade, 0.0, 0.22);
    gl_FragColor = vec4(col, alpha);
  }
`;
