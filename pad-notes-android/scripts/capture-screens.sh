#!/usr/bin/env bash
# Drives the freshly installed debug APK on the CI emulator and captures the
# real running UI. Used by .github/workflows/pad-notes-android.yml.
set -u

cd "$(dirname "$0")/.."
PKG="com.suimo.assistant"
OUT="docs/screenshots"
ADB="${ADB:-adb}"
mkdir -p "$OUT"

shot() {
  "$ADB" exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true
  echo "screenshot: $OUT/$1.png"
}

tap_xy() {
  echo "tap $1 $2"
  "$ADB" shell input tap "$1" "$2" >/dev/null 2>&1 || true
}

tap_text() {
  local text="$1"
  local i
  for i in $(seq 1 15); do
    "$ADB" shell uiautomator dump /sdcard/suimo-ui.xml >/dev/null 2>&1 || true
    "$ADB" pull /sdcard/suimo-ui.xml /tmp/suimo-ui.xml >/dev/null 2>&1 || true
    local coords
    coords=$(python3 - "$text" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

needle = sys.argv[1]
try:
    root = ET.parse("/tmp/suimo-ui.xml").getroot()
except Exception:
    sys.exit(1)
for node in root.iter("node"):
    values = [node.get("text") or "", node.get("content-desc") or ""]
    if any(needle in value for value in values):
        match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if match:
            x1, y1, x2, y2 = map(int, match.groups())
            print(f"{(x1 + x2) // 2} {(y1 + y2) // 2}")
            sys.exit(0)
sys.exit(1)
PY
)
    if [ -n "${coords:-}" ]; then
      echo "tap text '$text' at $coords"
      "$ADB" shell input tap $coords >/dev/null 2>&1 || true
      return 0
    fi
    sleep 1
  done
  echo "text not found: $text"
  return 1
}

screen_metrics() {
  local size density
  size=$("$ADB" shell wm size | sed -n 's/.*: \([0-9]*x[0-9]*\).*/\1/p' | tail -1)
  density=$("$ADB" shell wm density | sed -n 's/.*: \([0-9]*\).*/\1/p' | tail -1)
  SCREEN_W=${size%x*}
  SCREEN_H=${size#*x}
  DENSITY=${density:-320}
  echo "screen ${SCREEN_W}x${SCREEN_H} @ ${DENSITY}dpi"
}

dp() {
  python3 - "$1" "$DENSITY" <<'PY'
import sys
value, density = float(sys.argv[1]), float(sys.argv[2])
print(int(round(value * density / 160.0)))
PY
}

# The overlay window is not focusable, so UIAutomator may not dump it. These
# coordinates follow overlay_panel.xml and are only used as a fallback.
panel_close_xy() {
  local width left top
  width=$(dp 336)
  left=$((SCREEN_W - width - $(dp 12)))
  top=$(dp 52)
  tap_xy $((left + width - $(dp 33))) $((top + $(dp 31)))
}

panel_action_xy() {
  local width left bottom x
  width=$(dp 336)
  left=$((SCREEN_W - width - $(dp 12)))
  bottom=$("$ADB" shell dumpsys window windows | python3 -c '
import re, sys
data = sys.stdin.read()
frames = re.findall(r"mFrame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]", data)
print(frames[-1][3] if frames else "0")
' 2>/dev/null || echo 0)
  x=$((left + width - $(dp 57)))
  tap_xy "$x" $((bottom - $(dp 77)))
}

collapse_panel() {
  tap_text "收起" || panel_close_xy
}

analyze_from_panel() {
  tap_text "分析这一屏" || panel_action_xy
}

open_crop_panel() {
  tap_text "框选区域" || panel_action_xy
}

start_overlay() {
  tap_text "开始悬浮建议" || true
  sleep 2
  tap_text "Entire screen" >/dev/null 2>&1 || true
  tap_text "Start now" || tap_text "开始" || true
  sleep 3
}

"$ADB" start-server >/dev/null 2>&1 || true
"$ADB" wait-for-device
screen_metrics

"$ADB" shell settings put global window_animation_scale 0 || true
"$ADB" shell settings put global transition_animation_scale 0 || true
"$ADB" shell settings put global animator_duration_scale 0 || true
"$ADB" shell cmd uimode night no || true

"$ADB" shell pm clear "$PKG" >/dev/null 2>&1 || true
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk
"$ADB" shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow || true
"$ADB" shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true

# 1. Settings, light theme.
"$ADB" shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 3
shot 01-android-settings-light

# 2. Settings, dark theme.
"$ADB" shell cmd uimode night yes || true
"$ADB" shell am force-stop "$PKG" || true
"$ADB" shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 3
shot 02-android-settings-dark
"$ADB" shell cmd uimode night no || true

# 3. Grant capture and show the floating panel over the setup screen.
"$ADB" shell am force-stop "$PKG" || true
"$ADB" shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 2
start_overlay
shot 03-android-overlay-panel

# 4. Collapse to the ink dot, then read a screen in demo mode.
collapse_panel
sleep 1
tap_xy $((SCREEN_W - $(dp 40))) $((SCREEN_H * 40 / 100))
sleep 2
shot 04-android-overlay-suggestions

# 5. Crop selector.
open_crop_panel
sleep 2
shot 05-android-crop
tap_text "取消" || tap_xy $((SCREEN_W - $(dp 188))) $((SCREEN_H - $(dp 41)))

echo "done"
