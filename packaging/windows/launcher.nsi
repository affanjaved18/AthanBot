Unicode true
Name "AthanBot"
OutFile "${stage}/AthanBot.exe"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true

Section
  ExecShell "open" "$EXEDIR\node.exe" '"$EXEDIR\src\main.js" desktop' SW_HIDE
  IfErrors 0 +2
  MessageBox MB_OK|MB_ICONSTOP "AthanBot could not start. Reinstall the application."
SectionEnd
