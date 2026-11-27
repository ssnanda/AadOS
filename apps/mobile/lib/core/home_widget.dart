import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

/// Home-screen widgets (iOS WidgetKit extension "AadOSWidget"), mail only.
/// The app fetches /api/mobile/widget, adds the shared-mailbox count and the owner's layout (Settings → Widgets),
/// and hands it to iOS through the app group; the widget draws Small / Medium / Large from that.
class WidgetSection {
  const WidgetSection(this.id, this.label, this.hint);
  final String id, label, hint;
}

const widgetSections = [
  WidgetSection('counts', 'Unread counts', 'Mail (all accounts and folders) and shared mailboxes'),
  WidgetSection('latest', 'Latest unread emails', 'Sender and subject; tap opens the email'),
  WidgetSection('week', '7-day chart', 'Emails received per day, unread part shaded'),
  WidgetSection('accounts', 'Unread per account', 'Busiest accounts first'),
  WidgetSection('tabs', 'Leads · Scans · Rent', 'Inbox tab counts'),
  WidgetSection('rules', 'Rules today', 'Marked read / moved to Trash by your rules'),
];

class WidgetConfig {
  WidgetConfig({required this.order, required this.enabled, required this.latest});
  List<String> order; // section ids, top to bottom
  Set<String> enabled;
  int latest; // how many latest emails (Large shows up to this; smaller sizes fewer)

  static const _key = 'widget.config.v1';
  static WidgetConfig defaults() => WidgetConfig(order: widgetSections.map((s) => s.id).toList(), enabled: {'counts', 'latest', 'week', 'tabs'}, latest: 5);

  static Future<WidgetConfig> load() async {
    final raw = (await SharedPreferences.getInstance()).getString(_key);
    if (raw == null) return defaults();
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      final known = widgetSections.map((s) => s.id).toSet();
      final order = [for (final id in (j['order'] as List? ?? const [])) if (known.contains('$id')) '$id'];
      for (final id in known) {
        if (!order.contains(id)) order.add(id);
      }
      return WidgetConfig(order: order, enabled: {for (final id in (j['enabled'] as List? ?? const [])) '$id'}, latest: (j['latest'] as num?)?.toInt() ?? 5);
    } catch (_) {
      return defaults();
    }
  }

  Map<String, dynamic> get json => {'order': order, 'enabled': enabled.toList(), 'latest': latest};
  Future<void> save() async => (await SharedPreferences.getInstance()).setString(_key, jsonEncode(json));
}

class HomeWidgets {
  static const _channel = MethodChannel('com.aadnanda.aados/widget');
  static DateTime _last = DateTime.fromMillisecondsSinceEpoch(0);

  /// Refresh the widget data. `force` skips the 60-second throttle (Settings → Widgets "Update now").
  static Future<String> push(Api api, {int shared = 0, bool force = false}) async {
    if (!force && DateTime.now().difference(_last) < const Duration(seconds: 60)) return '';
    _last = DateTime.now();
    try {
      final data = await api.get('/api/mobile/widget') as Map<String, dynamic>;
      final config = await WidgetConfig.load();
      await _channel.invokeMethod('save', jsonEncode({...data, 'shared': shared, 'config': config.json}));
      return 'Widget updated.';
    } on ApiException catch (e) {
      return e.message;
    } on MissingPluginException {
      return 'Widgets need the AadOSWidget extension in this build.';
    } on PlatformException catch (e) {
      return e.message ?? 'Widget update failed.';
    }
  }
}
