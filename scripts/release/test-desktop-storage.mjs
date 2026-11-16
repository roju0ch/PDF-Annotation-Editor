import { rmSync } from "node:fs";
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
      throw Error(
        `Native ${name} test compilation failed: ${compile.error?.message || compile.stderr || compile.stdout}`,
      );
    const test = spawnSync(binary, [], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    if (test.stdout) process.stdout.write(test.stdout);
    if (test.stderr) process.stderr.write(test.stderr);
    if (test.error || test.status !== 0)
      throw Error(
        `Native ${name} tests failed: ${test.error?.message || test.stdout || test.stderr}`,
      );
    const count = /test result: ok\. (\d+) passed/.exec(test.stdout)?.[1];
    if (!count) throw Error("Missing native test summary");
    console.log(
      `::notice title=Desktop native PDF tests::${name}: ${count} tests passed on ${target || process.platform}`,
    );
  } finally {
    rmSync(binary, { force: true });
  }
}
try {
  if (target) {
    // Let Cargo resolve the application's locked dependencies and artifact
    // locations. Cargo 1.100 no longer puts all rlibs in release/deps.
    const test = spawnSync(
      process.env.CARGO || "cargo",
      [
        "test",
        "--locked",
        "--release",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--target",
        target,
        "--package",
        "tauri-plugin-desktop-save",
        "--lib",
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    if (test.stdout) process.stdout.write(test.stdout);
    if (test.stderr) process.stderr.write(test.stderr);
    if (test.error || test.status !== 0)
      throw Error(
        `Native storage/process lock tests failed: ${test.error?.message || `${test.stderr}\n${test.stdout}`}`,
      );
    const count = /test result: ok\. (\d+) passed/.exec(test.stdout)?.[1];
    if (
      !count ||
      Number(count) < 13 ||
      !test.stdout.includes(
        "live_instances_survive_other_editor_startup_and_orphans_are_cleaned",
      )
    )
      throw Error("Missing native storage/process lock test summary");
    console.log(
      `::notice title=Desktop native PDF tests::storage and process locks: ${count} tests passed on ${target}`,
    );
  } else {
    runTests("storage.rs", "storage");
  }
} catch (error) {
  // Make native diagnostics available in check annotations even when CI's log
  // download endpoint is unavailable. Tests use synthetic files exclusively.
  const message = String(error?.message || error)
    .slice(0, 12000)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error title=Desktop native PDF tests::${message}`);
  process.exitCode = 1;
}
