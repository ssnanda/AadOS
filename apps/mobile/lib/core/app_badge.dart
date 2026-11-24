import 'dart:io';

import 'package:app_badge_plus/app_badge_plus.dart';
import 'package:flutter/services.dart';

/// Unread-mail count on the home-screen icon. Updated whenever the inbox counts change (on open, the 2-minute live
/// sync and after read/delete). Without push notifications it cannot change while the app is closed.
/// iOS: native channel in AppDelegate (asks once for badge-only permission). Android: app_badge_plus, which supports
/// launchers with numeric badges (Samsung, Xiaomi, Huawei, …); stock Pixel launchers show dots only for notifications.
class AppBadge {
  static const _ios = MethodChannel('com.aadnanda.aados/badge');
  static int? _last;

  static Future<void> set(int count) async {
    if (count == _last) return;
    _last = count;
    try {
      if (Platform.isIOS) {
        await _ios.invokeMethod('set', count);
      } else if (Platform.isAndroid && await AppBadgePlus.isSupported()) {
        await AppBadgePlus.updateBadge(count);
      }
    } catch (_) {
      _last = null; // retry next time; a missing badge never breaks the app
    }
  }

  /// Signed out: no stale count on the icon.
  static Future<void> clear() => set(0);
}
