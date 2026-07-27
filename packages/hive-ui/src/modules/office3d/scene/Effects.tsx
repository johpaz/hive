import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import type { Quality } from "../state/office3dStore";

export function Effects({ quality }: { quality: Quality }) {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={quality === "high" ? 0.52 : 0.32} luminanceThreshold={0.38} luminanceSmoothing={0.22} />
      <Vignette offset={0.34} darkness={0.38} />
    </EffectComposer>
  );
}
