import { createClient } from "@libsql/client";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * @param {string} rootDir Thư mục gốc project (chứa file JSONL khi không dùng Turso)
 */
export function createEntriesBackend(rootDir) {
  const DATA = path.join(rootDir, "phieu-be-ngoan-data.jsonl");
  const TURSO_URL = (
    process.env.TURSO_DATABASE_URL ||
    process.env.LIBSQL_DATABASE_URL ||
    ""
  ).trim();
  const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || "").trim();
  const useTurso = Boolean(TURSO_URL && TURSO_TOKEN);

  /** @type {import("@libsql/client").Client | null} */
  let turso = null;

  return {
    get usesTurso() {
      return useTurso;
    },

    async init() {
      if (!useTurso) return;
      turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
      await turso.execute(`
    CREATE TABLE IF NOT EXISTS phieu_entries (
      id TEXT PRIMARY KEY NOT NULL,
      at TEXT NOT NULL,
      note TEXT NOT NULL
    )
  `);
    },

    /** @returns {Promise<{ id: string, at: string, note: string }[]>} */
    async readAllEntries() {
      if (turso) {
        const r = await turso.execute(
          "SELECT id, at, note FROM phieu_entries ORDER BY at DESC"
        );
        return r.rows.map((row) => ({
          id: String(row.id ?? ""),
          at: String(row.at ?? ""),
          note: String(row.note ?? ""),
        }));
      }
      let raw;
      try {
        raw = await fs.readFile(DATA, "utf8");
      } catch (e) {
        if (e && e.code === "ENOENT") return [];
        throw e;
      }
      const out = [];
      const seen = new Set();
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const o = JSON.parse(t);
          if (o && typeof o.id === "string" && !seen.has(o.id)) {
            seen.add(o.id);
            out.push({
              id: o.id,
              at: typeof o.at === "string" ? o.at : "",
              note: typeof o.note === "string" ? o.note : "",
            });
          }
        } catch {
          /* bỏ qua dòng hỏng */
        }
      }
      return out;
    },

    /** @param {{ id: string, at: string, note: string }} entry */
    async appendEntry(entry) {
      if (turso) {
        await turso.execute({
          sql: `INSERT INTO phieu_entries (id, at, note) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              at = excluded.at,
              note = excluded.note`,
          args: [entry.id, entry.at, entry.note],
        });
        return;
      }
      const line = JSON.stringify(entry) + "\n";
      await fs.appendFile(DATA, line, "utf8");
    },

    /** @param {{ id: string, at: string, note: string }[]} items */
    async writeAllEntries(items) {
      if (turso) {
        const tx = await turso.transaction("write");
        try {
          await tx.execute({ sql: "DELETE FROM phieu_entries", args: [] });
          for (const x of items) {
            await tx.execute({
              sql: "INSERT INTO phieu_entries (id, at, note) VALUES (?, ?, ?)",
              args: [x.id, x.at, x.note],
            });
          }
          await tx.commit();
        } finally {
          tx.close();
        }
        return;
      }
      const body =
        items.map((x) => JSON.stringify(x)).join("\n") +
        (items.length ? "\n" : "");
      await fs.writeFile(DATA, body, "utf8");
    },
  };
}
