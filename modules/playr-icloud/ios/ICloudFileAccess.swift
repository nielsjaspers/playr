import Foundation

enum ICloudFileAccess {
  /// Coordinates both locations and informs file presenters before and after a move.
  static func move(from source: URL, to destination: URL) throws {
    if source.standardizedFileURL == destination.standardizedFileURL { return }
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordinationError: NSError?
    var operationError: Error?
    coordinator.coordinate(writingItemAt: source, options: .forMoving,
      writingItemAt: destination, options: .forReplacing, error: &coordinationError) { sourceURL, destinationURL in
      do {
        guard !FileManager.default.fileExists(atPath: destinationURL.path) else {
          throw CocoaError(.fileWriteFileExists)
        }
        coordinator.item(at: sourceURL, willMoveTo: destinationURL)
        try FileManager.default.moveItem(at: sourceURL, to: destinationURL)
        coordinator.item(at: sourceURL, didMoveTo: destinationURL)
      } catch { operationError = error }
    }
    if let coordinationError { throw coordinationError }
    if let operationError { throw operationError }
  }

  static func isRetryable(_ error: NSError) -> Bool {
    if error.domain == NSCocoaErrorDomain && error.code == NSFileLockingError { return true }
    if error.domain == NSPOSIXErrorDomain && [Int(EBUSY), Int(EAGAIN)].contains(error.code) { return true }
    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError { return isRetryable(underlying) }
    return false
  }
}
