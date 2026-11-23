import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api.dart';
import 'mail_api.dart';
import 'models.dart';

/// The inbox on screen: query, rows (paged), counts, and live sync like a mail client
/// (on open, on folder change, when the app comes back, every 2 minutes while visible).
/// Delete and read/unread change the row at once; the mailbox call follows and is rolled back if it fails.
class InboxController extends ChangeNotifier {
  InboxController(this.mail);
  final MailApi mail;
  static const liveEvery = Duration(minutes: 2);

  InboxQuery query = const InboxQuery();
  InboxPage? data;
  final List<EmailRow> rows = [];
  bool loading = false, loadingMore = false, syncing = false;
  String error = '';
  int _page = 1;
  int _generation = 0; // drops answers for a query that is no longer on screen
  Timer? _timer;
  bool _visible = true;

  bool get hasMore => data != null && _page < data!.pages;
  int count(String view) => data?.counts[view == 'needs-reply' ? 'needsReply' : view] ?? 0;

  // ---- loading ----
  Future<void> start() async {
    await _restoreCache();
    await load();
    unawaited(sync());
    _timer ??= Timer.periodic(liveEvery, (_) {
      if (_visible) unawaited(sync());
    });
  }

  void setVisible(bool visible) {
    final wasHidden = !_visible;
    _visible = visible;
    if (visible && wasHidden) unawaited(sync());
  }

  Future<void> open(InboxQuery q) async {
    query = q;
    rows.clear();
    data = null;
    notifyListeners();
    await load();
    unawaited(sync());
  }

  /// Page 1 of the current query. [quiet] keeps the list on screen while reloading.
  Future<void> load({bool quiet = false}) async {
    final gen = ++_generation;
    if (!quiet) {
      loading = rows.isEmpty;
      error = '';
      notifyListeners();
    }
    try {
      final page = await mail.list(query);
      if (gen != _generation) return;
      data = page;
      _page = 1;
      rows
        ..clear()
        ..addAll(page.rows.where((r) => !_hidden.contains(r.key)));
      error = '';
      unawaited(_saveCache(page));
    } on ApiException catch (e) {
      if (gen == _generation && !e.unauthorized) error = e.message;
    } finally {
      if (gen == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> loadMore() async {
    if (loadingMore || !hasMore) return;
    final gen = _generation;
    loadingMore = true;
    notifyListeners();
    try {
      final page = await mail.list(query, page: _page + 1);
      if (gen != _generation) return;
      _page = page.page;
      final have = rows.map((r) => r.key).toSet();
      rows.addAll(page.rows.where((r) => !have.contains(r.key) && !_hidden.contains(r.key)));
    } on ApiException catch (e) {
      if (!e.unauthorized) error = e.message;
    } finally {
      loadingMore = false;
      notifyListeners();
    }
  }

  /// Refresh the open folder from Gmail/Zoho; reloads the list only when something changed (or [force]).
  Future<void> sync({bool force = false}) async {
    if (syncing) return;
    syncing = true;
    notifyListeners();
    try {
      final changed = await mail.liveSync(query, force: force);
      if (changed || force) await load(quiet: true);
    } on ApiException catch (e) {
      if (force && !e.unauthorized) error = e.message;
    } finally {
      syncing = false;
      notifyListeners();
    }
  }

  // ---- actions ----
  final Set<String> _hidden = {};

  /// Moves to the provider's Trash. Rows disappear immediately; returns the error message or ''.
  Future<String> delete(List<String> keys) async {
    final removed = <int, EmailRow>{};
    for (var i = 0; i < rows.length; i++) {
      if (keys.contains(rows[i].key)) removed[i] = rows[i];
    }
    _hidden.addAll(keys);
    rows.removeWhere((r) => keys.contains(r.key));
    notifyListeners();
    try {
      final warning = await mail.mark('delete', keys);
      unawaited(load(quiet: true).whenComplete(() => _hidden.removeAll(keys)));
      return warning;
    } on ApiException catch (e) {
      _hidden.removeAll(keys);
      for (final entry in removed.entries) {
        rows.insert(entry.key.clamp(0, rows.length), entry.value);
      }
      notifyListeners();
      return e.message;
    }
  }

  Future<String> setUnread(List<String> keys, bool unread) => _optimistic(unread ? 'mark-unread' : 'mark-read', keys, (r) => r.unread = unread, (r, was) => r.unread = was, (r) => r.unread);

  Future<String> setImportant(List<String> keys, bool important) =>
      _optimistic(important ? 'importance-high' : 'importance-normal', keys, (r) => r.important = important, (r, was) => r.important = was, (r) => r.important);

  Future<String> setFollowUp(List<String> keys, bool on) => _optimistic(on ? 'follow-up' : 'clear-follow-up', keys, (r) => r.followUp = on, (r, was) => r.followUp = was, (r) => r.followUp);

  Future<String> saveValue(String key, {required String kind, String expiry = ''}) async {
    final row = rows.where((r) => r.key == key).firstOrNull;
    final oldKind = row?.savedKind ?? '', oldExpiry = row?.savedExpiry ?? '';
    if (row != null) { row.savedKind = kind; row.savedExpiry = expiry; notifyListeners(); }
    final op = kind == 'coupon' ? 'save-coupon' : kind == 'gift-card' ? 'save-gift-card' : 'clear-saved-value';
    try {
      final warning = await mail.mark(op, [key], value: expiry);
      await load(quiet: true);
      return warning;
    } on ApiException catch (e) {
      if (row != null) { row.savedKind = oldKind; row.savedExpiry = oldExpiry; notifyListeners(); }
      return e.message;
    }
  }

  /// reviewed | dismissed | actionable | clear-action (AadOS-only review state).
  Future<String> review(String op, List<String> keys) async {
    final touched = [for (final r in rows) if (keys.contains(r.key)) (r, r.action, r.actionReason, r.reviewed)];
    for (final (r, _, _, _) in touched) {
      if (op == 'actionable') {
        r.action = 'reply';
        r.actionReason = 'Marked by you';
        r.reviewed = false;
      } else if (op == 'clear-action') {
        r.action = null;
        r.actionReason = '';
        r.reviewed = false;
      } else {
        r.reviewed = op == 'reviewed' || op == 'dismissed';
      }
    }
    notifyListeners();
    try {
      final warning = await mail.mark(op, keys);
      unawaited(load(quiet: true));
      return warning;
    } on ApiException catch (e) {
      for (final (r, action, reason, reviewed) in touched) {
        r.action = action;
        r.actionReason = reason;
        r.reviewed = reviewed;
      }
      notifyListeners();
      return e.message;
    }
  }

  Future<String> _optimistic(String op, List<String> keys, void Function(EmailRow) apply, void Function(EmailRow, bool) undo, bool Function(EmailRow) read) async {
    final touched = [for (final r in rows) if (keys.contains(r.key)) (r, read(r))];
    for (final (r, _) in touched) {
      apply(r);
    }
    notifyListeners();
    try {
      final warning = await mail.mark(op, keys);
      unawaited(load(quiet: true));
      return warning;
    } on ApiException catch (e) {
      for (final (r, was) in touched) {
        undo(r, was);
      }
      notifyListeners();
      return e.message;
    }
  }

  /// The reader opened an email: the server marks it read; reflect it in the list.
  void markSeen(String key) {
    for (final r in rows) {
      if (r.key == key && r.unread) {
        r.unread = false;
        notifyListeners();
      }
    }
  }

  // ---- instant start: last unread page from the previous session ----
  static const _cacheKey = 'aados.inbox.cache';
  Future<void> _saveCache(InboxPage page) async {
    if (query.cacheKey != const InboxQuery().cacheKey) return;
    try {
      await (await SharedPreferences.getInstance()).setString(_cacheKey, jsonEncode(page.raw));
    } catch (_) {}
  }

  /// Forget the cached page (sign out: the next person must not see it).
  static Future<void> clearCache() async {
    try {
      await (await SharedPreferences.getInstance()).remove(_cacheKey);
    } catch (_) {}
  }

  Future<void> _restoreCache() async {
    try {
      final s = (await SharedPreferences.getInstance()).getString(_cacheKey);
      if (s == null || rows.isNotEmpty) return;
      final page = InboxPage.fromJson(jsonDecode(s) as Map<String, dynamic>);
      data = page;
      rows.addAll(page.rows);
      notifyListeners();
    } catch (_) {}
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
