import Foundation
import React

@objc(FilmsnapsDownloader)
class FilmsnapsDownloader: RCTEventEmitter {

    private var backgroundSession: URLSession!
    private var taskMap: [String: URLSessionDownloadTask] = [:]
    private var hasListeners = false

    @objc override static func requiresMainQueueSetup() -> Bool { return false }

    override func supportedEvents() -> [String] {
        return ["onDownloadProgress", "onDownloadComplete", "onDownloadError", "onDownloadPaused"]
    }

    override func startObserving() { hasListeners = true }
    override func stopObserving() { hasListeners = false }

    override init() {
        super.init()
        let config = URLSessionConfiguration.background(withIdentifier: "app.filmsnaps.mobile.downloads")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.waitsForConnectivity = true
        config.timeoutIntervalForResource = 3600
        backgroundSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    @objc(startDownload:url:fileName:headers:resolver:rejecter:)
    func startDownload(
        _ taskId: String, url: String, fileName: String, headers: [String: String]?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let downloadUrl = URL(string: url) else {
            reject("INVALID_URL", "Malformed URL", nil); return
        }
        var request = URLRequest(url: downloadUrl)
        request.timeoutInterval = 30
        headers?.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        let task = backgroundSession.downloadTask(with: request)
        task.taskDescription = taskId
        taskMap[taskId] = task
        task.resume()
        resolve(String(task.taskIdentifier))
    }

    @objc(pauseDownload:resolver:rejecter:)
    func pauseDownload(
        _ taskId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let task = taskMap[taskId] else { resolve(nil); return }
        task.cancel { resumeData in
            if let data = resumeData {
                UserDefaults.standard.set(data, forKey: "filmsnaps_resume_\(taskId)")
            }
            DispatchQueue.main.async {
                self.taskMap.removeValue(forKey: taskId)
                self.sendEventSafe("onDownloadPaused", body: [
                    "taskId": taskId,
                    "bytesDownloaded": task.countOfBytesReceived,
                    "bytesTotal": task.countOfBytesExpectedToReceive
                ])
            }
            resolve(nil)
        }
    }

    @objc(resumeDownload:url:fileName:offsetBytes:headers:resolver:rejecter:)
    func resumeDownload(
        _ taskId: String, url: String, fileName: String, offsetBytes: Double,
        headers: [String: String]?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let key = "filmsnaps_resume_\(taskId)"
        if let resumeData = UserDefaults.standard.data(forKey: key) {
            let task = backgroundSession.downloadTask(withResumeData: resumeData)
            task.taskDescription = taskId
            taskMap[taskId] = task
            task.resume()
            UserDefaults.standard.removeObject(forKey: key)
            resolve(String(task.taskIdentifier))
            return
        }
        var newHeaders = headers ?? [:]
        if offsetBytes > 0 { newHeaders["Range"] = "bytes=\(Int(offsetBytes))-" }
        startDownload(taskId, url: url, fileName: fileName, headers: newHeaders, resolver: resolve, rejecter: reject)
    }

    @objc(cancelDownload:resolver:rejecter:)
    func cancelDownload(
        _ taskId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        taskMap[taskId]?.cancel()
        taskMap.removeValue(forKey: taskId)
        UserDefaults.standard.removeObject(forKey: "filmsnaps_resume_\(taskId)")
        resolve(nil)
    }

    @objc(getAvailableStorage:rejecter:)
    func getAvailableStorage(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        resolve(values?.volumeAvailableCapacityForImportantUsage ?? 0)
    }

    private func sendEventSafe(_ name: String, body: [String: Any]) {
        guard hasListeners else { return }
        sendEvent(withName: name, body: body)
    }
}

extension FilmsnapsDownloader: URLSessionDownloadDelegate {
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let taskId = downloadTask.taskDescription ?? "unknown"
        taskMap.removeValue(forKey: taskId)

        let destDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Filmsnaps")
        do {
            try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
            let fileName = downloadTask.originalRequest?.url?.lastPathComponent ?? "\(taskId).mp4"
            let safeName = fileName.replacingOccurrences(of: "[^a-zA-Z0-9._-]", with: "_", options: .regularExpression)
            let destPath = destDir.appendingPathComponent(safeName)
            if FileManager.default.fileExists(atPath: destPath.path) {
                try FileManager.default.removeItem(at: destPath)
            }
            try FileManager.default.moveItem(at: location, to: destPath)
            let size = (try? FileManager.default.attributesOfItem(atPath: destPath.path)[.size] as? Int64) ?? 0
            sendEventSafe("onDownloadComplete", body: ["taskId": taskId, "filePath": destPath.absoluteString, "bytesTotal": size])
        } catch {
            sendEventSafe("onDownloadError", body: ["taskId": taskId, "error": error.localizedDescription])
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let taskId = downloadTask.taskDescription ?? "unknown"
        sendEventSafe("onDownloadProgress", body: [
            "taskId": taskId,
            "bytesDownloaded": totalBytesWritten,
            "bytesTotal": totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : 0
        ])
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error = error else { return }
        let taskId = task.taskDescription ?? "unknown"
        if (error as NSError).code == NSURLErrorCancelled { return }
        taskMap.removeValue(forKey: taskId)
        sendEventSafe("onDownloadError", body: ["taskId": taskId, "error": error.localizedDescription])
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
                  let handler = appDelegate.backgroundCompletionHandler else { return }
            handler()
            appDelegate.backgroundCompletionHandler = nil
        }
    }
}
