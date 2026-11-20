/**
 * Preparación común de los tests de la interfaz.
 *
 * Node 25+ trae un `localStorage` experimental que, sin `--localstorage-file`, queda
 * indefinido y tapa el de jsdom: los tests que lo usan (el store del chat persiste en
 * él) fallaban con «Cannot read properties of undefined (reading 'clear')». Si falta,
 * se instala uno en memoria con la misma interfaz.
 */
class MemoryStorage implements Storage {
  private datos = new Map<string, string>();
  get length(): number { return this.datos.size; }
  clear(): void { this.datos.clear(); }
  getItem(clave: string): string | null { return this.datos.get(clave) ?? null; }
  key(indice: number): string | null { return [...this.datos.keys()][indice] ?? null; }
  removeItem(clave: string): void { this.datos.delete(clave); }
  setItem(clave: string, valor: string): void { this.datos.set(clave, String(valor)); }
}

for (const nombre of ["localStorage", "sessionStorage"] as const) {
  let existe = false;
  try { existe = typeof (globalThis as any)[nombre]?.getItem === "function"; } catch { /* getter que lanza */ }
  if (!existe) {
    Object.defineProperty(globalThis, nombre, { value: new MemoryStorage(), configurable: true, writable: true });
  }
}
