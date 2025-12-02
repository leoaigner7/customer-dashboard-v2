# -------------------------------------
# 1) FRONTEND BUILD
# -------------------------------------
FROM node:20 AS frontend-build

WORKDIR /app/frontend

COPY app/frontend/package*.json ./
RUN npm install

COPY app/frontend ./
RUN npm run build


# -------------------------------------
# 2) BACKEND
# -------------------------------------
FROM node:20 AS backend

WORKDIR /app/backend

COPY app/backend/package*.json ./
RUN npm install --production

COPY app/backend ./

# → GENAU HIER MUSS DAS FRONTEND HIN:
COPY --from=frontend-build /app/frontend/dist ./public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
