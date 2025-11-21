# Basis-Image: Node.js
FROM node:20

# Installiere cron
RUN apt-get update && apt-get install -y cron

# Arbeitsverzeichnis festlegen
WORKDIR /app

# Kopiere deine Dateien ins Docker-Image
COPY updater.js package*.json ./

# Installiere Node.js Abhängigkeiten
RUN npm install

# Cronjob für den Updater (alle 5 Minuten)
RUN echo "*/5 * * * * node /app/updater.js >> /var/log/updater.log 2>&1" > /etc/cron.d/updater-cron

# Erlaube Cron-Job auszuführen
RUN chmod 0644 /etc/cron.d/updater-cron

# Cron-Dienst starten
CMD ["cron", "-f"]
