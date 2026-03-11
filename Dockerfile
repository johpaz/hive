# ─── Stage 1: Build UI ────────────────────────────────────────────────────────
FROM docker.io/oven/bun:1 AS ui-builder

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY packages/hive-ui ./packages/hive-ui

# Stub other workspace packages so bun resolves the monorepo correctly
RUN mkdir -p packages/core packages/cli packages/mcp packages/skills packages/code-bridge && \
    echo '{"name":"@hive/core","version":"0.0.0"}' > packages/core/package.json && \
    echo '{"name":"@hive/cli","version":"0.0.0"}' > packages/cli/package.json && \
    echo '{"name":"@hive/mcp","version":"0.0.0"}' > packages/mcp/package.json && \
    echo '{"name":"@hive/skills","version":"0.0.0"}' > packages/skills/package.json && \
    echo '{"name":"@hive/code-bridge","version":"0.0.0"}' > packages/code-bridge/package.json

RUN bun install
RUN cd packages/hive-ui && bun run build

# ─── Stage 2: Compile binary (targeting musl for Alpine) ──────────────────────
FROM docker.io/oven/bun:1 AS binary-builder

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/cli ./packages/cli
COPY packages/mcp ./packages/mcp
COPY packages/skills ./packages/skills
COPY packages/code-bridge ./packages/code-bridge

RUN bun install

# Set NODE_ENV=production so Bun inlines it correctly in the compiled binary
ENV NODE_ENV=production

# Compile standalone binary linked against musl (Alpine compatible)
RUN bun build --compile \
      --target=bun-linux-x64-musl \
      --outfile=/app/hive-server \
      ./packages/cli/src/index.ts

# ─── Stage 3: Minimal Alpine runtime ──────────────────────────────────────────
FROM docker.io/alpine:3.21

# ca-certificates for HTTPS calls to LLM APIs
RUN apk add --no-cache ca-certificates tzdata libgcc libstdc++

WORKDIR /app

# Copy compiled binary (self-contained, includes Bun runtime)
COPY --from=binary-builder /app/hive-server ./hive-server

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
