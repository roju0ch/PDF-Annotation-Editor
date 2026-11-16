import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const target = process.argv[2];
const compiler = process.env.RUSTC || "rustc";
const root = "src-tauri/plugins/tauri-plugin-desktop-save/src";
function runTests(source, name, extra = []) {
  const binary = join(
    process.env.RUNNER_TEMP || tmpdir(),
    `pdf-${name}-tests-${process.pid}${process.platform === "win32" ? ".exe" : ""}`,
  );
  try {
    const compile = spawnSync(
      compiler,
      [
        "--edition=2021",
        "--test",
        resolve(root, source),
        ...extra,
        "-o",
        binary,
      ],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    if (compile.stdout) process.stdout.write(compile.stdout);
    if (compile.stderr) process.stderr.write(compile.stderr);
    if (compile.error || compile.status !== 0)
      throw Error(`Native ${name} test compilation failed`);
    const test = spawnSync(binary, [], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    if (test.stdout) process.stdout.write(test.stdout);
    if (test.stderr) process.stderr.write(test.stderr);
    if (test.error || test.status !== 0)
      throw Error(`Native ${name} tests failed`);
    const count = /test result: ok\. (\d+) passed/.exec(test.stdout)?.[1];
    if (!count) throw Error("Missing native test summary");
    console.log(
      `::notice title=Desktop native PDF tests::${name}: ${count} tests passed on ${target || process.platform}`,
    );
  } finally {
    rmSync(binary, { force: true });
  }
}
runTests("storage.rs", "storage");
if (target) {
  // Use the exact dependency builds from the successfully compiled application.
  const deps = resolve("src-tauri/target", target, "release/deps");
  const library = (name) => {
    const files = readdirSync(deps).filter(
      (file) => file.startsWith(`lib${name}-`) && file.endsWith(".rlib"),
    );
    if (files.length !== 1)
      throw Error(
        `Expected one compiled ${name} dependency, found ${files.length}`,
      );
    return join(deps, files[0]);
  };
  runTests("cache.rs", "cache-locks", [
    "--target",
    target,
    "-L",
    `dependency=${deps}`,
    "--extern",
    `fs2=${library("fs2")}`,
    "--extern",
    `uuid=${library("uuid")}`,
  ]);
}
