import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const providerPath = join(repoRoot, "packages", "provider-vip-brioi");
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const workspaceValue = option("--workspace");
if (!workspaceValue) {
  console.error("Usage: npm run setup:hypit-vip -- --workspace /path/to/hypit-video-project [--profile path]");
  process.exit(2);
}

const workspace = resolve(workspaceValue);
const profile = resolve(option("--profile", join(workspace, "hypit.runtime.vip.json")));
if (!existsSync(join(workspace, "package.json"))) {
  throw new Error(`Hypit project package.json not found: ${workspace}`);
}

const initial = existsSync(profile)
  ? JSON.parse(readFileSync(profile, "utf8"))
  : { format: "hypit.runtime-local@1", dataRoot: ".hypit/execution" };
const existingEndpoint = initial.endpoints?.["vip-brioi.video"];
if (existingEndpoint !== undefined && existingEndpoint.use !== "@infinite-replica/provider-vip-brioi") {
  throw new Error("Existing vip-brioi.video endpoint uses a different Provider; resolve it before setup");
}
for (const model of ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2.5"]) {
  const binding = initial.bindings?.[`@hypit/seedance@1#${model}`];
  if (binding !== undefined && binding !== "vip-brioi.video") {
    throw new Error(`Existing Seedance binding for ${model} points to ${binding}; resolve it before setup`);
  }
}

execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });

if (!hasFlag("--skip-skill")) {
  run("node", [join(repoRoot, "scripts", "install-hypit-pro.mjs")], repoRoot);
}

const packageManager = existsSync(join(workspace, "pnpm-lock.yaml")) ? "pnpm" : "npm";
run(packageManager, packageManager === "pnpm" ? ["add", providerPath] : ["install", providerPath], workspace);

const next = {
  ...initial,
  credentials: {
    ...(initial.credentials ?? {}),
    platform: initial.credentials?.platform ?? { use: "@hypit/credential-store-platform" },
  },
  endpoints: {
    ...(initial.endpoints ?? {}),
    "vip-brioi.video": {
      ...(initial.endpoints?.["vip-brioi.video"] ?? {}),
      use: "@infinite-replica/provider-vip-brioi",
      config: {
        baseUrl: "https://vip.brioi.com",
        apiKey: { store: "platform", key: "vip-brioi.personal" },
        concurrency: 1,
        pollIntervalMs: 5000,
        personReferencePolicy: "advisory",
        ...(initial.endpoints?.["vip-brioi.video"]?.config ?? {}),
      },
    },
  },
  bindings: {
    ...(initial.bindings ?? {}),
    "@hypit/seedance@1#seedance-2": "vip-brioi.video",
    "@hypit/seedance@1#seedance-2-fast": "vip-brioi.video",
    "@hypit/seedance@1#seedance-2-mini": "vip-brioi.video",
    "@hypit/seedance@1#seedance-2.5": "vip-brioi.video",
  },
};

writeFileSync(profile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Wrote VIP Runtime Profile: ${profile}`);
console.log(`Next: hypit runtime use ${profile} --workspace ${workspace}`);
console.log(`Then: hypit auth login vip-brioi.video --workspace ${workspace}`);
