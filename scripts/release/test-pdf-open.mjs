import { spawnSync } from "node:child_process";
const target = process.argv[2];
if (!target) throw new Error("Missing native target");
const result = spawnSync(
  "cargo",
  [
    "test",
    "--locked",
    "--release",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--target",
    target,
    "--package",
    "tauri-plugin-pdf-open",
    "--lib",
  ],
  { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
const count = /test result: ok\. (\d+) passed/.exec(result.stdout || "")?.[1];
if (result.error || result.status !== 0 || !count || Number(count) === 0) {
  const output = result.error?.message || `${result.stderr}\n${result.stdout}`;
  const detail = String(output)
    .slice(-12000)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error title=Native external PDF-open tests::${detail}`);
  process.exitCode = 1;
} else {
  console.log(
    `::notice title=Native external PDF-open tests::${count} native queue/path/cache/chunk tests passed on ${target}.`,
  );
}
