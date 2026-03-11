#!/bin/sh
# Levanta Hive en Docker y abre el navegador cuando esté listo

PORT=${HIVE_PORT:-18790}
URL="http://localhost:$PORT"
MAX_WAIT=60

# Si ya está corriendo, sólo abrir el navegador
if curl -sf "$URL/health" > /dev/null 2>&1; then
  echo "✅ Hive ya está corriendo"
else
  docker compose up -d

  echo "⏳ Esperando que Hive esté listo en $URL ..."
  i=0
  while [ $i -lt $MAX_WAIT ]; do
    if curl -sf "$URL/health" > /dev/null 2>&1; then
      break
    fi
    sleep 1
    i=$((i + 1))
  done

  if [ $i -ge $MAX_WAIT ]; then
    echo "⚠️  Hive no respondió en ${MAX_WAIT}s. Abre manualmente: $URL"
    exit 1
  fi
fi

# Detectar si ya fue configurado
SETUP_MODE=$(curl -sf "$URL/api/setup/status" | grep -o '"setupMode":true' || true)
if [ -n "$SETUP_MODE" ]; then
  OPEN_URL="$URL/setup"
else
  OPEN_URL="$URL"
fi

echo "✅ Hive listo — abriendo $OPEN_URL"

case "$(uname -s)" in
  Darwin) open "$OPEN_URL" ;;
  Linux)  gio open "$OPEN_URL" 2>/dev/null || xdg-open "$OPEN_URL" 2>/dev/null || echo "Abre: $OPEN_URL" ;;
  MINGW*|CYGWIN*|MSYS*) start "" "$OPEN_URL" ;;
  *) echo "Abre: $OPEN_URL" ;;
esac
