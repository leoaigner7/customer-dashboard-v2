FROM node:20-alpine

WORKDIR /app
COPY . .

RUN npm install axios

CMD ["node", "updater.js"]
