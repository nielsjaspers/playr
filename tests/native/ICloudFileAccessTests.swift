import Foundation

@main
struct ICloudFileAccessTests {
  static func main() throws {
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? manager.removeItem(at: root) }
    let source = root.appendingPathComponent("Audio")
    let destination = root.appendingPathComponent("Podcasts")
    try manager.createDirectory(at: source, withIntermediateDirectories: false)
    let audio = source.appendingPathComponent("episode.mp3")
    try Data([1, 2, 3]).write(to: audio)
    try ICloudFileAccess.move(from: source, to: source)
    precondition(manager.fileExists(atPath: audio.path))
    try ICloudFileAccess.move(from: source, to: destination)
    precondition(!manager.fileExists(atPath: source.path))
    let movedData = try Data(contentsOf: destination.appendingPathComponent("episode.mp3"))
    precondition(movedData == Data([1, 2, 3]))
    let occupied = root.appendingPathComponent("Existing")
    try manager.createDirectory(at: occupied, withIntermediateDirectories: false)
    do {
      try ICloudFileAccess.move(from: destination, to: occupied)
      fatalError("Move must not overwrite an existing destination")
    } catch {
      precondition((error as NSError).code == NSFileWriteFileExistsError)
      precondition(manager.fileExists(atPath: destination.path))
    }
    precondition(ICloudFileAccess.isRetryable(NSError(domain: NSCocoaErrorDomain, code: NSFileLockingError)))
    precondition(!ICloudFileAccess.isRetryable(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)))
    print("Coordinated move, no-op, collision protection, and retry classification passed.")
  }
}
