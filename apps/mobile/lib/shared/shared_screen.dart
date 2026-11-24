import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/ui.dart';
import '../email/body_view.dart';
import '../email/models.dart' show MessageBody;

/// Zoho shared mailboxes (hoa@, leads@ …), live from Zoho through /emails/shared/api — never stored.
class SharedApi {
  SharedApi(this.api);
  final Api api;
  Future<Map<String, dynamic>> op(String op, Map<String, dynamic> body, {Duration timeout = const Duration(seconds: 45)}) async =>
      mapOf(await api.post('/emails/shared/api', {'op': op, ...body}, timeout: timeout));
}

class SharedBox {
  SharedBox(this.accountId, this.account, Map<String, dynamic> j)
      : address = str(j['address']),
        name = str(j['name']),
        total = numOf(j['total']).toInt(),
        unread = numOf(j['unread']).toInt();
  final String accountId, account, address, name;
  final int total;
  int unread;
}

class SharedMsg {
  SharedMsg(this.j);
  final Map<String, dynamic> j;
  String get id => str(j['id']);
  String get subject => str(j['subject']);
  String get from => str(j['from']);
  String get to => str(j['to']);
  String get summary => str(j['summary']);
  DateTime? get at => numOf(j['at']) > 0 ? DateTime.fromMillisecondsSinceEpoch(numOf(j['at']).toInt()) : null;
  bool get unread => j['unread'] == true;
  set unread(bool v) => j['unread'] = v;
  bool get attachments => j['attachments'] == true;
}

/// Boxes per Zoho account with unread counts.
class SharedBoxesScreen extends StatefulWidget {
  const SharedBoxesScreen({super.key, required this.api});
  final Api api;
  @override
  State<SharedBoxesScreen> createState() => _SharedBoxesScreenState();
}

class _SharedBoxesScreenState extends State<SharedBoxesScreen> {
  late final SharedApi _api = SharedApi(widget.api);
  List<Map<String, dynamic>>? _accounts;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool fresh = false}) async {
    try {
      final r = await _api.op('boxes', {'fresh': fresh}, timeout: const Duration(seconds: 60));
      if (!mounted) return;
      setState(() {
        _accounts = maps(r['accounts']);
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = _accounts;
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Shared mailboxes')),
      body: a == null
          ? (_error.isNotEmpty ? ErrorPane(_error, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: () => _load(fresh: true),
              child: ListView(children: [
                if (a.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No Zoho account is connected.')),
                for (final acct in a) ...[
                  SectionLabel(str(acct['email'])),
                  if (str(acct['error']).isNotEmpty) ListTile(leading: Icon(Icons.error_outline, color: cs.error), title: Text(str(acct['error']))),
                  if (maps(acct['boxes']).isEmpty && str(acct['error']).isEmpty) const ListTile(title: Text('No shared mailboxes for this login.')),
                  for (final b in maps(acct['boxes']).map((j) => SharedBox(str(acct['accountId']), str(acct['email']), j)))
                    ListTile(
                      leading: const Icon(Icons.inbox_outlined),
                      title: Text(b.name, style: TextStyle(fontWeight: b.unread > 0 ? FontWeight.w800 : FontWeight.w500)),
                      subtitle: Text(b.address),
                      trailing: b.unread > 0 ? Badge(label: Text('${b.unread}'), backgroundColor: cs.primary) : Text('${b.total}', style: TextStyle(color: cs.onSurfaceVariant)),
                      onTap: () async {
                        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SharedListScreen(api: _api, box: b)));
                        _load(fresh: true);
                      },
                    ),
                ],
              ]),
            ),
    );
  }
}

/// One shared mailbox: Unread / All, swipe right = read/unread, swipe left = Trash, tap to read.
class SharedListScreen extends StatefulWidget {
  const SharedListScreen({super.key, required this.api, required this.box});
  final SharedApi api;
  final SharedBox box;
  @override
  State<SharedListScreen> createState() => _SharedListScreenState();
}

class _SharedListScreenState extends State<SharedListScreen> {
  final List<SharedMsg> _msgs = [];
  bool _unreadOnly = true, _loading = false;
  int? _next = 0;
  String _error = '';
  final _scroll = ScrollController();

  Map<String, dynamic> get _where => {'accountId': widget.box.accountId, 'address': widget.box.address};

  @override
  void initState() {
    super.initState();
    _load();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) _load(more: true);
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    if (_loading || (more && _next == null)) return;
    setState(() => _loading = true);
    try {
      final r = await widget.api.op('list', {..._where, 'unreadOnly': _unreadOnly, 'start': more ? _next : 0, 'limit': 50});
      if (!mounted) return;
      setState(() {
        if (!more) _msgs.clear();
        final seen = _msgs.map((m) => m.id).toSet();
        _msgs.addAll(maps(r['messages']).map(SharedMsg.new).where((m) => !seen.contains(m.id)));
        _next = r['next'] == null ? null : numOf(r['next']).toInt();
        _error = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<bool> setRead(SharedMsg m, bool read) async {
    final was = m.unread;
    setState(() {
      m.unread = !read;
      if (_unreadOnly && read) _msgs.remove(m);
    });
    final ok = await guarded(context, () => widget.api.op('read', {..._where, 'id': m.id, 'read': read}));
    if (ok == null && mounted) {
      setState(() {
        m.unread = was;
        if (!_msgs.contains(m)) _msgs.add(m);
      });
      return false;
    }
    return true;
  }

  Future<bool> trash(SharedMsg m) async {
    final i = _msgs.indexOf(m);
    setState(() => _msgs.remove(m));
    final ok = await guarded(context, () => widget.api.op('trash', {..._where, 'id': m.id}));
    if (ok == null && mounted) {
      setState(() => _msgs.insert(i.clamp(0, _msgs.length), m));
      return false;
    }
    return true;
  }

  Future<void> _open(int index) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => _SharedReader(list: this, start: index)));
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(widget.box.name), Text(widget.box.address, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant))]),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: SegmentedButton<bool>(
              showSelectedIcon: false,
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
              segments: const [ButtonSegment(value: true, label: Text('Unread')), ButtonSegment(value: false, label: Text('All'))],
              selected: {_unreadOnly},
              onSelectionChanged: (s) {
                setState(() => _unreadOnly = s.first);
                _load();
              },
            ),
          ),
        ],
      ),
      body: Column(children: [
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        if (_error.isNotEmpty) MaterialBanner(content: Text(_error), actions: [TextButton(onPressed: _load, child: const Text('Retry'))]),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: _msgs.isEmpty && !_loading
                ? ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(_unreadOnly ? 'No unread mail.' : 'No mail.')))])
                : ListView.separated(
                    controller: _scroll,
                    itemCount: _msgs.length,
                    separatorBuilder: (_, _) => Divider(height: 1, color: cs.outlineVariant.withValues(alpha: 0.5)),
                    itemBuilder: (context, i) {
                      final m = _msgs[i];
                      return Dismissible(
                        key: ValueKey(m.id),
                        background: Container(color: cs.primary, alignment: Alignment.centerLeft, padding: const EdgeInsets.only(left: 20), child: Icon(m.unread ? Icons.drafts_outlined : Icons.mark_email_unread_outlined, color: Colors.white)),
                        secondaryBackground: Container(color: cs.error, alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: 20), child: const Icon(Icons.delete_outline, color: Colors.white)),
                        confirmDismiss: (dir) async {
                          if (dir == DismissDirection.startToEnd) {
                            setRead(m, m.unread);
                          } else {
                            trash(m);
                          }
                          return false;
                        },
                        child: ListTile(
                          onTap: () => _open(i),
                          leading: CircleAvatar(radius: 18, backgroundColor: cs.primary.withValues(alpha: 0.12), child: Text(initials(m.from), style: TextStyle(color: cs.primary, fontWeight: FontWeight.w700, fontSize: 13))),
                          title: Row(children: [
                            Expanded(child: Text(displayName(m.from), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: m.unread ? FontWeight.w800 : FontWeight.w500))),
                            if (m.attachments) Icon(Icons.attach_file, size: 14, color: cs.onSurfaceVariant),
                            Text(' ${shortTime(m.at)}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                          ]),
                          subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(m.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: m.unread ? FontWeight.w700 : FontWeight.w400, color: cs.onSurface)),
                            Text(m.summary, maxLines: 2, overflow: TextOverflow.ellipsis),
                          ]),
                        ),
                      );
                    },
                  ),
          ),
        ),
      ]),
    );
  }
}

/// Reader with the mail app's flow: Delete / Unread move to the next message; swipe or ↑ ↓ to move; Reply from the box.
class _SharedReader extends StatefulWidget {
  const _SharedReader({required this.list, required this.start});
  final _SharedListScreenState list;
  final int start;
  @override
  State<_SharedReader> createState() => _SharedReaderState();
}

class _SharedReaderState extends State<_SharedReader> {
  late int _i = widget.start;
  SharedMsg? _m;
  MessageBody? _body;
  String _note = '';

  List<SharedMsg> get _msgs => widget.list._msgs;

  @override
  void initState() {
    super.initState();
    _show(_i);
  }

  Future<void> _show(int i) async {
    if (i < 0 || i >= _msgs.length) {
      Navigator.of(context).pop();
      return;
    }
    final m = _msgs[i];
    setState(() {
      _i = i;
      _m = m;
      _body = null;
      _note = '';
    });
    try {
      final r = await widget.list.widget.api.op('body', {...widget.list._where, 'id': m.id});
      if (!mounted || _m != m) return;
      setState(() {
        _body = MessageBody(str(r['html']), str(r['text']));
        _note = str(r['note']);
      });
    } on ApiException catch (e) {
      if (mounted && _m == m) {
        setState(() {
          _body = MessageBody('', m.summary);
          _note = e.message;
        });
      }
    }
    // Opening marks it read (in Zoho too), like the web; it stays in this list while the reader is open.
    if (m.unread && mounted) {
      m.unread = false;
      try {
        await widget.list.widget.api.op('read', {...widget.list._where, 'id': m.id, 'read': true});
      } on ApiException {
        m.unread = true;
      }
    }
  }

  void _advance({required bool removed}) {
    // The current message left the list: the next one now sits at the same index.
    if (removed) {
      if (_i >= _msgs.length) {
        Navigator.of(context).pop();
        return;
      }
      _show(_i);
    } else {
      _show(_i + 1);
    }
  }

  Future<void> _delete() async {
    final m = _m;
    if (m == null) return;
    if (await widget.list.trash(m)) _advance(removed: true);
  }

  Future<void> _unread() async {
    final m = _m;
    if (m == null) return;
    final before = _msgs.length;
    if (await widget.list.setRead(m, false)) _advance(removed: _msgs.length < before);
  }

  Future<void> _reply() async {
    final m = _m;
    if (m == null) return;
    final to = emailAddress(m.from) ?? m.from;
    final subject = RegExp(r'^\s*re:', caseSensitive: false).hasMatch(m.subject) ? m.subject : 'Re: ${m.subject}';
    final quoted = (_body?.text.isNotEmpty ?? false ? _body!.text : (_body?.html ?? '').replaceAll(RegExp(r'<[^>]*>'), ' ').replaceAll(RegExp(r'\s+'), ' ')).trim();
    final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _SharedCompose(list: widget.list, to: to, subject: subject, quote: '\n\n— On ${longTime(m.at)}, ${m.from} wrote:\n${quoted.length > 4000 ? quoted.substring(0, 4000) : quoted}'),
    ));
    if (sent == true && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Reply sent from ${widget.list.widget.box.address}.')));
  }

  @override
  Widget build(BuildContext context) {
    final m = _m;
    final cs = Theme.of(context).colorScheme;
    if (m == null) return const Scaffold();
    return Scaffold(
      appBar: AppBar(
        title: Text('${_i + 1} of ${_msgs.length}'),
        actions: [
          IconButton(tooltip: 'Previous', icon: const Icon(Icons.keyboard_arrow_up), onPressed: _i > 0 ? () => _show(_i - 1) : null),
          IconButton(tooltip: 'Next', icon: const Icon(Icons.keyboard_arrow_down), onPressed: _i < _msgs.length - 1 ? () => _show(_i + 1) : null),
        ],
      ),
      body: GestureDetector(
        onHorizontalDragEnd: (d) {
          final v = d.primaryVelocity ?? 0;
          if (v < -300 && _i < _msgs.length - 1) _show(_i + 1);
          if (v > 300 && _i > 0) _show(_i - 1);
        },
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(m.subject, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(m.from, style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('To ${m.to.isEmpty ? widget.list.widget.box.address : m.to} · ${longTime(m.at)}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
              if (_note.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_note, style: TextStyle(fontSize: 12, color: cs.error))),
            ]),
          ),
          const Divider(height: 1),
          Expanded(child: _body == null ? const Center(child: CircularProgressIndicator()) : EmailBodyView(key: ValueKey(m.id), body: _body!)),
        ]),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
          child: Row(children: [
            Expanded(child: TextButton.icon(icon: Icon(Icons.delete_outline, color: cs.error), label: Text('Delete', style: TextStyle(color: cs.error)), onPressed: _delete)),
            Expanded(child: TextButton.icon(icon: const Icon(Icons.mark_email_unread_outlined), label: const Text('Unread'), onPressed: _unread)),
            Expanded(child: FilledButton.tonalIcon(icon: const Icon(Icons.reply), label: const Text('Reply'), onPressed: _reply)),
          ]),
        ),
      ),
    );
  }
}

class _SharedCompose extends StatefulWidget {
  const _SharedCompose({required this.list, required this.to, required this.subject, required this.quote});
  final _SharedListScreenState list;
  final String to, subject, quote;
  @override
  State<_SharedCompose> createState() => _SharedComposeState();
}

class _SharedComposeState extends State<_SharedCompose> {
  late final _to = TextEditingController(text: widget.to);
  late final _subject = TextEditingController(text: widget.subject);
  late final _text = TextEditingController(text: widget.quote);
  bool _busy = false;

  @override
  void dispose() {
    _to.dispose();
    _subject.dispose();
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    final r = await guarded(context, () => widget.list.widget.api.op('send', {...widget.list._where, 'to': _to.text, 'subject': _subject.text, 'text': _text.text}, timeout: const Duration(seconds: 90)));
    if (!mounted) return;
    setState(() => _busy = false);
    if (r != null) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Reply'), actions: [
          Padding(padding: const EdgeInsets.only(right: 8), child: FilledButton.icon(onPressed: _busy ? null : _send, icon: const Icon(Icons.send, size: 18), label: const Text('Send'))),
        ]),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Text('From ${widget.list.widget.box.address}', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          TextField(controller: _to, decoration: const InputDecoration(labelText: 'To')),
          TextField(controller: _subject, decoration: const InputDecoration(labelText: 'Subject')),
          const SizedBox(height: 8),
          TextField(controller: _text, autofocus: true, minLines: 10, maxLines: null, decoration: const InputDecoration(border: OutlineInputBorder())),
        ]),
      );
}
