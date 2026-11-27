import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/scope.dart';
import 'mail_api.dart';

/// "Create rule…" from one open email or several selected emails.
/// The server proposes conditions (sender, recipients, subject text or a pattern shared by similar subjects; for one
/// email also its body text to pick a phrase from). The owner ticks/edits them, picks the action, where the rule lives
/// (AadOS for one account or all, a Gmail filter, or Zoho — shown disabled: Zoho's API has no filters) and Auto/Ask.
class RuleScreen extends StatefulWidget {
  const RuleScreen({super.key, required this.mail, required this.keys});
  final MailApi mail;
  final List<String> keys;

  static Future<void> open(BuildContext context, MailApi mail, List<String> keys) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => RuleScreen(mail: mail, keys: keys)));

  @override
  State<RuleScreen> createState() => _RuleScreenState();
}

class _Cond {
  _Cond({required this.field, required this.op, required String text, this.label = '', this.count = -1, this.picked = true}) : text = TextEditingController(text: text);
  String field, op, label;
  int count;
  bool picked;
  final TextEditingController text;
  Map<String, String> get json => {'field': field, 'op': op, 'text': text.text.trim()};
}

class _RuleScreenState extends State<RuleScreen> {
  bool _loading = true, _busy = false, _applyExisting = true, _keep = false;
  int _keepN = 2;
  String _error = '', _body = '', _match = 'all', _action = 'mark-read', _target = '', _mode = 'ask', _preview = '';
  Map<String, dynamic>? _dry; // dry run: {days, total, older, rows[]}
  final List<_Cond> _conds = [];
  List<Map<String, dynamic>> _targets = [], _actions = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _conds) {
      c.text.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await widget.mail.ruleDraft(widget.keys);
      setState(() {
        for (final c in (d['candidates'] as List? ?? []).cast<Map<String, dynamic>>()) {
          _conds.add(_Cond(field: '${c['field']}', op: '${c['op'] ?? 'contains'}', text: '${c['text']}', label: '${c['label'] ?? ''}', count: (c['count'] as num?)?.toInt() ?? -1, picked: c['picked'] == true));
        }
        _targets = (d['targets'] as List? ?? []).cast<Map<String, dynamic>>();
        _actions = (d['actions'] as List? ?? []).cast<Map<String, dynamic>>();
        _body = '${d['body'] ?? ''}';
        _action = '${d['action'] ?? 'mark-read'}';
        _keepN = (d['keepLatest'] as num?)?.toInt() ?? 0;
        _keep = _keepN > 0;
        if (_keepN < 1) _keepN = 2;
        _target = '${_targets.firstWhere((t) => t['disabled'] == null, orElse: () => const {'value': 'aados:'})['value']}';
        _loading = false;
      });
    } on ApiException catch (e) {
      setState(() { _error = e.message; _loading = false; });
    }
  }

  List<Map<String, String>> get _picked => [for (final c in _conds) if (c.picked && c.text.text.trim().isNotEmpty) c.json];
  bool get _gmail => _target.startsWith('gmail:');

  Map<String, dynamic> _rule(String op) => {
        'op': op, 'conditions': _picked, 'match': _match, 'action': _action, 'target': _target, 'mode': _mode,
        'applyExisting': _applyExisting && _target.startsWith('aados'),
        'keepLatest': _keep && !_gmail ? _keepN : 0,
      };

  /// Dry run: what the rule matches in the last [days] (0 = all mail). Nothing changes.
  Future<void> _check([int days = 7]) async {
    setState(() { _busy = true; _preview = ''; });
    try {
      final r = await widget.mail.ruleCall({..._rule('preview'), 'days': days});
      setState(() { _dry = r; _preview = ''; });
    } on ApiException catch (e) {
      setState(() { _dry = null; _preview = e.message; });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _dryRun(ThemeData t) {
    final d = _dry;
    const windows = [(7, '7 days'), (30, '30 days'), (90, '90 days'), (365, '1 year'), (0, 'All')];
    final days = (d?['days'] as num?)?.toInt();
    final total = (d?['total'] as num?)?.toInt() ?? 0, older = (d?['older'] as num?)?.toInt() ?? 0;
    final rows = (d?['rows'] as List? ?? []).cast<Map<String, dynamic>>();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const ListTile(title: Text('Dry run'), subtitle: Text('Emails this rule matches now. Nothing changes.'), dense: true),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Wrap(spacing: 6, children: [
          for (final (n, l) in windows) ChoiceChip(label: Text(l), selected: days == n, onSelected: _busy || _picked.isEmpty ? null : (_) => _check(n)),
        ]),
      ),
      if (d != null) ...[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Text('$total match${total == 1 ? '' : 'es'} ${days == 0 ? 'in all mail' : 'in the last $days days'}${older > 0 ? ' · $older older' : ''}', style: t.textTheme.titleSmall),
        ),
        if (total == 0 && older > 0)
          Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: TextButton(onPressed: () => _check(days == 7 ? 30 : days == 30 ? 90 : days == 90 ? 365 : 0), child: const Text('Look further back'))),
        for (final h in rows)
          ListTile(
            dense: true,
            title: Text('${h['subject']}'.isEmpty ? '(no subject)' : '${h['subject']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: h['unread'] == true ? FontWeight.w700 : FontWeight.w400)),
            subtitle: Text('${h['sender']} · ${h['accountEmail']} · ${_when('${h['receivedAt']}')}', maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: Text(
              h['wouldDelete'] == true ? '→ Trash' : h['wouldChange'] == true ? 'would change' : 'already done',
              style: TextStyle(fontSize: 12, color: h['wouldDelete'] == true ? t.colorScheme.error : h['wouldChange'] == true ? Colors.green.shade700 : t.hintColor),
            ),
          ),
        if (total > rows.length) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text('Showing the newest ${rows.length}.', style: t.textTheme.bodySmall)),
      ],
    ]);
  }

  String _when(String iso) {
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return '';
    return '${d.month}/${d.day} ${d.hour % 12 == 0 ? 12 : d.hour % 12}:${d.minute.toString().padLeft(2, '0')}${d.hour < 12 ? 'am' : 'pm'}';
  }

  Future<void> _create() async {
    if (_picked.isEmpty) { toast(context, 'Pick at least one condition.'); return; }
    setState(() => _busy = true);
    try {
      final r = await widget.mail.ruleCall(_rule('create'));
      if (!mounted) return;
      toast(context, '${r['message'] ?? 'Rule created.'}');
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _addCond(String field, String text, {String op = 'contains'}) => setState(() => _conds.add(_Cond(field: field, op: op, text: text, label: field == 'body' ? 'Body contains' : 'Custom')));

  Widget _condTile(_Cond c) {
    final t = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 12, 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Checkbox(value: c.picked, onChanged: (v) => setState(() => c.picked = v ?? false)),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              DropdownButton<String>(
                value: c.field, isDense: true, underline: const SizedBox(),
                items: const [DropdownMenuItem(value: 'from', child: Text('From')), DropdownMenuItem(value: 'subject', child: Text('Subject')), DropdownMenuItem(value: 'to', child: Text('To')), DropdownMenuItem(value: 'body', child: Text('Body'))],
                onChanged: (v) => setState(() => c.field = v ?? c.field),
              ),
              const SizedBox(width: 8),
              ChoiceChip(label: Text(c.op == 'regex' ? 'pattern' : 'contains'), selected: c.op == 'regex', visualDensity: VisualDensity.compact, onSelected: (on) => setState(() => c.op = on ? 'regex' : 'contains')),
              const Spacer(),
              if (c.count >= 0) Text('${c.count} match', style: t.textTheme.bodySmall),
            ]),
            TextField(controller: c.text, decoration: InputDecoration(isDense: true, hintText: c.op == 'regex' ? 'regular expression' : 'text', helperText: c.label.isEmpty ? null : c.label), style: const TextStyle(fontSize: 14), onChanged: (_) => setState(() {})),
          ]),
        ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final n = widget.keys.length;
    return Scaffold(
      appBar: AppBar(title: Text(n == 1 ? 'Rule from this email' : 'Rule from $n emails')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error)))
              : ListView(padding: const EdgeInsets.only(bottom: 120), children: [
                  ListTile(title: const Text('When'), subtitle: Text(n == 1 ? 'Tick what should match. Edit any text.' : 'What these emails have in common. Edit any text.'), dense: true),
                  for (final c in _conds) _condTile(c),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Wrap(spacing: 8, children: [
                      TextButton.icon(onPressed: () => _addCond('subject', ''), icon: const Icon(Icons.add), label: const Text('Condition')),
                      if (_picked.length > 1)
                        SegmentedButton<String>(
                          segments: const [ButtonSegment(value: 'all', label: Text('All match')), ButtonSegment(value: 'any', label: Text('Any matches'))],
                          selected: {_match}, showSelectedIcon: false, onSelectionChanged: (s) => setState(() => _match = s.first),
                        ),
                    ]),
                  ),
                  if (_body.isNotEmpty)
                    ExpansionTile(
                      title: const Text('Pick from the body'),
                      subtitle: const Text('Select text, then “Use in rule”'),
                      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      children: [
                        SelectableText(
                          _body, style: t.textTheme.bodySmall,
                          contextMenuBuilder: (ctx, s) => AdaptiveTextSelectionToolbar.buttonItems(
                            anchors: s.contextMenuAnchors,
                            buttonItems: [
                              ContextMenuButtonItem(label: 'Use in rule', onPressed: () {
                                final picked = s.textEditingValue.selection.textInside(s.textEditingValue.text).trim();
                                s.hideToolbar();
                                if (picked.isNotEmpty) _addCond('body', picked.length > 200 ? picked.substring(0, 200) : picked);
                              }),
                              ...s.contextMenuButtonItems,
                            ],
                          ),
                        ),
                      ],
                    ),
                  const Divider(),
                  ListTile(
                    title: const Text('Then'), dense: true,
                    trailing: DropdownButton<String>(
                      value: _actions.any((a) => a['value'] == _action) ? _action : null,
                      items: [for (final a in _actions) DropdownMenuItem(value: '${a['value']}', child: Text('${a['label']}'))],
                      onChanged: (v) => setState(() => _action = v ?? _action),
                    ),
                  ),
                  const Divider(),
                  const ListTile(title: Text('Where the rule lives'), dense: true),
                  RadioGroup<String>(
                    groupValue: _target,
                    onChanged: (v) => setState(() => _target = v ?? _target),
                    child: Column(children: [
                      for (final tg in _targets)
                        RadioListTile<String>(
                          value: '${tg['value']}', dense: true, enabled: tg['disabled'] == null,
                          title: Text('${tg['label']}'),
                          subtitle: tg['disabled'] != null ? Text('${tg['disabled']}') : (tg['value'] == _target && _gmail ? const Text('Runs inside Gmail on new mail. Contains-only, all conditions, mark read.') : null),
                        ),
                    ]),
                  ),
                  if (!_gmail) ...[
                    const Divider(),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: SegmentedButton<String>(
                        segments: const [ButtonSegment(value: 'ask', label: Text('Ask first')), ButtonSegment(value: 'auto', label: Text('Auto'))],
                        selected: {_mode}, showSelectedIcon: false, onSelectionChanged: (s) => setState(() => _mode = s.first),
                      ),
                    ),
                    CheckboxListTile(
                      value: _keep, dense: true,
                      title: Text('Keep only the newest $_keepN matching emails'),
                      subtitle: const Text('Older ones go to Trash. Undo with a shake.'),
                      secondary: _keep
                          ? Row(mainAxisSize: MainAxisSize.min, children: [
                              IconButton(icon: const Icon(Icons.remove), onPressed: _keepN > 1 ? () => setState(() => _keepN--) : null),
                              IconButton(icon: const Icon(Icons.add), onPressed: _keepN < 100 ? () => setState(() => _keepN++) : null),
                            ])
                          : null,
                      onChanged: (v) => setState(() => _keep = v ?? false),
                    ),
                    CheckboxListTile(value: _applyExisting, dense: true, title: const Text('Also apply to matching emails I already have'), subtitle: const Text('Undo with a shake'), onChanged: (v) => setState(() => _applyExisting = v ?? false)),
                  ],
                  const Divider(),
                  _dryRun(t),
                  if (_preview.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 0), child: Text(_preview, style: TextStyle(color: t.colorScheme.error))),
                ]),
      bottomNavigationBar: _loading || _error.isNotEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Row(children: [
                  OutlinedButton(onPressed: _busy || _picked.isEmpty ? null : () => _check(), child: const Text('Dry run')),
                  const SizedBox(width: 12),
                  Expanded(child: FilledButton(onPressed: _busy || _picked.isEmpty ? null : _create, child: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Create rule'))),
                ]),
              ),
            ),
    );
  }
}
