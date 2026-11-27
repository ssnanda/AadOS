import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/app_badge.dart';
import '../core/api.dart';
import '../core/scope.dart';
import '../email/inbox_controller.dart';
import '../finance/finance_screen.dart';
import '../messages/messages_screen.dart';
import '../settings/settings_screen.dart';
import '../shared/shared_screen.dart';
import 'web_section_screen.dart';

/// Native sections (Calendar and Asana are bottom tabs). Each needs the same permission as on the web.
final native = <(IconData, String, String, Widget Function(Api))>[
  (Icons.sms_outlined, 'Messages', 'messages', (api) => MessagesScreen(api: api)),
  (Icons.account_balance_outlined, 'Finance', 'finance', (api) => FinanceScreen(api: api)),
  (Icons.move_to_inbox_outlined, 'Shared mailboxes', 'emails', (api) => SharedBoxesScreen(api: api)),
];

/// Sections that are not native yet open from the web app (signed in).
const sections = [
  (Icons.contacts_outlined, 'Contacts', '/contacts', 'contacts'),
  (Icons.description_outlined, 'Documents', '/documents', 'documents'),
  (Icons.auto_awesome_outlined, 'Assistant', '/assistant', 'assistant'),
  (Icons.wb_sunny_outlined, 'Briefing', '/briefing', 'assistant'),
  (Icons.dashboard_outlined, 'Web dashboard', '/', ''),
];

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final user = session.user;
    final t = Theme.of(context);
    void open(String title, String path) =>
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebSectionScreen(session: session, title: title, path: path)));
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(children: [
        Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 4), child: Text('SECTIONS', style: t.textTheme.labelSmall?.copyWith(letterSpacing: 1, fontWeight: FontWeight.w700))),
        for (final (icon, title, permission, build) in native)
          if (user?.can(permission) ?? true)
            ListTile(leading: Icon(icon), title: Text(title), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => build(session.api)))),
        Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 4), child: Text('ON THE WEB', style: t.textTheme.labelSmall?.copyWith(letterSpacing: 1, fontWeight: FontWeight.w700))),
        for (final (icon, title, path, permission) in sections)
          if (permission.isEmpty || (user?.can(permission) ?? true))
            ListTile(leading: Icon(icon), title: Text(title), trailing: const Icon(Icons.open_in_new, size: 16), onTap: () => open(title, path)),
        if (user?.owner ?? false) ...[
          const Divider(),
          ListTile(leading: const Icon(Icons.settings_outlined), title: const Text('Settings'), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen()))),
        ],
        const Divider(),
        Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 4), child: Text('ACCOUNT', style: t.textTheme.labelSmall?.copyWith(letterSpacing: 1, fontWeight: FontWeight.w700))),
        ListTile(leading: const Icon(Icons.person_outline), title: Text(user?.name ?? 'Signed in'), subtitle: Text(Uri.parse(session.server).host)),
        FutureBuilder<PackageInfo>(
          future: PackageInfo.fromPlatform(),
          builder: (_, s) => ListTile(
            leading: const Icon(Icons.info_outline),
            title: Text('App ${s.data?.version ?? ''}${s.data != null ? ' (${s.data!.buildNumber})' : ''}'),
            subtitle: session.serverVersion.isNotEmpty ? Text('Server v${session.serverVersion}') : null,
          ),
        ),
        ListTile(
          leading: Icon(Icons.logout, color: t.colorScheme.error),
          title: Text('Sign out', style: TextStyle(color: t.colorScheme.error)),
          onTap: () async {
            final ok = await showDialog<bool>(
              context: context,
              builder: (c) => AlertDialog(
                title: const Text('Sign out of AadOS on this device?'),
                actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out'))],
              ),
            );
            if (ok != true) return;
            await InboxController.clearCache();
            await AppBadge.clear();
            await WebSectionScreen.clearCookies();
            await session.signOut();
          },
        ),
      ]),
    );
  }
}
