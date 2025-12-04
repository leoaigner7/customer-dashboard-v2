# 1) FRONTEND BUILD
FROM node:20 AS frontend-build
WORKDIR /app/frontend
COPY app/frontend/package*.json ./
RUN npm install
COPY app/frontend ./
RUN npm run build


# 2) BACKEND BUILD
FROM node:20 AS backend
WORKDIR /app

# COPY BACKEND
COPY app/backend/package*.json ./backend/
RUN cd backend && npm install --production

COPY app/backend ./backend

# COPY FRONTEND DIST (React build)
COPY --from=frontend-build /app/frontend/dist ./frontend/dist


# ENV VARS
ARG VERSION
ENV APP_VERSION=$VERSION
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "backend/server.js"]
