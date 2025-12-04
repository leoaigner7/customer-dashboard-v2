### 1) FRONTEND BUILD
FROM node:20 AS frontend_build
WORKDIR /app/frontend

COPY app/frontend/package*.json ./
RUN npm install

COPY app/frontend ./
RUN npm run build


### 2) BACKEND BUILD
FROM node:20 AS backend
WORKDIR /app/backend

# Backend packages
COPY app/backend/package*.json ./
RUN npm install --production

# Backend code
COPY app/backend ./

# Copy frontend build output
COPY --from=frontend_build /app/frontend/dist ../frontend/dist

# Copy deploy .env into backend
COPY deploy/.env ./.env

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
