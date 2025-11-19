FROM node:20-alpine

WORKDIR /app

COPY updater.js ./
COPY config.json ./

RUN npm install axios@1.6.0

CMD ["node", "updater.js"]
