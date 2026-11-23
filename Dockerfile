# Stage 1: 构建前端生产产物（含 theme-boot 内联与 sw.js 版本戳）
FROM node:26.13.1-alpine AS web-builder

WORKDIR /app
RUN npm install -g pnpm@12.21.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN pnpm build:web

# Stage 2: 编译零 CGO Go 单二进制并内嵌前端静态产物
FROM golang:1.27.4-alpine AS server-builder

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN rm -rf ./internal/webui/dist && mkdir -p ./internal/webui/dist
COPY --from=web-builder /app/dist ./internal/webui/dist

RUN CGO_ENABLED=0 GOOS=linux go build \
    -tags embedwebui \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/babylog \
    ./cmd/babylog

# Stage 3: 最小非 root 运行镜像
FROM alpine:3.21

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
