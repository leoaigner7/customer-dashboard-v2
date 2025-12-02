# --- Stage 2: Backend + Serve Frontend ---
FROM node:20 AS backend
WORKDIR /app

# Backend deps
COPY app/backend/package*.json ./backend/
RUN cd backend && npm install --production

# Backend code
COPY app/backend ./backend

# Frontend build kopieren → RICHTIGER ORDNER!
COPY --from=frontend-build /app/frontend/dist ./backend/public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "backend/src/server.js"]
