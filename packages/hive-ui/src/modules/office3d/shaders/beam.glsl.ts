/**
 * Beam de delegación: flujo energético animado a lo largo de un tubo (uv.x = longitud).
 */
export const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const beamFragment = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uIntensity;

  void main() {
    // uv.y recorre la longitud del cilindro (delegante → worker)
    float flow = fract(vUv.y * 3.0 - uTime * uSpeed);
    float packet = smoothstep(0.0, 0.12, flow) * smoothstep(0.42, 0.12, flow);
    float flow2 = fract(vUv.y * 7.0 - uTime * uSpeed * 1.7);
    float packet2 = smoothstep(0.0, 0.06, flow2) * smoothstep(0.2, 0.06, flow2);

    float core = 0.3 + packet * 1.6 + packet2 * 0.9;
    float ends = smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
    float glow = core * uIntensity;
    gl_FragColor = vec4(uColor * glow, clamp(glow * 0.6 * ends, 0.0, 1.0));
  }
`;
