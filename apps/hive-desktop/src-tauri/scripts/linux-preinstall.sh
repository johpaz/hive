#!/usr/bin/env sh

# Tauri declares these libraries as package dependencies. This extra check
# gives a useful message when the package is installed manually with dpkg/rpm
# or when a distribution uses different dependency metadata.
set -u

missing=""

has_library() {
  name="$1"
  if command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep -Fq "$name"; then
    return 0
  fi
  return 1
}

for library in libwebkit2gtk-4.1.so.0 libgtk-3.so.0 libappindicator3.so.1; do
  if ! has_library "$library"; then
    missing="$missing $library"
  fi
done

if [ -n "$missing" ]; then
  cat >&2 <<EOF

Hive Agents no puede instalarse porque faltan bibliotecas del sistema:$missing

En Debian/Ubuntu ejecuta:
  sudo apt update
  sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libappindicator3-1

En Fedora/RHEL compatibles ejecuta:
  sudo dnf install webkit2gtk4.1 gtk3 libappindicator-gtk3

Después vuelve a instalar Hive Agents.
EOF
  exit 1
fi

exit 0
