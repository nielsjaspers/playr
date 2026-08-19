import ExpoModulesCore
import Foundation

private let supportedAudioExtensions = Set(["aac", "m4a", "m4b", "mp3", "wav"])

private struct ICloudAudioFileRecord: Record {
  @Field var id: String = ""
  @Field var name: String = ""
  @Field var relativePath: String = ""
  @Field var size: Int64 = 0
  @Field var modifiedAt: Double?
  @Field var downloadState: String = "inCloud"
  @Field var downloadProgress: Double?
  @Field var localUri: String?
  @Field var isUploaded: Bool = false
}

private struct ICloudFileOperationRecord: Record {
  @Field var id: String = ""
  @Field var succeeded: Bool = false
  @Field var error: String?
}

private func makeICloudException(_ description: String) -> Exception {
  Exception(
    name: "PlayrICloudException",
    description: description,
    code: "ERR_PLAYR_ICLOUD"
  )
}

private final class AudioMetadataQuery {
  private let documentsURL: URL
  private let query = NSMetadataQuery()
  private let completion: (Result<[ICloudAudioFileRecord], Error>) -> Void
  private var observer: NSObjectProtocol?
  private var timeoutWorkItem: DispatchWorkItem?
  private var hasFinished = false

  init(
    documentsURL: URL,
    completion: @escaping (Result<[ICloudAudioFileRecord], Error>) -> Void
  ) {
    self.documentsURL = documentsURL.standardizedFileURL
    self.completion = completion
  }

  func start() {
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(
      format: "%K BEGINSWITH %@",
      NSMetadataItemPathKey,
      documentsURL.path
    )

    observer = NotificationCenter.default.addObserver(
      forName: .NSMetadataQueryDidFinishGathering,
      object: query,
      queue: .main
    ) { [weak self] _ in
      self?.finish()
    }

    let timeoutWorkItem = DispatchWorkItem { [weak self] in
      self?.fail(
        NSError(
          domain: "PlayrICloud",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "iCloud did not finish loading the library in time."]
        )
      )
    }
    self.timeoutWorkItem = timeoutWorkItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timeoutWorkItem)

    guard query.start() else {
      fail(
        NSError(
          domain: "PlayrICloud",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "iCloud could not start the library query."]
        )
      )
      return
    }
  }

  func cancel() {
    guard !hasFinished else { return }
    hasFinished = true
    cleanUp()
  }

  private func finish() {
    guard !hasFinished else { return }
    hasFinished = true
    query.disableUpdates()

    let files = query.results
      .compactMap { $0 as? NSMetadataItem }
      .compactMap(makeAudioFile)
      .sorted { left, right in
        if left.modifiedAt == right.modifiedAt {
          return left.name.localizedStandardCompare(right.name) == .orderedAscending
        }
        return (left.modifiedAt ?? 0) > (right.modifiedAt ?? 0)
      }

    cleanUp()
    completion(.success(files))
  }

  private func fail(_ error: Error) {
    guard !hasFinished else { return }
    hasFinished = true
    cleanUp()
    completion(.failure(error))
  }

  private func cleanUp() {
    timeoutWorkItem?.cancel()
    timeoutWorkItem = nil

    if let observer {
      NotificationCenter.default.removeObserver(observer)
      self.observer = nil
    }

    query.stop()
  }

  private func makeAudioFile(from item: NSMetadataItem) -> ICloudAudioFileRecord? {
    guard
      let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL,
      supportedAudioExtensions.contains(url.pathExtension.lowercased()),
      let relativePath = relativePath(for: url)
    else {
      return nil
    }

    let isDownloading = item.value(
      forAttribute: NSMetadataUbiquitousItemIsDownloadingKey
    ) as? Bool ?? false
    let rawDownloadStatus = item.value(
      forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey
    ) as? String

    let downloadState: String
    if isDownloading {
      downloadState = "downloading"
    } else if rawDownloadStatus == NSMetadataUbiquitousItemDownloadingStatusNotDownloaded {
      downloadState = "inCloud"
    } else {
      downloadState = "downloaded"
    }

    let progress = item.value(
      forAttribute: NSMetadataUbiquitousItemPercentDownloadedKey
    ) as? Double
    let modifiedAt = item.value(
      forAttribute: NSMetadataItemFSContentChangeDateKey
    ) as? Date

    let record = ICloudAudioFileRecord()
    record.id = relativePath
    record.name = url.deletingPathExtension().lastPathComponent
    record.relativePath = relativePath
    record.size = (item.value(forAttribute: NSMetadataItemFSSizeKey) as? NSNumber)?.int64Value ?? 0
    record.modifiedAt = modifiedAt.map { $0.timeIntervalSince1970 * 1_000 }
    record.downloadState = downloadState
    record.downloadProgress = progress.map { $0 / 100 }
    record.localUri = downloadState == "downloaded" ? url.absoluteString : nil
    record.isUploaded = item.value(
      forAttribute: NSMetadataUbiquitousItemIsUploadedKey
    ) as? Bool ?? false
    return record
  }

  private func relativePath(for url: URL) -> String? {
    let rootPath = documentsURL.path
    let filePath = url.standardizedFileURL.path
    let prefix = rootPath.hasSuffix("/") ? rootPath : rootPath + "/"
    guard filePath.hasPrefix(prefix) else { return nil }
    return String(filePath.dropFirst(prefix.count))
  }
}

public final class PlayrICloudModule: Module {
  private var activeQueries: [UUID: AudioMetadataQuery] = [:]

  public func definition() -> ModuleDefinition {
    Name("PlayrICloud")

    AsyncFunction("getAvailabilityAsync") {
      if FileManager.default.ubiquityIdentityToken == nil {
        return "signedOut"
      }
      return FileManager.default.url(forUbiquityContainerIdentifier: nil) == nil
        ? "unavailable"
        : "available"
    }

    AsyncFunction("ensureLibraryAsync") {
      let documentsURL = try self.documentsURL()
      try FileManager.default.createDirectory(
        at: documentsURL,
        withIntermediateDirectories: true
      )

      let guideURL = documentsURL.appendingPathComponent("Add audio files here.txt")
      guard !FileManager.default.fileExists(atPath: guideURL.path) else { return }

      let guide = "Place MP3, M4A, or M4B files in this folder. Playr never deletes the iCloud originals.\n"
      try guide.write(to: guideURL, atomically: true, encoding: .utf8)
    }

    AsyncFunction("listAudioFilesAsync") { (promise: Promise) in
      do {
        let documentsURL = try self.documentsURL()
        let queryID = UUID()
        let query = AudioMetadataQuery(documentsURL: documentsURL) { [weak self] result in
          self?.activeQueries.removeValue(forKey: queryID)
          switch result {
          case .success(let files):
            promise.resolve(files)
          case .failure(let error):
            promise.reject(makeICloudException(error.localizedDescription))
          }
        }
        self.activeQueries[queryID] = query
        query.start()
      } catch {
        promise.reject(makeICloudException(error.localizedDescription))
      }
    }.runOnQueue(.main)

    AsyncFunction("requestDownloadsAsync") { (ids: [String]) in
      ids.map { id in
        do {
          let url = try self.audioURL(for: id)
          try FileManager.default.startDownloadingUbiquitousItem(at: url)
          return self.operationResult(id: id, succeeded: true)
        } catch {
          return self.operationResult(id: id, succeeded: false, error: error.localizedDescription)
        }
      }
    }

    AsyncFunction("getAudioFilesAsync") { (ids: [String]) in
      ids.compactMap { id in
        try? self.audioFileRecord(for: id)
      }
    }

    AsyncFunction("removeDownloadsAsync") { (ids: [String]) in
      ids.map { id in
        do {
          let url = try self.audioURL(for: id)
          let values = try url.resourceValues(forKeys: [
            .ubiquitousItemDownloadingStatusKey,
            .ubiquitousItemIsUploadedKey,
          ])

          if values.ubiquitousItemDownloadingStatus == .notDownloaded {
            return self.operationResult(id: id, succeeded: true)
          }

          guard values.ubiquitousItemIsUploaded == true else {
            return self.operationResult(
              id: id,
              succeeded: false,
              error: "The file has not finished uploading to iCloud."
            )
          }

          try FileManager.default.evictUbiquitousItem(at: url)
          return self.operationResult(id: id, succeeded: true)
        } catch {
          return self.operationResult(id: id, succeeded: false, error: error.localizedDescription)
        }
      }
    }

    OnDestroy {
      self.activeQueries.values.forEach { $0.cancel() }
      self.activeQueries.removeAll()
    }
  }

  private func documentsURL() throws -> URL {
    guard FileManager.default.ubiquityIdentityToken != nil else {
      throw NSError(
        domain: "PlayrICloud",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Sign in to iCloud Drive to use Playr."]
      )
    }
    guard let containerURL = FileManager.default.url(forUbiquityContainerIdentifier: nil) else {
      throw NSError(
        domain: "PlayrICloud",
        code: 4,
        userInfo: [NSLocalizedDescriptionKey: "The Playr iCloud container is unavailable."]
      )
    }
    return containerURL.appendingPathComponent("Documents", isDirectory: true)
  }

  private func audioURL(for relativePath: String) throws -> URL {
    let documentsURL = try documentsURL().standardizedFileURL
    let candidate = documentsURL
      .appendingPathComponent(relativePath)
      .standardizedFileURL
    let rootPrefix = documentsURL.path.hasSuffix("/")
      ? documentsURL.path
      : documentsURL.path + "/"

    guard
      candidate.path.hasPrefix(rootPrefix),
      supportedAudioExtensions.contains(candidate.pathExtension.lowercased())
    else {
      throw NSError(
        domain: "PlayrICloud",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "The selected audio path is invalid."]
      )
    }
    return candidate
  }

  private func audioFileRecord(for relativePath: String) throws -> ICloudAudioFileRecord {
    let url = try audioURL(for: relativePath)
    let values = try url.resourceValues(forKeys: [
      .contentModificationDateKey,
      .fileSizeKey,
      .ubiquitousItemDownloadingStatusKey,
      .ubiquitousItemIsDownloadingKey,
      .ubiquitousItemIsUploadedKey,
    ])

    let downloadState: String
    if values.ubiquitousItemIsDownloading == true {
      downloadState = "downloading"
    } else if values.ubiquitousItemDownloadingStatus == .notDownloaded {
      downloadState = "inCloud"
    } else {
      downloadState = "downloaded"
    }

    var record = ICloudAudioFileRecord()
    record.id = relativePath
    record.name = url.deletingPathExtension().lastPathComponent
    record.relativePath = relativePath
    record.size = Int64(values.fileSize ?? 0)
    record.modifiedAt = values.contentModificationDate.map { $0.timeIntervalSince1970 * 1_000 }
    record.downloadState = downloadState
    record.downloadProgress = nil
    record.localUri = downloadState == "downloaded" ? url.absoluteString : nil
    record.isUploaded = values.ubiquitousItemIsUploaded ?? false
    return record
  }

  private func operationResult(
    id: String,
    succeeded: Bool,
    error: String? = nil
  ) -> ICloudFileOperationRecord {
    var result = ICloudFileOperationRecord()
    result.id = id
    result.succeeded = succeeded
    result.error = error
    return result
  }
}
