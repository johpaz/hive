# Hive Agents

Hive Agents is the native Tauri shell for Hive. It keeps the existing React
UI and starts a target-specific compiled Hive gateway as a bundled sidecar.
The release installers contain everything Hive needs at runtime; end users do
not install Bun, Node.js, Rust, Docker, or the Hive CLI.

## Requirements for development

- Bun 1.3+
- Rust 1.84+
- `cargo-tauri` 2.x (`cargo install tauri-cli --version '^2'`)
- Linux development packages required by WebKitGTK/libsoup when building on Linux

These requirements apply only when compiling Hive Agents from source. They
are not requirements for users installing a release.

## Development

From the repository root:

```bash
bun run desktop:dev
```

The Tauri lifecycle runs `scripts/build-desktop.ts` first. It builds the UI,
embeds it in the standalone gateway, and places the target-specific sidecar in
`src-tauri/binaries/`.

## Production build

```bash
bun run desktop:build
```

The generated installer is written under `apps/hive-desktop/src-tauri/target/`.
Sidecar binaries and generated build output are intentionally ignored by Git.

## Release distribution

GitHub Releases publish one native installer per desktop platform:

- Windows: NSIS `.exe` and `.msi`, with the WebView2 offline installer embedded.
- macOS: signed `.dmg` files for Intel and Apple Silicon.
- Linux: `.AppImage`, `.deb`, and Flatpak for x86_64; ARM64 publishes AppImage
  and `.deb` when a native runner is available.

Linux users should choose AppImage for portability, Flatpak for sandboxing, or
`.deb` for native package-manager integration. The `.deb` and Flatpak declare
their runtime WebKitGTK/GTK environment so users do not have to install Hive
dependencies manually. Tauri still uses the operating system WebView on Linux;
this is why the Linux release offers multiple native packaging formats.

The updater reads the signed metadata from:

`https://github.com/johpaz/hive/releases/latest/download/latest.json`

Release signing requires the `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secrets. The public key is safe to
keep in `src-tauri/tauri.conf.json`; never commit the private key.

The desktop shell chooses a free loopback port, creates an application-scoped
`HIVE_HOME`, starts the gateway, waits for `/health`, and then opens the existing
Hive UI over HTTP/WebSocket. Closing the app terminates the sidecar.
