; Per-user installer additions (electron-builder.yml nsis.include).

; electron-builder keeps a copy of the installer (~135 MB) in
; %LOCALAPPDATA%\ds5-dongle-configurator-updater for electron-updater, which
; this app doesn't use (it updates itself, electron/main/updater.ts): removed.
!macro customInstall
  RMDir /r "$LOCALAPPDATA\ds5-dongle-configurator-updater"
!macroend

; Uninstalling (not an update) also removes what the app itself made: the
; launch-at-login entry (electron/main/autostart.ts: setLoginItemSettings
; under the app id), the desktop shortcut the tray menu can make (same name as
; the Start menu one) and a downloaded update waiting in Temp. Settings, game
; profiles and the library stay in %APPDATA% (deleteAppDataOnUninstall: false).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.github.MarcelineVPQ.DS5DongleConfigurator"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "io.github.MarcelineVPQ.DS5DongleConfigurator"
    Delete "$DESKTOP\DS5 Dongle OLED Edition Configurator.lnk"
    RMDir /r "$TEMP\ds5-configurator-update"
    RMDir /r "$LOCALAPPDATA\ds5-dongle-configurator-updater"
  ${endIf}
!macroend
