import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/scope.dart';
import '../core/session.dart';
import '../core/ui.dart';

/// AadOS Settings through `/settings/app`: each web Settings page's own load and form actions (same validation and
/// messages as the web). Owner only.
class SettingsApi {
  SettingsApi(this.session);
  final Session session;
  Api get api => session.api;

  Future<Map<String, dynamic>> load(String page) async => mapOf(await api.get('/settings/app', query: {'page': page}, timeout: const Duration(seconds: 45)));

  /// Runs `page.action` with [fields] as its form. Returns the action's data, or null when it failed (error shown) or
  /// it opened a provider sign-in (then [onOAuthDone] runs when that finishes).
  Future<Map<String, dynamic>?> act(
    BuildContext context,
    String page,
    String action, {
    Map<String, Object?> fields = const {},
    VoidCallback? onOAuthDone,
  }) async {
    final r = await guarded(
      context,
      () async => mapOf(await api.post('/settings/app', {'page': page, 'action': action, 'fields': fields}, timeout: const Duration(seconds: 90))),
    );
    if (r == null) return null;
    final token = str(r['token']);
    if (token.isNotEmpty) await session.replaceToken(token);
    final redirect = str(r['redirect']);
    if (redirect.isNotEmpty) {
      if (context.mounted) await _oauth(context, Uri.parse(redirect), onOAuthDone);
      return null;
    }
    return mapOf(r['data']);
  }

  /// Google refuses sign-in inside an embedded web view, so the consent page opens in the system's in-app browser
  /// (Safari view / Custom Tab). The server records the callback's outcome; polling it lets the app close the Safari
  /// view (iOS) and refresh. On Android the user closes the tab; the poll still refreshes the page.
  Future<void> _oauth(BuildContext context, Uri url, VoidCallback? onDone) async {
    final state = url.queryParameters['state'] ?? '';
    final messenger = ScaffoldMessenger.maybeOf(context);
    final opened = await launchUrl(url, mode: LaunchMode.inAppBrowserView);
    if (!opened) {
      messenger?.showSnackBar(const SnackBar(content: Text('Could not open the sign-in page.')));
      return;
    }
    if (state.isEmpty) return;
    final until = DateTime.now().add(const Duration(minutes: 10));
    while (DateTime.now().isBefore(until)) {
      await Future<void>.delayed(const Duration(seconds: 2));
      Map<String, dynamic> s;
      try {
        s = mapOf(await api.get('/settings/app', query: {'oauth': state}));
      } on ApiException {
        continue;
      }
      if (s['unknown'] == true) break; // server restarted: nothing to wait for
      if (s['done'] != true) continue;
      if (await supportsCloseForLaunchMode(LaunchMode.inAppBrowserView)) await closeInAppWebView();
      messenger
        ?..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(str(s['message']).isNotEmpty ? str(s['message']) : (s['ok'] == true ? 'Connected.' : 'Connection failed.'))));
      break;
    }
    onDone?.call();
  }
}

/// Load → show → act → reload, shared by every settings page.
abstract class SettingsPageState<T extends StatefulWidget> extends State<T> {
  String get page;
  late final SettingsApi settings = SettingsApi(SessionScope.read(context));
  Map<String, dynamic>? data;
  String error = '';
  bool busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => reload());
  }

  Future<void> reload() async {
    try {
      final d = await settings.load(page);
      if (mounted) {
        setState(() {
          data = d;
          error = '';
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  /// Runs an action, shows [done] (or the action's `message`), then reloads.
  Future<Map<String, dynamic>?> run(String action, {Map<String, Object?> fields = const {}, String? done, String? on}) async {
    setState(() => busy = true);
    final r = await settings.act(context, on ?? page, action, fields: fields, onOAuthDone: reload);
    if (!mounted) return r;
    setState(() => busy = false);
    if (r != null) {
      final msg = str(r['message']).isNotEmpty ? str(r['message']) : (done ?? '');
      if (msg.isNotEmpty) toast(context, msg);
      await reload();
    }
    return r;
  }

  Future<bool> confirm(String title, {String? body, String ok = 'OK', bool danger = false}) async =>
      await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(title),
          content: body == null ? null : Text(body),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(
              style: danger ? FilledButton.styleFrom(backgroundColor: Theme.of(c).colorScheme.error) : null,
              onPressed: () => Navigator.pop(c, true),
              child: Text(ok),
            ),
          ],
        ),
      ) ==
      true;

  /// Standard scaffold: progress bar, error/retry, pull to refresh.
  Widget scaffold(String title, List<Widget> Function(Map<String, dynamic> d) children, {List<Widget>? actions, Widget? fab}) {
    final d = data;
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: actions,
        bottom: busy ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2)) : null,
      ),
      floatingActionButton: fab,
      body: d == null
          ? (error.isNotEmpty ? ErrorPane(error, onRetry: reload) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: reload,
              child: ListView(padding: const EdgeInsets.only(bottom: 32), children: children(d)),
            ),
    );
  }
}

/// Text field for settings forms (labels above, compact).
class Field extends StatelessWidget {
  const Field(this.controller, this.label, {super.key, this.hint, this.secret = false, this.enabled = true, this.helper, this.keyboard, this.lines = 1});
  final TextEditingController controller;
  final String label;
  final String? hint, helper;
  final bool secret, enabled;
  final TextInputType? keyboard;
  final int lines;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
    child: TextField(
      controller: controller,
      obscureText: secret,
      enabled: enabled,
      keyboardType: keyboard,
      autocorrect: false,
      enableSuggestions: !secret,
      minLines: lines,
      maxLines: secret ? 1 : (lines == 1 ? 1 : lines + 2),
      decoration: InputDecoration(labelText: label, hintText: hint, helperText: helper, border: const OutlineInputBorder(), isDense: true),
    ),
  );
}

/// Status line: label + value (dl/dt/dd on the web).
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.bad = false});
  final String label, value;
  final bool bad;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 3, 16, 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.onSurfaceVariant, fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(
            child: Text(value.isEmpty ? '—' : value, style: t.textTheme.bodySmall?.copyWith(color: bad ? t.colorScheme.error : null)),
          ),
        ],
      ),
    );
  }
}

String when(Object? iso) {
  final d = DateTime.tryParse(str(iso));
  if (d == null) return 'never';
  final l = d.toLocal();
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final h = l.hour % 12 == 0 ? 12 : l.hour % 12;
  return '${m[l.month - 1]} ${l.day}, $h:${l.minute.toString().padLeft(2, '0')} ${l.hour < 12 ? 'AM' : 'PM'}';
}
