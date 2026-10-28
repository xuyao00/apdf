; Reject unsupported hardware before NSIS reaches uninstallOldVersion.
!macro customInit
  !ifdef APP_ARM64
    !ifndef APP_64
      !ifndef APP_32
        ${IfNot} ${IsNativeARM64}
          MessageBox MB_OK|MB_ICONSTOP "This aPDF installer requires Windows on ARM. For an Intel or AMD PC, download the Windows x64 Setup.exe installer. Your existing installation has not been changed." /SD IDOK
          SetErrorLevel 1633
          Quit
        ${EndIf}
      !endif
    !endif
  !endif
!macroend
