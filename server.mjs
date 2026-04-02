import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEntriesBackend } from "./entries-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const DATA = path.join(ROOT, "phieu-be-ngoan-data.jsonl");
const backend = createEntriesBackend(ROOT);

const TURSO_URL = (
  process.env.TURSO_DATABASE_URL ||
  process.env.LIBSQL_DATABASE_URL ||
  ""
).trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || "").trim();

const PORT_START = Number(process.env.PORT) || 3333;
const PORT_TRY_MAX = 30;
let listenPort = PORT_START;

/** @param {import('node:http').ServerResponse} res */
function sendJson(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(buf);
}

/** @param {import('node:http').IncomingMessage} req */
async function parseBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function safeResolveStatic(urlPath) {
  const rel =
    urlPath === "/" || urlPath === ""
      ? "index.html"
      : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const abs = path.resolve(ROOT, rel);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (abs !== ROOT && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (url.pathname === "/api/entries") {
    try {
      if (req.method === "GET") {
        const items = await backend.readAllEntries();
        sendJson(res, 200, items);
        return;
      }
      if (req.method === "POST") {
        const body = await parseBody(req);
        if (!body || typeof body.id !== "string" || typeof body.at !== "string") {
          sendJson(res, 400, { error: "invalid body" });
          return;
        }
        await backend.appendEntry({
          id: body.id,
          at: body.at,
          note: typeof body.note === "string" ? body.note : "",
        });
        sendJson(res, 201, { ok: true });
        return;
      }
      if (req.method === "PUT") {
        const body = await parseBody(req);
        if (!Array.isArray(body)) {
          sendJson(res, 400, { error: "expected JSON array" });
          return;
        }
        const cleaned = body.filter(
          (x) => x && typeof x.id === "string" && typeof x.at === "string"
        );
        await backend.writeAllEntries(
          cleaned.map((x) => ({
            id: x.id,
            at: x.at,
            note: typeof x.note === "string" ? x.note : "",
          }))
        );
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 405, { error: "method not allowed" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api/entries]", req.method, msg, e);
      sendJson(res, 500, { error: msg });
    }
    return;
  }

  const filePath = safeResolveStatic(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".jsonl": "application/jsonl; charset=utf-8",
      ".ico": "image/x-icon",
    };
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (e && e.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(500);
    res.end(String(e));
  }
});

function logReady() {
  const addr = server.address();
  const p =
    addr && typeof addr === "object" && "port" in addr ? addr.port : listenPort;
  console.log(`Mở trình duyệt: http://localhost:${p}`);
  if (backend.usesTurso) {
    console.log("Lưu trữ: Turso (bảng phieu_entries)");
  } else {
    console.log(`File dữ liệu (tự tạo khi tích đầu tiên): ${DATA}`);
    if (TURSO_URL && !TURSO_TOKEN) {
      console.warn(
        "Có TURSO_DATABASE_URL nhưng thiếu TURSO_AUTH_TOKEN → dùng file JSONL."
      );
    }
  }
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const taken = listenPort;
    listenPort += 1;
    if (listenPort > PORT_START + PORT_TRY_MAX) {
      console.error(
        `Cổng ${PORT_START}–${PORT_START + PORT_TRY_MAX} đều đang bận. ` +
          `Tắt server cũ hoặc chạy: PORT=9000 npm start`
      );
      process.exit(1);
    }
    console.warn(`Cổng ${taken} đang bận → thử ${listenPort}…`);
    server.listen(listenPort);
    return;
  }
  console.error(err);
  process.exit(1);
});

backend
  .init()
  .then(() => {
    server.listen(listenPort, logReady);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
