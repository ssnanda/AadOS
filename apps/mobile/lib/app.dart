import 'dart:async';

import 'package:flutter/material.dart';

import 'asana/asana_api.dart';
import 'asana/asana_screen.dart';
import 'calendar/calendar_api.dart';
import 'calendar/calendar_screen.dart';
import 'core/app_badge.dart';
import 'core/home_widget.dart';
import 'core/login_screen.dart';
import 'core/scope.dart';
import 'core/shake.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'dashboard/dashboard_screen.dart';
import 'email/inbox_controller.dart';
import 'email/inbox_screen.dart';
import 'email/mail_api.dart';
import 'email/models.dart';
import 'more/more_screen.dart';
import 'shared/shared_screen.dart' show SharedApi;
import 'core/ui.dart' show maps, numOf;

final navigatorKey = GlobalKey<NavigatorState>();

class AadOSApp extends StatefulWidget {
  const AadOSApp({super.key, required this.session});
  final Session session;

  @override
  State<AadOSApp> createState() => _AadOSAppState();
}

class _AadOSAppState extends State<AadOSApp> {
  bool _wasSignedIn = false;

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_sessionChanged);
  }

  // Signed out (or the token expired): close everything above the root so the sign-in screen shows.
  void _sessionChanged() {
    final now = widget.session.signedIn;
    if (_wasSignedIn && !now) navigatorKey.currentState?.popUntil((r) => r.isFirst);
    _wasSignedIn = now;
  }

  @override
  void dispose() {
    widget.session.removeListener(_sessionChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SessionScope(
      session: widget.session,
      child: MaterialApp(
        title: 'AadOS',
        navigatorKey: navigatorKey,
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        home: ListenableBuilder(
          listenable: widget.session,
          builder: (context, _) {
            final s = widget.session;
            if (!s.ready) return const Scaffold(body: Center(child: CircularProgressIndicator()));
            if (!s.signedIn) return const LoginScreen();
            // A new token (sign-in) gets a fresh home with its own API client.
            return HomeShell(key: ValueKey(s.token), session: s);
          },
        ),
      ),
    );
  }
}

/// Bottom navigation: Dashboard, Mail, Calendar (with Conference Room), Asana and More (Messages, Finance,
/// Shared mailboxes, other sections, settings, sign out). Calendar and Asana show only with their permission.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.session});
  final Session session;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  late final MailApi _mail = MailApi(widget.session.api);
  late final InboxController _inbox = InboxController(_mail);
  late final CalendarApi _calendar = CalendarApi(widget.session.api);
  late final AsanaApi _asana = AsanaApi(widget.session.api);
  final _dashboard = GlobalKey<DashboardScreenState>();
  final _asanaDue = ValueNotifier<int>(0);
  final _sharedUnread = ValueNotifier<int>(0); // unread in Zoho shared mailboxes
  Timer? _sharedTimer;
  late final ShakeDetector _shake = ShakeDetector(_promptUndo);
  bool _undoOpen = false;
  String _tab = 'dashboard';
  final Set<String> _opened = {'dashboard', 'mail', 'asana'}; // Asana loads at start for its due badge; Calendar when opened

  bool get _canCalendar => widget.session.user?.can('calendar') ?? true;
  bool get _canAsana => widget.session.user?.can('asana') ?? true;
  List<String> get _tabs => ['dashboard', 'mail', if (_canCalendar) 'calendar', if (_canAsana) 'asana', 'more'];

  void _select(String t) {
    setState(() {
      _tab = t;
      _opened.add(t);
    });
    if (t == 'dashboard') _dashboard.currentState?.reload();
  }

  /// A Dashboard metric, view or inbox: open it in Mail.
  void _openInMail(InboxQuery q) {
    _inbox.open(q);
    _select('mail');
  }

  // Home-screen icon: all unread mail (every account and folder) + shared mailboxes. One number is all iOS allows.
  void _badge() {
    AppBadge.set(_inbox.unreadAll + _sharedUnread.value);
    // Home-screen widgets follow the same changes (throttled to once a minute).
    HomeWidgets.push(widget.session.api, shared: _sharedUnread.value);
  }

  /// Shared mailboxes' unread total (Zoho; slower, so every 5 minutes and on resume). Errors keep the last number.
  Future<void> _loadShared() async {
    if (!(widget.session.user?.can('emails') ?? true)) return;
    try {
      final r = await SharedApi(widget.session.api).op('boxes', {'fresh': false}, timeout: const Duration(seconds: 60));
      var n = 0;
      for (final a in maps(r['accounts'])) {
        for (final b in maps(a['boxes'])) {
          n += numOf(b['unread']).toInt();
        }
      }
      _sharedUnread.value = n;
    } catch (_) {/* no shared mailboxes or offline */}
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _inbox.addListener(_badge);
    _sharedUnread.addListener(_badge);
    _inbox.start();
    _shake.start();
    _loadShared();
    _sharedTimer = Timer.periodic(const Duration(minutes: 5), (_) => _loadShared());
  }

  /// Shake to undo: shows the newest delete / mark read / mark unread and undoes it on confirm.
  Future<void> _promptUndo() async {
    final ctx = navigatorKey.currentContext;
    if (_undoOpen || ctx == null) return;
    _undoOpen = true;
    try {
      final info = await _mail.latestUndo();
      final c = navigatorKey.currentContext;
      if (c == null || !c.mounted) return;
      final messenger = ScaffoldMessenger.maybeOf(c);
      if (info == null) { messenger?.showSnackBar(const SnackBar(content: Text('Nothing to undo.'))); return; }
      final ok = await showDialog<bool>(
        context: c,
        builder: (d) => AlertDialog(
          title: Text(info.op == 'delete' ? 'Undo delete?' : 'Undo?'),
          content: Text(info.label),
          actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Undo'))],
        ),
      );
      if (ok != true) return;
      final message = await _mail.undo(info.id);
      await _inbox.load(quiet: true);
      messenger?.showSnackBar(SnackBar(content: Text(message)));
    } catch (e) {
      final c = navigatorKey.currentContext;
      if (c != null && c.mounted) ScaffoldMessenger.maybeOf(c)?.showSnackBar(SnackBar(content: Text('Undo failed: $e')));
    } finally {
      _undoOpen = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Live sync pauses in the background and runs again when the app comes back (like the web's visibility check).
    // It keeps running on every tab so the icon and Mail badges stay current.
    _inbox.setVisible(state == AppLifecycleState.resumed);
    if (state == AppLifecycleState.resumed) { _shake.start(); _loadShared(); } else { _shake.stop(); }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _shake.stop();
    _sharedTimer?.cancel();
    _sharedUnread.removeListener(_badge);
    _sharedUnread.dispose();
    _inbox.removeListener(_badge);
    _inbox.dispose();
    _asanaDue.dispose();
    AppBadge.clear(); // signed out (or token replaced): no stale count on the icon
    super.dispose();
  }

  Widget _screen(String t) => switch (t) {
        'mail' => InboxScreen(inbox: _inbox),
        'calendar' => CalendarTab(api: _calendar),
        'asana' => AsanaScreen(api: _asana, onCount: (n) => _asanaDue.value = n),
        'more' => const MoreScreen(),
        _ => DashboardScreen(key: _dashboard, mail: _mail, onOpen: _openInMail),
      };

  @override
  Widget build(BuildContext context) {
    final tabs = _tabs;
    final index = tabs.indexOf(_tab).clamp(0, tabs.length - 1);
    Widget count(int n, Widget icon) => Badge(isLabelVisible: n > 0, label: Text(n > 999 ? '999+' : '$n'), child: icon);
    return Scaffold(
      body: IndexedStack(index: index, children: [for (final t in tabs) KeyedSubtree(key: ValueKey(t), child: _opened.contains(t) ? _screen(t) : const SizedBox())]),
      bottomNavigationBar: ListenableBuilder(
        listenable: Listenable.merge([_inbox, _asanaDue, _sharedUnread]),
        builder: (context, _) {
          final unread = _inbox.unreadAll, shared = _sharedUnread.value;
          // Mail: shared mailboxes on the left (blue), all unread mail on the right (red); each grows outward, no overlap.
          String n(int v) => v > 999 ? '999+' : '$v';
          Widget mail(Widget icon) => SizedBox(
                width: 64,
                height: 32,
                child: Stack(clipBehavior: Clip.none, alignment: Alignment.center, children: [
                  icon,
                  if (shared > 0) Positioned(right: 38, top: -4, child: Badge(label: Text(n(shared)), backgroundColor: Colors.blue.shade600, textColor: Colors.white)),
                  if (unread > 0) Positioned(left: 38, top: -4, child: Badge(label: Text(n(unread)))),
                ]),
              );
          return NavigationBar(
            height: 64,
            selectedIndex: index,
            onDestinationSelected: (i) => _select(tabs[i]),
            labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
            destinations: [
              for (final t in tabs)
                switch (t) {
                  'mail' => NavigationDestination(icon: mail(const Icon(Icons.mail_outline)), selectedIcon: mail(const Icon(Icons.mail)), label: 'Mail', tooltip: 'Unread: $unread mail, $shared shared'),
                  'calendar' => const NavigationDestination(icon: Icon(Icons.calendar_month_outlined), selectedIcon: Icon(Icons.calendar_month), label: 'Calendar'),
                  'asana' => NavigationDestination(icon: count(_asanaDue.value, const Icon(Icons.task_alt_outlined)), selectedIcon: count(_asanaDue.value, const Icon(Icons.task_alt)), label: 'Asana'),
                  'more' => const NavigationDestination(icon: Icon(Icons.apps_outlined), selectedIcon: Icon(Icons.apps), label: 'More'),
                  _ => const NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashboard'),
                },
            ],
          );
        },
      ),
    );
  }
}
