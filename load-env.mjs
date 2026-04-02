import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  config({ path: envPath });
}
