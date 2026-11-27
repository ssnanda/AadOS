import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/app_badge.dart';
import '../core/api.dart';
import '../core/scope.dart';
import '../core/session.dart';
import '../core/ui.dart';
import '../email/inbox_controller.dart';
import '../finance/finance_screen.dart';
import '../messages/messages_screen.dart';
import '../settings/emails_settings.dart';
import '../settings/family_settings.dart';
import '../settings/general_settings.dart';
import '../settings/integration_settings.dart';
import '../settings/settings_api.dart';
import '../settings/views_settings.dart';
import '../settings/widget_settings.dart';
import '../shared/shared_screen.dart';
import 'web_section_screen.dart';

/// One More entry. `permission` '' = everyone; `owner` = owner only (the Settings pages).
class _Entry {
  const _Entry(this.id, this.icon, this.title, this.subtitle, this.build, {this.permission = '', this.owner = false});
  final String id, title, subtitle, permission;
  final IconData icon;
  final bool owner;
  final Widget Function(Session) build;
}

/// Everything in More: sections (Calendar and Asana are bottom tabs) and the Settings pages, in one list.
/// The order is the starting order; after that, entries move up the more often they are opened on this phone.
final _entries = <_Entry>[
  _Entry('rules', Icons.rule, 'Rules', 'Suggestions, AadOS rules, Gmail filters', (s) => WebSectionScreen(session: s, title: 'Rules', path: '/settings/rules'), owner: true),
  _Entry('shared', Icons.move_to_inbox_outlined, 'Shared mailboxes', '', (s) => SharedBoxesScreen(api: s.api), permission: 'emails'),
  _Entry('messages', Icons.sms_outlined, 'Messages', '', (s) => MessagesScreen(api: s.api), permission: 'messages'),
  _Entry('finance', Icons.account_balance_outlined, 'Finance', '', (s) => FinanceScreen(api: s.api), permission: 'finance'),
  _Entry('widgets', Icons.widgets_outlined, 'Widgets', 'Home-screen mail widgets', (_) => const WidgetSettingsScreen()),
  _Entry('emails', Icons.mail_outline, 'Emails & Calendar', 'Accounts and connections', (_) => const EmailSettingsScreen(), owner: true),
  _Entry('views', Icons.view_agenda_outlined, 'Email views', '', (_) => const ViewsSettingsScreen(), owner: true),
  _Entry('general', Icons.tune, 'General', 'Time zone, password, sessions', (_) => const GeneralSettingsScreen(), owner: true),
  _Entry('family', Icons.family_restroom, 'Family', '', (_) => const FamilySettingsScreen(), owner: true),
  _Entry('messages-settings', Icons.settings_outlined, 'Messages settings', 'BlueBubbles server', (_) => const MessagesSettingsScreen(), owner: true),
  _Entry('ai', Icons.auto_awesome_outlined, 'AI', 'AJMCP gateway, triage', (_) => const AiSettingsScreen(), owner: true),
  _Entry('storage', Icons.inventory_2_outlined, 'Storage', 'Documents bucket', (_) => const StorageSettingsScreen(), owner: true),
];

class MoreScreen extends StatefulWidget {
  const MoreScreen({super.key});
  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  static const _key = 'more.usage.v1', _recentKey = 'more.recent.v1';
  Map<String, int> _uses = {};
  List<String> _recent = []; // ids, most recently opened first
  String _mailWarning = ''; // accounts that need reconnecting (shown on Emails & Calendar)

  @override
  void initState() {
    super.initState();
    _loadUses();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadMail());
  }

  Future<void> _loadUses() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key), recent = prefs.getStringList(_recentKey) ?? [];
    if (!mounted) return;
    try {
      setState(() {
        if (raw != null) _uses = (jsonDecode(raw) as Map).map((k, v) => MapEntry('$k', (v as num).toInt()));
        _recent = recent;
      });
    } catch (_) {/* start fresh */}
  }

  Future<void> _loadMail() async {
    final s = SessionScope.read(context);
    if (!(s.user?.owner ?? false)) return;
    try {
      final d = await SettingsApi(s).load('emails');
      final broken = maps(d['accounts']).where((a) => str(a['lastError']).isNotEmpty).map((a) => str(a['email'])).toList();
      if (mounted) setState(() => _mailWarning = broken.isEmpty ? '' : '${broken.length} need${broken.length == 1 ? 's' : ''} reconnecting: ${broken.join(', ')}');
    } on ApiException {
      // No warning shown.
    }
  }

  Future<void> _open(_Entry e, Session s) async {
    setState(() {
      _uses = {..._uses, e.id: (_uses[e.id] ?? 0) + 1};
      _recent = [e.id, ..._recent.where((id) => id != e.id)].take(10).toList();
    });
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(_uses));
    await prefs.setStringList(_recentKey, _recent);
    if (!mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => e.build(s)));
    if (e.id == 'emails') _loadMail();
  }

  @override
  Widget build(BuildContext context) {
    final session = SessionScope.of(context);
    final user = session.user;
    final t = Theme.of(context);
    final owner = user?.owner ?? false;
    final visible = [for (final e in _entries) if (e.owner ? owner : (e.permission.isEmpty || (user?.can(e.permission) ?? true))) e];
    // Most opened first; ties keep the starting order.
    final order = {for (var i = 0; i < _entries.length; i++) _entries[i].id: i};
    visible.sort((a, b) {
      final d = (_uses[b.id] ?? 0).compareTo(_uses[a.id] ?? 0);
      return d != 0 ? d : order[a.id]!.compareTo(order[b.id]!);
    });
    // Last 3 opened (newest first), from what this user can see.
    final byId = {for (final e in visible) e.id: e};
    final recent = [for (final id in _recent) if (byId[id] != null) byId[id]!].take(3).toList();
    Widget tile(_Entry e) => ListTile(leading: Icon(e.icon), title: Text(e.title), trailing: const Icon(Icons.history, size: 18), onTap: () => _open(e, session));
    Widget header(String s) => Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 4), child: Text(s, style: t.textTheme.labelSmall?.copyWith(letterSpacing: 1, fontWeight: FontWeight.w700)));
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(children: [
        if (recent.isNotEmpty) ...[
          header('RECENT'),
          for (final e in recent) tile(e),
          const Divider(),
        ],
        header('ALL · MOST USED FIRST'),
        for (final e in visible)
          ListTile(
            leading: Icon(e.icon, color: e.id == 'emails' && _mailWarning.isNotEmpty ? t.colorScheme.error : null),
            title: Text(e.title),
            subtitle: e.id == 'emails' && _mailWarning.isNotEmpty
                ? Text(_mailWarning, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: t.colorScheme.error))
                : e.subtitle.isEmpty ? null : Text(e.subtitle),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _open(e, session),
          ),
        const Divider(),
        header('ACCOUNT'),
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
