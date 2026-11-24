import EventKit
import Flutter
import UIKit
import UserNotifications

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
