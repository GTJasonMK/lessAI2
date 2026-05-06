#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPIMAGE_DIR="$ROOT_DIR/src-tauri/target/release/bundle/appimage"
APPDIR="${APPDIR:-$APPIMAGE_DIR/LessAI.AppDir}"

if [[ ! -d "$APPDIR" ]]; then
  echo "[ERROR] AppDir not found: $APPDIR" >&2
  exit 1
fi

OUT_APPIMAGE="${OUT_APPIMAGE:-}"
if [[ -z "$OUT_APPIMAGE" ]]; then
  OUT_APPIMAGE="$(find "$APPIMAGE_DIR" -maxdepth 1 -type f -name '*.AppImage' | head -n 1 || true)"
fi
if [[ -z "$OUT_APPIMAGE" ]]; then
  OUT_APPIMAGE="$APPIMAGE_DIR/LessAI_0.1.0_amd64.AppImage"
fi

PLUGIN_APPIMAGE="${LINUXDEPLOY_PLUGIN_APPIMAGE:-$HOME/.cache/tauri/linuxdeploy-plugin-appimage.AppImage}"
if [[ ! -x "$PLUGIN_APPIMAGE" ]] && [[ -x "$HOME/.cache/tauri/linuxdeploy-plugin-appimage-x86_64.AppImage" ]]; then
  PLUGIN_APPIMAGE="$HOME/.cache/tauri/linuxdeploy-plugin-appimage-x86_64.AppImage"
fi
if [[ ! -x "$PLUGIN_APPIMAGE" ]]; then
  echo "[ERROR] linuxdeploy appimage plugin not found: $PLUGIN_APPIMAGE" >&2
  exit 1
fi

echo "[INFO] AppDir: $APPDIR"
echo "[INFO] Output AppImage: $OUT_APPIMAGE"
echo "[INFO] Plugin: $PLUGIN_APPIMAGE"

# Align desktop Icon=<name> with actual icon file casing in AppDir.
# Some toolchains emit `LessAI.png` while desktop entry uses `lessai`,
# which makes appimagetool fail on Linux.
ensure_desktop_icon_alias() {
  local desktop_file icon_name icon_path match_path

  desktop_file="$(find "$APPDIR/usr/share/applications" -maxdepth 1 -type f -name '*.desktop' | head -n 1 || true)"
  if [[ -z "$desktop_file" || ! -f "$desktop_file" ]]; then
    return
  fi

  icon_name="$(awk -F= '/^Icon=/{print $2; exit}' "$desktop_file" | tr -d '\r' | xargs || true)"
  if [[ -z "$icon_name" ]]; then
    return
  fi

  icon_path="$APPDIR/${icon_name}.png"
  if [[ -e "$icon_path" ]]; then
    return
  fi

  match_path="$(find "$APPDIR" -maxdepth 1 -type f -iname "${icon_name}.png" | head -n 1 || true)"
  if [[ -n "$match_path" ]]; then
    ln -sfn "$(basename "$match_path")" "$icon_path"
    echo "[INFO] Added icon alias: $(basename "$match_path") -> ${icon_name}.png"
  fi
}

ensure_desktop_icon_alias

# Ensure WebKit subprocess binaries are available in common probe paths.
WEBKIT_SRC=""
for candidate in \
  /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 \
  /usr/lib/webkit2gtk-4.1 \
  /usr/lib64/webkit2gtk-4.1 \
  /usr/libexec/webkit2gtk-4.1; do
  if [[ -d "$candidate" ]]; then
    WEBKIT_SRC="$candidate"
    break
  fi
done
if [[ -n "$WEBKIT_SRC" ]]; then
  install -d "$APPDIR/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
  cp -a "$WEBKIT_SRC/." "$APPDIR/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/"
fi

# Ensure GStreamer can discover the app plugin that provides appsink.
GSTREAMER_APPDIR="$APPDIR/usr/lib/gstreamer-1.0"
GSTREAMER_APP_PLUGIN=""
for candidate in \
  /usr/lib/x86_64-linux-gnu/gstreamer-1.0/libgstapp.so \
  /usr/lib/gstreamer-1.0/libgstapp.so \
  /usr/lib64/gstreamer-1.0/libgstapp.so; do
  if [[ -f "$candidate" ]]; then
    GSTREAMER_APP_PLUGIN="$candidate"
    break
  fi
done
if [[ -z "$GSTREAMER_APP_PLUGIN" ]]; then
  echo "[ERROR] GStreamer app plugin not found (libgstapp.so). Install gstreamer1.0-plugins-base." >&2
  exit 1
fi

GSTREAMER_PLUGIN_SCANNER=""
for candidate in \
  /usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner \
  /usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner \
  /usr/lib64/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner \
  /usr/libexec/gstreamer-1.0/gst-plugin-scanner \
  /usr/lib/gstreamer-1.0/gst-plugin-scanner; do
  if [[ -x "$candidate" ]]; then
    GSTREAMER_PLUGIN_SCANNER="$candidate"
    break
  fi
done
if [[ -z "$GSTREAMER_PLUGIN_SCANNER" ]]; then
  echo "[ERROR] GStreamer plugin scanner not found. Install libgstreamer1.0-0 or gstreamer1.0-tools." >&2
  exit 1
fi

install -d "$GSTREAMER_APPDIR"
cp -a "$GSTREAMER_APP_PLUGIN" "$GSTREAMER_APPDIR/libgstapp.so"
cp -a "$GSTREAMER_PLUGIN_SCANNER" "$GSTREAMER_APPDIR/gst-plugin-scanner"
chmod +x "$GSTREAMER_APPDIR/gst-plugin-scanner"
echo "[INFO] Bundled GStreamer app plugin: $GSTREAMER_APP_PLUGIN"
echo "[INFO] Bundled GStreamer plugin scanner: $GSTREAMER_PLUGIN_SCANNER"

for candidate in \
  /usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-ptp-helper \
  /usr/lib/gstreamer1.0/gstreamer-1.0/gst-ptp-helper \
  /usr/lib64/gstreamer1.0/gstreamer-1.0/gst-ptp-helper \
  /usr/libexec/gstreamer-1.0/gst-ptp-helper; do
  if [[ -x "$candidate" ]]; then
    cp -a "$candidate" "$GSTREAMER_APPDIR/gst-ptp-helper"
    chmod +x "$GSTREAMER_APPDIR/gst-ptp-helper"
    echo "[INFO] Bundled GStreamer PTP helper: $candidate"
    break
  fi
done

# Compatibility links for runtimes that search under AppDir/lib*.
install -d "$APPDIR/lib" "$APPDIR/lib64"
ln -sfn ../usr/lib/x86_64-linux-gnu "$APPDIR/lib/x86_64-linux-gnu"
ln -sfn ../usr/lib/webkit2gtk-4.1 "$APPDIR/lib/webkit2gtk-4.1"
ln -sfn ../usr/lib64/webkit2gtk-4.1 "$APPDIR/lib64/webkit2gtk-4.1"

# Prefer host graphics stack to avoid cross-distro EGL/GBM crashes.
find "$APPDIR/usr/lib" \( \
  -name 'libEGL*' -o -name 'libGLES*' -o -name 'libgbm*' \
  -o -name 'libdrm*' -o -name 'libvulkan*' -o -name 'libxatracker*' \
  -o -name 'libgallium*' -o -name 'libMesa*' -o -name 'libnouveau*' \
  -o -name 'libradeon*' -o -name 'libiris*' -o -name 'dri' \
\) -prune -exec rm -rf {} + 2>/dev/null || true
find "$APPDIR/usr/lib" -xtype l -delete 2>/dev/null || true

cat > "$APPDIR/AppRun" <<'EOF'
#!/usr/bin/env bash
set -eo pipefail
HERE="$(dirname "$(readlink -f "$0")")"
cd "$HERE"
export APPDIR="$HERE"

SYSTEM_LIB_PATHS="/usr/lib:/usr/lib64:/usr/lib/x86_64-linux-gnu"
APPDIR_LIB_PATHS="$APPDIR/usr/lib:$APPDIR/usr/lib/x86_64-linux-gnu:$APPDIR/usr/lib64:$APPDIR/lib:$APPDIR/lib/x86_64-linux-gnu:$APPDIR/lib64"
if [[ "${LESSAI_FORCE_BUNDLED_LIBS:-0}" == "1" ]]; then
  export LD_LIBRARY_PATH="$APPDIR_LIB_PATHS:${LD_LIBRARY_PATH:-}:$SYSTEM_LIB_PATHS"
else
  export LD_LIBRARY_PATH="$SYSTEM_LIB_PATHS:${LD_LIBRARY_PATH:-}:$APPDIR_LIB_PATHS"
fi

if [[ -d "$HERE/apprun-hooks" ]]; then
  while IFS= read -r -d '' hook; do
    # shellcheck disable=SC1090
    source "$hook"
  done < <(find "$HERE/apprun-hooks" -maxdepth 1 -type f -print0 | sort -z)
fi

# Single source of truth lives in src-tauri/src/main.rs (apply_linux_graphics_compat_env).
# Keep AppImage on GPU-capable auto graphics by default. Safe mode forces
# software rendering and should only be opt-in for broken GPU/WebKit stacks:
#   LESSAI_LINUX_GRAPHICS_MODE=safe ./LessAI_*.AppImage
export LESSAI_LINUX_GRAPHICS_MODE="${LESSAI_LINUX_GRAPHICS_MODE:-auto}"

GSTREAMER_PLUGIN_DIR="$APPDIR/usr/lib/gstreamer-1.0"
export GST_REGISTRY_REUSE_PLUGIN_SCANNER="no"
export GST_PLUGIN_SYSTEM_PATH_1_0="$GSTREAMER_PLUGIN_DIR"
export GST_PLUGIN_PATH_1_0="$GSTREAMER_PLUGIN_DIR"
export GST_PLUGIN_SCANNER_1_0="$GSTREAMER_PLUGIN_DIR/gst-plugin-scanner"
export GST_PLUGIN_SCANNER="$GSTREAMER_PLUGIN_DIR/gst-plugin-scanner"

WEBKIT_BASE=""
if [[ "${LESSAI_FORCE_BUNDLED_WEBKIT:-0}" == "1" ]]; then
  WEBKIT_CANDIDATES=(
    "$APPDIR/lib/x86_64-linux-gnu/webkit2gtk-4.1"
    "$APPDIR/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
    "$APPDIR/usr/lib/webkit2gtk-4.1"
    "$APPDIR/usr/lib64/webkit2gtk-4.1"
    "/usr/lib/webkit2gtk-4.1"
    "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
    "/usr/lib64/webkit2gtk-4.1"
  )
else
  WEBKIT_CANDIDATES=(
    "/usr/lib/webkit2gtk-4.1"
    "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
    "/usr/lib64/webkit2gtk-4.1"
    "$APPDIR/lib/x86_64-linux-gnu/webkit2gtk-4.1"
    "$APPDIR/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
    "$APPDIR/usr/lib/webkit2gtk-4.1"
    "$APPDIR/usr/lib64/webkit2gtk-4.1"
  )
fi
for candidate in "${WEBKIT_CANDIDATES[@]}"; do
  if [[ -x "$candidate/WebKitNetworkProcess" ]]; then
    WEBKIT_BASE="$candidate"
    break
  fi
done
if [[ -z "$WEBKIT_BASE" ]]; then
  WEBKIT_BASE="/usr/lib/webkit2gtk-4.1"
fi
export WEBKIT_EXEC_PATH="$WEBKIT_BASE"
export WEBKIT_INJECTED_BUNDLE_PATH="$WEBKIT_BASE/injected-bundle"

if [[ "${LESSAI_DEBUG_APPRUN:-}" == "1" ]]; then
  echo "[AppRun] LD_LIBRARY_PATH=$LD_LIBRARY_PATH" >&2
  echo "[AppRun] LESSAI_LINUX_GRAPHICS_MODE=${LESSAI_LINUX_GRAPHICS_MODE:-<auto-default>}" >&2
  echo "[AppRun] WEBKIT_EXEC_PATH=$WEBKIT_EXEC_PATH" >&2
  echo "[AppRun] GDK_BACKEND=${GDK_BACKEND:-}" >&2
  echo "[AppRun] EGL_PLATFORM=${EGL_PLATFORM:-}" >&2
fi

exec "$HERE/usr/bin/lessai" "$@"
EOF
chmod +x "$APPDIR/AppRun"

RUNTIME_FILE="$(mktemp)"
OFFSET="$(APPIMAGE_EXTRACT_AND_RUN=1 "$PLUGIN_APPIMAGE" --appimage-offset)"
if [[ -z "${OFFSET}" ]] || [[ ! "${OFFSET}" =~ ^[0-9]+$ ]]; then
  echo "[ERROR] 无法获取 AppImage 运行时偏移量（OFFSET=${OFFSET:-<空>}）" >&2
  exit 1
fi
dd if="$PLUGIN_APPIMAGE" of="$RUNTIME_FILE" bs=1 count="$OFFSET" status=none
chmod +x "$RUNTIME_FILE"

TMP_APPIMAGE_DIR="$(mktemp -d)"
cp "$PLUGIN_APPIMAGE" "$TMP_APPIMAGE_DIR/plugin.AppImage"
(
  cd "$TMP_APPIMAGE_DIR"
  APPIMAGE_EXTRACT_AND_RUN=1 ./plugin.AppImage --appimage-extract >/dev/null
  ARCH=x86_64 "$TMP_APPIMAGE_DIR/squashfs-root/appimagetool-prefix/AppRun" \
    --runtime-file "$RUNTIME_FILE" \
    "$APPDIR" \
    "$OUT_APPIMAGE"
)
chmod +x "$OUT_APPIMAGE"

rm -f "$RUNTIME_FILE"
rm -rf "$TMP_APPIMAGE_DIR"

echo "[INFO] Repacked AppImage: $OUT_APPIMAGE"
