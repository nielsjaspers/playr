import CoreTransferable
import ExpoModulesCore
import SwiftUI
import UniformTypeIdentifiers

private let playrAudioDragType = UTType(exportedAs: "com.nielsjaspers.playr.audio-item", conformingTo: .data)

private struct PlayrAudioDragItem: Codable, Hashable, Identifiable, Sendable, Transferable {
  let id: String
  var origin: Origin = .library
  enum Origin: String, Codable { case library, queue, continuation }

  static var transferRepresentation: some TransferRepresentation {
    CodableRepresentation(contentType: playrAudioDragType)
  }
}

public struct PlayrLibraryAudioItemRecord: Record {
  @Field var id: String = ""
  @Field var name: String = ""
  @Field var relativePath: String = ""
  @Field var size: Int64 = 0
  @Field var downloadState: String = "inCloud"
  @Field var downloadProgress: Double?
  @Field var progressLabel: String?
  @Field var completedAt: Double?
  @Field var contextLabel: String?

  public init() {}
}

public struct PlayrLibraryFolderItemRecord: Record {
  @Field var id: String = ""
  @Field var name: String = ""
  @Field var relativePath: String = ""

  public init() {}
}

public final class PlayrLibraryViewProps: ExpoSwiftUI.ViewProps {
  @Field var documentsUri: String?
  @Field var title: String = "Library"
  @Field var currentFolderPath: String = ""
  @Field var searchQuery: String = ""
  @Field var searchGlobally: Bool = false
  @Field var isRefreshing: Bool = false
  @Field var isReversed: Bool = false
  @Field var keepDownloads: Bool = false
  @Field var rememberTimestamps: Bool = true
  @Field var hasCloudFiles: Bool = false
  @Field var hasDownloadedFiles: Bool = false
  @Field var currentFileId: String?
  @Field var isPlaying: Bool = false
  @Field var removingIds: [String] = []
  @Field var queuedIds: [String] = []
  @Field var directFiles: [PlayrLibraryAudioItemRecord] = []
  @Field var continueFiles: [PlayrLibraryAudioItemRecord] = []
  @Field var searchResults: [PlayrLibraryAudioItemRecord] = []
  @Field var folders: [PlayrLibraryFolderItemRecord] = []

  var onBack = EventDispatcher()
  var onOpenFile = EventDispatcher()
  var onAddToQueue = EventDispatcher()
  var onRemoveFromQueue = EventDispatcher()
  var onRemoveDownloads = EventDispatcher()
  var onDownloadFiles = EventDispatcher()
  var onMoveFiles = EventDispatcher()
  var onReorderFiles = EventDispatcher()
  var onOpenFolder = EventDispatcher()
  var onPlayFolder = EventDispatcher()
  var onDownloadFolder = EventDispatcher()
  var onRemoveFolderDownloads = EventDispatcher()
  var onKeepDownloadsChange = EventDispatcher()
  var onRememberTimestampsChange = EventDispatcher()
  var onCreateFolder = EventDispatcher()
  var onRenameFolder = EventDispatcher()
  var onRefresh = EventDispatcher()
  var onToggleOrder = EventDispatcher()
  var onSearchChange = EventDispatcher()
  var onSearchScopeChange = EventDispatcher()
}

private enum PlayrSearchScope: String, CaseIterable, Hashable {
  case folder
  case all

  var title: String {
    switch self {
    case .folder: "Folder"
    case .all: "All"
    }
  }
}

private struct PlayrSearchScopeModifier: ViewModifier {
  @Binding var scope: PlayrSearchScope
  let enabled: Bool

  @ViewBuilder
  func body(content: Content) -> some View {
    if enabled {
      content.searchScopes($scope, activation: .onSearchPresentation) {
        ForEach(PlayrSearchScope.allCases, id: \.self) { scope in
          Text(scope.title).tag(scope)
        }
      }
    } else {
      content
    }
  }
}

private struct PlayrSearchToolbarBehaviorModifier: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 17.1, *) {
      content.searchPresentationToolbarBehavior(.avoidHidingContent)
    } else {
      content
    }
  }
}

private struct PlayrGlassButtonModifier: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.buttonStyle(.glass)
    } else {
      content.buttonStyle(.bordered)
    }
  }
}

private struct PlayrDragSourceModifier: ViewModifier {
  let id: String

  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 27.0, *) {
      content.draggable(containerItemID: id)
    } else {
      content.draggable(PlayrAudioDragItem(id: id))
    }
  }
}

private struct PlayrFolderCard: View {
  let folder: PlayrLibraryFolderItemRecord
  let onOpen: () -> Void
  let onMove: ([String]) -> Void
  @State private var isDropTargeted = false

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      ZStack(alignment: .bottomTrailing) {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .fill(Color(uiColor: .secondarySystemFill))
          .overlay {
            Text(folder.name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1).uppercased())
              .font(.system(size: 52, weight: .bold, design: .rounded))
              .foregroundStyle(.primary)
          }
          .overlay {
            if isDropTargeted {
              RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.primary, lineWidth: 3)
            }
          }
          .aspectRatio(1, contentMode: .fit)

        Image(systemName: "waveform")
          .font(.system(size: 18, weight: .medium))
          .foregroundStyle(Color(uiColor: .systemBlue))
          .frame(width: 32, height: 32)
          .background(.regularMaterial, in: Circle())
          .padding(8)
      }

      Text(folder.name)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.primary)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
    .onTapGesture(perform: onOpen)
    .accessibilityAddTraits(.isButton)
    .accessibilityHint("Open folder")
    .dropDestination(for: PlayrAudioDragItem.self) { items, _ in
      let ids = items.map(\.id)
      guard !ids.isEmpty else { return false }
      onMove(ids)
      return true
    } isTargeted: { targeted in
      withAnimation(.easeInOut(duration: 0.16)) {
        isDropTargeted = targeted
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Open \(folder.name)")
    .accessibilityHint("Drop selected audio here to move it into this folder")
  }
}

private struct PlayrFolderHero: View {
  let name: String
  let itemCount: Int
  let hasAudio: Bool
  let hasCloudFiles: Bool
  let hasDownloadedFiles: Bool
  let onPlay: () -> Void
  let onDownloadAll: () -> Void
  let onRemoveAll: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      ZStack(alignment: .bottomTrailing) {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
          .fill(Color(uiColor: .secondarySystemFill))
          .overlay {
            Text(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1).uppercased())
              .font(.system(size: 72, weight: .bold, design: .rounded))
          }
          .frame(width: 188, height: 188)

        Image(systemName: "waveform")
          .font(.system(size: 22, weight: .medium))
          .foregroundStyle(Color(uiColor: .systemBlue))
          .frame(width: 38, height: 38)
          .background(.regularMaterial, in: Circle())
          .padding(10)
      }

      Text(name)
        .font(.title2.bold())
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .padding(.top, 14)

      Text("\(itemCount) \(itemCount == 1 ? "item" : "items")")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .padding(.top, 4)

      if hasAudio || hasCloudFiles || hasDownloadedFiles {
        HStack(spacing: 10) {
          if hasAudio {
            Button(action: onPlay) {
              Label("Play", systemImage: "play.fill")
                .font(.headline)
            }
            .modifier(PlayrGlassButtonModifier())
            .tint(.primary)
          }

          if hasCloudFiles {
            Button(action: onDownloadAll) {
              Label("Download All", systemImage: "icloud.and.arrow.down")
                .font(.headline)
            }
            .modifier(PlayrGlassButtonModifier())
            .tint(.primary)
          }

          if hasDownloadedFiles {
            Menu {
              Button("Remove Downloads", systemImage: "trash", role: .destructive) {
                onRemoveAll()
              }
            } label: {
              Label("Remove All", systemImage: "trash")
                .font(.headline)
            }
            .modifier(PlayrGlassButtonModifier())
            .tint(.primary)
          }
        }
        .padding(.top, 14)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 8)
  }
}

private struct PlayrEpisodeRow: View {
  let item: PlayrLibraryAudioItemRecord
  let isCurrent: Bool
  let isPlaying: Bool
  let isRemoving: Bool

  var body: some View {
    HStack(spacing: 12) {
      ZStack {
        Circle()
          .fill(Color.primary.opacity(0.10))
          .frame(width: 42, height: 42)

        if isRemoving || item.downloadState == "downloading" {
          ProgressView()
            .tint(.primary)
        } else {
          Image(systemName: actionSymbol)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(.primary)
        }
      }

      VStack(alignment: .leading, spacing: 3) {
        Text(item.name)
          .font(.body.weight(.semibold))
          .foregroundStyle(.primary)
          .lineLimit(1)

        Text(detail)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(2)

      }
    }
    .frame(minHeight: 62)
    .contentShape(Rectangle())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(item.name)
    .accessibilityValue(detail)
  }

  private var actionSymbol: String {
    if item.downloadState == "inCloud" { return "icloud.and.arrow.down" }
    if isCurrent && isPlaying { return "pause.fill" }
    return "play.fill"
  }

  private var detail: String {
    let base: String
    if isRemoving {
      base = "Removing download"
    } else if item.downloadState == "downloading" {
      if let progress = item.downloadProgress {
        base = "Downloading \(Int(progress * 100))%"
      } else {
        base = "Downloading from iCloud"
      }
    } else if let progress = item.progressLabel {
      base = item.downloadState == "inCloud" ? "\(progress) · In iCloud" : progress
    } else if item.completedAt != nil {
      base = "Played"
    } else if item.downloadState == "downloaded" {
      base = formatSize(item.size).isEmpty ? "On this iPhone" : formatSize(item.size)
    } else {
      let size = formatSize(item.size)
      base = size.isEmpty ? "In iCloud" : "In iCloud · \(size)"
    }

    guard let context = item.contextLabel, !context.isEmpty else { return base }
    return "\(context) · \(base)"
  }

  private func formatSize(_ bytes: Int64) -> String {
    guard bytes > 0 else { return "" }
    let megabytes = Double(bytes) / 1_048_576
    if megabytes >= 1_024 {
      return String(format: "%.1f GB", megabytes / 1_024)
    }
    return "\(max(1, Int(megabytes.rounded()))) MB"
  }
}

public struct PlayrLibraryView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject public var props: PlayrLibraryViewProps
  @State private var selection = Set<String>()
  @State private var editMode: EditMode = .inactive
  @State private var searchText = ""
  @State private var searchScope: PlayrSearchScope = .folder

  public init(props: PlayrLibraryViewProps) {
    self.props = props
  }

  public var body: some View {
    NavigationStack {
      dragEnabledList
        .navigationTitle(props.title)
        .navigationBarTitleDisplayMode(props.currentFolderPath.isEmpty ? .large : .inline)
        .searchable(
          text: $searchText,
          placement: .navigationBarDrawer(displayMode: .always),
          prompt: "Search audio titles"
        )
        .modifier(PlayrSearchToolbarBehaviorModifier())
        .modifier(
          PlayrSearchScopeModifier(
            scope: $searchScope,
            enabled: !props.currentFolderPath.isEmpty
          )
        )
        .toolbar { toolbarContent }
        .environment(\.editMode, $editMode)
        .tint(.primary)
    }
    .onAppear {
      searchText = props.searchQuery
      searchScope = props.searchGlobally ? .all : .folder
    }
    .onChange(of: props.searchQuery) { value in
      if searchText != value { searchText = value }
    }
    .onChange(of: props.searchGlobally) { value in
      let nextScope: PlayrSearchScope = value ? .all : .folder
      if searchScope != nextScope { searchScope = nextScope }
    }
    .onChange(of: props.currentFolderPath) { _ in
      finishEditing()
    }
    .onChange(of: searchText) { value in
      if value != props.searchQuery {
        props.onSearchChange(["query": value])
      }
    }
    .onChange(of: searchScope) { scope in
      let global = scope == .all
      if global != props.searchGlobally {
        props.onSearchScopeChange(["global": global])
      }
    }
  }

  @ViewBuilder
  private var dragEnabledList: some View {
    if #available(iOS 27.0, *) {
      libraryList
        .dragContainer(for: PlayrAudioDragItem.self) { ids in
          ids.map { PlayrAudioDragItem(id: $0) }
        }
        .dragContainerSelection(Array(selection))
    } else {
      libraryList
    }
  }

  private var libraryList: some View {
    List(selection: $selection) {
      if isSearching {
        searchSection
      } else {
        folderHeroSection
        continueListeningSection
        folderSection
        audioSection
      }
      bottomClearance
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .background(Color(uiColor: .systemBackground))
  }

  private var bottomClearance: some View {
    Color.clear
      .frame(height: props.currentFileId == nil ? 96 : 220)
      .listRowInsets(EdgeInsets())
      .listRowSeparator(.hidden)
  }

  private var isSearching: Bool {
    !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  @ViewBuilder
  private var folderHeroSection: some View {
    if !props.currentFolderPath.isEmpty {
      PlayrFolderHero(
        name: props.title,
        itemCount: props.directFiles.count + props.folders.count,
        hasAudio: !props.directFiles.isEmpty,
        hasCloudFiles: props.hasCloudFiles,
        hasDownloadedFiles: props.hasDownloadedFiles,
        onPlay: { props.onPlayFolder() },
        onDownloadAll: { props.onDownloadFolder() },
        onRemoveAll: { props.onRemoveFolderDownloads() }
      )
      .listRowSeparator(.hidden)
      .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 16))
    }
  }

  @ViewBuilder
  private var continueListeningSection: some View {
    if !props.continueFiles.isEmpty {
      Section {
        ForEach(props.continueFiles, id: \.id) { item in
          episodeRow(item)
        }
      } header: {
        Text("Continue Listening")
          .font(.title3.bold())
          .foregroundStyle(.primary)
          .textCase(nil)
      }

    }
  }

  @ViewBuilder
  private var folderSection: some View {
    if !props.folders.isEmpty {
      Section {
        LazyVGrid(
          columns: [
            GridItem(.flexible(), spacing: 14),
            GridItem(.flexible(), spacing: 14)
          ],
          spacing: 18
        ) {
          ForEach(props.folders, id: \.id) { folder in
            PlayrFolderCard(
              folder: folder,
              onOpen: {
                finishEditing()
                props.onOpenFolder(["path": folder.relativePath])
              },
              onMove: { ids in
                finishEditing()
                props.onMoveFiles([
                  "ids": ids,
                  "destinationFolderPath": folder.relativePath
                ])
              }
            )
          }
        }
        .padding(.vertical, 2)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 16))
      } header: {
        Text("Folders")
          .font(.title3.bold())
          .foregroundStyle(.primary)
          .textCase(nil)
      }
    }
  }

  @ViewBuilder
  private var audioSection: some View {
    if props.directFiles.isEmpty && props.folders.isEmpty {
      VStack(spacing: 10) {
        Image(systemName: "folder")
          .font(.largeTitle)
          .foregroundStyle(.secondary)
        Text("This folder is empty")
          .font(.headline)
        Text("Drag audio here or add files in iCloud Drive.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .listRowSeparator(.hidden)
    } else if !props.directFiles.isEmpty {
      Section {
        ForEach(props.directFiles, id: \.id) { item in
          episodeRow(item)
        }
        .dropDestination(for: PlayrAudioDragItem.self) { items, index in
          let current = props.directFiles.map(\.id)
          let ids = items.map(\.id).filter { current.contains($0) }
          guard !ids.isEmpty else { return }
          let beforeId = current.indices.contains(index) ? current[index] : nil
          guard beforeId.map({ !ids.contains($0) }) ?? true else { return }
          var remaining = current.filter { !ids.contains($0) }
          let destination = beforeId.flatMap { remaining.firstIndex(of: $0) } ?? remaining.count
          remaining.insert(contentsOf: ids, at: destination)
          props.onReorderFiles(["ids": remaining])
        }
        .onMove(perform: reorderFiles)
      } header: {
        HStack {
          Text("Audio")
            .font(.title3.bold())
            .foregroundStyle(.primary)
          Spacer()
          Button {
            props.onToggleOrder()
          } label: {
            Image(systemName: props.isReversed ? "arrow.up" : "arrow.down")
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Reverse audio order")
        }
        .textCase(nil)
      }
    }
  }

  @ViewBuilder
  private var searchSection: some View {
    if props.searchResults.isEmpty {
      VStack(spacing: 10) {
        Image(systemName: "magnifyingglass")
          .font(.largeTitle)
          .foregroundStyle(.secondary)
        Text("No Results")
          .font(.headline)
        Text("No audio titles match \"\(searchText)\".")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .listRowSeparator(.hidden)
    } else {
      Section {
        ForEach(props.searchResults, id: \.id) { item in
          episodeRow(item)
        }
      } header: {
        Text(props.searchGlobally ? "All Library Results" : "Folder Results")
          .font(.title3.bold())
          .foregroundStyle(.primary)
          .textCase(nil)
      }
    }
  }

  @ViewBuilder
  private func episodeRow(_ item: PlayrLibraryAudioItemRecord) -> some View {
    let isRemoving = props.removingIds.contains(item.id)
    PlayrEpisodeRow(
      item: item,
      isCurrent: props.currentFileId == item.id,
      isPlaying: props.isPlaying,
      isRemoving: isRemoving
    )
    .modifier(PlayrDragSourceModifier(id: item.id))
    .tag(item.id)
    .onTapGesture {
      guard editMode == .inactive, !isRemoving else { return }
      props.onOpenFile(["id": item.id])
    }
    .accessibilityAddTraits(.isButton)
    .accessibilityHint("Play or pause episode")
    .contextMenu {
      queueAction(item)

      if item.downloadState == "downloaded" && !isRemoving {
        Button("Remove Download", systemImage: "trash", role: .destructive) {
          props.onRemoveDownloads(["ids": [item.id]])
        }
      }

      Button("Move", systemImage: "arrow.up.arrow.down") {
        selection = [item.id]
        withAnimation { editMode = .active }
      }

      if let shareURL = shareURL(for: item.relativePath) {
        ShareLink(item: shareURL) {
          Label("Share", systemImage: "square.and.arrow.up")
        }
      }
    }
    .swipeActions(edge: .leading, allowsFullSwipe: true) {
      queueAction(item)
        .tint(props.queuedIds.contains(item.id) ? .orange : .blue)
    }
    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
      if item.downloadState == "downloaded" && !isRemoving {
        Button(role: .destructive) {
          props.onRemoveDownloads(["ids": [item.id]])
        } label: {
          Label("Remove Download", systemImage: "trash")
        }
        .tint(.red)
      }
    }
    .id("\(item.id):\(item.downloadState):\(isRemoving)")
  }

  @ViewBuilder
  private func queueAction(_ item: PlayrLibraryAudioItemRecord) -> some View {
    if props.queuedIds.contains(item.id) {
      Button("Remove from Queue", systemImage: "text.badge.minus") {
        props.onRemoveFromQueue(["id": item.id])
      }
    } else {
      Button("Add to Queue", systemImage: "text.badge.plus") {
        props.onAddToQueue(["id": item.id])
      }
    }
  }

  @ToolbarContentBuilder
  private var toolbarContent: some ToolbarContent {
    if !props.currentFolderPath.isEmpty {
      ToolbarItem(placement: .topBarLeading) {
        Button {
          finishEditing()
          props.onBack()
        } label: {
          Image(systemName: "chevron.left")
        }
        .dropDestination(for: PlayrAudioDragItem.self) { items, _ in
          let ids = items.map(\.id)
          guard !ids.isEmpty else { return false }
          finishEditing()
          props.onMoveFiles([
            "ids": ids,
            "destinationFolderPath": parentFolderPath(props.currentFolderPath)
          ])
          return true
        }
        .accessibilityLabel("Back")
        .accessibilityHint("Drop selected audio here to move it to the parent folder")
      }
    }

    ToolbarItem(placement: .topBarTrailing) {
      if editMode == .active {
        Button("Done") {
          finishEditing()
        }
      } else {
        Menu {
          Button("New Folder", systemImage: "folder.badge.plus") {
            props.onCreateFolder()
          }

          if !props.currentFolderPath.isEmpty {
            Button("Rename Folder", systemImage: "pencil") {
              props.onRenameFolder()
            }

            Toggle(isOn: Binding(
              get: { props.keepDownloads },
              set: { props.onKeepDownloadsChange(["enabled": $0]) }
            )) {
              Label("Keep Downloads", systemImage: "pin")
            }

            Toggle(isOn: Binding(
              get: { props.rememberTimestamps },
              set: { props.onRememberTimestampsChange(["enabled": $0]) }
            )) {
              Label("Remember Timestamp", systemImage: "clock.arrow.circlepath")
            }
          }

          Button("Select Files", systemImage: "checkmark.circle") {
            withAnimation { editMode = .active }
          }

          Button("Refresh", systemImage: "arrow.clockwise") {
            props.onRefresh()
          }
        } label: {
          Image(systemName: "ellipsis")
        }
        .menuOrder(.fixed)
        .accessibilityLabel("Library actions")
      }
    }

    if editMode == .active {
      ToolbarItemGroup(placement: .bottomBar) {
        Button {
          props.onDownloadFiles(["ids": Array(selection)])
          finishEditing()
        } label: {
          Label("Download", systemImage: "icloud.and.arrow.down")
        }
        .disabled(selection.isEmpty)

        Spacer()

        Button(role: .destructive) {
          props.onRemoveDownloads(["ids": Array(selection)])
          finishEditing()
        } label: {
          Label("Remove Download", systemImage: "trash")
        }
        .disabled(selection.isEmpty)
      }
    }
  }

  private func reorderFiles(fromOffsets: IndexSet, toOffset: Int) {
    var ids = props.directFiles.map(\.id)
    ids.move(fromOffsets: fromOffsets, toOffset: toOffset)
    props.onReorderFiles(["ids": ids])
  }

  private func finishEditing() {
    selection.removeAll()
    withAnimation { editMode = .inactive }
  }

  private func shareURL(for relativePath: String) -> URL? {
    guard let uri = props.documentsUri, let documentsURL = URL(string: uri) else { return nil }
    return documentsURL.appendingPathComponent(relativePath)
  }

  private func parentFolderPath(_ path: String) -> String {
    guard let separator = path.lastIndex(of: "/") else { return "" }
    return String(path[..<separator])
  }
}

public struct PlayrPlayerStateRecord: Record {
  @Field var title: String = ""
  @Field var currentTime: Double = 0
  @Field var duration: Double = 0
  @Field var artworkSize: Double = 300
  @Field var shuffleEnabled: Bool = false
  @Field var pendingName: String?
  public init() {}
}

public final class PlayrQueueViewProps: ExpoSwiftUI.ViewProps {
  @Field var currentFileId: String?
  @Field var isPlaying: Bool = false
  @Field var embedded: Bool = false
  @Field var player: PlayrPlayerStateRecord?
  var onSeek = EventDispatcher()
  var onSkip = EventDispatcher()
  var onTogglePlaying = EventDispatcher()
  var onNext = EventDispatcher()
  var onPrevious = EventDispatcher()
  var onCycleRepeat = EventDispatcher()
  var onToggleShuffle = EventDispatcher()
  var onCancelPending = EventDispatcher()
  @Field var repeatMode: String = "off"
  @Field var files: [PlayrLibraryAudioItemRecord] = []
  @Field var continuationFiles: [PlayrLibraryAudioItemRecord] = []

  var onOpenFile = EventDispatcher()
  var onOpenContinuation = EventDispatcher()
  var onAddToQueue = EventDispatcher()
  var onRemoveFromQueue = EventDispatcher()
  @Field var continuationAnchorId: String?
  var onQueueDrop = EventDispatcher()
  var onContinuationDrop = EventDispatcher()
  var onClear = EventDispatcher()
}

public struct PlayrQueueView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject public var props: PlayrQueueViewProps

  public init(props: PlayrQueueViewProps) { self.props = props }

  public var body: some View {
    Group {
      if props.embedded {
        queueList
      } else {
        NavigationStack {
          queueList
            .safeAreaInset(edge: .bottom) {
              if props.currentFileId != nil { Color.clear.frame(height: 90) }
            }
            .navigationTitle("Queue")
            .navigationBarTitleDisplayMode(.large)
        }
      }
    }
    .tint(.primary)
  }

  private enum QueueRow: Identifiable {
    case queueHeader, emptyQueue, libraryHeader, libraryFooter, repeatNotice
    case episode(PlayrLibraryAudioItemRecord, queued: Bool)

    var id: String {
      switch self {
      case .queueHeader: return "queue-header"
      case .emptyQueue: return "empty-queue"
      case .libraryHeader: return "library-header"
      case .libraryFooter: return "library-footer"
      case .repeatNotice: return "repeat-notice"
      case .episode(let item, let queued): return "\(queued ? "queue" : "library"):\(item.id)"
      }
    }
  }

  // One movable collection lets native List dragging cross the section headings.
  // moveDisabled on a heading would block crossing it; ignore heading moves instead.
  private var queueList: some View {
    let rows: [QueueRow] = [.queueHeader]
      + (props.repeatMode == "one" ? [.repeatNotice] : [])
      + (props.files.isEmpty ? [.emptyQueue] : props.files.map { .episode($0, queued: true) })
      + (props.continuationFiles.isEmpty && props.continuationAnchorId == nil ? [] : [.libraryHeader]
          + props.continuationFiles.map { .episode($0, queued: false) } + [.libraryFooter])
    return List {
      if props.embedded, let player = props.player {
        PlayrPlayerControls(props: props, player: player)
          .listRowInsets(EdgeInsets())
          .listRowSeparator(.hidden)
      }
      ForEach(rows) { row in
        switch row {
        case .queueHeader:
          HStack {
            Text("Next in Queue").font(.headline)
            Spacer()
            if !props.files.isEmpty {
              Menu {
                Button("Clear Queue", systemImage: "text.badge.minus") { props.onClear() }
              } label: { Image(systemName: "ellipsis").frame(width: 32, height: 32) }
                .accessibilityLabel("Queue actions")
            }
          }
          .padding(.top, 12)
          .accessibilityAddTraits(.isHeader)
          .listRowSeparator(.hidden)
        case .emptyQueue:
          Text("Drag episodes here, or swipe right on an episode to add it.")
            .font(.subheadline).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .listRowSeparator(.hidden)
        case .libraryHeader:
          Text("Next from Library").font(.headline)
            .padding(.top, 20)
            .accessibilityAddTraits(.isHeader)
            .listRowSeparator(.hidden)
        case .libraryFooter:
          Text(props.continuationFiles.isEmpty ? "Drag episodes here to continue from the library." : props.repeatMode == "all"
            ? "The library order repeats after these episodes."
            : "Continues in library playback order after your queue.")
            .font(.footnote).foregroundStyle(.secondary)
            .listRowSeparator(.hidden)
        case .repeatNotice:
          Text("Repeat One is on. Up next plays when you skip or turn repeat off.")
            .font(.subheadline).foregroundStyle(.secondary)
            .listRowSeparator(.hidden)
        case .episode(let item, let queued):
          queueRow(item, queued: queued)
        }
      }
      .onMove { offsets, destination in
        let items = offsets.compactMap { index -> PlayrAudioDragItem? in
          guard case .episode(let item, let queued) = rows[index] else { return nil }
          return PlayrAudioDragItem(id: item.id, origin: queued ? .queue : .continuation)
        }
        let target = rows.indices.contains(destination) ? rows[destination] : .libraryFooter
        switch target {
        case .episode(let item, let queued):
          _ = sendDrop(items, beforeId: item.id, queued: queued)
        case .queueHeader, .repeatNotice, .emptyQueue:
          _ = sendDrop(items, beforeId: props.files.first?.id, queued: true)
        case .libraryHeader:
          _ = sendDrop(items, beforeId: nil, queued: true)
        case .libraryFooter:
          _ = sendDrop(items, beforeId: nil, queued: props.continuationFiles.isEmpty && props.continuationAnchorId == nil)
        }
      }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .background(Color(uiColor: .systemBackground))
  }

  private func queueRow(_ item: PlayrLibraryAudioItemRecord, queued: Bool) -> some View {
    PlayrEpisodeRow(item: item, isCurrent: false, isPlaying: false, isRemoving: false)
      .contentShape(Rectangle())
      .onTapGesture {
        if queued { props.onOpenFile(["id": item.id]) }
        else { props.onOpenContinuation(["id": item.id]) }
      }
      .accessibilityAddTraits(.isButton)
      .accessibilityHint("Play this episode. Touch and hold to drag.")
      .accessibilityAction(named: "Move up") { moveAccessible(item.id, queued: queued, up: true) }
      .accessibilityAction(named: "Move down") { moveAccessible(item.id, queued: queued, up: false) }
      .swipeActions(edge: .leading, allowsFullSwipe: true) {
        queueAction(item, queued: queued).tint(queued ? .orange : .blue)
      }
  }

  private func sendDrop(_ items: [PlayrAudioDragItem], beforeId: String?, queued: Bool) -> Bool {
    let accepted = queued ? items : items.filter {
      $0.origin == .queue || ($0.origin == .continuation && $0.id != props.continuationAnchorId)
    }
    guard !accepted.isEmpty else { return false }
    // A drag from a section has one origin. Split mixed multi-item drops so
    // consumed queue entries cannot be restored as newly added library entries.
    for fromQueue in [true, false] {
      let ids = accepted.filter { ($0.origin == .queue) == fromQueue }.map(\.id)
      guard !ids.isEmpty else { continue }
      let event: [String: Any] = ["ids": ids, "beforeId": beforeId.map { $0 as Any } ?? NSNull(), "fromQueue": fromQueue]
      if queued { props.onQueueDrop(event) } else { props.onContinuationDrop(event) }
    }
    return true
  }

  private func moveAccessible(_ id: String, queued: Bool, up: Bool) {
    let items = queued ? props.files : props.continuationFiles
    guard let index = items.firstIndex(where: { $0.id == id }),
          up ? index > 0 : index < items.count - 1 else { return }
    let target = up ? index - 1 : index + 2
    let beforeId = items.indices.contains(target) ? items[target].id : nil
    _ = sendDrop([PlayrAudioDragItem(id: id, origin: queued ? .queue : .continuation)], beforeId: beforeId, queued: queued)
  }

  @ViewBuilder
  private func queueAction(_ item: PlayrLibraryAudioItemRecord, queued: Bool) -> some View {
    if queued || props.files.contains(where: { $0.id == item.id }) {
      Button("Remove from Queue", systemImage: "text.badge.minus") {
        props.onRemoveFromQueue(["id": item.id])
      }
    } else {
      Button("Add to Queue", systemImage: "text.badge.plus") {
        props.onAddToQueue(["id": item.id])
      }
    }
  }
}

private struct PlayrPlayerControls: View {
  @ObservedObject var props: PlayrQueueViewProps
  let player: PlayrPlayerStateRecord
  @State private var isSeeking = false
  @State private var draftTime: Double = 0
  @State private var artworkOffset: CGFloat = 0

  var body: some View {
    VStack(spacing: 0) {
      RoundedRectangle(cornerRadius: 26)
        .fill(Color(uiColor: .secondarySystemFill))
        .frame(width: player.artworkSize, height: player.artworkSize)
        .overlay { Image(systemName: "waveform").font(.system(size: 92)).foregroundStyle(.blue) }
        .offset(x: artworkOffset)
        .accessibilityLabel("Episode artwork")
        .accessibilityAction(named: "Next episode") { props.onNext() }
        .accessibilityAction(named: "Previous episode") { props.onPrevious() }
        .overlay {
          PlayrArtworkGesture(offset: $artworkOffset) { next in
            if next { props.onNext() } else { props.onPrevious() }
          }
        }
      Text(player.title)
        .font(.system(size: 22, weight: .bold)).lineLimit(2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 24).padding(.horizontal, 4)
      if let name = player.pendingName {
        HStack(spacing: 8) {
          ProgressView()
          Text("Preparing \(name)").lineLimit(1).foregroundStyle(.secondary)
          Spacer()
          Button("Cancel") { props.onCancelPending() }.buttonStyle(.borderless)
        }.padding(.top, 12)
      }
      VStack(spacing: 0) {
        Slider(value: Binding(
          get: { min(isSeeking ? draftTime : player.currentTime, max(player.duration, 1)) },
          set: { draftTime = $0 }
        ), in: 0...max(player.duration, 1), onEditingChanged: { editing in
          if editing { draftTime = player.currentTime }
          isSeeking = editing
          if !editing { props.onSeek(["seconds": draftTime]) }
        })
        .tint(.primary).controlSize(.large).frame(height: 44)
        .accessibilityLabel("Playback position")
        HStack {
          Text(durationText(isSeeking ? draftTime : player.currentTime))
          Spacer()
          Text("−" + durationText(max(0, player.duration - (isSeeking ? draftTime : player.currentTime))))
        }.font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
      }.padding(.top, 20)
      HStack(spacing: 32) {
        control("Back 15 seconds", symbol: "gobackward.15", size: 52) { props.onSkip(["seconds": -15]) }
        control(props.isPlaying ? "Pause" : "Play", symbol: props.isPlaying ? "pause.fill" : "play.fill", size: 64) {
          props.onTogglePlaying()
        }
        control("Forward 30 seconds", symbol: "goforward.30", size: 52) { props.onSkip(["seconds": 30]) }
      }.padding(.top, 24)
      HStack(spacing: 28) {
        VStack(spacing: 5) {
          control(player.shuffleEnabled ? "Turn shuffle off" : "Turn shuffle on", symbol: "shuffle") { props.onToggleShuffle() }
          Circle().fill(player.shuffleEnabled ? Color.primary : .clear).frame(width: 3, height: 3)
        }
        VStack(spacing: 5) {
          control(props.repeatMode == "one" ? "Repeat one" : props.repeatMode == "all" ? "Repeat all" : "Repeat off",
                  symbol: props.repeatMode == "one" ? "repeat.1" : "repeat") { props.onCycleRepeat() }
          Circle().fill(props.repeatMode == "off" ? .clear : Color.primary).frame(width: 3, height: 3)
        }
      }.padding(.top, 20)
    }
    .padding(.horizontal, 24).padding(.top, 28).padding(.bottom, 32)
  }

  private func durationText(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.isFinite ? seconds : 0))
    return total >= 3600
      ? String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60)
      : String(format: "%d:%02d", total / 60, total % 60)
  }

  private func control(_ label: String, symbol: String, size: CGFloat = 44, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: size >= 50 ? 24 : 19))
        .frame(width: size, height: size)
        .modifier(PlayrPlayerControlBackground())
    }
    .buttonStyle(.borderless)
    .accessibilityLabel(label)
  }
}

private struct PlayrPlayerControlBackground: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.glassEffect(.regular.interactive(), in: .circle)
    } else {
      content.background(Color(uiColor: .secondarySystemBackground), in: Circle())
    }
  }
}

// Reject vertical movement before recognition so the enclosing List can scroll.
// SwiftUI DragGesture in a List claims those touches even with simultaneousGesture.
private struct PlayrArtworkGesture: UIViewRepresentable {
  @Binding var offset: CGFloat
  let onNavigate: (Bool) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:)))
    pan.delegate = context.coordinator
    view.addGestureRecognizer(pan)
    return view
  }

  func updateUIView(_ view: UIView, context: Context) { context.coordinator.parent = self }

  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    var parent: PlayrArtworkGesture
    init(_ parent: PlayrArtworkGesture) { self.parent = parent }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
      guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
      let velocity = pan.velocity(in: pan.view)
      return abs(velocity.x) > abs(velocity.y) * 1.5
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
      true
    }

    @objc func pan(_ gesture: UIPanGestureRecognizer) {
      let translation = gesture.translation(in: gesture.view)
      switch gesture.state {
      case .changed:
        parent.offset = translation.x
      case .ended:
        if abs(translation.x) >= 18 && abs(translation.x) > abs(translation.y) * 1.5 {
          parent.onNavigate(translation.x < 0)
        }
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { parent.offset = 0 }
      case .cancelled, .failed:
        parent.offset = 0
      default: break
      }
    }
  }
}
