import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, ".agents", "skills", "hypit-pro");

test("hypitPro retains a resolvable reference for every production topic in its entrypoint", () => {
  const source = readFileSync(join(skill, "SKILL.md"), "utf8");
  const references = new Set([...source.matchAll(/references\/[a-zA-Z0-9./-]+\.md/g)].map(([path]) => path));
  assert.ok(references.size > 50);
  for (const path of references) assert.ok(existsSync(join(skill, path)), `Missing Skill reference: ${path}`);
  assert.ok(existsSync(join(skill, "LICENSE")));
});

test("hypitPro is installed from this repository without replacing the official hypit skill", () => {
  const installer = readFileSync(join(root, "scripts", "install-hypit-pro.mjs"), "utf8");
  assert.match(installer, /"--skill", "hypit-pro"/);
  assert.doesNotMatch(installer, /"--skill", "hypit"/);
  assert.doesNotMatch(installer, /"hypit-ai\/hypit"/);
  execFileSync(process.execPath, ["--check", join(root, "scripts", "install-hypit-pro.mjs")]);
});

test("VIP setup refuses conflicting routing before changing an existing project", () => {
  const workspace = mkdtempSync(join(tmpdir(), "hypit-pro-routing-"));
  try {
    const packagePath = join(workspace, "package.json");
    const profilePath = join(workspace, "hypit.runtime.vip.json");
    const packageText = JSON.stringify({ name: "routing-test", version: "1.0.0", private: true });
    const profileText = JSON.stringify({
      format: "hypit.runtime-local@1", dataRoot: ".hypit/execution",
      bindings: { "@hypit/seedance@1#seedance-2-mini": "another.account" },
    });
    writeFileSync(packagePath, packageText);
    writeFileSync(profilePath, profileText);
    const result = spawnSync(process.execPath, [
      join(root, "scripts", "setup-hypit-vip.mjs"), "--workspace", workspace, "--skip-skill",
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Existing Seedance binding/);
    assert.equal(readFileSync(packagePath, "utf8"), packageText);
    assert.equal(readFileSync(profilePath, "utf8"), profileText);
    assert.equal(existsSync(join(workspace, "node_modules")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
