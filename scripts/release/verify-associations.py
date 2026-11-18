"""Inspect actual installed/bundled metadata; never change a user's default app."""
import os
import pathlib
import plistlib
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ANDROID = '{http://schemas.android.com/apk/res/android}'

def verify_desktop(text):
    values = dict(line.split('=', 1) for line in text.splitlines() if '=' in line and not line.startswith('#'))
    assert values.get('Type') == 'Application', 'Not an application desktop entry'
    assert 'application/pdf' in values.get('MimeType', '').split(';'), 'Missing PDF MIME registration'
    command = values.get('Exec', '')
    assert command.endswith(' %F') and command.count('%F') == 1, 'Desktop Exec does not forward PDF filenames'
    assert values.get('Hidden', 'false') != 'true' and values.get('NoDisplay', 'false') != 'true', 'PDF handler hidden'
    return values

def verify_plist(value, ios=False):
    handlers = [item for item in value.get('CFBundleDocumentTypes', []) if 'com.adobe.pdf' in item.get('LSItemContentTypes', [])]
    assert handlers, 'Missing com.adobe.pdf document registration'
    for handler in handlers:
        assert handler.get('CFBundleTypeRole') == 'Editor', 'PDF role must be Editor'
        assert handler.get('LSHandlerRank') == 'Alternate', 'Registration must not claim PDF ownership/default'
        assert 'pdf' in handler.get('CFBundleTypeExtensions', []), 'Missing PDF extension'
    if ios:
        # Pinned Tao does not forward initial UIScene URLContexts. The official
        # CLI template uses the supported legacy application:openURL: path.
        assert 'UIApplicationSceneManifest' not in value, 'UIScene lifecycle loses initial file URL in pinned Tao'
        assert value.get('LSSupportsOpeningDocumentsInPlace') is False, 'iOS must import a private copy instead of assuming a reconstructed URL retains its security scope'

def verify_android_xml(text):
    root = ET.fromstring(text)
    prohibited = {'android.permission.MANAGE_EXTERNAL_STORAGE', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'}
    assert not {item.get(ANDROID+'name') for item in root.findall('uses-permission')} & prohibited, 'Unnecessary broad storage permission'
    matches = []
    for activity in root.findall('./application/activity'):
        for intent in activity.findall('intent-filter'):
            actions = {item.get(ANDROID+'name') for item in intent.findall('action')}
            categories = {item.get(ANDROID+'name') for item in intent.findall('category')}
            data = intent.findall('data')
            types = {item.get(ANDROID+'mimeType') for item in data}
            schemes = {item.get(ANDROID+'scheme') for item in data if item.get(ANDROID+'scheme')}
            if 'android.intent.action.VIEW' in actions and 'application/pdf' in types:
                assert 'android.intent.category.DEFAULT' in categories, 'PDF handler not available as default choice'
                assert not schemes or 'content' in schemes, 'PDF handler excludes content URIs'
                assert activity.get(ANDROID+'exported') == 'true', 'PDF activity not exported'
                assert activity.get(ANDROID+'launchMode') in {'singleTask', 'singleTop'}, 'Warm PDF opens create unrelated activities'
                matches.append(activity.get(ANDROID+'name'))
    assert matches, 'Missing PDF ACTION_VIEW handler'

def command(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs)

def desktop_packages(root):
    root = pathlib.Path(root).resolve()
    debs = list(root.rglob('*.deb'))
    images = list(root.rglob('*.AppImage'))
    assert len(debs) == 1 and len(images) == 1, 'Expected DEB and AppImage'
    for kind, package in [('DEB', debs[0]), ('AppImage', images[0])]:
        with tempfile.TemporaryDirectory(prefix='pdf-association-') as temporary:
            path = pathlib.Path(temporary)
            if kind == 'DEB':
                subprocess.run(['dpkg-deb', '--extract', str(package), temporary], check=True)
                entries = list((path/'usr/share/applications').glob('*.desktop'))
            else:
                subprocess.run([str(package), '--appimage-extract'], cwd=temporary, stdout=subprocess.DEVNULL, check=True)
                entries = list((path/'squashfs-root').glob('*.desktop'))
            assert len(entries) == 1, f'Expected one {kind} application desktop entry'
            verify_desktop(entries[0].read_text())
            if kind == 'DEB':
                subprocess.run(['desktop-file-validate', str(entries[0])], check=True)
            print(f'::notice title=Linux PDF association::{kind}: actual desktop entry has application/pdf and Exec filename forwarding. AppImage registration still requires explicit desktop integration.')
    verify_installed_deb(debs[0])

def verify_installed_deb(package):
    with tempfile.TemporaryDirectory(prefix='pdf-default-') as temporary:
        path = pathlib.Path(temporary)
        data = path/'data/applications'
        configuration = path/'configuration'
        data.mkdir(parents=True)
        configuration.mkdir()
        previous = 'CodexPreviousPdf.desktop'
        (data/previous).write_text('[Desktop Entry]\nType=Application\nName=Previous PDF test handler\nExec=/usr/bin/true %F\nMimeType=application/pdf;\n')
        (configuration/'mimeapps.list').write_text('[Default Applications]\napplication/pdf='+previous+';\n')
        environment = {**os.environ, 'XDG_DATA_HOME': str(path/'data'), 'XDG_CONFIG_HOME': str(configuration), 'XDG_DATA_DIRS': '/usr/local/share:/usr/share', 'XDG_CURRENT_DESKTOP': 'X-Generic'}
        def unchanged():
            actual = command('xdg-mime', 'query', 'default', 'application/pdf', env=environment).strip()
            assert actual == previous, 'DEB install/uninstall changed an existing PDF default'
        unchanged()
        name = command('dpkg-deb', '--field', str(package), 'Package').strip()
        installed = False
        try:
            subprocess.run(['sudo', 'dpkg', '--install', str(package)], check=True)
            installed = True
            entries = [pathlib.Path(p) for p in command('dpkg', '--listfiles', name).splitlines() if p.startswith('/usr/share/applications/') and p.endswith('.desktop')]
            assert len(entries) == 1, 'Missing installed DEB desktop handler'
            verify_desktop(entries[0].read_text())
            subprocess.run(['sudo', 'update-desktop-database', '/usr/share/applications'], check=True)
            cache = pathlib.Path('/usr/share/applications/mimeinfo.cache').read_text()
            pdf_entries = [line for line in cache.splitlines() if line.startswith('application/pdf=')]
            assert pdf_entries and entries[0].name in pdf_entries[0].split('=',1)[1].split(';'), 'Installed PDF handler missing from desktop database'
            unchanged()
            print('::notice title=Linux installed PDF association::Real DEB installation registered its PDF handler in the desktop database and preserved a prior per-user PDF default.')
        finally:
            if installed:
                subprocess.run(['sudo', 'dpkg', '--remove', name], check=True)
                unchanged()
                print('::notice title=Linux installed PDF association::Real DEB removal preserved the previous per-user PDF default.')

def macos_package(root):
    dmgs = list(pathlib.Path(root).rglob('*.dmg'))
    assert len(dmgs) == 1, 'Expected one DMG'
    with tempfile.TemporaryDirectory(prefix='pdf-dmg-') as temporary:
        subprocess.run(['hdiutil', 'attach', str(dmgs[0].resolve()), '-nobrowse', '-readonly', '-mountpoint', temporary], check=True, stdout=subprocess.DEVNULL)
        try:
            plists = list(pathlib.Path(temporary).glob('*.app/Contents/Info.plist'))
            assert len(plists) == 1, 'Expected one app inside DMG'
            verify_plist(plistlib.loads(plists[0].read_bytes()))
        finally:
            subprocess.run(['hdiutil', 'detach', temporary], check=True, stdout=subprocess.DEVNULL)
    print('::notice title=macOS PDF association::Actual DMG app declares com.adobe.pdf, .pdf, Editor and Alternate in CFBundleDocumentTypes.')

def android_package(apk):
    analyzer = pathlib.Path(os.environ['ANDROID_HOME'])/'cmdline-tools/latest/bin/apkanalyzer'
    verify_android_xml(command(str(analyzer), 'manifest', 'print', apk))
    print('::notice title=Android PDF association::Actual APK manifest exports PDF ACTION_VIEW with DEFAULT, content URI support and single-instance activity; no broad storage permissions.')

def ios_package(app):
    verify_plist(plistlib.loads((pathlib.Path(app)/'Info.plist').read_bytes()), ios=True)
    print('::notice title=iOS PDF association::Actual simulator app declares com.adobe.pdf, .pdf, Editor, Alternate and UIKit import-copy mode (no initial UIScene URL loss). Device distribution requires Apple signing.')

if __name__ == '__main__':
    try:
        mode, root = sys.argv[1:]
        {'linux': desktop_packages, 'macos': macos_package, 'android': android_package, 'ios': ios_package}[mode](root)
    except Exception as error:
        message = str(error).replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print('::error title=PDF package association verification::'+message, file=sys.stderr)
        raise SystemExit(1)
