import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/scope.dart';
import '../core/ui.dart';
import '../more/web_section_screen.dart';
import 'emails_settings.dart';
import 'family_settings.dart';
import 'general_settings.dart';
import 'integration_settings.dart';
import 'settings_api.dart';
import 'views_settings.dart';

/// AadOS Settings, native (owner only), the same pages as the web Settings tabs.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  /// Accounts summary for the Emails & Calendar row (which ones need reconnecting).
  Map<String, dynamic>? _mail;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final d = await SettingsApi(SessionScope.read(context)).load('emails');
      if (mounted) setState(() => _mail = d);
    } on ApiException {
      // The row just shows no summary.
    }
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final accounts = maps(_mail?['accounts']);
    final broken = accounts.where((a) => str(a['lastError']).isNotEmpty).toList();
    final mailSub = _mail == null
        ? null
        : broken.isNotEmpty
        ? '${broken.length} need${broken.length == 1 ? 's' : ''} reconnecting: ${broken.map((a) => str(a['email'])).join(', ')}'
        : '${accounts.length} account${accounts.length == 1 ? '' : 's'} connected';
    final rows = <(IconData, String, String?, Widget)>[
      (Icons.mail_outline, 'Emails & Calendar', mailSub, const EmailSettingsScreen()),
      (Icons.view_agenda_outlined, 'Email views', null, const ViewsSettingsScreen()),
      // Rules: the web page (suggestions, AadOS rules, Gmail filters, built-in rules, activity) in a signed-in web view.
      (Icons.rule, 'Rules', 'Suggestions, AadOS rules, Gmail filters', WebSectionScreen(session: SessionScope.read(context), title: 'Rules', path: '/settings/rules')),
      (Icons.tune, 'General', 'Time zone, password, sessions', const GeneralSettingsScreen()),
      (Icons.family_restroom, 'Family', null, const FamilySettingsScreen()),
      (Icons.sms_outlined, 'Messages', 'BlueBubbles server', const MessagesSettingsScreen()),
      (Icons.auto_awesome_outlined, 'AI', 'AJMCP gateway, triage', const AiSettingsScreen()),
      (Icons.inventory_2_outlined, 'Storage', 'Documents bucket', const StorageSettingsScreen()),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: [
            for (final (icon, title, sub, screen) in rows)
              ListTile(
                leading: Icon(icon, color: title == 'Emails & Calendar' && broken.isNotEmpty ? t.colorScheme.error : null),
                title: Text(title),
                subtitle: sub == null
                    ? null
                    : Text(
                        sub,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: title == 'Emails & Calendar' && broken.isNotEmpty ? TextStyle(color: t.colorScheme.error) : null,
                      ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _open(screen),
              ),
          ],
        ),
      ),
    );
  }
}
