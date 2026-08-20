# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /app
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN --mount=type=secret,id=host_ca,dst=/tmp/host_ca.pem,required=false \
    if [ -s /tmp/host_ca.pem ]; then cat /tmp/host_ca.pem >> /etc/ssl/certs/ca-certificates.crt; fi && \
    corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile=false

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--experimental-sqlite
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
ENV DOUYIN_PROFILE_BROWSER=1
ENV DOUYIN_COMMENTS_BROWSER=1
ENV DOUYIN_CHROMIUM_PATH=/usr/bin/chromium-browser
RUN apk add --no-cache chromium ffmpeg
COPY --from=deps /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 8000
CMD ["node", "src/node.ts"]
