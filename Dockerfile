# syntax=docker/dockerfile:1

# Stage 1: 构建前端生产产物（静态文件与目标架构无关，固定在构建机原生平台执行以避免 QEMU 模拟开销）
FROM --platform=$BUILDPLATFORM node:26.13.1-alpine AS web-builder

WORKDIR /app
RUN npm install -g pnpm@12.21.0

COPY package.json pnpm-lock.yaml ./
# BuildKit cache mount 仅加速同构建机本地与单次多架构构建；跨 GHA run 依赖镜像层本身由 type=gha,mode=max 持久化。
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/root/.local/share/pnpm/store

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN pnpm build:web

# Stage 2: 交叉编译零 CGO Go 单二进制并内嵌前端静态产物
FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine AS server-builder

ARG TARGETOS=linux
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
# 直接写入镜像层而非 cache mount，确保 go.sum 未变时跨 GHA run 可直接命中 type=gha 远端层缓存。
RUN go mod download

COPY backend/ ./
RUN rm -rf ./internal/webui/dist && mkdir -p ./internal/webui/dist
COPY --from=web-builder /app/dist ./internal/webui/dist

RUN --mount=type=cache,id=go-build-${TARGETOS}-${TARGETARCH},target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -tags embedwebui \
    -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildDate=${BUILD_DATE}" \
    -o /out/babylog \
    ./cmd/babylog

# Stage 3: 最小非 root 运行镜像
FROM alpine:3.24

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="BabyLog" \
      org.opencontainers.image.description="奶爸视角的宝宝日常记录自托管应用" \
      org.opencontainers.image.url="https://github.com/nt1r/babylog" \
      org.opencontainers.image.source="https://github.com/nt1r/babylog" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN addgroup -g 1000 babylog \
    && adduser -D -H -u 1000 -G babylog babylog \
    && mkdir -p /data \
    && chown babylog:babylog /data \
    && chmod 0700 /data

COPY --from=server-builder /out/babylog /usr/local/bin/babylog

USER babylog
WORKDIR /

ENV HOST=0.0.0.0 \
    PORT=21115 \
    GIN_MODE=release \
    BABYLOG_DATA_DIR=/data

EXPOSE 21115
VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/babylog"]
CMD ["serve"]
