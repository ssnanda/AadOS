import EventKit
import Flutter
import UIKit
import UserNotifications
import WidgetKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "AadOSAppleCalendar") else { return }
    let channel = FlutterMethodChannel(name: "com.aadnanda.aados/apple_calendar", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "createEvent", let values = call.arguments as? [String: Any] else {
        result(FlutterMethodNotImplemented)
        return
      }
      self?.createCalendarEvent(values, result: result)
    }

    // Home-screen widgets: the app hands over the mail metrics JSON; the AadOSWidget extension reads it from the app
    // group and draws Small / Medium / Large. Without the App Group entitlement this still succeeds but nothing is shared.
    if let widgetRegistrar = engineBridge.pluginRegistry.registrar(forPlugin: "AadOSWidget") {
      let widget = FlutterMethodChannel(name: "com.aadnanda.aados/widget", binaryMessenger: widgetRegistrar.messenger())
      widget.setMethodCallHandler { call, result in
        guard call.method == "save", let payload = call.arguments as? String else {
          result(FlutterMethodNotImplemented)
          return
        }
        let group = AppDelegate.appGroup()
        guard let store = UserDefaults(suiteName: group) else { result("No app group (\(group))"); return }
        store.set(payload, forKey: "mail")
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        result("Widget updated (\(group)) · profile groups: \(provisionedAppGroups().joined(separator: ", ").isEmpty ? "none" : provisionedAppGroups().joined(separator: ", "))")
      }
    }

    // Unread-mail count on the home-screen icon. iOS shows a badge only after the user allows badges (no alerts or
    // sounds are requested; there are no push notifications).
    guard let badgeRegistrar = engineBridge.pluginRegistry.registrar(forPlugin: "AadOSBadge") else { return }
    let badge = FlutterMethodChannel(name: "com.aadnanda.aados/badge", binaryMessenger: badgeRegistrar.messenger())
    badge.setMethodCallHandler { call, result in
      guard call.method == "set", let count = (call.arguments as? NSNumber)?.intValue else {
        result(FlutterMethodNotImplemented)
        return
      }
      UNUserNotificationCenter.current().requestAuthorization(options: [.badge]) { granted, _ in
        DispatchQueue.main.async {
          guard granted else { result(false); return }
          if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(max(0, count)) { _ in result(true) }
          } else {
            UIApplication.shared.applicationIconBadgeNumber = max(0, count)
            result(true)
          }
        }
      }
    }
  }

  /// The app group shared with the widget: the group in this app's provisioning profile (sideloaders rename it),
  /// else AltStore's ALTAppGroups, "group." + bundle ID, the original name; first one iOS grants wins.
  static func appGroup() -> String {
    let base = "group.com.aadnanda.aados"
    var candidates = provisionedAppGroups()
    candidates += Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] ?? []
    if let id = Bundle.main.bundleIdentifier { candidates.append("group.\(id)") }
    candidates.append(base)
    return candidates.first(where: { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) != nil }) ?? base
  }

  private func createCalendarEvent(_ values: [String: Any], result: @escaping FlutterResult) {
    let store = EKEventStore()
    let save: () -> Void = {
      guard let calendar = store.defaultCalendarForNewEvents else {
        result(FlutterError(code: "no_calendar", message: "Apple Calendar has no writable default calendar.", details: nil))
        return
      }
      guard
        let title = values["title"] as? String,
        let startMs = values["start"] as? NSNumber,
        let endMs = values["end"] as? NSNumber
      else {
        result(FlutterError(code: "invalid_event", message: "The event title or dates are missing.", details: nil))
        return
      }
      let event = EKEvent(eventStore: store)
      event.calendar = calendar
      event.title = title
      event.startDate = Date(timeIntervalSince1970: startMs.doubleValue / 1000)
      event.endDate = Date(timeIntervalSince1970: endMs.doubleValue / 1000)
      event.isAllDay = values["allDay"] as? Bool ?? false
      event.location = values["location"] as? String
      event.notes = values["notes"] as? String
      do {
        try store.save(event, span: .thisEvent, commit: true)
        result(true)
      } catch {
        result(FlutterError(code: "save_failed", message: error.localizedDescription, details: nil))
      }
    }

    let denied: (Bool, Error?) -> Void = { granted, error in
      DispatchQueue.main.async {
        if granted { save() }
        else { result(FlutterError(code: "calendar_denied", message: error?.localizedDescription ?? "Apple Calendar access was not granted.", details: nil)) }
      }
    }
    if #available(iOS 17.0, *) {
      store.requestFullAccessToEvents(completion: denied)
    } else {
      store.requestAccess(to: .event, completion: denied)
    }
  }
}

/// App groups this binary was actually signed with, read from its embedded provisioning profile (the sideloader
/// writes the real, renamed group names there). Empty when there is no profile or no groups.
func provisionedAppGroups(_ bundle: Bundle = .main) -> [String] {
  guard let url = bundle.url(forResource: "embedded", withExtension: "mobileprovision"),
        let data = try? Data(contentsOf: url),
        let start = data.range(of: Data("<?xml".utf8)),
        let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex) else { return [] }
  let plistData = data.subdata(in: start.lowerBound..<end.upperBound)
  guard let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
        let ent = plist["Entitlements"] as? [String: Any] else { return [] }
  return ent["com.apple.security.application-groups"] as? [String] ?? []
}
