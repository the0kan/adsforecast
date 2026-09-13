# API — build from repository root: docker build -t adsforecast-api .
FROM node:20-bookworm-slim

WORKDIR /app

COPY data.js metrics.js insights-engine.js ./
COPY backend/package.json backend/package-lock.json* backend/
COPY backend/prisma backend/prisma
COPY backend/src backend/src

RUN cd backend && npm install && npx prisma generate

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/backend
CMD ["node", "src/server.js"]
