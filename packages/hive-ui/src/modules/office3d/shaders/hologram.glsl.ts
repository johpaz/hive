/**
 * Shader holográfico volumétrico: fresnel rim + scanlines + flicker + glitch.
 * Pensado para additive blending (depthWrite off, side double).
 */
export const hologramVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  uniform float uTime;
  uniform float uGlitch;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    vec3 pos = position;
    if (uGlitch > 0.01) {
      float row = floor(position.y * 14.0 + uTime * 18.0);
      float slice = step(0.94, hash(row));
      pos.x += slice * uGlitch * (hash(uTime * 43.0) - 0.5) * 0.45;
      pos.z += slice * uGlitch * (hash(uTime * 71.0) - 0.5) * 0.2;
    }
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize(normalMatrix * normal);
    vViewDir = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const hologramFragment = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uGlitch;
  uniform float uOpacity;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float fresnel = pow(1.0 - abs(dot(n, v)), 2.2);
    float scan = 0.82 + 0.18 * sin(vWorldPos.y * 90.0 - uTime * 6.0);
    float flicker = 0.93 + 0.07 * sin(uTime * 37.0 + vWorldPos.x * 10.0);
    vec3 col = uColor;
    if (uGlitch > 0.01) {
      col = mix(col, vec3(1.0, 0.28, 0.2), uGlitch * 0.65);
      flicker *= 0.75 + 0.25 * step(0.5, fract(uTime * 24.0));
    }
    float alpha = (0.16 + fresnel * 0.95) * scan * flicker * uOpacity;
    vec3 glow = col * (uIntensity * (0.45 + fresnel * 1.7));
    gl_FragColor = vec4(glow, alpha);
  }
`;

export interface HologramUniforms {
  uTime: { value: number };
  uColor: { value: unknown };
  uIntensity: { value: number };
  uGlitch: { value: number };
  uOpacity: { value: number };
}
