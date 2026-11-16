import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const version = JSON.parse(readFileSync("package.json")).version;
const tag = `v${version}`;
if (
  process.env.GITHUB_EVENT_NAME !== "push" ||
  process.env.GITHUB_REF !== `refs/tags/${tag}` ||
  !/^v0\.\d+\.\d+$/.test(tag)
)
  throw Error("Publication is restricted to approved v0.x.y tag pushes.");
const targets = {
  "windows-x64": ["exe"],
  "macos-intel": ["dmg"],
  "macos-apple-silicon": ["dmg"],
  "linux-x64": ["AppImage", "deb"],
  "android-arm64-test": ["apk"],
};
const assets = [];
for (const [target, extensions] of Object.entries(targets)) {
  const manifest = JSON.parse(readFileSync(`release-assets/${target}.json`));
  if (
    manifest.version !== version ||
    manifest.commit !== process.env.GITHUB_SHA ||
    manifest.target !== target
  )
    throw Error("Artifact version/commit mismatch: " + target);
  if (manifest.files.length !== extensions.length)
    throw Error("Artifact inventory mismatch: " + target);
  for (const ext of extensions) {
    const name = `PDF-Annotation-Editor_${version}_${target}.${ext}`;
    const entry = manifest.files.find((f) => f.name === name);
    const data = readFileSync("release-assets/" + name);
    if (
      !entry ||
      entry.bytes !== data.length ||
      entry.sha256 !== createHash("sha256").update(data).digest("hex")
    )
      throw Error("Artifact checksum mismatch: " + name);
    assets.push(name);
  }
}
const manifests = Object.keys(targets).map((t) => t + ".json");
if (
  readdirSync("release-assets").some(
    (f) => ![...assets, ...manifests].includes(f),
  )
)
  throw Error("Unexpected artifact file");
writeFileSync(
  "release-assets/SHA256SUMS.txt",
  assets
    .map(
      (name) =>
        createHash("sha256")
          .update(readFileSync("release-assets/" + name))
          .digest("hex") +
        "  " +
        name,
    )
    .join("\n") + "\n",
);
const notes = `Testversion ${tag} – keine stabile Veröffentlichung.\n\nWindows: NSIS mit WebView2-Offline-Installer. macOS: separate Intel-/Apple-Silicon-DMGs. Linux x64: AppImage und DEB. Android: ARM64-Test-APK.\n\nSignierungsstatus siehe die beigefügten Plattform-Manifeste. Ohne eigene Zertifikate sind Desktop-Pakete unsigniert/ad-hoc-signiert und die APK hat einen kurzlebigen CI-Testschlüssel: Android-Updates zwischen solchen Builds erfordern Deinstallation. Keine Store-Freigabe oder Zusage für jedes Gerät.\n\nInstallation, Signierung, Systemvoraussetzungen und Einschränkungen: https://github.com/${process.env.GITHUB_REPOSITORY}/blob/${tag}/docs/RELEASES.md\n\nProgrammdateien und MuPDF-WASM sind lokal enthalten. Prüfsummen: SHA256SUMS.txt. Quellcode und AGPL-Lizenz liegen am selben Tag.\n`;
writeFileSync("release-notes.md", notes);
const gh = (args) => execFileSync("gh", args, { stdio: "inherit" });
// Never mutate an existing public release; a failed draft can be removed and retried.
gh([
  "release",
  "create",
  tag,
  "--verify-tag",
  "--draft",
  "--prerelease",
  "--latest=false",
  "--title",
  `PDF Annotation Editor ${tag} · Testversion`,
  "--notes-file",
  "release-notes.md",
  ...[...assets, ...manifests, "SHA256SUMS.txt"].map(
    (f) => "release-assets/" + f,
  ),
]);
gh(["release", "edit", tag, "--draft=false", "--prerelease", "--latest=false"]);
