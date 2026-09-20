' Launch the portal server in the background (hidden, no CMD window)
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = dir
sh.Run "cmd /c npx serve -l 3000 > serve.log 2>&1", 0, False
