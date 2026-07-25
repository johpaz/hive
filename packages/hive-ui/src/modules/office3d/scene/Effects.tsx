import { EffectComposer, Bloom, Vignette, ChromaticAberration, Noise } from "@react-three/postprocessing";
import { Vector2 } from "three";
import type { Quality } from "../state/office3dStore";

export function Effects({ quality }: { quality: Quality }) {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.16} luminanceSmoothing={0.28} />
      {quality === "high" ? (
        <ChromaticAberration offset={new Vector2(0.00055, 0.00055)} radialModulation modulationOffset={0.4} />
      ) : (
        <></>
      )}
      <Noise opacity={0.055} />
      <Vignette offset={0.22} darkness={0.74} />
    </EffectComposer>
  );
}
