#!/bin/sh
# Construye la imagen de Hive con los cambios actuales y opcionalmente hace push

IMAGE="johpaz/hive-agents"
TAG="latest"
PUSH=false

# Flags
for arg in "$@"; do
  case $arg in
    --push) PUSH=true ;;
    --*) ;;
    *) TAG="$arg" ;;
  esac
done

set -e

echo "Construyendo $IMAGE:$TAG ..."
docker build -t "$IMAGE:$TAG" "$(dirname "$0")"

if [ "$PUSH" = true ]; then
  echo "Haciendo push a Docker Hub ..."
  docker push "$IMAGE:$TAG"
  if [ "$TAG" != "latest" ]; then
    docker tag "$IMAGE:$TAG" "$IMAGE:latest"
    docker push "$IMAGE:latest"
  fi
fi

echo "Reiniciando contenedor ..."
cd "$(dirname "$0")"
docker compose up -d --force-recreate

echo "Listo — Hive corriendo con los ultimos cambios"
