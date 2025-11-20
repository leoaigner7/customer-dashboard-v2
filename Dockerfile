# --- Stage 1: Frontend Build ---
FROM node:20 AS frontend-build
# Setzt das Arbeitsverzeichnis im Container auf /app/frontend -> alle folgenden Befehle laufen relativ zu diesem Pfad
WORKDIR /app/frontend

# kopiert package.json und package-lock.json aus deinem Repo in das COntainer Verzeichnis /app/frontend/
# wichtig hier wird nicht der komplette code kopiert sondern nur die Datei
COPY app/frontend/package*.json ./

# installiert alle frontend Abhängigkeiten
RUN npm install

# kompletter frontend code wird in app/frontend kopiert
COPY app/frontend .

#starte den Build Prozess deines frontends 
RUN npm run build

# --- Stage 2: Backend Build ---
FROM node:20 AS backend
WORKDIR /app/backend

COPY app/backend/package*.json ./
RUN npm install --production

COPY app/backend .

# Frontend Dist in den erwarteten Pfad kopieren
# # nimmt Datein aus der ersten Stage, die ich frontend-build genannt habe 
# /app/frontend/dist: Das ist der Pfad im ersten Image, wo mein Frontend-Build gelandet ist.
# /app/frontend/dist: Das ist der Pfad im finalen (Backend-)Image, wohin die Dateien kopiert werden.
COPY --from=frontend-build /app/frontend/dist ./src/public
#Setzt die Umgebungsvariable NODE_ENV dauerhaft im Container
ENV NODE_ENV=production
EXPOSE 3000
#Das ist das Startkommando, wenn der Container läuft 
#erstellt wahrscheinlich den Express-Server 
CMD ["node", "src/server.js"]
