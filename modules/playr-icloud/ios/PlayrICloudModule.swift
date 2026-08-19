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
  @Field var metadataAvailable: Bool = true
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

public final class PlayrICloudModule: Module {
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

    AsyncFunction("listAudioFilesAsync") {
      try self.listAudioFiles()
    }

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
      ids.compactMap { id -> ICloudAudioFileRecord? in
        guard
          let url = try? self.audioURL(for: id),
          FileManager.default.fileExists(atPath: url.path)
        else {
          return nil
        }
        return (try? self.audioFileRecord(for: id)) ?? self.fallbackAudioFileRecord(for: url)
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

  }

  private func listAudioFiles() throws -> [ICloudAudioFileRecord] {
    let documentsURL = try documentsURL()
    let urls = try FileManager.default.contentsOfDirectory(
      at: documentsURL,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    )

    return urls
      .filter { supportedAudioExtensions.contains($0.pathExtension.lowercased()) }
      .map { url in
        (try? audioFileRecord(for: url.lastPathComponent)) ?? fallbackAudioFileRecord(for: url)
      }
      .sorted { left, right in
        if left.modifiedAt == right.modifiedAt {
          return left.name.localizedStandardCompare(right.name) == .orderedAscending
        }
        return (left.modifiedAt ?? 0) > (right.modifiedAt ?? 0)
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
    record.metadataAvailable = true
    return record
  }

  private func fallbackAudioFileRecord(for url: URL) -> ICloudAudioFileRecord {
    var record = ICloudAudioFileRecord()
    record.id = url.lastPathComponent
    record.name = url.deletingPathExtension().lastPathComponent
    record.relativePath = url.lastPathComponent
    record.downloadState = "inCloud"
    record.metadataAvailable = false
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
