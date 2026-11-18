; The official Tauri 2.12.4 template includes this hook AFTER FileAssociation.nsh.
; Keep its generated registration calls, but replace only the association macros:
; the upstream APP_ASSOCIATE writes the .pdf default (and APP_UNASSOCIATE restores
; it). We register Open With / Default Apps candidates without touching a user's
; existing .pdf default or protected Explorer UserChoice.
;
; Upstream API/reference (MIT OR Apache-2.0):
; https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/FileAssociation.nsh
; This project's replacement below is original code under AGPL-3.0-only.

!macroundef APP_ASSOCIATE
!macro APP_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}" "" `${DESCRIPTION}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\DefaultIcon" "" `${ICON}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open" "" `${COMMANDTEXT}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open\command" "" `${COMMAND}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" `${COMMAND}`
  WriteRegStr SHELL_CONTEXT "Software\${BUNDLEID}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHELL_CONTEXT "Software\${BUNDLEID}\Capabilities" "ApplicationDescription" "Lokaler PDF-Viewer und Annotationseditor"
  WriteRegStr SHELL_CONTEXT "Software\${BUNDLEID}\Capabilities\FileAssociations" ".${EXT}" "${FILECLASS}"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${BUNDLEID}" "Software\${BUNDLEID}\Capabilities"
!macroend

!macroundef APP_UNASSOCIATE
!macro APP_UNASSOCIATE EXT FILECLASS
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${FILECLASS}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${BUNDLEID}"
  DeleteRegKey SHELL_CONTEXT "Software\${BUNDLEID}\Capabilities"
!macroend
