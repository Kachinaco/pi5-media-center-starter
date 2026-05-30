#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const PORT = Number(process.env.PI_HOME_LAUNCHER_PORT || 8899);
const HOST = process.env.PI_HOME_LAUNCHER_HOST || "127.0.0.1";
const LIVE_ROOT = process.env.PI_HOME_LIVE_ROOT || path.join(os.homedir(), "pi-home-live");
const DATA_DIR = process.env.PI_HOME_DATA_DIR || path.join(os.homedir(), ".local", "share", "pi-home");
const WATCH_HISTORY_PATH = process.env.PI_HOME_WATCH_HISTORY_PATH || path.join(DATA_DIR, "watch-history.json");
const ALLOWED_ORIGINS = (process.env.PI_HOME_ALLOWED_ORIGINS || "http://127.0.0.1:8888,http://localhost:8888")
  .split(",")
  .map(item => item.trim())
  .filter(Boolean);

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers
  });
  res.end(data);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      "vary": "Origin"
    };
  }
  return {};
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data.trim()) return resolve(null);
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function execText(command, args, timeout = 1500) {
  return new Promise(resolve => {
    execFile(command, args, { timeout }, (error, stdout) => {
      resolve(error ? "" : String(stdout).trim());
    });
  });
}

async function readWatchHistory() {
  try {
    const text = await fs.readFile(WATCH_HISTORY_PATH, "utf8");
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeWatchHistory(items) {
  if (!Array.isArray(items)) {
    throw new Error("watch history must be an array");
  }
  await fs.mkdir(path.dirname(WATCH_HISTORY_PATH), { recursive: true });
  const tmp = `${WATCH_HISTORY_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2) + "\n", "utf8");
  await fs.rename(tmp, WATCH_HISTORY_PATH);
}

async function statusPayload() {
  const temp = await execText("vcgencmd", ["measure_temp"]);
  const disk = await execText("df", ["-h", LIVE_ROOT]);
  const load = os.loadavg();
  return {
    ok: true,
    host: os.hostname(),
    platform: os.platform(),
    uptimeSeconds: Math.round(os.uptime()),
    memory: {
      total: os.totalmem(),
      free: os.freemem()
    },
    load,
    temperature: temp || null,
    disk: disk || null,
    liveRoot: "configured",
    dataDir: "configured"
  };
}

async function statsPayload() {
  const status = await statusPayload();
  const totalGb = status.memory.total / 1024 / 1024 / 1024;
  const freeGb = status.memory.free / 1024 / 1024 / 1024;
  const usedGb = Math.max(totalGb - freeGb, 0);
  const tempMatch = status.temperature && status.temperature.match(/temp=([0-9.]+)/);
  return {
    ok: true,
    hostname: status.host,
    tailscale_ip: null,
    uptime_seconds: status.uptimeSeconds,
    cpu_temp_c: tempMatch ? Number(tempMatch[1]) : null,
    memory: {
      used_gb: Math.round(usedGb * 10) / 10,
      total_gb: Math.round(totalGb * 10) / 10,
      percent_used: totalGb ? Math.round((usedGb / totalGb) * 100) : 0
    },
    load_average: status.load.map(value => Math.round(value * 100) / 100),
    temperature: status.temperature,
    disk_raw: status.disk,
    disk: {
      used: "unknown",
      total: "unknown",
      percent_used: 0
    }
  };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "OPTIONS") {
    return send(res, 204, "", corsHeaders(req));
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return send(res, 200, await statusPayload());
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    return send(res, 200, await statsPayload());
  }

  if (req.method === "GET" && url.pathname === "/api/watch-history") {
    return send(res, 200, await readWatchHistory(), corsHeaders(req));
  }

  if (req.method === "POST" && url.pathname === "/api/watch-history") {
    const body = await readJsonBody(req);
    const items = Array.isArray(body) ? body : body && body.items;
    await writeWatchHistory(items);
    return send(res, 200, { ok: true, count: items.length }, corsHeaders(req));
  }

  if (req.method === "GET" && url.pathname === "/api/current-playback") {
    return send(res, 200, { active: false, current: null });
  }

  if (req.method === "GET" && url.pathname.startsWith("/calendar/")) {
    if (url.pathname === "/calendar/accounts") {
      return send(res, 200, { ok: true, accounts: [] });
    }
    if (url.pathname === "/calendar/events") {
      return send(res, 200, { ok: true, events: [] });
    }
    return send(res, 200, { ok: false, configured: false });
  }

  return send(res, 404, { ok: false, error: "not found" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch(error => send(res, 500, { ok: false, error: error.message }));
});

server.listen(PORT, HOST, () => {
  console.log(`pi-home launcher listening on http://${HOST}:${PORT}`);
});
