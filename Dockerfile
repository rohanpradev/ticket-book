FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG VITE_API_MODE=server
ENV VITE_API_MODE=$VITE_API_MODE
RUN bun run build

FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
USER bun
EXPOSE 3001
CMD ["bun", "src/server/index.ts"]
