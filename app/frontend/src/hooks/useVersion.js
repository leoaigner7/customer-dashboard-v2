import { useEffect, useState } from "react";
import api from "../api";

export default function useVersion() {
  const [version, setVersion] = useState("…");

  useEffect(() => {
    api.get("/version")
      .then(res => setVersion(res.data.version))
      .catch(() => setVersion("unknown"));
  }, []);

  return version;
}
