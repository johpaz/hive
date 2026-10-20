// HeadAudio no publica tipos. Solo se declara lo que usa lipsync.ts.
declare module "@met4citizen/headaudio/dist/headaudio.min.mjs" {
  export class HeadAudio extends AudioWorkletNode {
    constructor(
      context: BaseAudioContext,
      options?: { processorOptions?: object; parameterData?: Record<string, number> },
    );
    onvalue: ((key: string, value: number) => void) | null;
    loadModel(url: string, reset?: boolean): Promise<void>;
    update(dtMs: number): void;
  }
}

declare module "@met4citizen/headaudio/dist/headworklet.min.mjs?url" {
  const url: string;
  export default url;
}

declare module "@met4citizen/headaudio/dist/model-en-mixed.bin?url" {
  const url: string;
  export default url;
}
