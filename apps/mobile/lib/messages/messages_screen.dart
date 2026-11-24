import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/ui.dart';

// Messages (iMessage / SMS) through BlueBubbles on the Mac, via AadOS (/messages/data + /messages/api).
// iOS gives no third-party app access to read or send iMessage/SMS in the background, so the Mac relay stays the
// source; the phone app is a native client for it.

/// Comparable key for a phone number or email (same rule as messages-model.ts addressKey).
String addressKey(String a) {
  final s = a.trim().toLowerCase();
  if (s.contains('@')) return s;
  final d = s.replaceAll(RegExp(r'\D'), '');
  return d.length > 10 ? d.substring(d.length - 10) : d;
}

String prettyAddress(String a) {
  final k = addressKey(a);
  return k.length == 10 && !k.contains('@') ? '(${k.substring(0, 3)}) ${k.substring(3, 6)}-${k.substring(6)}' : a;
}

class Chat {
  Chat(this.j);
  final Map<String, dynamic> j;
  String get guid => str(j['guid']);
  String get title => str(j['title']);
  List<String> get participants => [for (final p in (j['participants'] as List? ?? const [])) str(p)];
  bool get group => j['group'] == true;
  bool get sms => j['sms'] == true;
  bool get filtered => j['filtered'] == true;
  Map<String, dynamic> get last => mapOf(j['last']);
  DateTime? get at => numOf(last['at']) > 0 ? DateTime.fromMillisecondsSinceEpoch(numOf(last['at']).toInt()) : null;
}

class MessagesApi {
  MessagesApi(this.api);
  final Api api;
  Future<Map<String, dynamic>> data() async => mapOf(await api.get('/messages/data', timeout: const Duration(seconds: 60)));
  Future<Map<String, dynamic>> op(String op, Map<String, dynamic> body, {Duration timeout = const Duration(seconds: 45)}) async =>
      mapOf(await api.post('/messages/api', {'op': op, ...body}, timeout: timeout));
}

const _folders = [('main', 'Messages'), ('unknown', 'Unknown'), ('spam', 'Spam'), ('reports', 'Spam reports')];

class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key, required this.api});
  final Api api;
  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  late final MessagesApi _api = MessagesApi(widget.api);
  Map<String, dynamic>? _d;
  String _error = '', _folder = 'main', _q = '';
  bool _unreadOnly = false, _searching = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await _api.data();
      if (!mounted) return;
      setState(() {
        _d = d;
        _error = d['connected'] == false ? 'BlueBubbles is not set up. The owner connects it in Settings → Messages on the web.' : str(d['error']);
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Set<String> get _spam => {for (final s in (_d?['spam'] as List? ?? const [])) str(s)};
  Set<String> get _done => {for (final s in (_d?['spamDone'] as List? ?? const [])) str(s)};
  Set<String> get _unread => {for (final s in (_d?['unread'] as List? ?? const [])) str(s)};
  Map<String, dynamic> get _people => mapOf(_d?['people']);

  String nameOf(String address) => str(_people[addressKey(address)]).isNotEmpty ? str(_people[addressKey(address)]) : prettyAddress(address);
  String titleOf(Chat c) => c.title.isNotEmpty ? c.title : c.participants.map(nameOf).join(', ');

  String _folderOf(Chat c) {
    final keys = c.participants.map(addressKey).toList();
    if (keys.contains('7726')) return 'reports';
    if (!c.group && keys.any(_done.contains)) return 'reports';
    if (!c.group && keys.any(_spam.contains)) return 'spam';
    if (c.filtered) return 'unknown';
    return 'main';
  }

  List<Chat> _chats() {
    final all = [for (final c in maps(_d?['chats'])) Chat(c)];
    final q = _q.toLowerCase();
    final unread = _unread;
    return all.where((c) {
      if (q.isNotEmpty) return titleOf(c).toLowerCase().contains(q) || str(c.last['text']).toLowerCase().contains(q) || c.participants.any((p) => p.contains(q));
      return _folderOf(c) == _folder && (!_unreadOnly || unread.contains(c.guid));
    }).toList()
      ..sort((a, b) => numOf(b.last['at']).compareTo(numOf(a.last['at'])));
  }

  int _count(String folder) {
    final unread = _unread;
    return [for (final c in maps(_d?['chats'])) Chat(c)].where((c) => _folderOf(c) == folder && unread.contains(c.guid)).length;
  }

  Future<void> _open(Chat c) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ThreadScreen(api: _api, chat: c, title: titleOf(c), nameOf: nameOf, templates: maps(_d?['templates']), aiAvailable: _d?['aiAvailable'] == true)));
    _load();
  }

  Future<void> _new() async {
    final to = TextEditingController(), text = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('New message'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: to, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone number or email')),
          TextField(controller: text, minLines: 2, maxLines: 5, decoration: const InputDecoration(labelText: 'Message')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Send'))],
      ),
    );
    if (ok != true || !mounted) return;
    final r = await guarded(context, () => _api.op('newChat', {'address': to.text, 'text': text.text}, timeout: const Duration(seconds: 60)));
    if (r != null) _load();
  }

  Future<void> _spamToggle(Chat c, bool spam) async {
    final r = await guarded(context, () => _api.op('spam.set', {'addresses': c.participants, 'spam': spam}));
    if (r != null) _load();
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: _searching ? TextField(autofocus: true, decoration: const InputDecoration(hintText: 'Search conversations', border: InputBorder.none), onChanged: (v) => setState(() => _q = v)) : const Text('Messages'),
        actions: [
          IconButton(icon: Icon(_searching ? Icons.close : Icons.search), onPressed: () => setState(() {
                    _searching = !_searching;
                    _q = '';
                  })),
          IconButton(tooltip: 'Unread only', icon: Icon(_unreadOnly ? Icons.mark_chat_unread : Icons.mark_chat_unread_outlined), onPressed: () => setState(() => _unreadOnly = !_unreadOnly)),
        ],
      ),
      floatingActionButton: d?['connected'] == true ? FloatingActionButton(onPressed: _new, child: const Icon(Icons.edit_outlined)) : null,
      body: d == null
          ? (_error.isNotEmpty ? ErrorPane(_error, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : d['connected'] == false
              ? ErrorPane(_error, icon: Icons.sms_failed_outlined)
              : Column(children: [
                  if (!_searching)
                    SizedBox(
                      height: 44,
                      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6), children: [
                        for (final (id, label) in _folders)
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: ChoiceChip(visualDensity: VisualDensity.compact, label: Text(_count(id) > 0 ? '$label ${_count(id)}' : label), selected: _folder == id, onSelected: (_) => setState(() => _folder = id)),
                          ),
                      ]),
                    ),
                  if (_error.isNotEmpty) MaterialBanner(content: Text(_error), actions: [TextButton(onPressed: _load, child: const Text('Retry'))]),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: Builder(builder: (context) {
                        final list = _chats();
                        if (list.isEmpty) return ListView(children: const [Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No conversations.')))]);
                        final unread = _unread;
                        return ListView.separated(
                          padding: const EdgeInsets.only(bottom: 88),
                          itemCount: list.length,
                          separatorBuilder: (_, _) => Divider(height: 1, indent: 72, color: cs.outlineVariant.withValues(alpha: 0.5)),
                          itemBuilder: (context, i) {
                            final c = list[i];
                            final isUnread = unread.contains(c.guid);
                            final text = str(c.last['text']).isNotEmpty ? str(c.last['text']) : (maps(c.last['attachments']).isNotEmpty ? '📎 Attachment' : '');
                            return ListTile(
                              onTap: () => _open(c),
                              onLongPress: c.group
                                  ? null
                                  : () => showModalBottomSheet<void>(
                                        context: context,
                                        builder: (s) => SafeArea(
                                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                                            if (_folderOf(c) == 'spam' || _folderOf(c) == 'reports')
                                              ListTile(leading: const Icon(Icons.verified_outlined), title: const Text('Not spam'), onTap: () {
                                                Navigator.pop(s);
                                                _spamToggle(c, false);
                                              })
                                            else
                                              ListTile(leading: const Icon(Icons.report_outlined), title: const Text('Move to Spam'), onTap: () {
                                                Navigator.pop(s);
                                                _spamToggle(c, true);
                                              }),
                                          ]),
                                        ),
                                      ),
                              leading: CircleAvatar(
                                backgroundColor: (c.sms ? const Color(0xFF1E8E4E) : cs.primary).withValues(alpha: 0.14),
                                child: c.group ? Icon(Icons.group, color: cs.primary) : Text(initials(titleOf(c)), style: TextStyle(color: c.sms ? const Color(0xFF1E8E4E) : cs.primary, fontWeight: FontWeight.w700)),
                              ),
                              title: Row(children: [
                                if (isUnread) Container(width: 8, height: 8, margin: const EdgeInsets.only(right: 6), decoration: BoxDecoration(color: cs.primary, shape: BoxShape.circle)),
                                Expanded(child: Text(titleOf(c), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: isUnread ? FontWeight.w800 : FontWeight.w600))),
                                Text(shortTime(c.at), style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                              ]),
                              subtitle: Text('${c.last['fromMe'] == true ? 'You: ' : ''}$text', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: isUnread ? cs.onSurface : null)),
                            );
                          },
                        );
                      }),
                    ),
                  ),
                ]),
    );
  }
}

/// One conversation: bubbles (newest at the bottom), photos, canned replies, AI suggestion, send (SMS threads send as SMS).
class ThreadScreen extends StatefulWidget {
  const ThreadScreen({super.key, required this.api, required this.chat, required this.title, required this.nameOf, required this.templates, required this.aiAvailable});
  final MessagesApi api;
  final Chat chat;
  final String title;
  final String Function(String) nameOf;
  final List<Map<String, dynamic>> templates;
  final bool aiAvailable;
  @override
  State<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends State<ThreadScreen> {
  List<Map<String, dynamic>>? _msgs;
  String _error = '';
  bool _sending = false;
  final _text = TextEditingController();
  Timer? _timer;

  Chat get c => widget.chat;

  @override
  void initState() {
    super.initState();
    _load();
    widget.api.op('read', {'chatGuid': c.guid}).ignore();
    _timer = Timer.periodic(const Duration(seconds: 8), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await widget.api.op('thread', {'chatGuid': c.guid});
      if (!mounted) return;
      final list = maps(r['messages'])..sort((a, b) => numOf(a['at']).compareTo(numOf(b['at'])));
      final grew = (_msgs?.length ?? 0) != list.length;
      setState(() {
        _msgs = list;
        _error = '';
      });
      if (grew) widget.api.op('read', {'chatGuid': c.guid}).ignore();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send({bool sms = false}) async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    final asSms = sms || c.sms;
    final r = await guarded(context, () => widget.api.op('send', {
          'chatGuid': c.guid,
          'text': text,
          'sms': asSms,
          if (!c.group && c.participants.isNotEmpty) 'address': c.participants.first,
          'addresses': c.group ? <String>[] : c.participants,
        }, timeout: const Duration(seconds: 60)));
    if (!mounted) return;
    setState(() => _sending = false);
    if (r == null) return;
    _text.clear();
    final notes = [
      if (str(r['smsNote']).isNotEmpty) str(r['smsNote']),
      if (r['reported'] == true) 'Reported to 7726.' else if (r['spammed'] == true) 'Moved to Spam.',
    ];
    if (notes.isNotEmpty) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(notes.join(' '))));
    _load();
  }

  Future<void> _suggest() async {
    final r = await guarded(context, () => widget.api.op('suggest', {'chatGuid': c.guid}, timeout: const Duration(seconds: 90)));
    if (r == null || !mounted) return;
    _text.text = str(r['reply']);
    if (str(r['why']).isNotEmpty) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('✦ ${str(r['category'])}: ${str(r['why'])}')));
  }

  Future<void> _summary() async {
    final r = await guarded(context, () => widget.api.op('summary', {'chatGuid': c.guid}, timeout: const Duration(seconds: 90)));
    if (r == null || !mounted) return;
    showDialog<void>(context: context, builder: (d) => AlertDialog(title: const Text('✦ Summary'), content: SingleChildScrollView(child: SelectableText(str(r['text']))), actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Close'))]));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final msgs = _msgs;
    final api = widget.api.api;
    final headers = {if (api.token != null) 'authorization': 'Bearer ${api.token}'};
    final failed = msgs?.where((m) => m['fromMe'] == true).lastOrNull?['error'] == true;
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.title, overflow: TextOverflow.ellipsis),
          Text(c.group ? '${c.participants.length} people' : '${prettyAddress(c.participants.firstOrNull ?? '')} · ${c.sms ? 'SMS' : 'iMessage'}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
        ]),
        actions: [if (widget.aiAvailable) IconButton(tooltip: 'Summarize', icon: const Icon(Icons.auto_awesome_outlined), onPressed: _summary)],
      ),
      body: Column(children: [
        if (_error.isNotEmpty) MaterialBanner(content: Text(_error), actions: [TextButton(onPressed: _load, child: const Text('Retry'))]),
        Expanded(
          child: msgs == null
              ? const Center(child: CircularProgressIndicator())
              : ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  itemCount: msgs.length,
                  itemBuilder: (context, i) {
                    final m = msgs[msgs.length - 1 - i];
                    final prev = i + 1 < msgs.length ? msgs[msgs.length - 2 - i] : null;
                    final me = m['fromMe'] == true;
                    final at = DateTime.fromMillisecondsSinceEpoch(numOf(m['at']).toInt());
                    final showTime = prev == null || numOf(m['at']) - numOf(prev['at']) > 15 * 60 * 1000;
                    final showSender = c.group && !me && (prev == null || str(prev['sender']) != str(m['sender']) || prev['fromMe'] == true);
                    final bubble = me ? (str(m['service']) == 'SMS' || c.sms ? const Color(0xFF34C759) : const Color(0xFF0A84FF)) : cs.surfaceContainerHighest;
                    return Column(crossAxisAlignment: me ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
                      if (showTime) Center(child: Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(DateFormat('EEE, MMM d · h:mm a').format(at), style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)))),
                      if (showSender) Padding(padding: const EdgeInsets.only(left: 10, bottom: 2), child: Text(widget.nameOf(str(m['sender'])), style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant))),
                      for (final a in maps(m['attachments']))
                        Padding(
                          padding: const EdgeInsets.only(bottom: 3),
                          child: str(a['mime']).startsWith('image/') && !str(a['mime']).contains('svg')
                              ? ClipRRect(
                                  borderRadius: BorderRadius.circular(14),
                                  child: ConstrainedBox(
                                    constraints: const BoxConstraints(maxWidth: 240, maxHeight: 320),
                                    child: Image.network(api.uri('/messages/attachment/${Uri.encodeComponent(str(a['guid']))}').toString(), headers: headers, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined)),
                                  ),
                                )
                              : Chip(avatar: const Icon(Icons.attach_file, size: 16), label: Text(str(a['name']).isEmpty ? 'Attachment' : str(a['name']))),
                        ),
                      if (str(m['text']).isNotEmpty)
                        Container(
                          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.76),
                          margin: const EdgeInsets.only(bottom: 3),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(color: bubble, borderRadius: BorderRadius.circular(18)),
                          child: SelectableText(str(m['text']), style: TextStyle(color: me ? Colors.white : cs.onSurface, fontSize: 15)),
                        ),
                      if (me && m['error'] == true) Text('Not delivered', style: TextStyle(fontSize: 11, color: cs.error)),
                    ]);
                  },
                ),
        ),
        if (failed && !c.sms && !c.group)
          Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Align(alignment: Alignment.centerRight, child: TextButton.icon(icon: const Icon(Icons.sms_outlined), label: const Text('Send next as SMS'), onPressed: () => _send(sms: true)))),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(6, 4, 6, 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              PopupMenuButton<String>(
                tooltip: 'Replies',
                icon: const Icon(Icons.bolt_outlined),
                onSelected: (v) {
                  if (v == '__ai') {
                    _suggest();
                  } else {
                    _text.text = v;
                  }
                },
                itemBuilder: (_) => [
                  if (widget.aiAvailable) const PopupMenuItem(value: '__ai', child: Text('✦ Suggest a reply')),
                  for (final t in widget.templates) PopupMenuItem(value: str(t['text']), child: Text('${t['spam'] == true ? '⛔ ' : ''}${str(t['title'])}')),
                ],
              ),
              Expanded(
                child: TextField(
                  controller: _text,
                  minLines: 1,
                  maxLines: 5,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(hintText: c.sms ? 'Text Message' : 'iMessage', isDense: true, border: OutlineInputBorder(borderRadius: BorderRadius.circular(20))),
                ),
              ),
              IconButton(
                icon: _sending ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(Icons.arrow_upward_rounded, color: c.sms ? const Color(0xFF34C759) : const Color(0xFF0A84FF)),
                onPressed: _sending ? null : () => _send(),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}
