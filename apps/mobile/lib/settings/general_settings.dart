import 'package:flutter/material.dart';

import '../core/app_badge.dart';
import '../core/scope.dart';
import '../core/ui.dart';
import '../email/inbox_controller.dart';
import '../more/web_section_screen.dart';
import 'settings_api.dart';

/// Settings → General: calendar time zone and week start, owner password, sign out everywhere.
class GeneralSettingsScreen extends StatefulWidget {
  const GeneralSettingsScreen({super.key});
  @override
  State<GeneralSettingsScreen> createState() => _GeneralState();
}

class _GeneralState extends SettingsPageState<GeneralSettingsScreen> {
  @override
  String get page => 'general';

  final _zone = TextEditingController(), _current = TextEditingController(), _next = TextEditingController(), _confirm = TextEditingController();
  int _weekStart = 0;
  bool _filled = false;

  @override
  void dispose() {
    for (final c in [_zone, _current, _next, _confirm]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _signOutEverywhere() async {
    if (!await confirm('Sign out on every device?', body: 'This phone too. Sign in again afterwards.', ok: 'Sign out', danger: true)) return;
    if (!mounted) return;
    final session = SessionScope.read(context);
    final r = await settings.act(context, 'session', 'revokeAll');
    if (r == null) return;
    await InboxController.clearCache();
    await AppBadge.clear();
    await WebSectionScreen.clearCookies();
    await session.signOut();
  }

  @override
  Widget build(BuildContext context) => scaffold('General', (d) {
    final prefs = mapOf(d['prefs']);
    if (!_filled) {
      _filled = true;
      _zone.text = str(prefs['timeZone']).isEmpty ? 'UTC' : str(prefs['timeZone']);
      _weekStart = numOf(prefs['weekStart']).toInt() == 1 ? 1 : 0;
    }
    final db = mapOf(d['db']);
    final cmp = mapOf(db['comparison']);
    return [
      const SectionLabel('Calendar'),
      Field(_zone, 'Time zone', hint: 'America/New_York', helper: 'IANA name'),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
        child: SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 0, label: Text('Week starts Sunday')),
            ButtonSegment(value: 1, label: Text('Monday')),
          ],
          selected: {_weekStart},
          onSelectionChanged: (s) => setState(() => _weekStart = s.first),
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
        child: Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.tonal(
            onPressed: busy ? null : () => run('prefs', fields: {'timeZone': _zone.text.trim(), 'weekStart': '$_weekStart'}, done: 'Saved.'),
            child: const Text('Save'),
          ),
        ),
      ),
      const SectionLabel('Password'),
      Field(_current, 'Current password', secret: true),
      Field(_next, 'New password', secret: true, helper: 'At least 12 characters'),
      Field(_confirm, 'Confirm new password', secret: true),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
        child: Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.tonal(
            onPressed: busy
                ? null
                : () async {
                    // Other devices are signed out; this phone receives the new token and stays signed in.
                    final r = await run(
                      'password',
                      fields: {'current': _current.text, 'next': _next.text, 'confirm': _confirm.text},
                      done: 'Password changed. Other devices have been signed out.',
                    );
                    if (r != null) {
                      for (final c in [_current, _next, _confirm]) {
                        c.clear();
                      }
                    }
                  },
            child: const Text('Change password'),
          ),
        ),
      ),
      const SectionLabel('Sessions'),
      ListTile(
        leading: Icon(Icons.devices_other, color: Theme.of(context).colorScheme.error),
        title: Text('Sign out everywhere', style: TextStyle(color: Theme.of(context).colorScheme.error)),
        onTap: busy ? null : _signOutEverywhere,
      ),
      if (str(db['mode']) == 'compare') ...[
        const SectionLabel('Database'),
        if (str(db['error']).isNotEmpty)
          InfoRow('Mirror', str(db['error']), bad: true)
        else if (cmp['match'] == true)
          const InfoRow('Mirror', 'Matches legacy state')
        else
          for (final x in (cmp['differences'] as List? ?? const [])) InfoRow('Difference', str(x), bad: true),
      ],
    ];
  });
}
