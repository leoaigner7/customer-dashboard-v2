FROM node:20 AS backend-build
WORKDIR /app

# Backend deps
COPY app/backend/package*.json ./backend/
RUN cd backend && npm install

# Copy Backend code
COPY app/backend ./backend

# Frontend build
FROM node:20 AS frontend-build
WORKDIR /app
COPY app/frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY app/frontend ./frontend
RUN cd frontend && npm run build

# --- FINAL IMAGE ---
FROM node:20
WORKDIR /app

# Backend rein
COPY --from=backend-build /app/backend ./backend

# Frontend Build rein
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# ENV setzen
ENV NODE_ENV=production

# Port öffnen
EXPOSE 3000

# App starten
CMD ["node", "backend/src/server.js"]
