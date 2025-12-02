import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_PLEASE";

export function signUser(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

export function authMiddleware(requiredRole = null) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: "Forbidden" });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

export async function seedAdmin() {
  const adminEmail = "admin@example.com";

  const existing = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(adminEmail);

  if (!existing) {
    const hash = await bcrypt.hash("admin123", 10);
    db.prepare(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
    ).run(adminEmail, hash, "admin");

    console.log(
      "Admin-User erstellt: admin@example.com / admin123 (bitte in Settings ändern)"
    );
  }
}
