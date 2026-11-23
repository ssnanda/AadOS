import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/scope.dart';
import 'inbox_controller.dart';
import 'models.dart';
import 'widgets.dart';

/// "More from sender": other stored emails from the same address (or domain) in this account,
/// with read/delete per row and for all of them. Returns the rows + index to open, if one was tapped.
Future<(List<EmailRow>, int)?> showRelatedSheet(BuildContext context, {required InboxController inbox, required EmailRow row}) =>
    showModalBottomSheet<(List<EmailRow>, int)>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => _RelatedSheet(inbox: inbox, row: row),
    );

class _RelatedSheet extends StatefulWidget {
  const _RelatedSheet({required this.inbox, required this.row});
  final InboxController inbox;
  final EmailRow row;

  @override
  State<_RelatedSheet> createState() => _RelatedSheetState();
}

class _RelatedSheetState extends State<_RelatedSheet> {
  bool _domain = false, _busy = false;
  RelatedResult? _result;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _result = null;
      _error = '';
    });
    try {
      final r = await widget.inbox.mail.related(widget.row, domain: _domain);
      if (mounted) setState(() => _result = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _act(String op, List<EmailRow> rows) async {
    if (rows.isEmpty) return;
    if (op == 'delete' && rows.length > 1) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text('Move ${rows.length} emails to Trash?'),
          content: const Text('They go to the Gmail/Zoho Trash.'),
          actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Delete'))],
        ),
      );
      if (ok != true) return;
    }
    setState(() => _busy = true);
    final keys = rows.map((r) => r.key).toList();
    final msg = op == 'delete' ? await widget.inbox.delete(keys) : await widget.inbox.setUnread(keys, false);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (msg.isEmpty || op != 'delete') {
        if (op == 'delete') {
          _result!.rows.removeWhere((r) => keys.contains(r.key));
        } else {
          for (final r in rows) {
            r.unread = false;
          }
        }
      }
    });
    if (msg.isNotEmpty) toast(context, msg);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final r = _result;
    final who = r == null ? '' : (_domain ? '@${r.domain}' : (r.sender.isNotEmpty ? r.sender : displayName(widget.row.sender)));
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (context, scroll) => Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 8, 8),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('More from ${_domain ? 'domain' : 'sender'}', style: t.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                if (who.isNotEmpty) Text('$who · ${r!.total} email${r.total == 1 ? '' : 's'}', style: t.textTheme.bodySmall),
              ]),
            ),
            SegmentedButton<bool>(
              segments: const [ButtonSegment(value: false, label: Text('Sender')), ButtonSegment(value: true, label: Text('Domain'))],
              selected: {_domain},
              showSelectedIcon: false,
              onSelectionChanged: (v) {
                _domain = v.first;
                _load();
              },
            ),
          ]),
        ),
        if (r != null && r.rows.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(children: [
              TextButton.icon(onPressed: _busy ? null : () => _act('read', r.rows.where((x) => x.unread).toList()), icon: const Icon(Icons.mark_email_read_outlined), label: const Text('Mark all read')),
              const Spacer(),
              TextButton.icon(
                onPressed: _busy ? null : () => _act('delete', r.rows),
                icon: const Icon(Icons.delete_sweep_outlined, color: Colors.red),
                label: Text('Delete ${r.rows.length}', style: const TextStyle(color: Colors.red)),
              ),
            ]),
          ),
        const Divider(height: 1),
        Expanded(
          child: _error.isNotEmpty
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error, textAlign: TextAlign.center)))
              : r == null
                  ? const Center(child: CircularProgressIndicator())
                  : r.rows.isEmpty
                      ? const Center(child: Text('No other emails stored.'))
                      : ListView.separated(
                          controller: scroll,
                          itemCount: r.rows.length,
                          separatorBuilder: (_, _) => const Divider(height: 1, indent: 64),
                          itemBuilder: (_, i) {
                            final e = r.rows[i];
                            return Dismissible(
                              key: ValueKey(e.key),
                              direction: DismissDirection.endToStart,
                              background: swipeBackground(context, delete: true, unread: e.unread),
                              confirmDismiss: (_) async {
                                await _act('delete', [e]);
                                return false; // the list already dropped the row
                              },
                              child: EmailTile(row: e, onTap: () => Navigator.pop(context, (r.rows, i))),
                            );
                          },
                        ),
        ),
      ]),
    );
  }
}
