import { useEffect, useState } from "react";
import api from "../api";

export default function SettingsPage() {
  const [settings, setSettings] = useState({ theme: "light", language: "de" });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/settings").then(res => setSettings(res.data));
  }, []);

  const save = async () => {
    setSaved(false);
    await api.put("/settings", settings);
    setSaved(true);
  };

  return (
    <div>
      <h1>Einstellungen</h1>
      <div className="form-row">
        <label>Theme</label>
        <select
          value={settings.theme}
          onChange={e => setSettings(s => ({ ...s, theme: e.target.value }))}
        >
          <option value="light">Hell</option>
          <option value="dark">Dunkel</option>
        </select>
      </div>

      <div className="form-row">
        <label>Sprache</label>
        <select
          value={settings.language}
          onChange={e =>
            setSettings(s => ({ ...s, language: e.target.value }))
          }
        >
          <option value="de">Deutsch</option>
          <option value="en">Englisch</option>
        </select>
      </div>

      <button onClick={save}>Speichern</button>
      {saved && <span className="success">Gespeichert!</span>}
    </div>
  );
}
