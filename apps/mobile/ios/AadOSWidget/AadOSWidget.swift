// AadOS mail widgets (WidgetKit): Small (4 icons), Medium (8), Large (16). Full screen = Large + Medium.
// Data: the app writes JSON from /api/mobile/widget (+ shared count + layout from Settings → Widgets) to the app group
// "group.com.aadnanda.aados", key "mail" (AppDelegate, channel com.aadnanda.aados/widget). Read-only here.
import SwiftUI
import WidgetKit

// MARK: - Data

struct MailDay: Decodable { let day: String; let received: Int; let unread: Int }
struct MailAccountCount: Decodable { let email: String; let unread: Int }
struct MailLatest: Decodable { let key: String; let sender: String; let subject: String; let at: String }
struct MailTabs: Decodable { let leads: Int; let scans: Int; let rent: Int }
struct MailRules: Decodable { let actions: Int; let read: Int; let trashed: Int }
struct MailLayout: Decodable { let order: [String]; let enabled: [String]; let latest: Int }
struct MailData: Decodable {
  let at: String
  let unread: Int
  let shared: Int?
  let receivedToday: Int
  let week: [MailDay]
  let accounts: [MailAccountCount]
  let tabs: MailTabs
  let rulesToday: MailRules
  let latest: [MailLatest]
  let config: MailLayout?

  /// Enabled sections in the owner's order (defaults when the app has not saved a layout yet).
  var sections: [String] {
    guard let c = config else { return ["counts", "latest", "week", "tabs"] }
    return c.order.filter { c.enabled.contains($0) }
  }
  var latestLimit: Int { config?.latest ?? 5 }

  /// Same group as the app (AltStore renames app groups when it re-signs). Candidates: ALTAppGroups in this widget's
  /// or the containing app's Info.plist, "group." + the app's bundle ID, the original name; first one iOS grants wins.
  static func appGroup() -> String {
    let base = "group.com.aadnanda.aados"
    // Widget bundle lives at AadOS.app/PlugIns/AadOSWidget.appex → containing app is two levels up.
    let app = Bundle(url: Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent())
    var candidates = (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] ?? []) + (app?.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] ?? [])
    if let id = app?.bundleIdentifier { candidates.append("group.\(id)") }
    if let own = Bundle.main.bundleIdentifier, own.hasSuffix(".AadOSWidget") { candidates.append("group.\(own.dropLast(".AadOSWidget".count))") }
    candidates.append(base)
    return candidates.first(where: { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) != nil }) ?? base
  }

  static func load() -> MailData? {
    guard let raw = UserDefaults(suiteName: appGroup())?.string(forKey: "mail"), let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(MailData.self, from: data)
  }
}

struct MailEntry: TimelineEntry { let date: Date; let data: MailData? }

struct MailProvider: TimelineProvider {
  func placeholder(in context: Context) -> MailEntry { MailEntry(date: Date(), data: nil) }
  func getSnapshot(in context: Context, completion: @escaping (MailEntry) -> Void) { completion(MailEntry(date: Date(), data: MailData.load())) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<MailEntry>) -> Void) {
    // The app reloads the widget whenever it syncs; otherwise ask iOS to check again in 15 minutes.
    completion(Timeline(entries: [MailEntry(date: Date(), data: MailData.load())], policy: .after(Date().addingTimeInterval(15 * 60))))
  }
}

// MARK: - Pieces

private let mailRed = Color(red: 0.84, green: 0.22, blue: 0.27)
private let sharedBlue = Color(red: 0.19, green: 0.45, blue: 0.93)

struct CountsView: View {
  let d: MailData; var big = false
  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 14) {
      VStack(alignment: .leading, spacing: 0) {
        Text("\(d.unread)").font(.system(size: big ? 34 : 26, weight: .bold, design: .rounded)).foregroundStyle(mailRed)
        Text("unread mail").font(.caption2).foregroundStyle(.secondary)
      }
      if let s = d.shared, s > 0 {
        VStack(alignment: .leading, spacing: 0) {
          Text("\(s)").font(.system(size: big ? 34 : 26, weight: .bold, design: .rounded)).foregroundStyle(sharedBlue)
          Text("shared").font(.caption2).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      VStack(alignment: .trailing, spacing: 0) {
        Text("+\(d.receivedToday)").font(.headline)
        Text("today").font(.caption2).foregroundStyle(.secondary)
      }
    }
  }
}

struct WeekView: View {
  let d: MailData
  var body: some View {
    let maxV = max(1, d.week.map(\.received).max() ?? 1)
    VStack(alignment: .leading, spacing: 3) {
      Text("Received, last 7 days").font(.caption2).foregroundStyle(.secondary)
      HStack(alignment: .bottom, spacing: 4) {
        ForEach(Array(d.week.enumerated()), id: \.offset) { _, day in
          VStack(spacing: 2) {
            GeometryReader { g in
              // Grey = received that day; red = the part still unread.
              ZStack(alignment: .bottom) {
                Rectangle().fill(Color.secondary.opacity(0.35)).frame(height: g.size.height * CGFloat(day.received) / CGFloat(maxV))
                Rectangle().fill(mailRed.opacity(0.85)).frame(height: g.size.height * CGFloat(day.unread) / CGFloat(maxV))
              }
              .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
            Text(String(day.day.suffix(2))).font(.system(size: 9)).foregroundStyle(.secondary)
          }
        }
      }
    }
  }
}

struct LatestView: View {
  let d: MailData; let limit: Int
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(Array(d.latest.prefix(limit).enumerated()), id: \.offset) { _, m in
        Link(destination: URL(string: "aados://email/\(m.key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")")!) {
          HStack(spacing: 6) {
            Text(m.sender).font(.caption.weight(.semibold)).lineLimit(1).frame(maxWidth: 110, alignment: .leading)
            Text(m.subject).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
      if d.latest.isEmpty { Text("No unread mail").font(.caption).foregroundStyle(.secondary) }
    }
  }
}

struct AccountsView: View {
  let d: MailData; let limit: Int
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      ForEach(Array(d.accounts.filter { $0.unread > 0 }.prefix(limit).enumerated()), id: \.offset) { _, a in
        HStack { Text(a.email).font(.caption).lineLimit(1); Spacer(); Text("\(a.unread)").font(.caption.weight(.bold)) }
      }
    }
  }
}

struct TabsView: View {
  let d: MailData
  var body: some View {
    HStack(spacing: 12) {
      Label("\(d.tabs.leads)", systemImage: "house").font(.caption)
      Label("\(d.tabs.scans)", systemImage: "printer").font(.caption)
      Label("\(d.tabs.rent)", systemImage: "dollarsign.circle").font(.caption)
      Spacer(minLength: 0)
    }
  }
}

struct RulesView: View {
  let d: MailData
  var body: some View {
    Text("Rules today: \(d.rulesToday.actions) · \(d.rulesToday.read) read · \(d.rulesToday.trashed) to Trash").font(.caption).foregroundStyle(.secondary).lineLimit(1)
  }
}

// MARK: - Sizes

struct MailWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: MailEntry

  @ViewBuilder func section(_ id: String, _ d: MailData, latest: Int) -> some View {
    switch id {
    case "counts": CountsView(d: d, big: family == .systemLarge)
    case "latest": LatestView(d: d, limit: latest)
    case "week": WeekView(d: d).frame(height: family == .systemLarge ? 70 : 46)
    case "accounts": AccountsView(d: d, limit: family == .systemLarge ? 5 : 2)
    case "tabs": TabsView(d: d)
    case "rules": RulesView(d: d)
    default: EmptyView()
    }
  }

  var body: some View {
    Group {
      if let d = entry.data {
        switch family {
        case .systemSmall:
          // 4 icons: the counts, plus the 7-day chart if it is on.
          VStack(alignment: .leading, spacing: 6) {
            Text("AadOS Mail").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 0) {
              Text("\(d.unread)").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(mailRed)
              if let s = d.shared, s > 0 { Text("\(s) shared").font(.caption.weight(.semibold)).foregroundStyle(sharedBlue) }
            }
            if d.sections.contains("week") { WeekView(d: d).frame(height: 34) } else { Spacer(minLength: 0) }
          }
        case .systemMedium:
          // 8 icons: first two enabled sections.
          VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(d.sections.prefix(2).enumerated()), id: \.offset) { _, id in section(id, d, latest: 3) }
            Spacer(minLength: 0)
          }
        default:
          // 16 icons: every enabled section in order, as many as fit.
          VStack(alignment: .leading, spacing: 8) {
            HStack { Text("AadOS Mail").font(.caption.weight(.semibold)); Spacer(); Text(entry.date, style: .time).font(.caption2).foregroundStyle(.secondary) }
            ForEach(Array(d.sections.prefix(4).enumerated()), id: \.offset) { _, id in
              section(id, d, latest: d.latestLimit)
              Divider()
            }
            Spacer(minLength: 0)
          }
        }
      } else {
        VStack(spacing: 4) {
          Text("AadOS Mail").font(.caption.weight(.semibold))
          Text("Open AadOS once to load your mail.").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
          Text(MailData.appGroup()).font(.system(size: 8)).foregroundStyle(.tertiary)
        }
      }
    }
    .widgetURL(URL(string: "aados://mail"))
    .modifier(WidgetBackground())
  }
}

/// iOS 17+ requires a container background for widgets.
struct WidgetBackground: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) { content.containerBackground(for: .widget) { Color(.systemBackground) } }
    else { content.padding().background(Color(.systemBackground)) }
  }
}

struct AadOSWidget: Widget {
  let kind = "AadOSMail"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: MailProvider()) { entry in MailWidgetView(entry: entry) }
      .configurationDisplayName("AadOS Mail")
      .description("Unread mail, shared mailboxes and more. Customize in AadOS → More → Widgets.")
      .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct AadOSWidgetBundle: WidgetBundle {
  var body: some Widget { AadOSWidget() }
}
