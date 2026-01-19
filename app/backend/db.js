const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "database.db");
// Verzeichnis sicherstellen (hilft, falls der Ordner /data noch nicht existiert)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
// Tabellen anlegen, falls nicht vorhanden
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Optional für Status-Langzeitspeicherung:
CREATE TABLE IF NOT EXISTS update_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT,
  source TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Seed-Admin Logik (Reparatur-Modus)
const adminEmail = 'admin@example.com';
const adminUser = db.prepare("SELECT * FROM users WHERE email = ?").get(adminEmail);

const bcrypt = require("bcryptjs");
// Falls in .env ein Passwort steht, nutze das, sonst admin123
const initialPass = process.env.ADMIN_PASSWORD || "admin123";
const passwordHash = bcrypt.hashSync(initialPass, 10);

if (!adminUser) {
  // 1. Fall: Benutzer existiert noch nicht -> Neu anlegen
  db.prepare(
    `INSERT INTO users (email, password_hash, role)
     VALUES (?, ?, 'admin')`
  ).run(adminEmail, passwordHash);
  
  console.log(`[SEED] Admin neu erzeugt: ${adminEmail} / ${initialPass}`);

} else {
  // 2. Fall: Benutzer existiert schon (vielleicht kaputt?) -> Passwort RESETTEN!
  // Das repariert Ihren Login automatisch beim Neustart
  db.prepare(
    "UPDATE users SET password_hash = ? WHERE email = ?"
  ).run(passwordHash, adminEmail);
  
  console.log(`[SEED] Admin-Passwort repariert/zurückgesetzt für: ${adminEmail}`);
}

module.exports = db;

