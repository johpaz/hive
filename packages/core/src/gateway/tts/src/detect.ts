const KITTEN_PACKAGES = {
  "linux-x64": "hive-kitten-linux-x64.tar.gz",
  "linux-arm64": "hive-kitten-linux-arm64.tar.gz",
  "darwin-x64": "hive-kitten-darwin-x64.tar.gz",
  "darwin-arm64": "hive-kitten-darwin-arm64.tar.gz",
  "win32-x64": "hive-kitten-win32-x64.tar.gz",
} as const

const UV_PACKAGES = {
  "linux-x64": ["x86_64-unknown-linux-gnu", "56dd1b66701ecb62fe896abb919444e4b83c5e8645cca953e6ddd496ff8a0feb"],
  "linux-arm64": ["aarch64-unknown-linux-gnu", "eee8dd658d20e5ac85fec9c2326b6cbc9d83a1eef09ef07433e58698ac849591"],
  "darwin-x64": ["x86_64-apple-darwin", "c59d73bf34b58bc8e33a11629f7a255c11789fd00f03cd3e68ab2d1603645de9"],
  "darwin-arm64": ["aarch64-apple-darwin", "c729adb365114e844dd7f9316313a7ed6443b89bb5681d409eebac78b0bd06c8"],
  "win32-x64": ["x86_64-pc-windows-msvc", "c84629a56e0706b69a47ea35862208af827cb6fbfa1d0ca763c52c67594637e8"],
} satisfies Record<keyof typeof KITTEN_PACKAGES, readonly [string, string]>

export function detectKittenPackage(version: string, os: string = process.platform, arch: string = process.arch) {
  const platform = `${os}-${arch}`
  if (!Object.hasOwn(KITTEN_PACKAGES, platform)) return undefined
  const key = platform as keyof typeof KITTEN_PACKAGES
  const filename = KITTEN_PACKAGES[key]
  const url = `https://github.com/johpaz/hive/releases/download/v${version}/${filename}`
  const [triple, sha256] = UV_PACKAGES[key]
  const uvDirectory = `uv-${triple}`
  const uvFile = `${uvDirectory}.${os === "win32" ? "zip" : "tar.gz"}`
  return {
    filename, url, checksumUrl: `${url}.sha256`,
    uv: {
      filename: uvFile,
      url: `https://github.com/astral-sh/uv/releases/download/0.11.8/${uvFile}`,
      executable: os === "win32" ? "uv.exe" : "uv",
      directory: uvDirectory,
      sha256,
    },
  }
}
