# 1) FRONTEND BUILD
FROM node:20 AS frontend-build
WORKDIR /app/frontend

# Dependencies
COPY app/frontend/package*.json ./
RUN npm install

# Source + Build
COPY app/frontend ./
RUN npm run build

# 2) BACKEND + FRONTEND MERGE
FROM node:20 AS backend
WORKDIR /app/backend

# Backend deps
COPY app/backend/package*.json ./
RUN npm install --production

# Backend code
COPY app/backend ./

# VERSION ins Image einbauen:
ARG VERSION
ENV APP_VERSION=$VERSION

# React-Build in Backend kopieren:
COPY --from=frontend-build /app/frontend/dist ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
