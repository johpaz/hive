/**
 * Segundo proceso del test de sesión persistente.
 *
 * Corre aparte a propósito: dentro de un mismo proceso, Bun le da a todas las
 * vistas el mismo perfil de Chrome, así que dos vistas hermanas comparten
 * cookies sin que nadie las restaure. La única prueba honesta de que la sesión
 * sobrevive es esta: otro proceso, otro perfil, y la cookie tiene que volver
 * desde el almacén.
 *
 * Uso: bun tests/fixtures/browser-session-child.ts <url>
 * Imprime una línea JSON con lo que el servidor respondió.
 */

export {}; // sin esto el archivo no es módulo y su scope se mezcla con el global

const destino = process.argv[2];
if (!destino) {
  console.error("falta la url");
  process.exit(2);
}

const { WebViewBackend } = await import("../../packages/core/src/tools/web/webview-backend.ts");

const backend = new WebViewBackend({ persistSession: true });
try {
  await backend.navigate(destino);
  const texto = await backend.evaluate<string>("document.body.innerText.trim()");
  const visibles = await backend.evaluate<string>("document.cookie");
  console.log(JSON.stringify({ texto, visibles }));
} catch (error) {
  console.log(JSON.stringify({ error: (error as Error).message }));
} finally {
  backend.close();
}
process.exit(0);
