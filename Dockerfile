# --- Stage 1: Frontend Build ---
FROM node:20 AS frontend-build
WORKDIR /app/frontend

COPY app/frontend/package*.json ./
RUN npm install

COPY app/frontend .
RUN npm run build

# --- Stage 2: Backend Build ---
FROM node:20 AS backend
WORKDIR /app/backend

COPY app/backend/package*.json ./
RUN npm install --production

COPY app/backend .

# Frontend Dist in den erwarteten Pfad kopieren
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
