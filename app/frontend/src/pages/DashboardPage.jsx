import { useEffect, useState } from "react";
import api from "../api";

export default function DashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/dashboard/widgets").then(res => setData(res.data));
  }, []);

  if (!data) return <div>Dashboard wird geladen...</div>;

  return (
    <div>
      <h1>Dashboard 3.9.0</h1>
      <div className="cards">
        {data.cards.map(card => (
          <div key={card.id} className="card">
            <h3>{card.title}</h3>
            <p className="card-value">{card.value}</p>
          </div>
        ))}
      </div>

      <h2>Letzte Logs</h2>
      <ul className="logs">
        {data.recentLogs.map((log, i) => (
          <li key={i}>
            <strong>[{log.level}]</strong> {log.message}{" "}
            <span className="muted">{log.created_at}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
