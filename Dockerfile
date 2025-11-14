# --- Stage 1: Frontend build (Vite + React) ---
    FROM node:20-alpine AS frontend-build
    WORKDIR /app/frontend
    
    # Dependencies installieren
    COPY app/frontend/package*.json ./
    RUN npm ci
    
    # Source-Code kopieren und bauen
    COPY app/frontend .
    RUN npm run build
    
    # --- Stage 2: Backend + statische Files ---
    FROM node:20-alpine AS backend
    WORKDIR /app/backend
    
    # Backend-Dependencies
    COPY app/backend/package*.json ./
    RUN npm ci --only=production
    
    # Backend-Code kopieren
    COPY app/backend .
    
    # Frontend-Build in "public" legen (von dort kann server.js ausliefern)
    COPY --from=frontend-build /app/frontend/dist ./public
    
    ENV NODE_ENV=production
    EXPOSE 3000
    
    # Passe den Startbefehl ggf. an, falls dein Backend anders heißt
    CMD ["node", "src/server.js"]
    