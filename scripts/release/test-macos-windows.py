"""Exercise real macOS LaunchServices delivery into two actual Tauri windows.

The optional native-window-tests build reports read-only native/React state for
synthetic PDFs. This verifier does not automate Accessibility, fake a successful
window, or expose a production command channel. Ordinary DMG builds exclude the
diagnostic feature; this separately built loose .app is never an installer.
"""

import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unicodedata


def escaped(value):
    return str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def one_page_pdf(path):
    """Independent minimal PDF writer; the real app still uses its own importer."""
    stream = b"0.2 0.4 0.8 rg 40 40 120 100 re f\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
    ]
    output = bytearray(b"%PDF-1.7\n")
    offsets = []
    for index, item in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(str(index).encode() + b" 0 obj\n" + item + b"\nendobj\n")
    xref = len(output)
    output.extend(b"xref\n0 5\n0000000000 65535 f \n")
    for offset in offsets:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(f"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    path.write_bytes(output)


def command(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(
            f"{args[0]} exited with {result.returncode}: "
            + (result.stderr or result.stdout).strip()[-6000:]
        )
    return result.stdout + result.stderr


def cleanup_processes(app, pids):
    # Only terminate a process observed in our report and still executing our
    # exact probe bundle. Never use killall or affect another PDF application.
    prefix = str(app / "Contents/MacOS") + "/"
    for pid in pids:
        if not isinstance(pid, int) or pid <= 1:
            continue
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True
        )
        if result.returncode or prefix not in result.stdout:
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        else:
            current = subprocess.run(
                ["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True
            )
            if current.returncode == 0 and prefix in current.stdout:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


def owned_processes(app):
    """Also find our own hung/crashed-before-report launch for safe cleanup."""
    prefix = str(app / "Contents/MacOS") + "/"
    result = subprocess.run(
        ["ps", "-ax", "-o", "pid=,command="], capture_output=True, text=True
    )
    found = set()
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].isdigit() and prefix in parts[1]:
            found.add(int(parts[0]))
    return found


def run(app):
    app = pathlib.Path(app).resolve()
    if sys.platform != "darwin":
        raise RuntimeError("This test requires an actual macOS GUI runner")
    if not app.is_dir() or app.suffix != ".app":
        raise RuntimeError("Expected the separately built probe .app bundle")
    help_result = subprocess.run(["open", "-h"], capture_output=True, text=True)
    help_text = help_result.stdout + help_result.stderr
    for option in ["--env", "--stdout", "--stderr"]:
        if option not in help_text:
            raise RuntimeError(f"Installed macOS open command does not support {option}")
    fixture = pathlib.Path("artifacts/fixture.pdf").resolve()
    if not fixture.is_file():
        raise RuntimeError("Generate synthetic fixtures with node scripts/fixtures.mjs first")
    pids = set()
    with tempfile.TemporaryDirectory(prefix="pdf-mac-windows-") as temporary:
        directory = pathlib.Path(temporary)
        first = directory / "Mac Plan A 50%.pdf"
        second = directory / "Mac Plan Süd #2.pdf"
        shutil.copyfile(fixture, first)
        one_page_pdf(second)
        report = directory / "window-state.json"
        stdout = directory / "application.stdout.log"
        stderr = directory / "application.stderr.log"
        latest = None

        def wait_for(description, predicate, expected_pid=None):
            nonlocal latest
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                try:
                    value = json.loads(report.read_text())
                    if value.get("schemaVersion") != 1:
                        raise RuntimeError("Unexpected native window report schema")
                    pid = value.get("pid")
                    if not isinstance(pid, int) or pid <= 1:
                        raise RuntimeError("Window report lacks a valid application PID")
                    pids.add(pid)
                    latest = value
                    if expected_pid is not None and pid != expected_pid:
                        raise RuntimeError("Warm PDF delivery launched a second application process")
                    if predicate(value):
                        return value
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                time.sleep(0.15)
            logs = "\n".join(
                path.read_text(errors="replace")[-5000:]
                for path in [stdout, stderr]
                if path.exists()
            )
            state = json.dumps(latest, ensure_ascii=False)[:6000]
            raise RuntimeError(f"Timed out waiting for {description}. Native state: {state}\n{logs}")

        def ready(value, name, page_count):
            actual = value.get("actualWindowLabels", [])
            visible = value.get("visibleWindowLabels", [])
            titles = value.get("windowTitles", {})
            # macOS filesystem/LaunchServices can return decomposed Unicode
            # (e.g. u + combining diaeresis) for a name created as precomposed
            # ü. Compare canonically equivalent text while still requiring the
            # exact filename, page count, visible native window and own title.
            expected_name = unicodedata.normalize("NFC", name)
            return [
                window
                for window in value.get("windows", [])
                if unicodedata.normalize("NFC", window.get("fileName", "")) == expected_name
                and window.get("hasDocument") is True
                and window.get("pageCount") == page_count
                and window.get("busy") is False
                and window.get("label") in actual
                and window.get("label") in visible
                and expected_name in unicodedata.normalize("NFC", titles.get(window.get("label"), ""))
            ]

        try:
            command(
                "open", "-n", "--env", f"PDF_EDITOR_WINDOW_TEST_REPORT={report}",
                "--stdout", str(stdout), "--stderr", str(stderr),
                "-a", str(app), str(first),
            )
            cold = wait_for(
                "the cold-start PDF in one actual visible window",
                lambda state: len(state.get("actualWindowLabels", [])) == 1
                and len(ready(state, first.name, 3)) == 1,
            )
            pid = cold["pid"]
            first_label = ready(cold, first.name, 3)[0]["label"]
            command("open", "-a", str(app), str(second))
            warm = wait_for(
                "two independent visible PDFs in the existing process",
                lambda state: len(state.get("actualWindowLabels", [])) == 2
                and len(ready(state, first.name, 3)) == 1
                and len(ready(state, second.name, 1)) == 1,
                expected_pid=pid,
            )
            first_window = ready(warm, first.name, 3)[0]
            second_window = ready(warm, second.name, 1)[0]
            if first_window["label"] != first_label or first_label == second_window["label"]:
                raise RuntimeError("The second PDF replaced or reused the first document window")
            print(
                "::notice title=macOS real PDF window runtime::"
                "Actual LaunchServices cold/warm delivery opened synthetic 3-page and 1-page PDFs "
                "in two visible Cocoa/Wry windows of one process; each existing MuPDF importer "
                "reported its own filename/page count, and the first window remained intact."
            )
        finally:
            pids.update(owned_processes(app))
            cleanup_processes(app, pids)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise RuntimeError("Usage: test-macos-windows.py path/to/probe.app")
        run(sys.argv[1])
    except Exception as error:
        print("::error title=macOS real PDF window runtime::" + escaped(error), file=sys.stderr)
        raise SystemExit(1)
