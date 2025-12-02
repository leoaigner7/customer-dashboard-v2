# -------------------------------------
# 1) FRONTEND
# -------------------------------------
FROM node:20 AS frontend-build
WORKDIR /app/frontend

COPY app/frontend/package*.json ./
RUN npm install

COPY app/frontend .
RUN npm run build

# -------------------------------------
# 2) BACKEND
# -------------------------------------
FROM node:20 AS backend
WORKDIR /app/backend

COPY app/backend/package*.json ./
RUN npm install --production

COPY app/backend .

# React-Build in den erwarteten Ordner kopieren:
COPY --from=frontend-build /app/frontend/dist ../frontend/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
