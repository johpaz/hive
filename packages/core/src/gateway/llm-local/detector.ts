/**
 * Hive Local LLM — Detector de GPU
 * Detecta Vulkan, CUDA, Metal o fallback a CPU
 *
 * Estrategias para Vulkan (en orden):
 *  1) vulkaninfo --summary   (si está instalado)
 *  2) ICD JSON files + /sys/class/drm  (sin herramientas extra)
 *  3) lspci                  (último recurso)
 */

export type GPUBackend = "cuda" | "vulkan" | "metal" | "rocm" | "none"
export type PlatformArch = "linux-x64" | "linux-arm64" | "windows-x64" | "macos-x64" | "macos-arm64"
export type GPUType = "iGPU" | "dGPU"

export interface GPUInfo {
  backend: GPUBackend
  deviceName?: string
  vramMB?: number
  gpuType?: GPUType
  platform: PlatformArch
}

function detectPlatform(): PlatformArch {
  const os = process.platform
  const arch = process.arch

  if (os === "linux" && arch === "x64") return "linux-x64"
  if (os === "linux" && arch === "arm64") return "linux-arm64"
  if (os === "win32" && arch === "x64") return "windows-x64"
  if (os === "darwin" && arch === "x64") return "macos-x64"
  if (os === "darwin" && arch === "arm64") return "macos-arm64"

  throw new Error(`Plataforma no soportada: ${os}/${arch}`)
}

/** Intenta detectar CUDA via nvidia-smi */
async function detectCUDA(): Promise<{ deviceName: string; vramMB: number } | null> {
  try {
    const proc = Bun.spawn(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) return null

    const line = output.trim().split("\n")[0]
    if (!line) return null
    const match = line.match(/^(.+?),\s*(\d+)\s*MiB/)
    if (!match) return null

    return { deviceName: match[1].trim(), vramMB: parseInt(match[2], 10) }
  } catch {
    return null
  }
}

/** Lee un archivo del sistema de forma segura */
async function readSysFile(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    return (await file.text()).trim()
  } catch {
    return null
  }
}

/** Mapea vendor ID hex a nombre legible */
function vendorName(vendorId: string): string {
  const map: Record<string, string> = {
    "0x1002": "AMD",
    "0x8086": "Intel",
    "0x10de": "NVIDIA",
    "0x1af4": "VirtIO",
  }
  return map[vendorId.toLowerCase()] ?? vendorId
}

/** Nombres amigables para cada ICD conocido */
const KNOWN_ICDS: Record<string, string> = {
  intel_icd: "Intel Graphics",
  radeon_icd: "AMD Radeon",
  amd_icd: "AMD Radeon",
  nvidia_icd: "NVIDIA GPU",
  nouveau_icd: "NVIDIA (nouveau)",
  lvp_icd: "llvmpipe (Software)",
  dzn_icd: "Microsoft DirectX (dzn)",
  virtio_icd: "VirtIO GPU",
  asahi_icd: "Apple Silicon GPU",
}

const SOFTWARE_ICDS = ["lvp_icd", "dzn_icd"]

/** Detecta Vulkan con 3 estrategias en cascada */
async function detectVulkan(): Promise<{
  deviceName: string
  vramMB?: number
  gpuType?: GPUType
} | null> {
  // ── Estrategia 1: vulkaninfo (más preciso, si está instalado) ────────────────
  try {
    const proc = Bun.spawn(["vulkaninfo", "--summary"], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode === 0) {
      const deviceMatch = output.match(/deviceName\s*=\s*(.+)/)
      if (deviceMatch) return { deviceName: deviceMatch[1].trim() }
    }
  } catch {
    // vulkaninfo no instalado → siguiente estrategia
  }

  // ── Estrategia 2: ICD JSON files + /sys/class/drm ───────────────────────────
  if (process.platform === "linux") {
    const icdDirs = ["/usr/share/vulkan/icd.d", "/etc/vulkan/icd.d"]

    for (const dir of icdDirs) {
      let files: string[] = []
      try {
        const glob = new Bun.Glob("*.json")
        files = await Array.fromAsync(glob.scan({ cwd: dir, absolute: true }))
      } catch {
        continue
      }

      if (files.length === 0) continue

      // Ordenar: hardware primero, software al final
      files.sort((a, b) => {
        const swA = SOFTWARE_ICDS.some(k => a.includes(k)) ? 1 : 0
        const swB = SOFTWARE_ICDS.some(k => b.includes(k)) ? 1 : 0
        return swA - swB
      })

      // Recopilar tarjetas DRM disponibles una sola vez
      let drmCards: string[] = []
      try {
        const drmGlob = new Bun.Glob("card*")
        const all = await Array.fromAsync(drmGlob.scan({ cwd: "/sys/class/drm", absolute: true }))
        drmCards = all.filter(c => /\/card\d+$/.test(c))
      } catch {
        // sin acceso a sysfs
      }

      // Procesar cada ICD
      const hwResults: Array<{ deviceName: string; vramMB?: number; gpuType?: GPUType }> = []
      const swResults: Array<{ deviceName: string }> = []

      for (const filePath of files) {
        const text = await readSysFile(filePath)
        if (!text) continue

        let icd: { ICD?: { library_path?: string } } = {}
        try { icd = JSON.parse(text) } catch { continue }

        const libPath = icd?.ICD?.library_path
        if (!libPath) continue

        // Verificar que la librería existe en el sistema
        if (!(await Bun.file(libPath).exists())) continue

        const baseName = filePath.split("/").pop()?.replace(/\.x86_64\.json$|\.arm64\.json$|\.json$/, "") ?? ""
        const isSoftware = SOFTWARE_ICDS.some(k => baseName.includes(k))
        const matchedKey = Object.keys(KNOWN_ICDS).find(k => baseName.includes(k))
        let deviceName = matchedKey ? KNOWN_ICDS[matchedKey] : baseName

        if (isSoftware) {
          swResults.push({ deviceName })
          continue
        }

        // Enriquecer con DRM sysfs
        let vramMB: number | undefined
        let gpuType: GPUType | undefined
        let foundMatch = false

        for (const cardPath of drmCards) {
          const vendor = await readSysFile(`${cardPath}/device/vendor`)
          if (!vendor) continue

          const vName = vendorName(vendor)

          // ¿Coincide este card con el ICD actual?
          const matches =
            (baseName.includes("intel") && vName === "Intel") ||
            (baseName.includes("radeon") && vName === "AMD") ||
            (baseName.includes("amd") && vName === "AMD") ||
            (baseName.includes("nvidia") && vName === "NVIDIA") ||
            (baseName.includes("nouveau") && vName === "NVIDIA") ||
            (baseName.includes("virtio") && vName === "VirtIO")

          if (!matches) continue
          foundMatch = true

          // VRAM desde sysfs (AMD expone mem_info_vram_total en bytes)
          const vramRaw = await readSysFile(`${cardPath}/device/mem_info_vram_total`)
          if (vramRaw) {
            const bytes = parseInt(vramRaw, 10)
            vramMB = Math.round(bytes / (1024 * 1024))
            gpuType = bytes >= 512 * 1024 * 1024 ? "dGPU" : "iGPU"
          }

          // Enriquecer nombre con tipo de GPU
          if (gpuType === "iGPU") {
            deviceName = `${vName} iGPU (integrada)`
          } else if (gpuType === "dGPU") {
            deviceName = `${vName} GPU (dedicada)`
          }

          break
        }

        if (foundMatch) hwResults.push({ deviceName, vramMB, gpuType })
      }

      // Retornar el primer resultado de hardware real encontrado
      if (hwResults.length > 0) return hwResults[0]
      // Si no hay hardware, reportar software renderer
      if (swResults.length > 0) return swResults[0]
    }
  }

  // ── Estrategia 3: lspci (último recurso) ────────────────────────────────────
  try {
    const proc = Bun.spawn(["lspci"], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode === 0) {
      const match = output.match(/(?:VGA|3D|Display)[^:]*:\s*(.+)/i)
      if (match) return { deviceName: match[1].trim() }
    }
  } catch {
    // lspci no disponible
  }

  return null
}

/** Detecta Metal en macOS */
async function detectMetal(): Promise<{ deviceName: string } | null> {
  if (process.platform !== "darwin") return null
  return { deviceName: "Apple Metal" }
}

/** Detección completa de GPU y plataforma */
export async function detectGPU(): Promise<GPUInfo> {
  const platform = detectPlatform()

  const cuda = await detectCUDA()
  if (cuda) return { backend: "cuda", ...cuda, platform }

  const vulkan = await detectVulkan()
  if (vulkan) return { backend: "vulkan", ...vulkan, platform }

  const metal = await detectMetal()
  if (metal) return { backend: "metal", ...metal, platform }

  return { backend: "none", platform }
}

/** Devuelve el nombre del binario según GPU y plataforma (legacy hive-cli) */
export function getHiveCLIBinaryName(gpu: GPUInfo): string {
  const { backend } = gpu
  const backendPart = backend === "none" ? "cpu" : backend
  const os = process.platform === "win32" ? "windows" : (process.platform === "darwin" ? "darwin" : "linux")
  const arch = process.arch === "x64" ? "amd64" : (process.arch === "arm64" ? "arm64" : process.arch)
  const ext = os === "windows" ? ".exe" : ""
  return `hive-cli-${os}-${arch}-${backendPart}${ext}`
}

export const HIVE_CLI_RELEASE_BASE = "https://github.com/johpaz/hive-cli/releases/download"
export const HIVE_CLI_VERSION = "v0.0.1"

export function getHiveCLIDownloadURL(binaryName: string): string {
  return `${HIVE_CLI_RELEASE_BASE}/${HIVE_CLI_VERSION}/${binaryName}`
}

/** 
 * Devuelve el sufijo del binario oficial de llama.cpp según GPU y plataforma
 * Basado en GUIA-SERVIDOR.md
 */
export function getLlamaServerSuffix(gpu: GPUInfo): string {
  const { backend, platform } = gpu
  
  switch (platform) {
    case "linux-x64":
      if (backend === "vulkan") return "bin-ubuntu-vulkan-x64"
      if (backend === "cuda") return "bin-ubuntu-cuda-x64" // Nota: el oficial suele ser vulkan/cpu/rocm/sycl en ubuntu
      if (backend === "rocm") return "bin-ubuntu-rocm-7.2-x64"
      return "bin-ubuntu-x64"
      
    case "linux-arm64":
      if (backend === "vulkan") return "bin-ubuntu-vulkan-arm64"
      return "bin-ubuntu-arm64"
      
    case "windows-x64":
      if (backend === "cuda") return "bin-win-cuda-12.4-x64"
      if (backend === "vulkan") return "bin-win-vulkan-x64"
      return "bin-win-cpu-x64"
      
    case "macos-arm64":
      return "bin-macos-arm64"
      
    case "macos-x64":
      return "bin-macos-x64"
      
    default:
      return "bin-ubuntu-x64"
  }
}

export const LLAMA_CPP_RELEASE_BASE = "https://github.com/ggml-org/llama.cpp/releases/download"
export const LLAMA_CPP_DEFAULT_VER = "b9025"

export function getLlamaServerDownloadURL(suffix: string, version: string = LLAMA_CPP_DEFAULT_VER): string {
  const isWin = suffix.includes("win")
  const ext = isWin ? "zip" : "tar.gz"
  const filename = `llama-${version}-${suffix}.${ext}`
  return `${LLAMA_CPP_RELEASE_BASE}/${version}/${filename}`
}
