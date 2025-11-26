const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");

function resolvePath(baseDir, p) {
  return path.resolve(baseDir, p);
}

function log(msg, config) {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${msg}\n`;
  if (config.notification?.logFile) {
    const logPath = resolvePath(__dirname, config.notification.logFile);
    fs.appendFileSync(logPath, line);
  }
  console.log(line.trim());
}

function readEnvVersion(baseDir, envFile, key) {
  const filePath = resolvePath(baseDir, envFile);
  const content = fs.readFileSync(filePath, "utf8");
  const line = content.split("\n").find(l => l.startsWith(key + "="));
  return line ? line.split("=")[1].trim() : null;
}

function writeEnvVersion(baseDir, envFile, key, version) {
  const filePath = resolvePath(baseDir, envFile);
  let content = fs.readFileSync(filePath, "utf8").split("\n");
  let found = false;

  content = content.map(line => {
    if (line.startsWith(key + "=")) {
      found = true;
      return `${key}=${version}`;
    }
    return line;
  });

  if (!found) content.push(`${key}=${version}`);
  fs.writeFileSync(filePath, content.join("\n"));
}

function downloadImage(config, version) {
  const image = config.artifacts.imageTemplate.replace("{version}", version);
  execSync(`docker pull ${image}`, { stdio: "inherit" });
  return image;
}

function restartDashboard(baseDir, composeFile, serviceName) {
  const composePath = resolvePath(baseDir, composeFile);
  const svc = serviceName || "dashboard";

  execSync(`docker compose -f "${composePath}" stop ${svc}`, {
    stdio: "inherit"
  });

  execSync(`docker compose -f "${composePath}" up -d ${svc}`, {
    stdio: "inherit"
  });
}

module.exports = {
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard,
  log,
  resolvePath
};
