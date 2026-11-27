import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/scope.dart';
import '../core/ui.dart';
import 'settings_api.dart';

const _labels = {
  'emails': 'Emails',
  'messages': 'Messages',
  'contacts': 'Contacts',
  'finance': 'Finance',
  'calendar': 'Calendar',
  'asana': 'Asana',
  'documents': 'Documents',
  'assistant': 'Assistant',
};

/// Settings → Family: member logins, the sections and mailboxes each may see, passwords.
class FamilySettingsScreen extends StatefulWidget {
  const FamilySettingsScreen({super.key});
  @override
  State<FamilySettingsScreen> createState() => _FamilyState();
}

class _FamilyState extends SettingsPageState<FamilySettingsScreen> {
  @override
  String get page => 'family';

  /// A generated password is shown once, right after it is created.
  Future<void> _showPassword(Map<String, dynamic> r) async {
    final shown = mapOf(r['shown']);
    if (shown.isEmpty || !mounted) return;
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('Password for ${str(shown['username'])}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SelectableText(str(shown['password']), style: const TextStyle(fontFamily: 'monospace', fontSize: 16)),
            const SizedBox(height: 8),
            const Text('Copy it now; it is not shown again.'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Clipboard.setData(ClipboardData(text: str(shown['password']))),
            child: const Text('Copy'),
          ),
          FilledButton(onPressed: () => Navigator.pop(c), child: const Text('Done')),
        ],
      ),
    );
  }

  Future<void> _edit(Map<String, dynamic> d, [Map<String, dynamic>? m]) async {
    final fields = await Navigator.of(context).push<Map<String, Object?>>(
      MaterialPageRoute(
        builder: (_) => _MemberForm(d: d, m: m),
      ),
    );
    if (fields == null || !mounted) return;
    final r = await run(m == null ? 'create' : 'update', fields: fields, done: m == null ? 'Added ${fields['name']}.' : 'Saved.');
    if (r != null) await _showPassword(r);
  }

  Future<void> _password(Map<String, dynamic> m) async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('New password for ${str(m['name'])}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: c,
              obscureText: true,
              decoration: const InputDecoration(hintText: 'Empty = generate one'),
            ),
            const SizedBox(height: 8),
            Text('Signs ${str(m['name'])} out everywhere.', style: Theme.of(ctx).textTheme.bodySmall),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Set password')),
        ],
      ),
    );
    final pw = c.text;
    c.dispose();
    if (ok != true) return;
    final r = await run('password', fields: {'id': m['id'], 'password': pw}, done: 'Password set.');
    if (r != null) await _showPassword(r);
  }

  @override
  Widget build(BuildContext context) => scaffold(
    'Family',
    (d) {
      final members = maps(d['members']);
      final t = Theme.of(context);
      return [
        if (members.isEmpty)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('No family members yet. Each member signs in with their own username and sees only what you allow.'),
          ),
        for (final m in members)
          Opacity(
            opacity: m['disabled'] == true ? .55 : 1,
            child: ListTile(
              leading: CircleAvatar(child: Text(str(m['name']).isEmpty ? '?' : str(m['name'])[0].toUpperCase())),
              title: Text(str(m['name'])),
              subtitle: Text(
                [
                  '${str(m['username'])}${m['disabled'] == true ? ' · disabled' : ''}',
                  (m['permissions'] as List? ?? const []).map((p) => _labels[p] ?? p).join(', ').ifEmpty('No access'),
                  if (m['ownAccounts'] == true) 'Own accounts',
                  if ((m['permissions'] as List? ?? const []).contains('emails'))
                    m['mailboxes'] == 'all' ? 'All mail' : '${(m['mailboxes'] as List? ?? const []).length} mailboxes',
                ].join(' · '),
              ),
              isThreeLine: true,
              onTap: busy ? null : () => _edit(d, m),
              trailing: PopupMenuButton<String>(
                onSelected: (v) async {
                  switch (v) {
                    case 'access':
                      _edit(d, m);
                    case 'password':
                      _password(m);
                    case 'toggle':
                      run('toggle', fields: {'id': m['id']}, done: 'Saved.');
                    case 'remove':
                      if (await confirm("Remove ${str(m['name'])}'s login?", ok: 'Remove', danger: true)) {
                        run('remove', fields: {'id': m['id']}, done: 'Removed.');
                      }
                  }
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(value: 'access', child: Text('Access')),
                  const PopupMenuItem(value: 'password', child: Text('Password')),
                  PopupMenuItem(value: 'toggle', child: Text(m['disabled'] == true ? 'Enable' : 'Disable')),
                  PopupMenuItem(
                    value: 'remove',
                    child: Text('Remove', style: TextStyle(color: t.colorScheme.error)),
                  ),
                ],
              ),
            ),
          ),
      ];
    },
    fab: data == null
        ? null
        : FloatingActionButton.extended(onPressed: busy ? null : () => _edit(data!), icon: const Icon(Icons.person_add_alt), label: const Text('Add member')),
  );
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

/// Add or edit a member: name, login (new only), sections, mailboxes. Pops the form fields for the action.
class _MemberForm extends StatefulWidget {
  const _MemberForm({required this.d, this.m});
  final Map<String, dynamic> d;
  final Map<String, dynamic>? m;
  @override
  State<_MemberForm> createState() => _MemberFormState();
}

class _MemberFormState extends State<_MemberForm> {
  late final _name = TextEditingController(text: str(widget.m?['name']));
  final _user = TextEditingController(), _pw = TextEditingController();
  late final Set<String> _perms = {
    ...(widget.m?['permissions'] as List? ?? const ['calendar']).map(str),
  };
  late bool _all = widget.m?['mailboxes'] == 'all';
  late final Set<String> _boxes = {if (widget.m?['mailboxes'] is List) ...(widget.m!['mailboxes'] as List).map(str)};
  late bool _own = widget.m?['ownAccounts'] == true;

  @override
  void dispose() {
    _name.dispose();
    _user.dispose();
    _pw.dispose();
    super.dispose();
  }

  void _save() {
    if (_name.text.trim().isEmpty) return toast(context, 'Enter a name.');
    Navigator.pop<Map<String, Object?>>(context, {
      if (widget.m != null) 'id': widget.m!['id'],
      'name': _name.text.trim(),
      if (widget.m == null) ...{'username': _user.text.trim(), 'password': _pw.text},
      'perm': _perms.toList(),
      'allMail': _all,
      'mailbox': _all ? <String>[] : _boxes.toList(),
      'ownAccounts': _own,
    });
  }

  @override
  Widget build(BuildContext context) {
    final perms = (widget.d['permissions'] as List? ?? const []).map(str).toList();
    final accounts = maps(widget.d['accounts']);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.m == null ? 'Add member' : str(widget.m!['name'])),
        actions: [TextButton(onPressed: _save, child: const Text('Save'))],
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          Field(_name, 'Name'),
          if (widget.m == null) ...[
            Field(_user, 'Username', helper: '3–32 letters, digits, dot, dash or underscore'),
            Field(_pw, 'Password', secret: true, hint: 'Leave empty to generate'),
          ],
          const SectionLabel('Sections'),
          for (final p in perms)
            CheckboxListTile(
              dense: true,
              title: Text(_labels[p] ?? p),
              value: _perms.contains(p),
              onChanged: (v) => setState(() => v == true ? _perms.add(p) : _perms.remove(p)),
            ),
          const SectionLabel('Email & calendar accounts'),
          SwitchListTile(
            title: const Text('Can link their own email & calendar'),
            subtitle: const Text('Private to them'),
            value: _own,
            onChanged: (v) => setState(() => _own = v),
          ),
          CheckboxListTile(dense: true, title: const Text('All of my mailboxes'), value: _all, onChanged: (v) => setState(() => _all = v == true)),
          for (final a in accounts)
            CheckboxListTile(
              dense: true,
              enabled: !_all,
              title: Text('${a['provider'] == 'gmail' ? 'Gmail' : 'Zoho'} · ${str(a['email'])}'),
              value: _all || _boxes.contains(str(a['id'])),
              onChanged: (v) => setState(() => v == true ? _boxes.add(str(a['id'])) : _boxes.remove(str(a['id']))),
            ),
        ],
      ),
    );
  }
}
