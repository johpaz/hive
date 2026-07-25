/**
 * Campo de partículas ambientales ("polen de datos") y estallidos de actividad.
 */
export const pointsVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vSeed;
  varying float vFade;

  void main() {
    vSeed = aSeed;
    vec3 pos = position;
    float t = uTime * (0.08 + aSeed * 0.12);
    // Deriva orgánica
    pos.x += sin(uTime * 0.25 + aSeed * 40.0) * 1.6;
    pos.z += cos(uTime * 0.2 + aSeed * 31.0) * 1.6;
    // Ascenso envolvente (polen que sube y reaparece abajo)
    pos.y = mod(position.y + t * 6.0, 22.0);
    vFade = smoothstep(0.0, 3.0, pos.y) * smoothstep(22.0, 16.0, pos.y);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (1.4 + aSeed * 2.4) * uPixelRatio * (28.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

export const pointsFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vSeed;
  varying float vFade;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float disc = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(uColor * (0.6 + vSeed * 0.8), disc * uOpacity * vFade);
  }
`;

export const burstVertex = /* glsl */ `
  attribute vec3 aVel;
  attribute float aSeed;
  uniform float uTime;
  uniform float uStart;
  uniform float uPixelRatio;
  varying float vLife;

  void main() {
    float t = clamp((uTime - uStart) / 1.4, 0.0, 1.0);
    vLife = 1.0 - t;
    vec3 pos = aVel * (t * 3.2 - t * t * 1.1); // desaceleración
    pos.y += t * 1.2;                          // ligera ascensión
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = (2.2 + aSeed * 2.0) * vLife * uPixelRatio * (30.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

export const burstFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float disc = smoothstep(0.5, 0.05, length(c));
    gl_FragColor = vec4(uColor * (0.8 + vLife), disc * vLife);
  }
`;
