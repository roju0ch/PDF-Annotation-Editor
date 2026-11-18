import { spawnSync } from "node:child_process";
const result = spawnSync(
  "swift",
  ["test", "--package-path", "src-tauri/plugins/tauri-plugin-ios-bridge/core"],
  { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
const output = (result.stdout || "") + (result.stderr || "");
const summaries = [
  ...output.matchAll(/Executed (\d+) tests?, with (\d+) failures?/g),
];
const passed = Math.max(
  0,
  ...summaries
    .filter((match) => match[2] === "0")
    .map((match) => Number(match[1])),
);
if (result.error || result.status !== 0 || passed === 0) {
  const detail = String(result.error?.message || output.slice(-12000))
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error title=iOS native PDF staging tests::${detail}`);
  process.exitCode = 1;
} else {
  console.log(
    `::notice title=iOS native PDF staging tests::${passed} real-file XCTest cases passed on macOS Foundation; full iOS SDK compilation follows.`,
  );
}
