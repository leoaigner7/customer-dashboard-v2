const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "database.db");

const db = new Database(DB_PATH);

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

// Seed-Admin erzeugen, wenn noch keiner existiert
// Seed-Admin nur, wenn explizit erlaubt (Fail-secure Default)
const ALLOW_SEED_ADMIN = process.env.ALLOW_SEED_ADMIN === "true";

if (ALLOW_SEED_ADMIN) {
  const adminExists = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin'")
    .get().count;

  if (!adminExists) {
    const bcrypt = require("bcryptjs");
    const password = bcrypt.hashSync("admin123", 10);

    db.prepare(
      `INSERT INTO users (email, password_hash, role)
       VALUES ('admin@example.com', ?, 'admin')`
    ).run(password);

    console.log("[SEED] Admin erzeugt: admin@example.com / admin123 (ALLOW_SEED_ADMIN=true)");
  }
}


module.exports = db;
