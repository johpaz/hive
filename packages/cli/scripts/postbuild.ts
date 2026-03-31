#!/usr/bin/env bun
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

// Calcular ruta correcta: desde packages/cli/scripts/ hacia la raíz y luego a dist/
const scriptDir = dirname(__filename)
const rootDir = join(scriptDir, '../../..')
const distDir = join(rootDir, 'dist')

// Crear dist/ si no existe
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true })
}

// ── WINDOWS — archivo .cmd ─────────────────────────────────────────────────
// Permite ejecutar `hive` desde CMD y PowerShell
// %~dp0 resuelve la ruta del directorio actual aunque tenga espacios
writeFileSync(
  join(distDir, 'hive.cmd'),
  `@echo off\r\nbun "%~dp0hive.js" %*\r\n`,
  'utf8'
)

// ── WINDOWS — archivo .ps1 para PowerShell ─────────────────────────────────
writeFileSync(
  join(distDir, 'hive.ps1'),
  `#!/usr/bin/env pwsh\nbun "$PSScriptRoot/hive.js" @args\n`,
  'utf8'
)

// ── macOS / Linux — asegurar permisos de ejecución ────────────────────────
// En Mac, npm/bun a veces no preserva el bit +x al publicar
const mainBin = join(distDir, 'hive.js')
if (existsSync(mainBin)) {
  chmodSync(mainBin, 0o755)
}

console.log('✅ Shims multiplataforma generados:')
console.log('   dist/hive.cmd  → Windows CMD')
console.log('   dist/hive.ps1  → Windows PowerShell')
console.log('   dist/hive.js   → Linux / macOS (chmod 755)')
