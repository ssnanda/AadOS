import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/scope.dart';
import '../core/theme.dart';
import '../core/ui.dart';
import 'settings_api.dart';

/// Settings → Emails & Calendar, native: connected Gmail/Zoho accounts (reconnect, change access, what syncs, calendars),
/// connecting another account and the provider app credentials. Same actions as the web page (`/settings/emails`).
class EmailSettingsScreen extends StatefulWidget {
  const EmailSettingsScreen({super.key});
  @override
  State<EmailSettingsScreen> createState() => _EmailSettingsState();
}

class _EmailSettingsState extends SettingsPageState<EmailSettingsScreen> {
  @override
  String get page => 'emails';

  /// Per-account checkbox on the web: `on` is the explicit new state, so a repeated submit never flips it back.
  Future<void> _sync(String id, String kind, bool on) => run('setSync', fields: {'id': id, 'kind': kind, 'on': on.toString()});

  @override
  Widget build(BuildContext context) => scaffold('Emails & Calendar', (d) {
    final accounts = maps(d['accounts']);
    final calendars = maps(d['calendars']);
    return [
      if (str(d['error']).isNotEmpty) _Banner(str(d['error'])),
      for (final p in const ['gmail', 'zoho']) ...[
        SectionLabel(p == 'gmail' ? 'Gmail' : 'Zoho Mail'),
        for (final a in accounts.where((a) => a['provider'] == p))
          _AccountCard(a: a, calendars: calendars.where((c) => c['accountId'] == a['id']).toList(), memberNames: mapOf(d['memberNames']), state: this),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
          child: Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              icon: const Icon(Icons.add, size: 18),
              label: Text(
                accounts.any((a) => a['provider'] == p)
                    ? 'Add another ${p == 'gmail' ? 'Gmail' : 'Zoho'} account'
                    : 'Connect ${p == 'gmail' ? 'Gmail' : 'Zoho'}',
              ),
              onPressed: busy ? null : () => run(p == 'gmail' ? 'connectGmail' : 'connectZoho'),
            ),
          ),
        ),
        _Credentials(provider: p, d: d, state: this),
      ],
    ];
  });
}

class _Banner extends StatelessWidget {
  const _Banner(this.text);
  final String text;
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: c.errorContainer, borderRadius: BorderRadius.circular(8)),
      child: Text(text, style: TextStyle(color: c.onErrorContainer)),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, {this.ok = false});
  final String text;
  final bool ok;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(color: ok ? const Color(0x1F0F7F74) : const Color(0x1FA1752A), borderRadius: BorderRadius.circular(99)),
    child: Text(
      text,
      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: ok ? AppColors.follow : AppColors.action),
    ),
  );
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.a, required this.calendars, required this.memberNames, required this.state});
  final Map<String, dynamic> a;
  final List<Map<String, dynamic>> calendars;
  final Map<String, dynamic> memberNames;
  final _EmailSettingsState state;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final id = str(a['id']);
    final gmail = a['provider'] == 'gmail';
    final full = a['canModify'] == true && a['canSend'] == true && (!gmail || a['canFilter'] == true);
    final err = str(a['lastError']), calErr = str(a['calendarError']);
    final hasCal = a['calendar'] == true, calOn = hasCal && a['calendarOff'] != true;
    final busy = state.busy;
    final sub =
        '${numOf(a['messages']).toInt()} emails · ${(a['folders'] as List? ?? const []).length} ${gmail ? 'labels' : 'folders'} · '
        '${str(a['lastSync']).isEmpty ? 'not synced yet' : 'synced ${when(a['lastSync'])}'}';

    return Card(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        initiallyExpanded: err.isNotEmpty,
        shape: const Border(),
        leading: Icon(Icons.circle, size: 12, color: err.isNotEmpty ? t.colorScheme.error : (a['paused'] == true ? t.disabledColor : const Color(0xFF2FB96B))),
        title: Text(
          str(a['email']).isEmpty ? id : str(a['email']),
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Wrap(
              spacing: 4,
              runSpacing: 2,
              children: [
                _Pill(full ? 'Full access' : 'Read-only', ok: full),
                if (calOn && a['calendarWrite'] == true) const _Pill('Calendar editing', ok: true),
                if (str(a['ownerId']).isNotEmpty) _Pill("${str(memberNames[a['ownerId']]).isEmpty ? 'Family' : str(memberNames[a['ownerId']])}'s"),
              ],
            ),
            const SizedBox(height: 2),
            Text(sub, style: t.textTheme.bodySmall),
            if (err.isNotEmpty) Text(err, style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.error)),
            if (calErr.isNotEmpty) Text('Calendar: $calErr', style: t.textTheme.bodySmall?.copyWith(color: t.colorScheme.error)),
          ],
        ),
        childrenPadding: const EdgeInsets.only(bottom: 8),
        children: [
          if (err.isNotEmpty || !full)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
              child: Row(
                children: [
                  // Reconnect and Allow changes are the same consent (full access, keeps calendar if granted).
                  FilledButton.icon(
                    icon: Icon(err.isNotEmpty ? Icons.link : Icons.lock_open, size: 18),
                    label: Text(err.isNotEmpty ? 'Reconnect' : 'Allow changes'),
                    onPressed: busy ? null : () => state.run('allowChanges', fields: {'id': id}),
                  ),
                ],
              ),
            ),
          SwitchListTile(
            secondary: const Icon(Icons.mail_outline),
            title: const Text('Email'),
            value: a['paused'] != true,
            onChanged: busy ? null : (v) => state._sync(id, 'mail', v),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.calendar_month_outlined),
            title: const Text('Calendar'),
            subtitle: hasCal ? null : Text('Opens ${gmail ? 'Google' : 'Zoho'} to allow access'),
            value: calOn,
            onChanged: busy ? null : (v) => hasCal ? state._sync(id, 'calendar', v) : (v ? state.run('enableCalendar', fields: {'id': id}) : null),
          ),
          if (calOn && a['calendarWrite'] != true)
            ListTile(
              contentPadding: const EdgeInsets.only(left: 72, right: 16),
              title: const Text('Allow event editing'),
              trailing: const Icon(Icons.open_in_new, size: 16),
              onTap: busy ? null : () => state.run('enableCalendar', fields: {'id': id}),
            ),
          if (calOn)
            for (final c in calendars)
              CheckboxListTile(
                dense: true,
                contentPadding: const EdgeInsets.only(left: 72, right: 16),
                secondary: Icon(Icons.circle, size: 10, color: hexColor(str(c['color']))),
                controlAffinity: ListTileControlAffinity.trailing,
                title: Text(str(c['name'])),
                value: c['enabled'] == true,
                onChanged: busy ? null : (v) => state.run('toggleCalendar', fields: {'id': c['id'], 'on': (v ?? false).toString()}),
              ),
          if (gmail)
            SwitchListTile(
              secondary: const Icon(Icons.person_outline),
              title: const Text('Contacts'),
              subtitle: a['contacts'] == true ? null : const Text('Opens Google to allow read-only access'),
              value: a['contacts'] == true && a['contactsOff'] != true,
              onChanged: busy
                  ? null
                  : (v) => a['contacts'] == true ? state._sync(id, 'contacts', v) : (v ? state.run('enableContacts', fields: {'id': id}) : null),
            ),
          const Divider(height: 8),
          Wrap(
            spacing: 4,
            children: [
              TextButton.icon(
                icon: const Icon(Icons.refresh, size: 18),
                label: Text('Reload ${gmail ? 'labels' : 'folders'}'),
                onPressed: busy ? null : () => state.run('refreshAccount', fields: {'id': id}, done: 'Reloaded.'),
              ),
              if (hasCal)
                TextButton(
                  onPressed: busy
                      ? null
                      : () async {
                          if (await state.confirm("Remove this account's synced calendar data from AadOS?", ok: 'Clear', danger: true)) {
                            state.run('clearCalendar', fields: {'id': id}, done: 'Calendar data cleared.');
                          }
                        },
                  child: Text('Clear calendar', style: TextStyle(color: t.colorScheme.error)),
                ),
              TextButton(
                onPressed: busy
                    ? null
                    : () async {
                        if (await state.confirm(
                          'Remove all synced emails of this account from AadOS?',
                          body: 'A sync brings them back. The mailbox is not changed.',
                          ok: 'Clear',
                          danger: true,
                        )) {
                          final r = await state.run('purgeAccountData', fields: {'id': id});
                          if (r != null && state.mounted) toast(state.context, '${numOf(r['removed']).toInt()} stored emails removed.');
                        }
                      },
                child: Text('Clear data', style: TextStyle(color: t.colorScheme.error)),
              ),
              TextButton(
                onPressed: busy
                    ? null
                    : () async {
                        if (await state.confirm(
                          'Disconnect ${str(a['email'])}?',
                          body: 'Views on this account stay, paused. Connect again to resume.',
                          ok: 'Disconnect',
                          danger: true,
                        )) {
                          state.run('disconnectAccount', fields: {'id': id}, done: 'Disconnected.');
                        }
                      },
                child: Text('Disconnect', style: TextStyle(color: t.colorScheme.error)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Google Cloud / Zoho API Console client credentials. The secret is never sent back; blank keeps the saved one.
class _Credentials extends StatefulWidget {
  const _Credentials({required this.provider, required this.d, required this.state});
  final String provider;
  final Map<String, dynamic> d;
  final _EmailSettingsState state;
  @override
  State<_Credentials> createState() => _CredentialsState();
}

class _CredentialsState extends State<_Credentials> {
  final _id = TextEditingController(), _secret = TextEditingController();
  String _dc = 'com';

  @override
  void initState() {
    super.initState();
    _dc = str(widget.d['dataCenter']).isEmpty ? 'com' : str(widget.d['dataCenter']);
  }

  @override
  void dispose() {
    _id.dispose();
    _secret.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final gmail = widget.provider == 'gmail';
    final configured = widget.d[gmail ? 'gmailConfigured' : 'configured'] == true;
    final redirect = str(widget.d[gmail ? 'gmailRedirect' : 'zohoRedirect']);
    return ExpansionTile(
      initiallyExpanded: !configured,
      leading: const Icon(Icons.key_outlined),
      title: Text(gmail ? 'Google OAuth app' : 'Zoho API Console app'),
      subtitle: Text(configured ? 'Saved' : 'Not set up'),
      children: [
        Field(_id, 'Client ID', hint: configured ? 'Enter again to change' : null),
        Field(_secret, 'Client secret', secret: true, hint: configured ? 'Saved — leave blank to keep' : null),
        if (!gmail)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
            child: DropdownButtonFormField<String>(
              initialValue: _dc,
              decoration: const InputDecoration(labelText: 'Data center', border: OutlineInputBorder(), isDense: true),
              items: [
                for (final v in const ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa']) DropdownMenuItem(value: v, child: Text(v)),
              ],
              onChanged: (v) => setState(() => _dc = v ?? 'com'),
            ),
          ),
        ListTile(
          title: const Text('Redirect URI'),
          subtitle: Text(redirect, style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
          trailing: IconButton(
            icon: const Icon(Icons.copy, size: 18),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: redirect));
              toast(context, 'Copied.');
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.tonal(
              onPressed: widget.state.busy
                  ? null
                  : () async {
                      final r = await widget.state.run(
                        gmail ? 'saveGmail' : 'saveZoho',
                        fields: {'clientId': _id.text.trim(), 'clientSecret': _secret.text.trim(), if (!gmail) 'dataCenter': _dc},
                        done: 'Saved.',
                      );
                      if (r != null) _secret.clear();
                    },
              child: const Text('Save'),
            ),
          ),
        ),
      ],
    );
  }
}
