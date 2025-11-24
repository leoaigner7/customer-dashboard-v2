FROM node:20

RUN apt-get update && apt-get install -y cron

WORKDIR /app

COPY deploy/updater/updater.js deploy/updater/package.json ./

# WICHTIG: Kopiere docker-compose INS IMAGE
COPY deploy/docker-compose.yml /app/docker-compose.yml

RUN npm install

RUN echo "*/1 * * * * node /app/updater.js >> /var/log/updater.log 2>&1" > /etc/cron.d/updater-cron
RUN chmod 0644 /etc/cron.d/updater-cron

CMD ["cron", "-f"]
