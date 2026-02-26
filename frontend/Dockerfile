FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package*.json ./

RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

COPY --from=builder /app/public ./public

EXPOSE 4321

ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production

CMD ["node", "./dist/server/entry.mjs"]