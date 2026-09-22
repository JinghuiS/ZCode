/**
 * macOS 自替换安装的纯逻辑部分。
 *
 * CI 产出的 mac 包只有 ad-hoc 签名，Squirrel.Mac 会用“当前 App 的 designated requirement”
 * 校验新包；ad-hoc 签名的 requirement 就是固定 cdhash，任何新版本都不满足，因此无法 stage。
 * 这里改为：electron-updater 负责下载与 sha512 校验，App 退出后由独立 shell 脚本解压 zip 并替换 .app。
 *
 * 本文件保持零依赖（不 import 任何模块），便于 node:test 直接执行。
 */

export type MacInstallMode = "squirrel" | "self-install";

/**
 * 解析 `codesign -dv` 输出（写在 stderr）。只有带 Team ID 的正式签名才交给 Squirrel.Mac，
 * ad-hoc（TeamIdentifier=not set）、未签名或签名损坏都走自替换安装。
 */
export function resolveMacInstallModeFromCodesignOutput(output: string | null): MacInstallMode {
  const teamIdentifier = output?.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim();
  return teamIdentifier && teamIdentifier !== "not set" ? "squirrel" : "self-install";
}

/** 从主进程可执行文件路径（…/X.app/Contents/MacOS/X）反推 .app 包路径。 */
export function resolveMacAppBundlePath(executablePath: string): string | null {
  const marker = ".app/Contents/MacOS/";
  const index = executablePath.lastIndexOf(marker);
  return index === -1 ? null : executablePath.slice(0, index + ".app".length);
}

/**
 * 从“下载”目录直接打开的隔离 App 会被系统 App Translocation 挂到只读随机路径，
 * 替换它既无权限也无意义，必须先让用户把 App 拖进「应用程序」。
 */
export function isTranslocatedMacAppPath(bundlePath: string): boolean {
  return bundlePath.includes("/AppTranslocation/");
}

/**
 * 安装脚本参数：$1 等待退出的 App PID，$2 更新 zip，$3 目标 .app 路径，$4 重启标记文件。
 *
 * - 等 App 退出后再动文件，避免覆盖正在运行的 bundle。
 * - 在目标同目录解压暂存，保证后续 mv 是同卷 rename，替换过程接近原子。
 * - 新包先过 codesign --verify，签名损坏的包会被系统判定“已损坏”，不能替换上去。
 * - 替换失败时把旧包挪回原位；只有 quitAndInstall 写了重启标记才重新打开 App，
 *   普通退出时的静默安装不应把用户刚关掉的 App 再拉起来。
 */
export function buildMacSelfInstallScript(): string {
  return `#!/bin/bash
set -u
APP_PID="$1"
UPDATE_ZIP="$2"
TARGET_APP="$3"
RELAUNCH_MARKER="$4"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

relaunch_if_requested() {
  if [ -f "$RELAUNCH_MARKER" ]; then
    rm -f "$RELAUNCH_MARKER"
    /usr/bin/open "$TARGET_APP"
  fi
}

fail() {
  log "install failed: $*"
  relaunch_if_requested
  exit 1
}

log "waiting for pid=$APP_PID to exit"
while kill -0 "$APP_PID" 2>/dev/null; do
  sleep 1
done
sleep 1

[ -f "$UPDATE_ZIP" ] || fail "update zip missing: $UPDATE_ZIP"

STAGE_DIR="$(mktemp -d "$(dirname "$TARGET_APP")/.zcode-update.XXXXXX")" || fail "cannot create stage dir"
trap 'rm -rf "$STAGE_DIR"' EXIT

/usr/bin/ditto -x -k "$UPDATE_ZIP" "$STAGE_DIR/new" || fail "unzip failed"
NEW_APP="$(find "$STAGE_DIR/new" -maxdepth 1 -name '*.app' -type d | head -n 1)"
[ -n "$NEW_APP" ] || fail "no .app found in update zip"

/usr/bin/xattr -cr "$NEW_APP" 2>/dev/null || true
/usr/bin/codesign --verify "$NEW_APP" || fail "code signature of new app is invalid"

mv "$TARGET_APP" "$STAGE_DIR/previous.app" || fail "cannot move current app aside"
if ! mv "$NEW_APP" "$TARGET_APP"; then
  mv "$STAGE_DIR/previous.app" "$TARGET_APP"
  fail "cannot move new app into place"
fi

log "installed update into $TARGET_APP"
relaunch_if_requested
`;
}
