import { describe, expect, test } from "vitest";
import { esAltavozAbierto } from "./dispositivos";

describe("esAltavozAbierto", () => {
  test("formato tarjeta|puerto de la vía con pactl", () => {
    expect(esAltavozAbierto("alsa_card.pci-0000_06_00.1|hdmi-output-1")).toBe(true);
    expect(esAltavozAbierto("alsa_card.pci-0000_06_00.6|analog-output-speaker")).toBe(true);
    expect(esAltavozAbierto("alsa_card.usb-X|analog-output-headphones")).toBe(false);
    expect(esAltavozAbierto("bluez_card.15_08|headset-output")).toBe(false);
  });

  test("ids del audio nativo: un televisor por HDMI es altavoz abierto", () => {
    expect(esAltavozAbierto("pipewire:alsa_output.pci-0000_06_00.1.hdmi-stereo-extra1")).toBe(true);
  });

  test("ids del audio nativo: Bluetooth y USB genérico no lo son", () => {
    expect(esAltavozAbierto("pipewire:bluez_output.15_08_20_27_0A_D5.1")).toBe(false);
    expect(esAltavozAbierto("pipewire:alsa_output.usb-MaiYueTech_YU7_20251201-0934_V2.2-01.analog-stereo")).toBe(false);
  });

  test("un hash opaco del navegador no se puede saber: no lo es", () => {
    expect(esAltavozAbierto("a1b2c3d4e5f6")).toBe(false);
  });

  test("no confunde 'tv' dentro de otra palabra", () => {
    expect(esAltavozAbierto("pipewire:alsa_output.pci-0000.activity-stereo")).toBe(false);
  });
});
