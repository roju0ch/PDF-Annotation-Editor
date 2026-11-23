"""Exercise native PDF delivery into two actual desktop Tauri windows.

The optional native-window-tests build reports read-only native/React state for
synthetic PDFs. This verifier does not automate Accessibility, fake a successful
window, or expose a production command channel. The diagnostic executable is
built separately from the regular installers.
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


def command(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30, **kwargs)
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
    mac = sys.platform == "darwin"
    if mac:
        if not app.is_dir() or app.suffix != ".app":
            raise RuntimeError("Expected the separately built probe .app bundle")
        help_result = subprocess.run(["open", "-h"], capture_output=True, text=True)
        help_text = help_result.stdout + help_result.stderr
        for option in ["--env", "--stdout", "--stderr"]:
            if option not in help_text:
                raise RuntimeError(f"Installed macOS open command does not support {option}")
    elif sys.platform not in ("win32", "linux") or not app.is_file():
        raise RuntimeError("Expected the separately built Windows or Linux probe executable")
    fixture = pathlib.Path("artifacts/fixture.pdf").resolve()
    if not fixture.is_file():
        raise RuntimeError("Generate synthetic fixtures with node scripts/fixtures.mjs first")
    pids = set()
    with tempfile.TemporaryDirectory(prefix="pdf-desktop-windows-") as temporary:
        directory = pathlib.Path(temporary)
        first = directory / "Plan A 50%.pdf"
        second = directory / "Weiteres Verzeichnis" / "Plan Süd #2.pdf"
        second.parent.mkdir()
        shutil.copyfile(fixture, first)
        one_page_pdf(second)
        report = directory / "window-state.json"
        stdout = directory / "application.stdout.log"
        stderr = directory / "application.stderr.log"
        latest = None
        primary = None

        def wait_for(description, predicate, expected_pid=None):
            nonlocal latest
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                try:
                    value = json.loads(report.read_text(encoding="utf-8"))
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
                if primary and primary.poll() is not None:
                    break
                time.sleep(0.15)
            logs = "\n".join(
                path.read_text(errors="replace")[-5000:]
                for path in [stdout, stderr]
                if path.exists()
            )
            state = json.dumps(latest, ensure_ascii=False)[:6000]
            raise RuntimeError(f"Failed to observe {description}. Native state: {state}\n{logs}")

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
            if mac:
                command(
                    "open", "-n", "--env", f"PDF_EDITOR_WINDOW_TEST_REPORT={report}",
                    "--stdout", str(stdout), "--stderr", str(stderr),
                    "-a", str(app), str(first),
                )
            else:
                env = os.environ | {"PDF_EDITOR_WINDOW_TEST_REPORT": str(report)}
                with stdout.open("wb") as out, stderr.open("wb") as err:
                    primary = subprocess.Popen(
                        [str(app), first.name], cwd=first.parent, env=env, stdout=out, stderr=err,
                    )
            cold = wait_for(
                "the cold-start PDF in one actual visible window",
                lambda state: len(state.get("actualWindowLabels", [])) == 1
                and len(ready(state, first.name, 3)) == 1,
            )
            pid = cold["pid"]
            if primary and pid != primary.pid:
                raise RuntimeError("The first PDF was not opened by the launched application process")
            first_label = ready(cold, first.name, 3)[0]["label"]
            if mac:
                command("open", "-a", str(app), str(second))
            else:
                # The installer uses argv. A different cwd also verifies that
                # the single-instance handoff resolves the caller's filename.
                command(str(app), second.name, cwd=second.parent, env=env)
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
            delivery = "LaunchServices" if mac else "single-instance argv handoff"
            print(
                "::notice title=Desktop PDF document windows::"
                f"Cold/warm {delivery} opened synthetic 3-page and 1-page PDFs "
                "in two visible native windows of one process. Each MuPDF importer "
                "reported its own filename/page count, and the first window remained intact."
            )
        finally:
            if mac:
                pids.update(owned_processes(app))
                cleanup_processes(app, pids)
            elif primary and primary.poll() is None:
                primary.terminate()
                try:
                    primary.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    primary.kill()
                    primary.wait(timeout=5)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise RuntimeError("Usage: test-desktop-windows.py path/to/probe[.app|.exe]")
        run(sys.argv[1])
    except Exception as error:
        print("::error title=Desktop PDF document windows::" + escaped(error), file=sys.stderr)
        raise SystemExit(1)
