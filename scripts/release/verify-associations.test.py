import sys
sys.dont_write_bytecode = True
import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location('associations', pathlib.Path(__file__).with_name('verify-associations.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

class AssociationMetadataTests(unittest.TestCase):
    def test_desktop_forwards_names_with_shell_safe_placeholder(self):
        a.verify_desktop('[Desktop Entry]\nType=Application\nExec="PDF Viewer" %F\nMimeType=application/pdf;\n')
        for command in ['pdf-viewer', 'pdf-viewer %u', 'pdf-viewer %F %F']:
            with self.assertRaises(AssertionError):
                a.verify_desktop(f'Type=Application\nExec={command}\nMimeType=application/pdf;\n')
    def test_desktop_rejects_missing_mime_and_hidden_handlers(self):
        for extra in ['MimeType=text/plain;', 'MimeType=application/pdf;\nHidden=true', 'MimeType=application/pdf;\nNoDisplay=true']:
            with self.assertRaises(AssertionError):
                a.verify_desktop('Type=Application\nExec=pdf-viewer %F\n'+extra)
    def test_apple_requires_editor_pdf_and_nondefault_rank(self):
        record={'CFBundleTypeExtensions':['pdf'], 'LSItemContentTypes':['com.adobe.pdf'], 'CFBundleTypeRole':'Editor', 'LSHandlerRank':'Alternate'}
        a.verify_plist({'CFBundleDocumentTypes':[record]})
        for key,value in [('LSHandlerRank','Owner'),('CFBundleTypeRole','Viewer'),('LSItemContentTypes',['public.text']),('CFBundleTypeExtensions',[])]:
            with self.assertRaises(AssertionError): a.verify_plist({'CFBundleDocumentTypes':[{**record,key:value}]})
    def test_ios_requires_import_copy_mode_and_legacy_url_delivery(self):
        record={'CFBundleTypeExtensions':['pdf'], 'LSItemContentTypes':['com.adobe.pdf'], 'CFBundleTypeRole':'Editor', 'LSHandlerRank':'Alternate'}
        with self.assertRaises(AssertionError): a.verify_plist({'CFBundleDocumentTypes':[record]},ios=True)
        a.verify_plist({'CFBundleDocumentTypes':[record],'LSSupportsOpeningDocumentsInPlace':False},ios=True)
        with self.assertRaises(AssertionError): a.verify_plist({'CFBundleDocumentTypes':[record],'LSSupportsOpeningDocumentsInPlace':True},ios=True)
        with self.assertRaises(AssertionError): a.verify_plist({'CFBundleDocumentTypes':[record],'LSSupportsOpeningDocumentsInPlace':False,'UIApplicationSceneManifest':{}},ios=True)
    def manifest(self, action='VIEW', scheme='', category='DEFAULT', permission=''):
        return f'''<manifest xmlns:android="http://schemas.android.com/apk/res/android">{permission}<application><activity android:exported="true" android:launchMode="singleTask"><intent-filter><action android:name="android.intent.action.{action}"/><category android:name="android.intent.category.{category}"/><data android:mimeType="application/pdf" {scheme}/></intent-filter></activity></application></manifest>'''
    def test_android_accepts_content_or_mime_only_filters(self):
        a.verify_android_xml(self.manifest())
        a.verify_android_xml(self.manifest(scheme='android:scheme="content"'))
    def test_android_accepts_decoded_activity_enums_but_rejects_standard_launches(self):
        for mode in ['singleTop', 'singleTask', '1', '2', '0x1', '0x2']:
            a.verify_android_xml(self.manifest().replace('launchMode="singleTask"', f'launchMode="{mode}"'))
        for mode in ['standard', '0', '0x0']:
            with self.assertRaises(AssertionError):
                a.verify_android_xml(self.manifest().replace('launchMode="singleTask"', f'launchMode="{mode}"'))
    def test_android_rejects_pdf_mime_outside_view_filter(self):
        with self.assertRaises(AssertionError): a.verify_android_xml(self.manifest(action='SEND'))
    def test_android_requires_default_and_content_uri_support(self):
        for xml in [self.manifest(scheme='android:scheme="https"'), self.manifest(category='BROWSABLE')]:
            with self.assertRaises(AssertionError): a.verify_android_xml(xml)
    def test_android_disallows_broad_storage_permissions(self):
        with self.assertRaises(AssertionError):
            a.verify_android_xml(self.manifest(permission='<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE"/>'))

if __name__=='__main__': unittest.main(verbosity=2)
