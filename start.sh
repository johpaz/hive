#!/bin/bash
# Creates host directories before Docker can create them as root

WORKSPACE="${HIVE_WORKSPACE:-./workspace}"

mkdir -p "$WORKSPACE"

docker compose up -d "$@"
