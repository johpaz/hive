// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DispositivoAudio } from "@/lib/realtime/dispositivos";
import { SoloAltavozControl } from "./SoloAltavozControl";

const mic = (nombre: string, bluetooth = false): DispositivoAudio => ({
  id: nombre,
  nombre,
  porDefecto: false,
  bluetooth,
});

afterEach(cleanup);

describe("SoloAltavozControl", () => {
  test("no pinta nada si no hay aparatos Bluetooth ni ocultos", () => {
    const { container } = render(
      <SoloAltavozControl entradas={[mic("YU7")]} ocultas={[]} onOcultar={vi.fn()} onMostrar={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  test("ofrece marcar cada aparato Bluetooth aunque no sea el micrófono elegido", () => {
    render(
      <SoloAltavozControl
        entradas={[mic("YU7"), mic("BS-2", true)]}
        ocultas={[]}
        onOcultar={vi.fn()}
        onMostrar={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("BS-2")).toBeTruthy();
    expect(screen.queryByText("YU7")).toBeNull();
  });

  test("marcarlo avisa con el aparato correcto", () => {
    const onOcultar = vi.fn();
    const bs2 = mic("BS-2", true);
    render(<SoloAltavozControl entradas={[bs2]} ocultas={[]} onOcultar={onOcultar} onMostrar={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onOcultar).toHaveBeenCalledWith(bs2);
  });

  test("lista los ocultos y deja volver a mostrarlos", () => {
    const onMostrar = vi.fn();
    const bs2 = mic("BS-2", true);
    render(<SoloAltavozControl entradas={[]} ocultas={[bs2]} onOcultar={vi.fn()} onMostrar={onMostrar} />);
    expect(screen.getByText(/Ocultos por ser solo altavoz/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mostrar" }));
    expect(onMostrar).toHaveBeenCalledWith(bs2);
  });
});
