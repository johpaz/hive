/**
 * Marca del asistente de configuración.
 *
 * Un solo logo, `logocolor-dark.png`, el mismo que usan Header.tsx y
 * DashboardPage.tsx. La app es siempre oscura — `index.html` fija
 * `class="dark"` en el <html> y nada lo alterna — así que no hay variantes
 * por tema que conmutar.
 */

import { cn } from "@/lib/utils";
import { SETUP_BRAND } from "./brand";

interface LogoProps {
  /** Lado del cuadro en píxeles. */
  size?: number;
  /** Halo de color detrás del logo. Se apaga en las apariciones pequeñas. */
  glow?: boolean;
  className?: string;
}

export function SetupLogo({ size = 96, glow = true, className }: LogoProps) {
  return (
    <div className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {glow && (
        <div
          className="absolute inset-0 rounded-[28%] bg-amber-400/20 blur-2xl"
          aria-hidden="true"
        />
      )}
      <div className="relative flex h-full w-full items-center justify-center rounded-[28%] border border-border/70 bg-card/90 p-[14%] shadow-sm backdrop-blur-sm">
        <img
          src="/logocolor-dark.png"
          alt={SETUP_BRAND.name}
          className="h-full w-full object-contain"
        />
      </div>
    </div>
  );
}

/** Etiqueta pequeña con punto pulsante, para encabezar una pantalla. */
export function SetupEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">
        {children}
      </span>
    </div>
  );
}

/** Fila compacta de marca para la cabecera del asistente. */
export function SetupBrandBar() {
  return (
    <div className="flex items-center gap-2.5">
      <SetupLogo size={32} glow={false} />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">{SETUP_BRAND.name}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {SETUP_BRAND.tagline}
        </div>
      </div>
    </div>
  );
}
