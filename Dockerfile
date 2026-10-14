FROM docker:29.8.1-cli AS docker-cli

FROM node:24.21.0-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  NODE_ENV=production

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY --from=docker-cli /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile --prod \
  && rm -rf /root/.cache /root/.local

COPY src ./src
COPY sandbox ./sandbox

CMD ["node", "src/main.ts"]
