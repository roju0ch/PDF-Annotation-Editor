import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const path = join(process.env.RUNNER_TEMP, "AuthKey.p8");
writeFileSync(path, Buffer.from(process.env.APPLE_API_KEY_BASE64, "base64"), {
  mode: 0o600,
});
for (const key of [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_PATH",
]) {
  const delimiter = randomUUID();
  appendFileSync(
    process.env.GITHUB_ENV,
    `${key}<<${delimiter}\n${key === "APPLE_API_KEY_PATH" ? path : process.env[key]}\n${delimiter}\n`,
  );
}
