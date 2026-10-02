// Installs Pashov Audit Group's skills from the pinned submodule (vendor/pashov-skills) into
// .claude/skills/, where Claude Code picks up project skills. Used by the @claude workflow and
// for local Claude Code sessions: `npm run skills:install`.
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor", "pashov-skills");
const SKILLS = ["x-ray", "solidity-auditor", "fizz"];

if (!existsSync(path.join(vendor, "README.md"))) {
  console.error("vendor/pashov-skills is empty: run `git submodule update --init` first.");
  process.exit(1);
}

for (const skill of SKILLS) {
  const dest = path.join(root, ".claude", "skills", skill);
  rmSync(dest, { recursive: true, force: true });
  cpSync(path.join(vendor, skill), dest, { recursive: true });
  // The skills' Node scripts are CommonJS, but this repo's package.json says "type": "module",
  // which Node would apply to them too. A package.json in the skill folder restores CommonJS.
  writeFileSync(path.join(dest, "package.json"), '{ "type": "commonjs" }
');
  console.log(`installed ${skill} -> .claude/skills/${skill}`);
}
