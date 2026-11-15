import { spawn } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
let tail = "";
function output(chunk, stream) {
  stream.write(chunk);
  tail = (tail + chunk.toString()).slice(-12000);
}
child.stdout.on("data", (chunk) => output(chunk, process.stdout));
child.stderr.on("data", (chunk) => output(chunk, process.stderr));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code) => {
  if (code !== 0) {
    // GitHub logs can be inaccessible from a restricted Cloud workspace. Expose
    // a short, redacted failure tail through the check's error annotations too.
    for (const [key, value] of Object.entries(process.env))
      if (
        /TOKEN|PASSWORD|SECRET|CERTIFICATE|PRIVATE|API_KEY/.test(key) &&
        value &&
        value.length > 3
      )
        tail = tail.split(value).join("[REDACTED]");
    const message = tail
      .slice(-3000)
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    console.error(`::error title=Build command failed::${message}`);
    process.exitCode = code || 1;
  }
});
