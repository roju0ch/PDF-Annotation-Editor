import {
  readdirSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
const [root, target, formats] = process.argv.slice(2);
if (!root || !/^[a-z0-9-]+$/.test(target) || !formats)
  throw Error(
    "Expected bundle directory, target and comma-separated extensions",
  );
const version = JSON.parse(readFileSync("package.json")).version;
const extensions = formats.split(",");
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)],
  );
}
const files = walk(root).filter((p) =>
  extensions.includes(extname(p).slice(1)),
);
mkdirSync("release-assets", { recursive: true });
const entries = extensions.map((ext) => {
  const matches = files.filter((p) => extname(p) === "." + ext);
  if (matches.length !== 1)
    throw Error(`Expected one ${ext}, found ${matches.length}`);
  const name = `PDF-Annotation-Editor_${version}_${target}.${ext}`;
  const bytes = readFileSync(matches[0]);
  copyFileSync(matches[0], join("release-assets", name));
  return {
    name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});
writeFileSync(
  `release-assets/${target}.json`,
  JSON.stringify(
    {
      version,
      commit: process.env.GITHUB_SHA,
      target,
      signing: process.env.PACKAGE_SIGNING || "unsigned",
      files: entries,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(entries, null, 2));

for (const entry of entries) {
  console.log(
    `::notice title=Installation package::${entry.name} | ${entry.bytes} bytes | SHA256 ${entry.sha256}`,
  );
}
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    entries
      .map((e) => `- **${e.name}**: ${e.bytes} bytes; SHA256 \`${e.sha256}\``)
      .join("\n") + "\n",
  );
