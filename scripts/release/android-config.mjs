import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Ephemeral test keys must not require uninstalling the owner's installed app. */
export function androidBuildConfig(base, signed) {
  if (signed) return {};
  return {
    identifier: `${base.identifier}.test`,
    productName: `${base.productName} Test`,
  };
}

export function verifyAndroidPackage(badging, base, signed) {
  const expected =
    androidBuildConfig(base, signed).identifier ?? base.identifier;
  const actual = /^package: name='([^']+)'/m.exec(badging)?.[1];
  if (actual !== expected)
    throw new Error(
      `Android package identity mismatch: expected ${expected}, got ${actual ?? "unknown"}`,
    );
  return actual;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const base = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const signed = process.env.SIGN_ANDROID === "true";
  const [mode, file] = process.argv.slice(2);
  if (!file || !["prepare", "verify"].includes(mode))
    throw new Error("Expected prepare CONFIG or verify AAPT_OUTPUT");
  if (mode === "prepare") {
    writeFileSync(
      file,
      JSON.stringify(androidBuildConfig(base, signed)) + "\n",
    );
  } else {
    const id = verifyAndroidPackage(readFileSync(file, "utf8"), base, signed);
    console.log(
      `::notice title=Android application identity::${id}${signed ? " (persistent signing key)" : " (PDF Viewer Test, installs alongside the original app)"}`,
    );
  }
}
