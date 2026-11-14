; ==============================================================================
; Folio Desktop - NSIS installer hooks
; (tauri.conf.json -> bundle > windows > nsis > installerHooks)
;
; Supported macros (see the Tauri NSIS template):
;   NSIS_HOOK_PREINSTALL    - before files are copied
;   NSIS_HOOK_POSTINSTALL   - after files, registry keys and shortcuts are set
;   NSIS_HOOK_PREUNINSTALL  - before files/registry/shortcuts are removed
;   NSIS_HOOK_POSTUNINSTALL - after files/registry/shortcuts are removed
;
; Keep identifiers in sync with tauri.conf.json (bundle.identifier:
; com.folio.workspace) - the local workspace database lives at
;   %APPDATA%\com.folio.workspace\folio.db
; and the WebView2 profile (localStorage, cache) at
;   %LOCALAPPDATA%\com.folio.workspace\
;
; NOTE: this file must stay pure ASCII (no BOM, no smart quotes/dashes):
; NSIS reads it as ANSI and non-ASCII bytes can corrupt the parse.
; ==============================================================================

!macro NSIS_HOOK_PREINSTALL
  ; A running Folio instance locks its own files; close it politely so the
  ; update installs cleanly. taskkill exits non-zero when Folio isn't
  ; running - that's expected and must never block the install.
  nsExec::Exec 'taskkill /IM "Folio.exe" /T /F'
  Pop $0
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Nothing to do - Tauri already registered shortcuts and the folio://
  ; deep-link handler.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The uninstaller already prompts the user to close Folio before this
  ; point; the kill here is a safety net for a force-closed dialog.
  nsExec::Exec 'taskkill /IM "Folio.exe" /T /F'
  Pop $0
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Offer to also remove the LOCAL workspace data (projects, tasks, ideas,
  ; cached profile and session token). Data already synced to the user's
  ; Folio cloud account stays there; signing back in after a reinstall
  ; pulls it down again. Choosing "No" keeps this device's data intact for
  ; a future reinstall - nothing is deleted silently.
  MessageBox MB_ICONQUESTION|MB_YESNO "Also delete your local Folio workspace data on this computer?$\r$\n$\r$\nYour projects, tasks and preferences are stored in your user profile. Yes permanently removes them from this device (anything already synced to your Folio account is kept in the cloud). No keeps them for a future reinstall." IDNO FolioKeepLocalData
    DetailPrint "Removing local Folio workspace data..."
    RMDir /r "$APPDATA\com.folio.workspace"
    RMDir /r "$LOCALAPPDATA\com.folio.workspace"
  FolioKeepLocalData:
!macroend
