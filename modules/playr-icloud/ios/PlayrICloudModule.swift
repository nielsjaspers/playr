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

private struct ICloudFolderRecord: Record {
  @Field var id: String = ""
  @Field var name: String = ""
  @Field var relativePath: String = ""
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

    View(PlayrLibraryView.self)

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

    AsyncFunction("listFoldersAsync") {
      try self.listFolders()
    }

    AsyncFunction("createFolderAsync") { (parentPath: String, name: String) in
      let parentURL = try self.folderURL(for: parentPath)
      let folderName = try self.validatedFolderName(name)
      let folderURL = parentURL.appendingPathComponent(folderName, isDirectory: true)
      try self.ensureAvailableDestination(folderURL)
      try FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: false)
      return try self.folderRecord(for: folderURL)
    }

    AsyncFunction("renameFolderAsync") { (relativePath: String, name: String) in
      guard !relativePath.isEmpty else {
        throw makeICloudException("The Playr library folder cannot be renamed.")
      }
      let sourceURL = try self.folderURL(for: relativePath)
      let folderName = try self.validatedFolderName(name)
      let destinationURL = sourceURL
        .deletingLastPathComponent()
        .appendingPathComponent(folderName, isDirectory: true)
      try self.ensureAvailableDestination(destinationURL, allowing: sourceURL)
      if sourceURL.standardizedFileURL != destinationURL.standardizedFileURL {
        try FileManager.default.moveItem(at: sourceURL, to: destinationURL)
      }
      return try self.folderRecord(for: destinationURL)
    }

    AsyncFunction("moveAudioFileAsync") { (id: String, destinationFolderPath: String) in
      let sourceURL = try self.audioURL(for: id)
      let destinationFolderURL = try self.folderURL(for: destinationFolderPath)
      let destinationURL = destinationFolderURL.appendingPathComponent(sourceURL.lastPathComponent)
      try self.ensureAvailableDestination(destinationURL, allowing: sourceURL)
      if sourceURL.standardizedFileURL != destinationURL.standardizedFileURL {
        try FileManager.default.moveItem(at: sourceURL, to: destinationURL)
      }
      let destinationPath = try self.relativePath(for: destinationURL)
      return (try? self.audioFileRecord(for: destinationPath))
        ?? self.fallbackAudioFileRecord(for: destinationURL)
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
    let urls = try descendants(of: documentsURL)
    return urls
      .filter { supportedAudioExtensions.contains($0.pathExtension.lowercased()) }
      .map { url in
        let relativePath = (try? self.relativePath(for: url)) ?? url.lastPathComponent
        return (try? audioFileRecord(for: relativePath)) ?? fallbackAudioFileRecord(for: url)
      }
      .sorted { left, right in
        left.relativePath.localizedStandardCompare(right.relativePath) == .orderedAscending
      }
  }

  private func listFolders() throws -> [ICloudFolderRecord] {
    let documentsURL = try documentsURL()
    return try descendants(of: documentsURL)
      .filter { url in
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
      }
      .compactMap { try? folderRecord(for: $0) }
      .sorted {
        $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending
      }
  }

  private func descendants(of rootURL: URL) throws -> [URL] {
    guard let enumerator = FileManager.default.enumerator(
      at: rootURL,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles, .skipsPackageDescendants]
    ) else {
      return []
    }
    return enumerator.compactMap { $0 as? URL }
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

  private func folderURL(for relativePath: String) throws -> URL {
    let documentsURL = try documentsURL().standardizedFileURL
    guard !relativePath.hasPrefix("/") else {
      throw makeICloudException("The selected folder path is invalid.")
    }
    let candidate = relativePath.isEmpty
      ? documentsURL
      : documentsURL.appendingPathComponent(relativePath, isDirectory: true).standardizedFileURL
    let rootPrefix = documentsURL.path.hasSuffix("/")
      ? documentsURL.path
      : documentsURL.path + "/"
    guard candidate == documentsURL || candidate.path.hasPrefix(rootPrefix) else {
      throw makeICloudException("The selected folder path is invalid.")
    }
    var isDirectory: ObjCBool = false
    guard
      FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      throw makeICloudException("The selected folder no longer exists.")
    }
    return candidate
  }

  private func relativePath(for url: URL) throws -> String {
    let documentsURL = try documentsURL().standardizedFileURL
    let candidate = url.standardizedFileURL
    let rootPrefix = documentsURL.path.hasSuffix("/")
      ? documentsURL.path
      : documentsURL.path + "/"
    guard candidate.path.hasPrefix(rootPrefix) else {
      throw makeICloudException("The selected item is outside the Playr library.")
    }
    return String(candidate.path.dropFirst(rootPrefix.count))
  }

  private func validatedFolderName(_ name: String) throws -> String {
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let invalidCharacters = CharacterSet(charactersIn: "/:").union(.controlCharacters)
    guard
      !trimmedName.isEmpty,
      trimmedName != ".",
      trimmedName != "..",
      trimmedName.rangeOfCharacter(from: invalidCharacters) == nil
    else {
      throw makeICloudException("Enter a folder name without slashes or colons.")
    }
    return trimmedName
  }

  private func ensureAvailableDestination(_ destinationURL: URL, allowing sourceURL: URL? = nil) throws {
    if sourceURL?.standardizedFileURL == destinationURL.standardizedFileURL {
      return
    }
    guard !FileManager.default.fileExists(atPath: destinationURL.path) else {
      throw makeICloudException("An item with that name already exists in this folder.")
    }
  }

  private func folderRecord(for url: URL) throws -> ICloudFolderRecord {
    let relativePath = try self.relativePath(for: url)
    var record = ICloudFolderRecord()
    record.id = relativePath
    record.name = url.lastPathComponent
    record.relativePath = relativePath
    return record
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
    let relativePath = (try? self.relativePath(for: url)) ?? url.lastPathComponent
    var record = ICloudAudioFileRecord()
    record.id = relativePath
    record.name = url.deletingPathExtension().lastPathComponent
    record.relativePath = relativePath
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
