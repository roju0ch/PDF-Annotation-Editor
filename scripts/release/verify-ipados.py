"""Verify the actual iPad bundle and, for a private Ad Hoc build, its signature."""
import pathlib
import plistlib
import subprocess
import sys
import tempfile

EXPECTED_ORIENTATIONS = {
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationPortraitUpsideDown",
    "UIInterfaceOrientationLandscapeLeft",
    "UIInterfaceOrientationLandscapeRight",
}


def run(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE).stdout


def verify(app, mode):
    with (app / "Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    expected_platform = "iPhoneSimulator" if mode == "simulator" else "iPhoneOS"
    assert info["CFBundleIdentifier"] == "io.github.roju0ch.pdfannotationeditor"
    assert info["MinimumOSVersion"] == "17.0"
    assert expected_platform in info["CFBundleSupportedPlatforms"]
    assert 2 in info["UIDeviceFamily"]
    assert EXPECTED_ORIENTATIONS <= set(info["UISupportedInterfaceOrientations~ipad"])
    assert run("lipo", "-archs", str(app / info["CFBundleExecutable"])).split() == [b"arm64"]
    run(sys.executable, "scripts/release/verify-associations.py", "ios", str(app))
    if mode == "signed":
        run("codesign", "--verify", "--deep", "--strict", str(app))
        profile = plistlib.loads(run("security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")))
        entitlements = plistlib.loads(run("codesign", "-d", "--entitlements", "-", str(app)))
        assert profile["ProvisionedDevices"], "Ad Hoc provisioning requires registered devices"
        assert entitlements["application-identifier"] == profile["Entitlements"]["application-identifier"]


def main(mode, path):
    if mode == "simulator":
        verify(path, mode)
    else:
        files = list(path.glob("**/build/arm64/*.ipa"))
        if len(files) != 1:
            raise SystemExit(f"Expected one ARM64 IPA, found {len(files)}")
        with tempfile.TemporaryDirectory() as directory:
            run("ditto", "-x", "-k", str(files[0]), directory)
            apps = list(pathlib.Path(directory).glob("Payload/*.app"))
            if len(apps) != 1:
                raise SystemExit(f"Expected one app in the IPA, found {len(apps)}")
            verify(apps[0], mode)
    print(f"Verified iPadOS package and PDF registration ({mode}).")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in {"simulator", "unsigned", "signed"}:
        raise SystemExit("usage: verify-ipados.py {simulator,unsigned,signed} PATH")
    main(sys.argv[1], pathlib.Path(sys.argv[2]))
