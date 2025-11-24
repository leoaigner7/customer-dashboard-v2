FROM node:20

RUN apt-get update && apt-get install -y cron

WORKDIR /app

# Kopiere Updater Code
COPY updater.js package*.json ./

# Kopiere docker-compose.yml INS IMAGE !!!
COPY ../docker-compose.yml /app/docker-compose.yml

RUN npm install

# Cronjob für Updater
RUN echo "*/1 * * * * node /app/updater.js >> /var/log/updater.log 2>&1" > /etc/cron.d/updater-cron
RUN chmod 0644 /etc/cron.d/updater-cron

CMD ["cron", "-f"]
