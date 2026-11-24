import 'package:flutter/material.dart';

import 'core/login_screen.dart';
import 'core/scope.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'dashboard/dashboard_screen.dart';
import 'email/inbox_controller.dart';
import 'email/inbox_screen.dart';
import 'email/mail_api.dart';
import 'email/models.dart';
import 'more/more_screen.dart';

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

/// Bottom navigation: Dashboard (metrics, views, inboxes), Mail (native) and More (other sections, settings, sign out).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.session});
  final Session session;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  late final MailApi _mail = MailApi(widget.session.api);
  late final InboxController _inbox = InboxController(_mail);
  final _dashboard = GlobalKey<DashboardScreenState>();
  static const _dashboardTab = 0, _mailTab = 1;
  int _tab = _dashboardTab;

  void _select(int i) {
    setState(() => _tab = i);
    // Mail keeps checking in the background while the Dashboard is open, so its counts stay current.
    _inbox.setVisible(i != 2);
    if (i == _dashboardTab) _dashboard.currentState?.reload();
  }

  /// A Dashboard metric, view or inbox: open it in Mail.
  void _openInMail(InboxQuery q) {
    _inbox.open(q);
    _select(_mailTab);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _inbox.start();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Live sync pauses in the background and runs again when the app comes back (like the web's visibility check).
    _inbox.setVisible(state == AppLifecycleState.resumed && _tab != 2);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _inbox.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _tab, children: [DashboardScreen(key: _dashboard, mail: _mail, onOpen: _openInMail), InboxScreen(inbox: _inbox), const MoreScreen()]),
      bottomNavigationBar: ListenableBuilder(
        listenable: _inbox,
        builder: (context, _) {
          final unread = _inbox.count('unread');
          return NavigationBar(
            height: 64,
            selectedIndex: _tab,
            onDestinationSelected: _select,
            destinations: [
              const NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashboard'),
              NavigationDestination(
                icon: Badge(isLabelVisible: unread > 0, label: Text(unread > 999 ? '999+' : '$unread'), child: const Icon(Icons.mail_outline)),
                selectedIcon: Badge(isLabelVisible: unread > 0, label: Text(unread > 999 ? '999+' : '$unread'), child: const Icon(Icons.mail)),
                label: 'Mail',
              ),
              const NavigationDestination(icon: Icon(Icons.apps_outlined), selectedIcon: Icon(Icons.apps), label: 'More'),
            ],
          );
        },
      ),
    );
  }
}
