import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/scope.dart';
import '../email/inbox_controller.dart';
import 'web_section_screen.dart';

/// Sections that are not native yet open from the web app (signed in). Each needs the same permission as on the web.
const sections = [
  (Icons.dashboard_outlined, 'Dashboard', '/', ''),
  (Icons.event_outlined, 'Calendar', '/calendar', 'calendar'),
  (Icons.track_changes, 'Asana', '/asana', 'asana'),
  (Icons.sms_outlined, 'Messages', '/messages', 'messages'),
  (Icons.contacts_outlined, 'Contacts', '/contacts', 'contacts'),
  (Icons.account_balance_outlined, 'Finance', '/finance', 'finance'),
  (Icons.description_outlined, 'Documents', '/documents', 'documents'),
  (Icons.auto_awesome_outlined, 'Assistant', '/assistant', 'assistant'),
  (Icons.wb_sunny_outlined, 'Briefing', '/briefing', 'assistant'),
  (Icons.mail_outline, 'Shared mailboxes', '/emails/shared', 'emails'),
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
        for (final (icon, title, path, permission) in sections)
          if (permission.isEmpty || (user?.can(permission) ?? true))
            ListTile(leading: Icon(icon), title: Text(title), trailing: const Icon(Icons.open_in_new, size: 16), onTap: () => open(title, path)),
        if (user?.owner ?? false) ListTile(leading: const Icon(Icons.settings_outlined), title: const Text('AadOS settings'), trailing: const Icon(Icons.open_in_new, size: 16), onTap: () => open('Settings', '/settings')),
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
            await WebSectionScreen.clearCookies();
            await session.signOut();
          },
        ),
      ]),
    );
  }
}
