FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# better-sqlite3 needs native build tools
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /var/lib/orchestrator/data

ENV NODE_ENV=production
ENV PORT=3000
ENV ORCHESTRATOR_DB_PATH=/var/lib/orchestrator/data/orchestrator.db

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
