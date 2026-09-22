// 电脑控制预览辅助程序（ScreenCaptureKit）。
//
// 用法：
//   zcode-cua-preview resolve [--pid <pid>] [--app <名称或 bundle id>] [--window-id <id>]
//     输出一行 JSON：{"pid":..,"windowId":..,"title":..,"onScreen":..,"w":..,"h":..}
//     或 {"error":"app_not_found" | "window_not_found" | "screen_capture_unavailable"}。
//   zcode-cua-preview stream --window-id <CGWindowID> [--fps 10] [--max-width 640] [--quality 0.7]
//     stdout 连续输出帧：4 字节大端长度 + JPEG。stdin 关闭即退出；目标窗口消失时以 5 退出。
//
// 列窗与取流都需要屏幕录制权限。辅助程序作为 ZCode.app 的子进程运行，TCC 归属于宿主。

import AppKit
import CoreImage
import CoreMedia
import Foundation
import ScreenCaptureKit

signal(SIGPIPE, SIG_IGN)

let arguments = Array(CommandLine.arguments.dropFirst())
let command = arguments.first ?? ""

func argValue(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

func writeStdout(_ data: Data) {
    do {
        try FileHandle.standardOutput.write(contentsOf: data)
    } catch {
        // 父进程已关闭管道：没有消费者就没有继续采集的意义。
        exit(0)
    }
}

func printJSON(_ object: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: object) {
        writeStdout(data + Data("\n".utf8))
    }
    exit(0)
}

func loadShareableWindows(_ completion: @escaping ([SCWindow]?) -> Void) {
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { content, error in
        completion(error == nil ? content?.windows ?? [] : nil)
    }
}

/// KimiCU 的 app 参数可能是显示名、bundle id 或可执行文件名。
func resolvePid(pid: pid_t?, app: String?) -> pid_t? {
    if let pid, pid > 0 { return pid }
    guard let raw = app?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
        return nil
    }
    let needle = raw.lowercased()
    let hits = NSWorkspace.shared.runningApplications.filter { candidate in
        if candidate.activationPolicy == .prohibited { return false }
        if candidate.bundleIdentifier?.lowercased() == needle { return true }
        if candidate.localizedName?.lowercased() == needle { return true }
        if candidate.executableURL?.lastPathComponent.lowercased() == needle { return true }
        return candidate.bundleURL?.deletingPathExtension().lastPathComponent.lowercased() == needle
    }
    return (hits.first { $0.activationPolicy == .regular } ?? hits.first)?.processIdentifier
}

func area(_ window: SCWindow) -> CGFloat { window.frame.width * window.frame.height }

/// 同一进程多个窗口时：窗口号命中优先；其次当前屏幕上面积最大者；
/// 都不在屏幕上（其他桌面空间、被遮挡）时取有标题的最大窗口，排除无标题的隐藏辅助窗。
func pickWindow(_ windows: [SCWindow], pid: pid_t, preferredId: CGWindowID?) -> SCWindow? {
    let owned = windows.filter {
        $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width >= 40
            && $0.frame.height >= 40
    }
    if let preferredId, let exact = owned.first(where: { $0.windowID == preferredId }) {
        return exact
    }
    if let best = owned.filter({ $0.isOnScreen }).max(by: { area($0) < area($1) }) {
        return best
    }
    return owned.filter { !($0.title ?? "").isEmpty }.max(by: { area($0) < area($1) })
}

func runResolve() {
    let pidArg = argValue("--pid").flatMap { Int32($0) }
    let windowIdArg = argValue("--window-id").flatMap { UInt32($0) }
    guard let pid = resolvePid(pid: pidArg, app: argValue("--app")) else {
        printJSON(["error": "app_not_found"])
    }
    loadShareableWindows { windows in
        guard let windows else { printJSON(["error": "screen_capture_unavailable"]) }
        guard let window = pickWindow(windows, pid: pid, preferredId: windowIdArg) else {
            printJSON(["error": "window_not_found", "pid": Int(pid)])
        }
        printJSON([
            "pid": Int(pid),
            "windowId": Int(window.windowID),
            "title": window.title ?? "",
            "onScreen": window.isOnScreen,
            "w": window.frame.width,
            "h": window.frame.height,
        ])
    }
}

final class FrameWriter: NSObject, SCStreamOutput, SCStreamDelegate {
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private let quality: CGFloat

    init(quality: CGFloat) {
        self.quality = quality
    }

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen, sampleBuffer.isValid else { return }
        // 内容未变化时 SCK 只发 idle 帧；只转发完整帧，静止窗口不产生任何流量。
        guard
            let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
            let rawStatus = attachments.first?[.status] as? Int,
            SCFrameStatus(rawValue: rawStatus) == .complete,
            let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else { return }
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard
            let jpeg = context.jpegRepresentation(
                of: image, colorSpace: colorSpace,
                options: [
                    CIImageRepresentationOption(
                        rawValue: kCGImageDestinationLossyCompressionQuality as String): quality
                ])
        else { return }
        var length = UInt32(jpeg.count).bigEndian
        var packet = Data(bytes: &length, count: 4)
        packet.append(jpeg)
        writeStdout(packet)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("[cua-preview] stream stopped: \(error.localizedDescription)\n", stderr)
        exit(5)
    }
}

func streamConfiguration(for window: SCWindow, fps: Int, maxWidth: Int) -> SCStreamConfiguration {
    let configuration = SCStreamConfiguration()
    let scale = min(1, CGFloat(maxWidth) / max(window.frame.width, 1))
    configuration.width = max(2, Int((window.frame.width * scale).rounded()))
    configuration.height = max(2, Int((window.frame.height * scale).rounded()))
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.showsCursor = false
    configuration.queueDepth = 3
    return configuration
}

var activeStream: SCStream?
var activeWriter: FrameWriter?
var activeSize = CGSize.zero
let sampleQueue = DispatchQueue(label: "dev.zcode.cua-preview.samples")

func runStream() {
    guard let windowId = argValue("--window-id").flatMap({ UInt32($0) }) else {
        fputs("usage: zcode-cua-preview stream --window-id <id>\n", stderr)
        exit(2)
    }
    let fps = max(1, min(30, argValue("--fps").flatMap { Int($0) } ?? 10))
    let maxWidth = max(64, min(2048, argValue("--max-width").flatMap { Int($0) } ?? 640))
    let quality = CGFloat(max(0.1, min(1, argValue("--quality").flatMap { Double($0) } ?? 0.7)))

    // 父进程退出或主动关闭 stdin 时收尾，避免遗留采集进程。
    DispatchQueue.global(qos: .utility).async {
        _ = FileHandle.standardInput.readDataToEndOfFile()
        exit(0)
    }

    loadShareableWindows { windows in
        guard let windows else {
            fputs("[cua-preview] screen capture unavailable\n", stderr)
            exit(3)
        }
        guard let window = windows.first(where: { $0.windowID == windowId }) else { exit(5) }
        let writer = FrameWriter(quality: quality)
        let stream = SCStream(
            filter: SCContentFilter(desktopIndependentWindow: window),
            configuration: streamConfiguration(for: window, fps: fps, maxWidth: maxWidth),
            delegate: writer)
        do {
            try stream.addStreamOutput(writer, type: .screen, sampleHandlerQueue: sampleQueue)
        } catch {
            fputs("[cua-preview] add output failed: \(error.localizedDescription)\n", stderr)
            exit(4)
        }
        activeStream = stream
        activeWriter = writer
        activeSize = window.frame.size
        stream.startCapture { error in
            if let error {
                fputs("[cua-preview] start failed: \(error.localizedDescription)\n", stderr)
                exit(4)
            }
        }
        watchWindow(windowId: windowId, fps: fps, maxWidth: maxWidth)
    }
}

/// 窗口尺寸变化时更新输出尺寸（保持比例）；窗口关闭时退出，由宿主重新解析目标。
func watchWindow(windowId: CGWindowID, fps: Int, maxWidth: Int) {
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1.5) {
        loadShareableWindows { windows in
            guard let windows else { return watchWindow(windowId: windowId, fps: fps, maxWidth: maxWidth) }
            guard let window = windows.first(where: { $0.windowID == windowId }) else { exit(5) }
            let size = window.frame.size
            if abs(size.width - activeSize.width) > 2 || abs(size.height - activeSize.height) > 2 {
                activeSize = size
                activeStream?.updateConfiguration(
                    streamConfiguration(for: window, fps: fps, maxWidth: maxWidth)
                ) { _ in }
            }
            watchWindow(windowId: windowId, fps: fps, maxWidth: maxWidth)
        }
    }
}

switch command {
case "resolve":
    runResolve()
case "stream":
    runStream()
default:
    fputs("usage: zcode-cua-preview resolve|stream [options]\n", stderr)
    exit(2)
}

dispatchMain()
