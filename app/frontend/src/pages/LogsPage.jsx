import { useEffect, useState } from "react";
import api from "../api";

export default function LogsPage() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    api.get("/logs").then(res => setLogs(res.data));
  }, []);

  return (
    <div>
      <h1>Logs</h1>
      <ul className="logs">
        {logs.map((log, i) => (
          <li key={i}>
            <strong>[{log.level}]</strong> {log.message}{" "}
            <span className="muted">{log.created_at}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
