' Desktop shortcut launcher: runs the portal batch file with no window at all
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run "cmd /c """ & dir & "start-portal.bat"", 0, False
