# Button click test (1080x2340 TodoAssistant AVD)
$env:PATH = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:PATH"
$OUT = "C:\Users\Administrator\Desktop\My_TODO\dist\btn-test"
New-Item -ItemType Directory -Force -Path $OUT | Out-Null

function Shot($n) { cmd /c "adb exec-out screencap -p > `"$OUT\$n.png`"" }
function Tap($x,$y) { adb shell input tap $x $y; Start-Sleep -Milliseconds 900 }

adb shell am force-stop com.kylian.todoassistant
adb shell am start -n com.kylian.todoassistant/.MainActivity
Start-Sleep -Seconds 10
Shot "00-start"

$tests = @(
  @{ n='01-list'; x=520; y=255 },
  @{ n='02-kanban'; x=640; y=255 },
  @{ n='03-theme'; x=780; y=255 },
  @{ n='04-settings'; x=920; y=255 },
  @{ n='05-bug'; x=165; y=600 },
  @{ n='06-todo'; x=415; y=600 },
  @{ n='07-req'; x=665; y=600 },
  @{ n='08-idea'; x=915; y=600 }
)

foreach ($t in $tests) {
  adb shell am force-stop com.kylian.todoassistant
  adb shell am start -n com.kylian.todoassistant/.MainActivity
  Start-Sleep -Seconds 8
  Tap $t.x $t.y
  if ($t.n -eq '04-settings') { Start-Sleep -Seconds 1 }
  Shot $t.n
  if ($t.n -eq '04-settings') { adb shell input keyevent KEYCODE_BACK; Start-Sleep -Milliseconds 500 }
}

adb shell am force-stop com.kylian.todoassistant
adb shell am start -n com.kylian.todoassistant/.MainActivity
Start-Sleep -Seconds 8
adb shell input swipe 540 1900 540 900 400
Start-Sleep -Milliseconds 800
Tap 200 1100
Shot "09-filter-bug"
Tap 400 1100
Shot "10-filter-todo"

Write-Host "Done. Screenshots: $OUT"
