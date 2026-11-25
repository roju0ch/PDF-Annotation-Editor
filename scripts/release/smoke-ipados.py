"""Install and launch the release bundle on an available iPad simulator."""
import json
import pathlib
import subprocess
import sys


def sim(*arguments, **options):
    return subprocess.run(["xcrun", "simctl", *arguments], check=True, **options)


def main(root):
    apps = list(root.glob("**/build/arm64-sim/*.app"))
    if len(apps) != 1:
        raise SystemExit(f"Expected one simulator app, found {len(apps)}")
    inventory = json.loads(sim("list", "-j", "devices", "available", capture_output=True).stdout)
    ipads = [
        device
        for runtime, devices in inventory["devices"].items()
        if ".iOS-" in runtime
        for device in devices
        if device["name"].startswith("iPad")
    ]
    if not ipads:
        raise SystemExit("The runner has no available iPad simulator.")
    device = next((item for item in ipads if item["state"] == "Booted"), ipads[-1])
    udid = device["udid"]
    booted_here = device["state"] != "Booted"
    if booted_here:
        sim("boot", udid, timeout=120)
    try:
        sim("bootstatus", udid, "-b", timeout=360)
        sim("install", udid, str(apps[0]), timeout=120)
        sim("launch", udid, "io.github.roju0ch.pdfannotationeditor", timeout=60)
        sim("terminate", udid, "io.github.roju0ch.pdfannotationeditor", timeout=60)
    finally:
        if booted_here:
            sim("shutdown", udid, timeout=120)


if __name__ == "__main__":
    main(pathlib.Path(sys.argv[1]))
