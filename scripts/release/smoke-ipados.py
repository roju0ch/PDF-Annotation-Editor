"""Install and launch the release bundle on an available iPad simulator."""
import json
import pathlib
import subprocess
import sys
import tempfile


def sim(*arguments, **options):
    return subprocess.run(["xcrun", "simctl", *arguments], check=True, **options)


def main(root):
    apps = list(root.glob("**/build/arm64-sim/*.app"))
    if len(apps) != 1:
        raise SystemExit(f"error: expected one simulator app, found {len(apps)}")
    inventory = json.loads(sim("list", "-j", "devices", "available", capture_output=True).stdout)
    ipads = [
        (tuple(map(int, runtime.split(".iOS-")[-1].split("-"))), device)
        for runtime, devices in inventory["devices"].items()
        if ".iOS-" in runtime
        for device in devices
        if device["name"].startswith("iPad")
    ]
    if not ipads:
        raise SystemExit("error: the runner has no available iPad simulator.")
    version, device = max(ipads, key=lambda item: (item[1]["state"] == "Booted", item[0]))
    udid = device["udid"]
    print(f"Running smoke test on {device['name']} with iOS {'.'.join(map(str, version))}.", flush=True)
    booted_here = device["state"] != "Booted"
    if booted_here:
        sim("boot", udid, timeout=120)
    try:
        sim("bootstatus", udid, "-b", timeout=360)
        with tempfile.TemporaryDirectory() as directory:
            app = pathlib.Path(directory) / apps[0].name
            subprocess.run(["ditto", str(apps[0]), str(app)], check=True, timeout=60)
            # Ad Hoc sign only the disposable simulator copy. The archived
            # bundle and the device-signing workflow are independent.
            subprocess.run(
                ["codesign", "--force", "--deep", "--sign", "-", str(app)], check=True, timeout=60
            )
            sim("install", udid, str(app), timeout=120)
            sim("launch", udid, "io.github.roju0ch.pdfannotationeditor", timeout=60)
            sim("terminate", udid, "io.github.roju0ch.pdfannotationeditor", timeout=60)
    finally:
        if booted_here:
            sim("shutdown", udid, timeout=120)


if __name__ == "__main__":
    try:
        main(pathlib.Path(sys.argv[1]))
    except (subprocess.SubprocessError, OSError) as error:
        raise SystemExit(f"error: iPad simulator smoke test: {error}") from error
