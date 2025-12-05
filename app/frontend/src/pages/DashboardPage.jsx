import { useEffect, useState } from "react";
import api from "../api";

export default function DashboardPage() {
  const [data, setData] = useState({ cards: [], recentLogs: [] });
  const [version, setVersion] = useState("");

  // Widgets / Dashboard-Daten laden
  useEffect(() => {
    api.get("/dashboard")
      .then(res => setData({
        cards: res.data.cards ?? [],
        recentLogs: res.data.recentLogs ?? []
      }))
      .catch(() => setData({ cards: [], recentLogs: [] }));
  }, []);

  // Version vom Backend holen
  useEffect(() => {
    fetch("/api/version")
      .then(res => res.json())
      .then(data => setVersion(data.version))
      .catch(() => setVersion("unknown"));
  }, []);

  return (
    <div>
      <h1>Dashboard {version ? `v${version}` : ""}</h1>

      <div className="cards">
        {(data.cards ?? []).map(card => (
          <div key={card.id} className="card">
            <h3>{card.title}</h3>
            <p className="card-value">{card.value}</p>
          </div>
        ))}
      </div>

      <h2>Letzte Logs</h2>
      <ul className="logs">
        {(data.recentLogs ?? []).map((log, i) => (
          <li key={i}>
            <strong>[{log.level}]</strong> {log.message}{" "}
            <span className="muted">{log.created_at}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
