import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const pkg = JSON.parse(readFileSync("package.json"));
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json"));
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").match(
  /^version = "([^"]+)"/m,
)?.[1];
const lock = JSON.parse(readFileSync("package-lock.json"));
const rustLock = readFileSync("src-tauri/Cargo.lock", "utf8").match(
  /name = "pdf-annotation-editor"\nversion = "([^"]+)"/,
)?.[1];
const version = pkg.version;
if (
  ![
    tauri.version,
    cargo,
    lock.version,
    lock.packages[""].version,
    rustLock,
  ].every((v) => v === version)
)
  throw Error(
    "Versions in package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json must match.",
  );
if (!/^0\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.test(version))
  throw Error(
    "This test pipeline only permits 0.x.y versions (minor/patch <= 999). Stable 1.0 is intentionally disabled.",
  );
if (process.env.GITHUB_EVENT_NAME === "push") {
  if (process.env.GITHUB_REF !== `refs/tags/v${version}`)
    throw Error("Tag must exactly match v" + version);
  execFileSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], {
    stdio: "inherit",
  });
}
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Validated test version ${version}`);
