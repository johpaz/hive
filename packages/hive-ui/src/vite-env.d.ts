/// <reference types="vite/client" />

/**
 * Modelos glTF binarios como URL.
 *
 * `vite/client` ya los declara, pero el typecheck de la raíz —el que corre el
 * CI— no resuelve esos tipos y fallaba con "Cannot find module '@/assets/bia.glb'".
 */
declare module "*.glb" {
  const src: string;
  export default src;
}
