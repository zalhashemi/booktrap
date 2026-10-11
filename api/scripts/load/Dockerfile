# The API as Render builds and runs it, for the load test (api/scripts/load). Build from the repo root:
#   docker build -f api/scripts/load/Dockerfile -t booktrap-api-load .
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY web/package.json web/
# Only the API's and shared's dependencies (ffmpeg-static fetches its Linux binary here).
RUN npm ci --include=dev -w @booktrap/api -w @booktrap/shared --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY api/tsconfig.json api/tsup.config.ts api/
COPY api/src api/src
RUN npm run build -w @booktrap/api
ENV NODE_ENV=development PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["npm", "start", "-w", "@booktrap/api"]
