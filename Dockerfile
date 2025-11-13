FROM node:18-alpine AS build-frontend
WORKDIR /app/frontend
COPY app/frontend/package*.json ./
RUN npm install
COPY app/frontend .
RUN npm run build

FROM node:18-alpine AS backend
WORKDIR /app
COPY app/backend/package*.json ./backend/
RUN cd backend && npm install --production
COPY app/backend ./backend
COPY --from=build-frontend /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app/backend
EXPOSE 3000

CMD ["node", "src/server.js"]
