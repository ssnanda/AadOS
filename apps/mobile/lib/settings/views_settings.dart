import 'package:flutter/material.dart';

import '../core/scope.dart';
import '../core/ui.dart';
import 'settings_api.dart';

const _types = {'shop': 'Shopping', 'health': 'Health', 'digest': 'Weekly review (AI)', 'generic': 'Custom'};
const _icons = {'shop': Icons.shopping_bag_outlined, 'health': Icons.favorite_border, 'digest': Icons.edit_note, 'generic': Icons.mail_outline};

/// Settings → Views: email views over folders/labels (pause, remove, weekly-review focus, add).
class ViewsSettingsScreen extends StatefulWidget {
  const ViewsSettingsScreen({super.key});
  @override
  State<ViewsSettingsScreen> createState() => _ViewsState();
}

class _ViewsState extends SettingsPageState<ViewsSettingsScreen> {
  @override
  String get page => 'views';

  Future<void> _focus(Map<String, dynamic> w) async {
    final c = TextEditingController(text: str(w['focus']));
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Keep only'),
        content: TextField(
          controller: c,
          minLines: 2,
          maxLines: 5,
          maxLength: 400,
          decoration: const InputDecoration(hintText: 'Empty = default focus'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    final text = c.text.trim();
    c.dispose();
    if (ok == true) run('focus', fields: {'id': w['id'], 'focus': text}, done: 'Saved.');
  }

  Future<void> _add(Map<String, dynamic> d) async {
    final fields = await Navigator.of(context).push<Map<String, Object?>>(MaterialPageRoute(builder: (_) => _AddView(accounts: maps(d['accounts']))));
    if (fields != null && mounted) run('create', fields: fields, done: 'View added.');
  }

  @override
  Widget build(BuildContext context) => scaffold(
    'Email views',
    (d) {
      final accounts = {for (final a in maps(d['accounts'])) str(a['id']): str(a['email'])};
      final counts = mapOf(d['itemCounts']);
      final views = maps(d['pipelines']);
      final t = Theme.of(context);
      return [
        if (views.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No views yet.')),
        for (final w in views)
          ListTile(
            leading: Icon(_icons[w['parser']] ?? Icons.mail_outline),
            title: Text(str(w['name'])),
            subtitle: Text(
              [
                maps(
                  w['folders'],
                ).map((f) => '${accounts[str(f['accountId']).isEmpty ? str(w['accountId']) : str(f['accountId'])] ?? ''} · ${str(f['name'])}').join(' + '),
                '${numOf(counts[w['id']]).toInt()} items · ${w['enabled'] == true ? 'auto sync' : 'paused'}${str(w['lastError']).isEmpty ? '' : ' · ${str(w['lastError'])}'}',
              ].join('\n'),
            ),
            isThreeLine: true,
            trailing: PopupMenuButton<String>(
              onSelected: (v) async {
                switch (v) {
                  case 'toggle':
                    run('toggle', fields: {'id': w['id']});
                  case 'focus':
                    _focus(w);
                  case 'remove':
                    if (await confirm(
                      'Remove “${str(w['name'])}”?',
                      body: 'Its ${numOf(counts[w['id']]).toInt()} stored copies leave AadOS; the mailbox is not changed.',
                      ok: 'Remove',
                      danger: true,
                    )) {
                      final r = await run('remove', fields: {'id': w['id']});
                      if (r != null && mounted) toast(this.context, 'View removed · ${numOf(r['removed']).toInt()} stored copies cleared.');
                    }
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(value: 'toggle', child: Text(w['enabled'] == true ? 'Pause' : 'Enable')),
                if (w['parser'] == 'digest') const PopupMenuItem(value: 'focus', child: Text('Focus')),
                if (w['system'] != true)
                  PopupMenuItem(
                    value: 'remove',
                    child: Text('Remove', style: TextStyle(color: t.colorScheme.error)),
                  ),
              ],
            ),
          ),
      ];
    },
    fab: data == null || maps(data!['accounts']).isEmpty
        ? null
        : FloatingActionButton.extended(onPressed: busy ? null : () => _add(data!), icon: const Icon(Icons.add), label: const Text('Add view')),
  );
}

/// New view: one or more folders/labels from any accounts, a type and an optional name / weekly-review focus.
class _AddView extends StatefulWidget {
  const _AddView({required this.accounts});
  final List<Map<String, dynamic>> accounts;
  @override
  State<_AddView> createState() => _AddViewState();
}

class _AddViewState extends State<_AddView> {
  final _name = TextEditingController(), _focus = TextEditingController();
  final _picked = <String>{};
  String _parser = 'shop';

  @override
  void dispose() {
    _name.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Add view'),
      actions: [
        TextButton(
          onPressed: _picked.isEmpty
              ? null
              : () => Navigator.pop<Map<String, Object?>>(context, {
                  'folder': _picked.toList(),
                  'parser': _parser,
                  'name': _name.text.trim(),
                  if (_parser == 'digest') 'focus': _focus.text.trim(),
                }),
          child: const Text('Add'),
        ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.only(bottom: 32),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
          child: DropdownButtonFormField<String>(
            initialValue: _parser,
            decoration: const InputDecoration(labelText: 'View type', border: OutlineInputBorder(), isDense: true),
            items: [for (final e in _types.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: (v) => setState(() => _parser = v ?? 'shop'),
          ),
        ),
        Field(_name, 'Name', hint: 'Use folder or label name'),
        if (_parser == 'digest') Field(_focus, 'Keep only', hint: 'Empty = default focus', lines: 2),
        for (final a in widget.accounts) ...[
          SectionLabel('${a['provider'] == 'gmail' ? 'Gmail' : 'Zoho'} · ${str(a['email'])}'),
          for (final f in maps(a['folders']))
            CheckboxListTile(
              dense: true,
              title: Text(str(f['path']).isEmpty ? str(f['name']) : str(f['path'])),
              value: _picked.contains('${a['id']}|${f['id']}'),
              onChanged: (v) => setState(() => v == true ? _picked.add('${a['id']}|${f['id']}') : _picked.remove('${a['id']}|${f['id']}')),
            ),
        ],
      ],
    ),
  );
}
