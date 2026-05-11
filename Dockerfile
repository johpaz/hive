# ─── Stage 1: Build UI ────────────────────────────────────────────────────────
FROM docker.io/oven/bun:1 AS ui-builder

WORKDIR /app

# Copy root manifests
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./

# Copy hive-ui source
COPY packages/hive-ui ./packages/hive-ui

# Stub workspace packages with correct names so bun workspace resolution works
RUN mkdir -p packages/core packages/cli packages/mcp packages/skills packages/code-bridge && \
      echo '{"name":"@johpaz/hive-agents-core","version":"0.0.0"}' > packages/core/package.json && \
      echo '{"name":"@johpaz/hive-agents","version":"0.0.0"}' > packages/cli/package.json && \
      echo '{"name":"@johpaz/hive-agents-mcp","version":"0.0.0"}' > packages/mcp/package.json && \
      echo '{"name":"@johpaz/hive-agents-skills","version":"0.0.0"}' > packages/skills/package.json && \
      echo '{"name":"@johpaz/hive-agents-code-bridge","version":"0.0.0"}' > packages/code-bridge/package.json

RUN bun install
RUN cd packages/hive-ui && bun run build

# ─── Stage 2: Compile binary (targeting musl for Alpine) ──────────────────────
FROM docker.io/oven/bun:1 AS binary-builder

WORKDIR /app

# Copy manifests first so `bun install` is cached independently of source changes
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/skills/package.json ./packages/skills/package.json
COPY packages/code-bridge/package.json ./packages/code-bridge/package.json
RUN bun install --ignore-scripts

# Copy source after install so dependency layer stays cached on code changes
COPY packages/core ./packages/core
COPY packages/cli ./packages/cli
COPY packages/mcp ./packages/mcp
COPY packages/skills ./packages/skills
COPY packages/code-bridge ./packages/code-bridge

# Set NODE_ENV=production so Bun inlines it correctly in the compiled binary
ENV NODE_ENV=production

# Compile standalone binary linked against musl (Alpine compatible)
RUN bun build --compile \
      --target=bun-linux-x64-musl \
      --outfile=/app/hive-server \
      ./packages/cli/src/index.ts

# ─── Stage 3: Minimal Alpine runtime ──────────────────────────────────────────
FROM docker.io/alpine:3.21

# ca-certificates for HTTPS, chromium for browser tools
RUN apk add --no-cache \
      ca-certificates tzdata libgcc libstdc++ \
      chromium nss freetype harfbuzz ttf-freefont

WORKDIR /app

# Copy compiled binary (self-contained, includes Bun runtime)
COPY --from=binary-builder /app/hive-server ./hive-server

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
