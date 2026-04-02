import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEntriesBackend } from "../entries-store.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = createEntriesBackend(rootDir);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** @param {unknown} data @param {number} [status] */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

/** @returns {Promise<unknown | null>} */
async function readJsonBody(request) {
  const raw = await request.text();
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      await backend.init();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api/entries] init", msg, e);
      return jsonResponse({ error: msg }, 500);
    }

    if (!backend.usesTurso && process.env.VERCEL) {
      return jsonResponse(
        {
          error:
            "Trên Vercel cần TURSO_DATABASE_URL và TURSO_AUTH_TOKEN (không ghi được file JSONL).",
        },
        503
      );
    }

    try {
      if (request.method === "GET") {
        const items = await backend.readAllEntries();
        return jsonResponse(items, 200);
      }

      if (request.method === "POST") {
        let body;
        try {
          body = await readJsonBody(request);
        } catch {
          return jsonResponse({ error: "invalid json" }, 400);
        }
        if (!body || typeof body.id !== "string" || typeof body.at !== "string") {
          return jsonResponse({ error: "invalid body" }, 400);
        }
        await backend.appendEntry({
          id: body.id,
          at: body.at,
          note: typeof body.note === "string" ? body.note : "",
        });
        return jsonResponse({ ok: true }, 201);
      }

      if (request.method === "PUT") {
        let body;
        try {
          body = await readJsonBody(request);
        } catch {
          return jsonResponse({ error: "invalid json" }, 400);
        }
        if (!Array.isArray(body)) {
          return jsonResponse({ error: "expected JSON array" }, 400);
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
        return jsonResponse({ ok: true }, 200);
      }

      return jsonResponse({ error: "method not allowed" }, 405);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api/entries]", request.method, msg, e);
      return jsonResponse({ error: msg }, 500);
    }
  },
};
