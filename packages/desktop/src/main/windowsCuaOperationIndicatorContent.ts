import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@zcode/shared";

/**
 * 电脑控制预览窗的呈现层：文案、尺寸与 HTML。
 * 生命周期在 windowsCuaOperationIndicator.ts。
 */

const INDICATOR_CARD_HEIGHT = 38;
const PREVIEW_FRAME_HEIGHT = 180;
export const INDICATOR_CARD_TOP_OFFSET = 12;
/** 贴在对话窗外侧 / 内侧时与窗口边缘的间距。 */
export const INDICATOR_ANCHOR_GAP = 12;
/** 退回对话窗内侧时避开标题栏与顶部工具栏。 */
export const INDICATOR_ANCHOR_TOP_OFFSET = 56;
export const INDICATOR_SHADOW_INSET = { top: 6, right: 8, bottom: 12, left: 8 } as const;

function indicatorCopy(locale: Locale): { text: string; width: number } {
  return locale === "zh-CN"
    ? { text: "ZCode 正在操作电脑", width: 320 }
    : { text: "ZCode is controlling your computer", width: 360 };
}

/** 空壳预览与闭源 Auto-PiP 同属本机桌面投影；Linux 不展示。 */
export function supportsComputerUsePreview(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "darwin";
}

export function indicatorWindowSize(locale: Locale): { width: number; height: number } {
  const { width } = indicatorCopy(locale);
  return {
    width: width + INDICATOR_SHADOW_INSET.left + INDICATOR_SHADOW_INSET.right,
    height:
      INDICATOR_SHADOW_INSET.top +
      INDICATOR_CARD_HEIGHT +
      PREVIEW_FRAME_HEIGHT +
      INDICATOR_SHADOW_INSET.bottom,
  };
}

interface IndicatorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 预览窗贴在发起电脑控制的对话窗旁边：右侧放得下放右侧，否则左侧，
 * 都放不下（对话窗铺满屏幕）时收进对话窗右上角。窗口含透明阴影边，按可见卡片边缘对齐。
 */
export function anchoredIndicatorBounds(
  anchor: IndicatorRect,
  workArea: IndicatorRect,
  size: { width: number; height: number },
): IndicatorRect {
  const inset = INDICATOR_SHADOW_INSET;
  const clampY = (y: number) =>
    Math.round(
      Math.min(
        Math.max(y, workArea.y - inset.top),
        workArea.y + workArea.height - size.height + inset.bottom,
      ),
    );
  const outsideY = clampY(anchor.y - inset.top);
  const rightX = anchor.x + anchor.width + INDICATOR_ANCHOR_GAP - inset.left;
  if (rightX + size.width - inset.right <= workArea.x + workArea.width) {
    return { ...size, x: Math.round(rightX), y: outsideY };
  }
  const leftX = anchor.x - INDICATOR_ANCHOR_GAP - size.width + inset.right;
  if (leftX + inset.left >= workArea.x) {
    return { ...size, x: Math.round(leftX), y: outsideY };
  }
  return {
    ...size,
    x: Math.round(anchor.x + anchor.width - INDICATOR_ANCHOR_GAP - size.width + inset.right),
    y: clampY(anchor.y + INDICATOR_ANCHOR_TOP_OFFSET - inset.top),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function indicatorHtml(locale: Locale): string {
  const copy = indicatorCopy(locale);
  return `<!doctype html>
<html lang="${locale}" data-state="active">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src mediastream:">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
    body { display: flex; align-items: flex-start; justify-content: center; padding: 6px 8px 12px; font-family: system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", sans-serif; }
    .card {
      display: flex; flex-direction: column; width: 100%;
      color: #202124; background: rgba(255, 255, 255, 0.96);
      border: 1px solid rgba(15, 23, 42, 0.14); border-radius: 12px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 6px 12px -6px rgba(15, 23, 42, 0.18);
      overflow: hidden;
      opacity: 1; transform: translateY(0);
      transition: opacity 120ms ease, transform 120ms ease;
      animation: enter 140ms ease-out both;
    }
    .indicator {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      height: 38px; padding: 0 18px;
      font-size: 13px; font-weight: 600; line-height: 1; white-space: nowrap;
    }
    .frame, .video { width: 100%; height: 180px; object-fit: contain; background: #111; display: none; }
    html[data-has-frame="image"] .frame { display: block; }
    html[data-has-frame="video"] .video { display: block; }
    .dots { display: flex; align-items: center; gap: 3px; }
    .dot { width: 4px; height: 4px; border-radius: 50%; background: #64748b; animation: pulse 1.2s ease-in-out infinite; }
    .dot:nth-child(2) { animation-delay: 120ms; }
    .dot:nth-child(3) { animation-delay: 240ms; }
    html[data-state="leaving"] .card { opacity: 0; transform: translateY(-6px); }
    @keyframes enter { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%, 70%, 100% { opacity: .35; transform: scale(.8); } 35% { opacity: 1; transform: scale(1); } }
    @media (prefers-color-scheme: dark) {
      .card { color: #f8fafc; background: rgba(35, 38, 43, 0.96); border-color: rgba(255, 255, 255, 0.14); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), 0 6px 12px -6px rgba(0, 0, 0, 0.28); }
      .dot { background: #a8b3c4; }
    }
    @media (prefers-reduced-motion: reduce) {
      .card, .dot { animation: none; transition: opacity 1ms linear; transform: none; }
      html[data-state="leaving"] .card { transform: none; }
    }
  </style>
</head>
<body><div class="card" role="status" aria-live="polite"><div class="indicator"><span class="dots" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span><span>${escapeHtml(copy.text)}</span></div><img class="frame" alt=""><video class="video" muted playsinline></video></div></body>
</html>`;
}

/**
 * 预览页必须是安全上下文：data: URL 拿不到 navigator.mediaDevices，Windows 的
 * getDisplayMedia 取流会直接失败。每次加载前按当前语言写入本地文件，用 file:// 加载。
 */
export function writeIndicatorPage(directory: string, locale: Locale): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `computer-use-preview.${locale}.html`);
  writeFileSync(path, indicatorHtml(locale), "utf8");
  return path;
}

const STOP_VIDEO_JS =
  'var v=document.querySelector(".video");if(v&&v.srcObject){v.srcObject.getTracks().forEach(function(t){t.stop()});v.srcObject=null;}';

export function previewFrameScript(dataUrl: string): string {
  return `(function(){${STOP_VIDEO_JS}var img=document.querySelector(".frame");if(!img)return;img.src=${JSON.stringify(dataUrl)};document.documentElement.dataset.hasFrame="image";})()`;
}

/** 由宿主以 userGesture 执行；宿主的 setDisplayMediaRequestHandler 直接给出目标窗口，不弹选择器。 */
export function previewVideoStartScript(): string {
  return `(async function(){${STOP_VIDEO_JS}var v=document.querySelector(".video");if(!v)return;var s=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:10},audio:false});v.srcObject=s;s.getVideoTracks().forEach(function(t){t.onended=function(){if(v.srcObject===s){v.srcObject=null;delete document.documentElement.dataset.hasFrame;}}});await v.play();document.documentElement.dataset.hasFrame="video";})()`;
}

export function previewClearScript(): string {
  return `(function(){${STOP_VIDEO_JS}var img=document.querySelector(".frame");if(img)img.removeAttribute("src");delete document.documentElement.dataset.hasFrame;})()`;
}
