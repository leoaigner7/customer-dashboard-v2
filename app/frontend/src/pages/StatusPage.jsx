import { useEffect, useState } from "react";
import api from "../api";

export default function StatusPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .get("/status")
      .then(res => setStatus(res.data))
      .catch(() => setError("Status konnte nicht geladen werden"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Update-Status wird geladen...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!status) return <div>Kein Status verfügbar.</div>;

  return (
    <div>
      <div style={{
        padding: "15px",
        marginBottom: "20px",
        backgroundColor: "#e8f4ff",
        border: "1px solid #7bb3ff",
        borderRadius: "8px"
   }}>
  <h3 style={{ margin: 0 }}>Version 7.0.9 – Neue Funktion aktiviert</h3>
  <p style={{ margin: 0 }}>Dieses Banner erscheint nur in Version 7.0.9 Damit kannst du Auto-Updates sofort prüfen.</p>
</div>

      <h1>Update-Status</h1>

      <div className="cards">
        <div className="card">
          <h3>Installierte Version</h3>
          <p className="card-value">
            {status.installedVersion || "unbekannt"}
          </p>
        </div>
        <div className="card">
          <h3>Verfügbare Version</h3>
          <p className="card-value">
            {status.latestVersion || "unbekannt"}
          </p>
        </div>
        <div className="card">
          <h3>Letztes Ergebnis</h3>
          <p className="card-value">
            {status.lastResult || "–"}
          </p>
        </div>
      </div>

      <h2>Details</h2>
      <ul className="logs">
        <li>
          <strong>Quelle:</strong> {status.lastSource || "–"}
        </li>
        <li>
          <strong>Letzter Check:</strong>{" "}
          {status.lastCheckedAt || "–"}
        </li>
        <li>
          <strong>Nächster geplanter Check:</strong>{" "}
          {status.nextCheckAt || "–"}
        </li>
        <li>
          <strong>Rollback möglich:</strong>{" "}
          {status.rollbackAvailable ? "Ja" : "Nein"}
        </li>
        <li>
          <strong>Health:</strong>{" "}
          {status.health || "unbekannt"}
        </li>
        {status.lastError && (
          <li>
            <strong>Fehler:</strong> {status.lastError}
          </li>
        )}
      </ul>
    </div>
  );
}
