import { execFile, spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, closeSync, openSync, rmSync, writeFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import { MacUpdater, type UpdateDownloadedEvent } from "electron-updater";
import type { DownloadExecutorTask } from "electron-updater/out/AppUpdater.js";
import {
  buildMacSelfInstallScript,
  isTranslocatedMacAppPath,
  resolveMacAppBundlePath,
  resolveMacInstallModeFromCodesignOutput,
  type MacInstallMode,
} from "./macSelfInstall.js";

// 与 MacUpdater 内部保持一致：差分下载以该文件作为“上一版 zip”。
const CURRENT_MAC_APP_ZIP_FILE_NAME = "update.zip";

function readCodesignOutput(bundlePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/codesign", ["-dv", "--verbose=2", bundlePath], (error, _stdout, stderr) => {
      resolve(error ? null : String(stderr));
    });
  });
}

/**
 * 未用 Developer ID 签名的 mac 包无法通过 Squirrel.Mac 校验（见 macSelfInstall.ts）。
 * 该 updater 沿用 MacUpdater 的检查、架构选择、差分下载与 sha512 校验，
 * 只把“交给 Squirrel stage/安装”换成退出后由 shell 脚本替换 .app；
 * 若运行中的 App 带 Team ID 正式签名，则完全回落到原生 Squirrel 流程。
 */
export class MacSelfInstallUpdater extends MacUpdater {
  private installModePromise: Promise<MacInstallMode> | null = null;
  private installMode: MacInstallMode | null = null;
  private downloadedZipPath: string | null = null;
  private installWatcher: ChildProcess | null = null;
  private selfInstallTriggered = false;

  private get bundlePath(): string | null {
    return resolveMacAppBundlePath(process.execPath);
  }

  private get relaunchMarkerPath(): string {
    return join(app.getPath("userData"), "mac-self-install.relaunch");
  }

  private resolveInstallMode(): Promise<MacInstallMode> {
    this.installModePromise ??= (async () => {
      const bundlePath = this.bundlePath;
      const mode = resolveMacInstallModeFromCodesignOutput(
        bundlePath ? await readCodesignOutput(bundlePath) : null,
      );
      this.installMode = mode;
      this._logger.info(`[mac-self-install] install mode=${mode} bundle=${bundlePath}`);
      return mode;
    })();
    return this.installModePromise;
  }

  /** 在下载前就拦住无法替换的位置，避免用户下载完、退出准备都做完才发现装不上。 */
  private assertBundleReplaceable(): string {
    const bundlePath = this.bundlePath;
    if (!bundlePath) {
      throw new Error(`Cannot locate app bundle from ${process.execPath}`);
    }
    if (isTranslocatedMacAppPath(bundlePath)) {
      throw new Error(
        "App is running from a translocated location. Move it to the Applications folder and reopen it to enable updates.",
      );
    }
    try {
      accessSync(bundlePath, constants.W_OK);
      accessSync(dirname(bundlePath), constants.W_OK);
    } catch {
      throw new Error(
        `No write permission to replace ${bundlePath}. Move the app to a writable location (e.g. Applications) to enable updates.`,
      );
    }
    return bundlePath;
  }

  private stopInstallWatcher(): void {
    if (this.installWatcher && this.installWatcher.exitCode === null) {
      this.installWatcher.kill();
    }
    this.installWatcher = null;
  }

  private startInstallWatcher(zipPath: string): void {
    const bundlePath = this.assertBundleReplaceable();
    this.stopInstallWatcher();

    const scriptPath = join(app.getPath("userData"), "mac-self-install.sh");
    writeFileSync(scriptPath, buildMacSelfInstallScript(), { mode: 0o755 });
    const logFd = openSync(join(app.getPath("logs"), "mac-self-install.log"), "a");
    try {
      // 脚本在 App 运行期间就启动并等待 PID 退出：主进程多数退出路径走 app.exit()，
      // 不会发出 quit 事件，退出时再拉起安装器并不可靠。
      const watcher = spawn(
        "/bin/bash",
        [scriptPath, String(process.pid), zipPath, bundlePath, this.relaunchMarkerPath],
        { detached: true, stdio: ["ignore", logFd, logFd] },
      );
      watcher.unref();
      this.installWatcher = watcher;
      this._logger.info(`[mac-self-install] install watcher started pid=${watcher.pid}`);
    } finally {
      closeSync(logFd);
    }
  }

  protected override async executeDownload(taskOptions: DownloadExecutorTask): Promise<string[]> {
    if ((await this.resolveInstallMode()) === "squirrel") {
      return super.executeDownload(taskOptions);
    }

    this.assertBundleReplaceable();
    // 新一轮下载会清理 pending 目录里的旧 zip，旧 watcher 不能再在退出时去装它。
    this.stopInstallWatcher();
    this.downloadedZipPath = null;

    return super.executeDownload({
      ...taskOptions,
      done: async (event: UpdateDownloadedEvent) => {
        const helper = this.downloadedUpdateHelper;
        if (helper && !taskOptions.downloadUpdateOptions.disableDifferentialDownload) {
          try {
            await mkdir(helper.cacheDir, { recursive: true });
            await copyFile(
              event.downloadedFile,
              join(helper.cacheDir, CURRENT_MAC_APP_ZIP_FILE_NAME),
            );
          } catch (error) {
            this._logger.warn(
              `[mac-self-install] cache update.zip for differential download failed: ${String(error)}`,
            );
          }
        }

        this.downloadedZipPath = event.downloadedFile;
        rmSync(this.relaunchMarkerPath, { force: true });
        if (this.autoInstallOnAppQuit) {
          this.startInstallWatcher(event.downloadedFile);
        }
        this.dispatchUpdateDownloaded(event);
      },
    });
  }

  override quitAndInstall(): void {
    if (this.installMode !== "self-install") {
      super.quitAndInstall();
      return;
    }
    if (this.selfInstallTriggered) {
      this._logger.warn("[mac-self-install] quitAndInstall already triggered");
      return;
    }

    const zipPath = this.downloadedZipPath;
    if (!zipPath) {
      this.dispatchError(new Error("No downloaded update to install"));
      return;
    }

    try {
      if (!this.installWatcher || this.installWatcher.exitCode !== null) {
        this.startInstallWatcher(zipPath);
      }
      writeFileSync(this.relaunchMarkerPath, "");
    } catch (error) {
      // 调用方已完成退出准备（host/agent 已回收），装不上时重启回到可用状态。
      this.dispatchError(error instanceof Error ? error : new Error(String(error)));
      app.relaunch();
      this.app.quit();
      return;
    }

    this.selfInstallTriggered = true;
    this._logger.info("[mac-self-install] quitting app for self install");
    this.app.quit();
  }
}
