import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ChannelDoc, ModelDoc } from "../packages/core/src/storage/collections";
import { voiceService } from "../packages/core/src/voice/index";

const realFetch = globalThis.fetch;

type Captured = { url: string; model: string | null; body: Record<string, unknown> | null };

/** Intercepta las llamadas a Groq y devuelve audio/texto de mentira, sin salir a la red. */
function stubGroq(): { last: () => Captured | null } {
  let captured: Captured | null = null;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    if (!url.includes("api.groq.com")) return realFetch(input, init);

    if (url.includes("/audio/transcriptions")) {
      const form = init?.body as FormData;
      captured = { url, model: form?.get("model") as string, body: null };
      return new Response(JSON.stringify({ text: "hola" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    captured = { url, model: body.model as string, body };
    return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer, {
      headers: { "Content-Type": "audio/wav" },
    });
  }) as typeof fetch;
  return { last: () => captured };
}

const AUDIO = {
  type: "base64" as const,
  data: Buffer.from("audio").toString("base64"),
  mimeType: "audio/ogg",
};

describe("voz con Groq", () => {
  beforeEach(async () => {
    await ensureHiveDb();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.GROQ_API_KEY;
  });

  describe("prefijo de revendedor", () => {
    it("STT manda el id del cable, no la clave prefijada del catálogo", async () => {
      // groq está en RESELLER_PROVIDERS, así que su fila de catálogo se llama
      // `groq/whisper-large-v3-turbo` y ese es el id que el selector del canal
      // guarda en stt_provider. Mandar el prefijo al cable hacía que la API
      // contestara 400 para cualquier whisper de Groq, no sólo el deprecado.
      const groq = stubGroq();
      const text = await voiceService.transcribe(AUDIO, "groq/whisper-large-v3-turbo");

      expect(groq.last()?.model).toBe("whisper-large-v3-turbo");
      expect(text).toBe("hola");
    });

    it("TTS manda el id del cable, con el namespace del dueño intacto", async () => {
      // Ojo con este: el id lleva DOS niveles. `groq/` es el prefijo de
      // revendedor y se saca; `canopylabs/` es el namespace del dueño del modelo
      // y tiene que llegar entero.
      const groq = stubGroq();
      await voiceService.speak("hola", "groq/canopylabs/orpheus-v1-english");

      expect(groq.last()?.model).toBe("canopylabs/orpheus-v1-english");
    });
  });

  describe("TTS Orpheus", () => {
    it("pide wav, el único formato que Orpheus acepta", async () => {
      const groq = stubGroq();
      const audio = await voiceService.speak("hola", "groq/canopylabs/orpheus-v1-english");

      expect(groq.last()?.body?.response_format).toBe("wav");
      expect(audio.mimeType).toBe("audio/wav");
    });

    it("elige una voz por defecto acorde al idioma del modelo", async () => {
      const groq = stubGroq();
      await voiceService.speak("hola", "groq/canopylabs/orpheus-v1-english");
      expect(groq.last()?.body?.voice).toBe("troy");

      await voiceService.speak("مرحبا", "groq/canopylabs/orpheus-arabic-saudi");
      expect(groq.last()?.body?.voice).toBe("abdullah");
    });

    it("respeta la voz elegida en el canal", async () => {
      const groq = stubGroq();
      await voiceService.speak("hola", "groq/canopylabs/orpheus-v1-english", "hannah");

      expect(groq.last()?.body?.voice).toBe("hannah");
      expect(voiceService.getGroqVoices().map(v => v.id)).toContain("hannah");
    });
  });

  describe("catálogo", () => {
    it("ya no ofrece el modelo STT que Groq deprecó", async () => {
      const models = await col<ModelDoc>("models");
      const ids = (await models.scan({}))
        .filter(e => e.doc.model_type === "stt")
        .map(e => e.doc.id);

      expect(ids).not.toContain("groq/distil-whisper-large-v3-en");
      expect(ids).toContain("groq/whisper-large-v3-turbo");
    });

    it("siembra los Orpheus como TTS de Groq", async () => {
      const models = await col<ModelDoc>("models");
      const ids = (await models.scan({}))
        .filter(e => e.doc.model_type === "tts" && e.doc.provider_id === "groq")
        .map(e => e.doc.id);

      expect(ids).toContain("groq/canopylabs/orpheus-v1-english");
      expect(ids).toContain("groq/canopylabs/orpheus-arabic-saudi");
    });

    it("repunta los canales que tenían elegido el modelo deprecado", async () => {
      // Borrar la fila del seed no alcanza: el canal guarda el id, no una FK, así
      // que quedaría apuntando a una fila inexistente y la voz seguiría rota.
      const channels = await col<ChannelDoc>("channels");
      const before = await channels.get("telegram");
      if (!before) throw new Error("el seed debería crear el canal telegram");

      await channels.put(
        "telegram",
        { ...before.doc, stt_provider: "groq/distil-whisper-large-v3-en" },
        { expectedVersion: before.version },
      );

      const { seedAllData } = await import("../packages/core/src/storage/seed");
      await seedAllData();

      expect((await channels.get("telegram"))?.doc.stt_provider).toBe("groq/whisper-large-v3-turbo");
    });
  });

  describe("contrato entre el asistente de onboarding y el catálogo", () => {
    it("cada modelo que ofrece existe como fila del catálogo", async () => {
      // `saveVoiceConfig` guarda el value verbatim en el canal y resuelve el
      // provider buscando esa fila. Un id que no exista rompe tres cosas en
      // silencio: no activa el modelo, NO GUARDA LA API KEY (resuelve provider
      // "" y el if la saltea), y deja el canal apuntando al vacío. Pasó con los
      // whisper de Groq: el asistente ofrecía "whisper-large-v3-turbo" mientras
      // la fila se llama "groq/whisper-large-v3-turbo".
      const { ONBOARDING_STT_OPTIONS, ONBOARDING_TTS_OPTIONS } =
        await import("../packages/cli/src/commands/onboard");

      const models = await col<ModelDoc>("models");
      const byId = new Map((await models.scan({})).map(e => [e.doc.id, e.doc]));

      for (const opt of ONBOARDING_STT_OPTIONS) {
        expect(byId.get(opt.value)?.model_type, `STT ${opt.value}`).toBe("stt");
      }
      for (const opt of ONBOARDING_TTS_OPTIONS) {
        expect(byId.get(opt.value)?.model_type, `TTS ${opt.value}`).toBe("tts");
      }
    });
  });

  describe("configuraciones viejas", () => {
    it("un stt_provider que guarda un id de provider resuelve a un modelo concreto", async () => {
      // El campo se llama *_provider por historia y las configs viejas guardaban
      // literalmente "groq". Resolver sólo el provider hacía que su nombre
      // viajara al cable como nombre de modelo.
      const groq = stubGroq();
      await voiceService.transcribe(AUDIO, "groq");

      const sent = groq.last()?.model;
      expect(sent).not.toBe("groq");
      expect(["whisper-large-v3", "whisper-large-v3-turbo"]).toContain(sent!);
    });

    it("lo mismo para el TTS", async () => {
      const groq = stubGroq();
      await voiceService.speak("hola", "groq");

      expect(groq.last()?.model).toStartWith("canopylabs/");
    });
  });
});
