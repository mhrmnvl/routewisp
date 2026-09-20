FROM oven/bun:1-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/app/data

COPY package.json bun.lock* ./
RUN bun install --production

COPY . ./

RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

EXPOSE 20128
CMD ["bun", "server.js"]
