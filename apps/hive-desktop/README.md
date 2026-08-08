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

GitHub Releases publish native installers per desktop platform:

- Windows: NSIS `.exe` and `.msi`, with the WebView2 offline installer embedded.
- macOS: `.dmg` for Intel and Apple Silicon.
- Linux: `.deb`, `.rpm`, and a Flatpak bundle for x86_64; ARM64 publishes
  `.deb` and `.rpm` when a native runner is available.

AppImage is temporarily excluded from `bundles` in `release.yml`:
`linuxdeploy-plugin-gtk` aborts (SIGABRT) running `ldd` on our `hive-gateway`
sidecar (compiled with Bun) during dependency deployment, reproduced
consistently in CI on both x86_64 and aarch64. It is unrelated to FUSE or to
the `.relr.dyn`/`strip` issue also seen on this bundler (`NO_STRIP=true` is
still set and did not fix this one). `.deb`/`.rpm` don't go through
`linuxdeploy` and build fine; Flatpak doesn't use it either, since it installs
the sidecar directly via its own manifest.

Linux users should choose Flatpak for sandboxing, or `.deb`/`.rpm` for native
package-manager integration. The `.deb`, `.rpm`, and Flatpak declare their
runtime WebKitGTK/GTK environment so users do not have to install Hive
dependencies manually. Tauri still uses the operating system WebView on
Linux; this is why the Linux release offers multiple native packaging
formats.

**Neither the macOS `.dmg` nor the Windows installers carry OS-level code
signing** (no Apple Developer ID notarization, no Authenticode certificate) —
that requires paid certificates that this project does not currently hold.
Gatekeeper on macOS will show "app is damaged" / "cannot verify developer",
and SmartScreen on Windows will warn the installer is unrecognized. Both are
one-time prompts users can bypass (`xattr -dr com.apple.quarantine` on macOS,
"More info → Run anyway" on Windows) — see `docs/guides/instalacion.md` for
the exact steps. This is unrelated to the updater signing below, which only
guarantees that an *update* was produced by this project's release pipeline,
not that the *installer* is trusted by the OS.

The updater reads the signed metadata from:

`https://github.com/johpaz/hive/releases/latest/download/latest.json`

Update signing (minisign, via the Tauri updater plugin) requires the
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub
secrets. The public key is safe to keep in `src-tauri/tauri.conf.json`; never
commit the private key.

The desktop shell chooses a free loopback port, creates an application-scoped
`HIVE_HOME`, starts the gateway, waits for `/health`, and then opens the existing
Hive UI over HTTP/WebSocket. Closing the app terminates the sidecar.
