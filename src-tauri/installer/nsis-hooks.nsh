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
;
; Why this file does so much
; --------------------------
; The Tauri installer asks Windows (Restart Manager) to force-close Folio and
; aborts with "unable to kill" when that is refused. That happens with some
; antivirus products (McAfee, Norton, ...), with apps started by another
; user/session, and with older Folio builds whose program file was called
; app.exe. These hooks run BEFORE that check and close Folio through several
; independent routes, so the check normally finds nothing left to close. If
; Folio still cannot be closed, the person gets a plain-English dialog with
; manual steps and a Retry button instead of a dead end.
; ==============================================================================

; ------------------------------------------------------------------------------
; FolioCheckRunning
;   Leaves $0 = "0" when nothing from $INSTDIR is running, "3" when something
;   still is, and anything else when PowerShell itself could not be used.
;   Needs $R8 = path to powershell.exe and FOLIO_INSTDIR in the environment.
; ------------------------------------------------------------------------------
!macro FolioCheckRunning
  nsExec::Exec `"$R8" -NoProfile -NonInteractive -Command "$$d=$$env:FOLIO_INSTDIR.TrimEnd('\')+'\'; $$n=@(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ProcessId -ne $$PID -and $$_.Name -notlike 'uninst*' -and $$_.Name -notlike '*setup*' -and $$_.ExecutablePath.StartsWith($$d,[StringComparison]::OrdinalIgnoreCase) }).Count; if ($$n -gt 0) { exit 3 } else { exit 0 }"`
  Pop $0
!macroend

; ------------------------------------------------------------------------------
; FolioStopRunningApp
;   Closes every Folio process that runs from $INSTDIR (and Folio's WebView2
;   helper processes). It only looks at programs that live inside the install
;   folder, so an unrelated program that happens to be called app.exe is never
;   touched. Safe to call when Folio is not running (it then does nothing).
; ------------------------------------------------------------------------------
!macro FolioStopRunningApp
  !define FolioUID ${__LINE__}

  Push $0
  Push $R8

  ; Nothing to close on a first-time install.
  IfFileExists "$INSTDIR\*.*" 0 folio_done_${FolioUID}

  StrCpy $R8 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ; Hand the install folder to PowerShell through the environment so a user
  ; name with an apostrophe or other odd character can never break quoting.
  System::Call 'kernel32::SetEnvironmentVariableW(w "FOLIO_INSTDIR", w "$INSTDIR")'

  ; Quick look first: when Folio is not running there is nothing to do.
  !insertmacro FolioCheckRunning
  StrCmp $0 "0" folio_done_${FolioUID}

  folio_close_${FolioUID}:

  ; Route 1 - ask nicely (closes the window like the X button, no admin needed).
  nsExec::Exec '"$SYSDIR\taskkill.exe" /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  Sleep 1200

  ; Route 2 - find the processes by the folder they run from (this also
  ; catches old builds named app.exe), ask them to close, then end whatever is
  ; left, plus the WebView2 helpers that keep Folio's data folder busy.
  nsExec::Exec `"$R8" -NoProfile -NonInteractive -Command "$$ErrorActionPreference='SilentlyContinue'; $$d=$$env:FOLIO_INSTDIR.TrimEnd('\')+'\'; function Get-FolioProc { Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ProcessId -ne $$PID -and $$_.Name -notlike 'uninst*' -and $$_.Name -notlike '*setup*' -and $$_.ExecutablePath.StartsWith($$d,[StringComparison]::OrdinalIgnoreCase) } }; Get-FolioProc | ForEach-Object { try { (Get-Process -Id $$_.ProcessId).CloseMainWindow() | Out-Null } catch {} }; Start-Sleep -Milliseconds 1500; Get-FolioProc | ForEach-Object { try { Stop-Process -Id $$_.ProcessId -Force } catch {} }; Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'msedgewebview2.exe' -and $$_.CommandLine -like '*com.folio.workspace*' } | ForEach-Object { try { Stop-Process -Id $$_.ProcessId -Force } catch {} }; exit 0"`
  Pop $0

  ; Route 3 - Windows' own tool, by exact program name (works even when
  ; PowerShell is switched off by a company or security policy).
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  Sleep 800

  ; Did that work?
  !insertmacro FolioCheckRunning
  StrCmp $0 "3" 0 folio_done_${FolioUID}

  ; Still running. Silent and passive runs cannot ask anything; the standard
  ; Tauri check that follows reports the problem for them.
  IfSilent folio_done_${FolioUID}
  StrCmp $PassiveMode "1" folio_done_${FolioUID}

  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Folio is still open, and Windows or your security software (for example McAfee, Norton or Windows Security) did not allow this setup to close it.$\r$\n$\r$\nTo continue, please close Folio yourself:$\r$\n$\r$\n  1. Click the Folio window and close it (the X in the top corner).$\r$\n  2. If it does not close, press Ctrl + Shift + Esc to open Task Manager, find Folio in the list, and click End task.$\r$\n  3. Come back to this window and click Retry.$\r$\n$\r$\nYour projects and tasks are safe. They are saved in your Folio account and on this computer." IDRETRY folio_close_${FolioUID}

  Abort "Folio could not be closed, so nothing was changed. Close Folio (or end it in Task Manager) and run this again."

  folio_done_${FolioUID}:

  Pop $R8
  Pop $0

  !undef FolioUID
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; A running Folio locks its own files; close it so the update installs
  ; cleanly. This never blocks the install unless the person chooses Cancel
  ; after being shown how to close Folio by hand.
  !insertmacro FolioStopRunningApp
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Older Folio builds shipped the program as app.exe. The Tauri template
  ; removes the previous program file when its name changes; this is a second
  ; safety net so no stale copy is left behind after an update.
  !if "${MAINBINARYNAME}" != "app"
    IfFileExists "$INSTDIR\app.exe" 0 +2
      Delete "$INSTDIR\app.exe"
  !endif
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Close Folio (and its helpers) before the standard check runs, so removing
  ; Folio works with any antivirus or none.
  !insertmacro FolioStopRunningApp
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Nothing else to do. Removing the local workspace data (projects, tasks,
  ; ideas, cached profile and session token) is offered by the standard
  ; "Delete the application data" checkbox on the uninstall page, which
  ; clears both %APPDATA%\com.folio.workspace and
  ; %LOCALAPPDATA%\com.folio.workspace. Anything already synced to the
  ; person's Folio account stays in the cloud and returns after signing in.
!macroend
