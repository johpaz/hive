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
 * Imprime `RESULTADO:<json>` con lo que el servidor respondió.
 *
 * La línea va marcada porque el logger de hive también escribe en stdout: si el
 * padre se quedara con la última línea, cualquier log posterior al resultado
 * —un guardado de sesión que cae tarde— le llegaría como JSON inválido.
 */

export {}; // sin esto el archivo no es módulo y su scope se mezcla con el global

const destino = process.argv[2];
if (!destino) {
  console.error("falta la url");
  process.exit(2);
}

const { WebViewBackend } = await import("../../packages/core/src/tools/web/webview-backend.ts");
const { loadStoredCookies } = await import("../../packages/core/src/tools/web/browser-session.ts");

const backend = new WebViewBackend({ persistSession: true });
try {
  // Cuántas cookies vio este proceso en el almacén. Separa las dos causas de un
  // "anonimo": que no hubiera nada guardado, o que el navegador no las tomara.
  const guardadas = (await loadStoredCookies()).length;
  await backend.navigate(destino);
  const texto = await backend.evaluate<string>("document.body.innerText.trim()");
  const visibles = await backend.evaluate<string>("document.cookie");
  console.log(`RESULTADO:${JSON.stringify({ texto, visibles, guardadas })}`);
} catch (error) {
  console.log(`RESULTADO:${JSON.stringify({ error: (error as Error).message })}`);
} finally {
  backend.close();
}
process.exit(0);
