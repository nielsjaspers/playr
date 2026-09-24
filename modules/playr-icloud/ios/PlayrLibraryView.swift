import CoreTransferable
import ExpoModulesCore
import SwiftUI
import UniformTypeIdentifiers

private let playrAudioDragType = UTType(exportedAs: "com.nielsjaspers.playr.audio-item")

private struct PlayrAudioDragItem: Codable, Hashable, Identifiable, Sendable, Transferable {
  let id: String

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
  @Field var progressPosition: Double?
  @Field var progressDuration: Double?
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
          .lineLimit(1)

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
      Button("Add to Queue", systemImage: "text.badge.plus") {
        props.onAddToQueue(["id": item.id])
      }
      .disabled(props.queuedIds.contains(item.id))

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
      Button {
        props.onAddToQueue(["id": item.id])
      } label: {
        Label("Add to Queue", systemImage: "text.badge.plus")
      }
      .tint(Color(uiColor: .systemGray))
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

public final class PlayrQueueViewProps: ExpoSwiftUI.ViewProps {
  @Field var currentFileId: String?
  @Field var isPlaying: Bool = false
  @Field var files: [PlayrLibraryAudioItemRecord] = []
  @Field var continuationFiles: [PlayrLibraryAudioItemRecord] = []

  var onOpenFile = EventDispatcher()
  var onOpenContinuation = EventDispatcher()
  var onRemoveFromQueue = EventDispatcher()
  var onReorder = EventDispatcher()
  var onReorderContinuation = EventDispatcher()
  var onClear = EventDispatcher()
}

public struct PlayrQueueView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject public var props: PlayrQueueViewProps
  @State private var editMode: EditMode = .inactive

  public init(props: PlayrQueueViewProps) { self.props = props }

  public var body: some View {
    NavigationStack {
      queueList
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color(uiColor: .systemBackground))
        .safeAreaInset(edge: .bottom) {
          if props.currentFileId != nil { Color.clear.frame(height: 90) }
        }
        .navigationTitle("Queue")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Menu {
              if !props.files.isEmpty {
                Button("Clear Queue", systemImage: "trash", role: .destructive) { props.onClear() }
              }
              EditButton()
            } label: { Image(systemName: "ellipsis") }
            .accessibilityLabel("Queue actions")
          }
        }
        .environment(\.editMode, $editMode)
        .tint(.primary)
    }
  }

  private var queueList: some View {
    List {
      if props.files.isEmpty && props.continuationFiles.isEmpty {
        VStack(spacing: 10) {
          Text("Nothing up next").font(.headline)
          Text("Play from your library or add episodes to the queue.").foregroundStyle(.secondary)
        }.padding(.vertical, 36).frame(maxWidth: .infinity)
      }
      if !props.files.isEmpty {
        Section("Next in Queue") { rows(props.files, queued: true) }
      }
      if !props.continuationFiles.isEmpty {
        Section("Next from Library") { rows(props.continuationFiles, queued: false) }
      }
    }
  }

  private func rows(_ items: [PlayrLibraryAudioItemRecord], queued: Bool) -> some View {
    ForEach(items, id: \.id) { item in queueRow(item, queued: queued) }
      .onMove { offsets, destination in
        var ids = items.map(\.id)
        ids.move(fromOffsets: offsets, toOffset: destination)
        sendOrder(ids, queued: queued)
      }
  }

  private func sendOrder(_ ids: [String], queued: Bool) {
    if queued { props.onReorder(["ids": ids]) }
    else { props.onReorderContinuation(["ids": ids]) }
  }

  private func queueRow(_ item: PlayrLibraryAudioItemRecord, queued: Bool) -> some View {
    PlayrEpisodeRow(item: item, isCurrent: false, isPlaying: false, isRemoving: false)
      .contentShape(Rectangle())
      .onTapGesture {
        guard editMode == .inactive else { return }
        if queued { props.onOpenFile(["id": item.id]) }
        else { props.onOpenContinuation(["id": item.id]) }
      }
      .accessibilityAddTraits(.isButton)
      .accessibilityHint("Play this episode")
      .contextMenu {
        if queued {
          Button("Remove from Queue", systemImage: "trash", role: .destructive) {
            props.onRemoveFromQueue(["id": item.id])
          }
        }
      }
      .swipeActions(edge: .trailing, allowsFullSwipe: true) {
        if queued {
          Button(role: .destructive) { props.onRemoveFromQueue(["id": item.id]) }
            label: { Label("Remove from Queue", systemImage: "trash") }
        }
      }
  }
}
