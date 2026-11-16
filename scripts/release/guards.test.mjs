import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { androidBuildConfig, verifyAndroidPackage } from "./android-config.mjs";

test("temporary Android test keys use a separate identity; persistent builds retain the production app", () => {
  const base = { identifier: "io.example.pdf", productName: "PDF Viewer" };
  assert.deepEqual(androidBuildConfig(base, false), {
    identifier: "io.example.pdf.test",
    productName: "PDF Viewer Test",
  });
  assert.deepEqual(androidBuildConfig(base, true), {});
  assert.equal(
    verifyAndroidPackage(
      "package: name='io.example.pdf.test' versionCode='1'",
      base,
      false,
    ),
    "io.example.pdf.test",
  );
  assert.equal(
    verifyAndroidPackage(
      "package: name='io.example.pdf' versionCode='1'",
      base,
      true,
    ),
    "io.example.pdf",
  );
});

test("Android packaging rejects the production identity under an ephemeral test key", () => {
  const base = { identifier: "io.example.pdf", productName: "PDF Viewer" };
  assert.throws(
    () => verifyAndroidPackage("package: name='io.example.pdf'", base, false),
    /identity mismatch/,
  );
  assert.throws(
    () => verifyAndroidPackage("", base, false),
    /identity mismatch/,
  );
  assert.throws(
    () =>
      verifyAndroidPackage("package: name='io.example.pdf.test'", base, true),
    /identity mismatch/,
  );
});
const validate = resolve("scripts/release/validate.mjs"),
  publish = resolve("scripts/release/publish.mjs");
function fixture(version) {
  const dir = mkdtempSync(join(tmpdir(), "release-guard-"));
  mkdirSync(join(dir, "src-tauri"));
  const write = (name, value) =>
    writeFileSync(
      join(dir, name),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  write("package.json", { version });
  write("package-lock.json", { version, packages: { "": { version } } });
  write("src-tauri/tauri.conf.json", { version });
  write("src-tauri/Cargo.toml", `[package]\nversion = "${version}"\n`);
  write(
    "src-tauri/Cargo.lock",
    `name = "pdf-annotation-editor"\nversion = "${version}"\n`,
  );
  return { dir, write };
}
const run = (script, cwd, event, ref) =>
  spawnSync(process.execPath, [script], {
    cwd,
    env: {
      ...process.env,
      GITHUB_OUTPUT: "",
      GITHUB_EVENT_NAME: event,
      GITHUB_REF: ref,
    },
    encoding: "utf8",
  });
test("test builds accept matching 0.x.y versions but reject stable 1.0 and mismatched lockfiles", () => {
  const f = fixture("0.1.0");
  try {
    assert.equal(
      run(validate, f.dir, "workflow_dispatch", "refs/heads/main").status,
      0,
    );
    f.write("src-tauri/tauri.conf.json", { version: "0.2.0" });
    assert.notEqual(
      run(validate, f.dir, "workflow_dispatch", "refs/heads/main").status,
      0,
    );
  } finally {
    rmSync(f.dir, { recursive: true });
  }
  const stable = fixture("1.0.0");
  try {
    assert.match(
      run(validate, stable.dir, "workflow_dispatch", "refs/heads/main").stderr,
      /Stable 1.0 is intentionally disabled/,
    );
  } finally {
    rmSync(stable.dir, { recursive: true });
  }
});
test("tag/version mismatch fails before building or publishing", () => {
  const f = fixture("0.1.0");
  try {
    assert.match(
      run(validate, f.dir, "push", "refs/tags/v0.2.0").stderr,
      /Tag must exactly match/,
    );
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});
test("pull requests and manual runs cannot publish; missing artifacts block tag publication", () => {
  const f = fixture("0.1.0");
  try {
    for (const event of ["pull_request", "workflow_dispatch"])
      assert.match(
        run(publish, f.dir, event, "refs/tags/v0.1.0").stderr,
        /Publication is restricted/,
      );
    const result = run(publish, f.dir, "push", "refs/tags/v0.1.0");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /windows-x64.json/);
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});

test("tampered package is rejected before any GitHub release is created", () => {
  const f = fixture("0.1.0");
  try {
    mkdirSync(join(f.dir, "release-assets"));
    const name = "PDF-Annotation-Editor_0.1.0_windows-x64.exe";
    f.write("release-assets/" + name, "tampered");
    f.write("release-assets/windows-x64.json", {
      version: "0.1.0",
      commit: process.env.GITHUB_SHA,
      target: "windows-x64",
      files: [{ name, bytes: 8, sha256: "incorrect" }],
    });
    assert.match(
      run(publish, f.dir, "push", "refs/tags/v0.1.0").stderr,
      /Artifact checksum mismatch/,
    );
  } finally {
    rmSync(f.dir, { recursive: true });
  }
});
