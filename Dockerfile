# ─── Stage 1: Build UI ────────────────────────────────────────────────────────
FROM docker.io/oven/bun:1 AS ui-builder

WORKDIR /app

# Copy root manifests
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./

# Copy hive-ui source
COPY packages/hive-ui ./packages/hive-ui

# Stub workspace packages with correct names so bun workspace resolution works
RUN mkdir -p packages/core packages/cli packages/mcp packages/skills && \
      echo '{"name":"@johpaz/hive-agents-core","version":"0.0.0"}' > packages/core/package.json && \
      echo '{"name":"@johpaz/hive-agents","version":"0.0.0"}' > packages/cli/package.json && \
      echo '{"name":"@johpaz/hive-agents-mcp","version":"0.0.0"}' > packages/mcp/package.json && \
      echo '{"name":"@johpaz/hive-agents-skills","version":"0.0.0"}' > packages/skills/package.json

RUN bun install
RUN cd packages/hive-ui && bun run build

# ─── Stage 2: Compile gateway for the image architecture ─────────────────────
FROM docker.io/oven/bun:1 AS binary-builder

WORKDIR /app
ARG TARGETARCH

# Copy manifests first so `bun install` is cached independently of source changes
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/skills/package.json ./packages/skills/package.json
RUN bun install --ignore-scripts

# Copy source after install so dependency layer stays cached on code changes
COPY packages/core ./packages/core
COPY packages/cli ./packages/cli
COPY packages/mcp ./packages/mcp
COPY packages/skills ./packages/skills
COPY scripts/build-gateway.ts ./scripts/build-gateway.ts

# Set NODE_ENV=production so Bun inlines it correctly in the compiled binary
ENV NODE_ENV=production

# Compile a GNU/Linux binary matching BuildKit's target architecture. Running
# the builder on the target platform ensures bun installs the matching HiveDB
# optional native package before it is embedded into the executable.
RUN case "$TARGETARCH" in \
      amd64) BUN_TARGET=bun-linux-x64 ;; \
      arm64) BUN_TARGET=bun-linux-arm64 ;; \
      *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    bun scripts/build-gateway.ts --target "$BUN_TARGET" --outfile /app/hive-server

# Bundle the tool worker as a standalone script. The binary spawns it via
# `new Worker(path)` at runtime, so it must exist on disk next to the binary
# in the final image (it is not embedded by `bun build --compile`).
RUN bun build \
      --target=bun \
      --outfile=/app/tool-worker.js \
      ./packages/core/src/tool-runtime/tool-worker.ts

# ─── Stage 3: Minimal glibc runtime ───────────────────────────────────────────
FROM docker.io/debian:bookworm-slim

# ca-certificates for HTTPS, Chromium for browser tools, wget for healthchecks.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tzdata libgcc-s1 libstdc++6 chromium wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled binary (self-contained, includes Bun runtime)
COPY --from=binary-builder /app/hive-server ./hive-server

# Copy tool worker (loaded at runtime by `new Worker()` from packages/core/src/tool-runtime/index.ts)
COPY --from=binary-builder /app/tool-worker.js ./tool-worker.js

# Copy bundled skills (.md files read at runtime via fs — not embedded in binary)
# Bun preserves original __dirname in compiled binary: packages/skills/src/bundled
COPY --from=binary-builder /app/packages/skills/src/bundled ./packages/skills/src/bundled

# Copy built UI
COPY --from=ui-builder /app/packages/hive-ui/dist ./ui

# Hive data directory — mount a volume here for persistence
VOLUME /root/.hive

EXPOSE 18790

ENV HIVE_HOST=0.0.0.0
ENV HIVE_PORT=18790
ENV HIVE_UI_DIR=/app/ui
ENV NODE_ENV=production


CMD ["/app/hive-server", "start", "--skip-check"]
