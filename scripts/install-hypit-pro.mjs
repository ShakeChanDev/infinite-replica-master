import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("npx", [
  "--yes", "skills", "add", repoRoot, "-g", "--skill", "hypit-pro", "--agent", "codex", "--copy", "-y",
], { stdio: "inherit" });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
