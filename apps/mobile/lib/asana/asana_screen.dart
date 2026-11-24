import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/ui.dart';
import 'asana_api.dart';

const _filters = [('due', 'Due'), ('incoming', 'Incoming'), ('todo', 'To do'), ('doing', 'Doing'), ('upcoming', 'Upcoming'), ('nodate', 'No date'), ('all', 'All')];

/// Asana tab: My Tasks, live. Tick = complete, swipe right = complete, swipe left = next stage
/// (Acknowledge → Start → Done). Tap for details, comments, subtasks, due date and the timer.
class AsanaScreen extends StatefulWidget {
  const AsanaScreen({super.key, required this.api, this.onCount});
  final AsanaApi api;

  /// Due/overdue count for the tab badge.
  final ValueChanged<int>? onCount;
  @override
  State<AsanaScreen> createState() => _AsanaScreenState();
}

class _AsanaScreenState extends State<AsanaScreen> with AutomaticKeepAliveClientMixin {
  AsanaData? _data;
  String _error = '', _filter = 'due', _q = '';
  bool _loading = false, _searching = false;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) setState(() => _loading = true);
    try {
      final d = await widget.api.load();
      if (!mounted) return;
      setState(() {
        _data = d;
        _error = d.error;
      });
      widget.onCount?.call(_due(d).length);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<AsanaTask> _due(AsanaData d) => d.tasks.where((t) => !t.completed && t.dueDay != null && t.dueDay!.compareTo(d.today) <= 0).toList();

  List<AsanaTask> _visible(AsanaData d) {
    final q = _q.toLowerCase();
    Iterable<AsanaTask> l = d.tasks.where((t) => !t.completed);
    if (q.isNotEmpty) {
      l = l.where((t) => t.name.toLowerCase().contains(q) || t.notes.toLowerCase().contains(q) || t.projects.any((p) => p.toLowerCase().contains(q)));
    } else {
      l = switch (_filter) {
        'due' => _due(d),
        'upcoming' => l.where((t) => t.dueDay != null && t.dueDay!.compareTo(d.today) > 0),
        'nodate' => l.where((t) => t.dueDay == null),
        'all' => l,
        _ => l.where((t) => t.stage == _filter),
      };
    }
    final list = l.toList()
      ..sort((a, b) {
        final x = a.dueDay ?? '9999', y = b.dueDay ?? '9999';
        if (x != y) return x.compareTo(y);
        final tx = a.dueTime, ty = b.dueTime;
        if (tx != null && ty != null) return tx.compareTo(ty);
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
    return list;
  }

  int _countFor(AsanaData d, String f) {
    final l = d.tasks.where((t) => !t.completed);
    return switch (f) {
      'due' => _due(d).length,
      'upcoming' => l.where((t) => t.dueDay != null && t.dueDay!.compareTo(d.today) > 0).length,
      'nodate' => l.where((t) => t.dueDay == null).length,
      'all' => l.length,
      _ => l.where((t) => t.stage == f).length,
    };
  }

  /// Optimistic: the row changes at once; on failure it comes back with the error.
  Future<void> _act(AsanaTask t, String op, Map<String, dynamic> body, {bool remove = false, String done = ''}) async {
    final d = _data;
    if (d == null) return;
    final i = d.tasks.indexOf(t);
    if (remove) setState(() => d.tasks.remove(t));
    final ok = await guarded(context, () => widget.api.op(op, {'gid': t.gid, ...body}));
    if (!mounted) return;
    if (ok == null) {
      if (remove && i >= 0) setState(() => d.tasks.insert(i.clamp(0, d.tasks.length), t));
      return;
    }
    if (done.isNotEmpty) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(done)));
    }
    _load(quiet: true);
  }

  void _complete(AsanaTask t) => _act(t, 'complete', {'completed': true}, remove: true, done: 'Completed “${t.name}”');

  void _advance(AsanaTask t) {
    final n = stageNext[t.stage ?? 'incoming'];
    if (n == null) return;
    if (n.$2 == 'done') return _complete(t);
    setState(() => t.j['sectionName'] = n.$2 == 'todo' ? 'To do' : 'Doing');
    _act(t, 'stage', {'stage': n.$2}, done: '${n.$1}: ${t.name}');
  }

  Future<void> _openTask(AsanaTask t) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => AsanaTaskScreen(api: widget.api, task: t, data: _data!)));
    if (changed == true) _load(quiet: true);
  }

  Future<void> _newTask() async {
    final d = _data;
    if (d == null) return;
    final created = await Navigator.of(context).push<bool>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => _NewTask(api: widget.api, data: d)));
    if (created == true) _load(quiet: true);
  }

  Future<void> _ai(String kind, String title) async {
    final ctl = ValueNotifier<String?>(null);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => ValueListenableBuilder<String?>(
        valueListenable: ctl,
        builder: (c, text, _) => SizedBox(
          height: MediaQuery.of(c).size.height * 0.7,
          child: ListView(padding: const EdgeInsets.fromLTRB(20, 0, 20, 24), children: [
            Text('✦ $title', style: Theme.of(c).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            text == null ? const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())) : SelectableText(text),
          ]),
        ),
      ),
    );
    try {
      final r = await widget.api.op('ai', {'kind': kind}, const Duration(seconds: 120));
      ctl.value = str(r['text']);
    } on ApiException catch (e) {
      ctl.value = e.message;
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final d = _data;
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: _searching
            ? TextField(autofocus: true, decoration: const InputDecoration(hintText: 'Search tasks', border: InputBorder.none), onChanged: (v) => setState(() => _q = v))
            : const Text('Asana'),
        actions: [
          IconButton(
            icon: Icon(_searching ? Icons.close : Icons.search),
            onPressed: () => setState(() {
              _searching = !_searching;
              _q = '';
            }),
          ),
          if (d?.aiAvailable ?? false)
            PopupMenuButton<String>(
              icon: const Icon(Icons.auto_awesome_outlined),
              onSelected: (k) => _ai(k, k == 'plan' ? 'Plan my day' : 'Summary'),
              itemBuilder: (_) => const [PopupMenuItem(value: 'plan', child: Text('✦ Plan my day')), PopupMenuItem(value: 'summary', child: Text('✦ Summarize my tasks'))],
            ),
        ],
      ),
      floatingActionButton: d?.connected == true ? FloatingActionButton(onPressed: _newTask, child: const Icon(Icons.add)) : null,
      body: d == null
          ? (_error.isNotEmpty ? ErrorPane(_error, onRetry: _load) : const Center(child: CircularProgressIndicator()))
          : !d.connected
              ? const ErrorPane('Asana is not connected. The owner connects it in Settings → Asana on the web.', icon: Icons.link_off)
              : Column(children: [
                  if (!_searching)
                    SizedBox(
                      height: 44,
                      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6), children: [
                        for (final (id, label) in _filters)
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: ChoiceChip(
                              visualDensity: VisualDensity.compact,
                              label: Text('$label ${_countFor(d, id)}'),
                              selected: _filter == id,
                              onSelected: (_) => setState(() => _filter = id),
                            ),
                          ),
                      ]),
                    ),
                  if (_loading) const LinearProgressIndicator(minHeight: 2),
                  if (_error.isNotEmpty) MaterialBanner(content: Text(_error), actions: [TextButton(onPressed: _load, child: const Text('Retry'))]),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: () => _load(quiet: true),
                      child: Builder(builder: (context) {
                        final list = _visible(d);
                        if (list.isEmpty) return ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(_filter == 'due' && _q.isEmpty ? 'Nothing due. 🎉' : 'No tasks.')))]);
                        return ListView.separated(
                          padding: const EdgeInsets.only(bottom: 88),
                          itemCount: list.length,
                          separatorBuilder: (_, _) => Divider(height: 1, indent: 52, color: cs.outlineVariant.withValues(alpha: 0.5)),
                          itemBuilder: (context, i) {
                            final t = list[i];
                            final next = stageNext[t.stage ?? 'incoming'];
                            return Dismissible(
                              key: ValueKey(t.gid),
                              background: Container(color: const Color(0xFF1E8E4E), alignment: Alignment.centerLeft, padding: const EdgeInsets.only(left: 20), child: const Icon(Icons.check, color: Colors.white)),
                              secondaryBackground: Container(color: cs.primary, alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: 20), child: Text(next?.$1 ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
                              confirmDismiss: (dir) async {
                                if (dir == DismissDirection.startToEnd) {
                                  _complete(t);
                                  return false; // the list itself removes the row
                                }
                                _advance(t);
                                return false;
                              },
                              child: TaskTile(task: t, today: d.today, timing: d.timers.containsKey(t.gid), onTap: () => _openTask(t), onComplete: () => _complete(t)),
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

String dueLabel(AsanaTask t, String today) {
  final d = t.dueDay;
  if (d == null) return '';
  final day = DateTime.parse(d), now = DateTime.parse(today);
  final diff = day.difference(now).inDays;
  final time = t.dueTime == null ? '' : ' ${DateFormat.jm().format(t.dueTime!)}';
  if (diff == 0) return 'Today$time';
  if (diff == 1) return 'Tomorrow$time';
  if (diff == -1) return 'Yesterday$time';
  if (diff < 0) return '${DateFormat.MMMd().format(day)} · ${-diff}d late';
  if (diff < 7) return '${DateFormat.E().format(day)}$time';
  return DateFormat.MMMd().format(day);
}

class TaskTile extends StatelessWidget {
  const TaskTile({super.key, required this.task, required this.today, required this.onTap, required this.onComplete, this.timing = false});
  final AsanaTask task;
  final String today;
  final VoidCallback onTap, onComplete;
  final bool timing;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final t = task;
    final late = t.dueDay != null && t.dueDay!.compareTo(today) < 0;
    final isToday = t.dueDay == today;
    final due = dueLabel(t, today);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
        child: Row(children: [
          IconButton(icon: Icon(Icons.radio_button_unchecked, color: cs.onSurfaceVariant), tooltip: 'Complete', onPressed: onComplete),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t.name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600), maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                if (due.isNotEmpty) Text(due, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: late ? cs.error : isToday ? const Color(0xFF1E8E4E) : cs.onSurfaceVariant)),
                if (t.sectionName.isNotEmpty) Text(t.sectionName, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                if (t.projects.isNotEmpty) Text(t.projects.first, style: TextStyle(fontSize: 12, color: cs.primary)),
                if (t.recurring) Icon(Icons.repeat, size: 13, color: cs.onSurfaceVariant),
                if (t.numSubtasks > 0) Text('☰ ${t.numSubtasks}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                if (timing) const Icon(Icons.timer, size: 14, color: Color(0xFFE0A21B)),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// One task: name, notes, due date, stage, timer, subtasks, comments.
class AsanaTaskScreen extends StatefulWidget {
  const AsanaTaskScreen({super.key, required this.api, required this.task, required this.data});
  final AsanaApi api;
  final AsanaTask task;
  final AsanaData data;
  @override
  State<AsanaTaskScreen> createState() => _AsanaTaskScreenState();
}

class _AsanaTaskScreenState extends State<AsanaTaskScreen> {
  late final TextEditingController _name = TextEditingController(text: widget.task.name);
  late final TextEditingController _notes = TextEditingController(text: widget.task.notes);
  final _comment = TextEditingController();
  Map<String, dynamic>? _detail;
  bool _changed = false, _busy = false;
  late bool _timing = widget.data.timers.containsKey(widget.task.gid);

  AsanaTask get t => widget.task;

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  @override
  void dispose() {
    _name.dispose();
    _notes.dispose();
    _comment.dispose();
    super.dispose();
  }

  Future<void> _loadDetail() async {
    try {
      final r = await widget.api.op('detail', {'gid': t.gid});
      if (mounted) setState(() => _detail = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => _detail = {'error': e.message});
    }
  }

  Future<bool> _do(String op, Map<String, dynamic> body, {String done = ''}) async {
    setState(() => _busy = true);
    final r = await guarded(context, () => widget.api.op(op, {'gid': t.gid, ...body}));
    if (!mounted) return false;
    setState(() => _busy = false);
    if (r == null) return false;
    _changed = true;
    if (done.isNotEmpty) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    if (r['task'] is Map) setState(() => t.j.addAll(mapOf(r['task'])));
    return true;
  }

  Future<void> _saveText() async {
    final name = _name.text.trim(), notes = _notes.text;
    if (name == t.name && notes == t.notes) return;
    if (name.isEmpty) return;
    await _do('update', {'name': name, 'notes': notes}, done: 'Saved');
  }

  Future<void> _due() async {
    final cur = t.dueDay != null ? DateTime.parse(t.dueDay!) : DateTime.now();
    final d = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2000), lastDate: DateTime(2100), helpText: 'Due date');
    if (d == null || !mounted) return;
    TimeOfDay? time;
    if (t.dueTime != null) time = TimeOfDay.fromDateTime(t.dueTime!);
    final day = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    final hm = time == null ? '' : '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
    final ok = await _do('due', {'day': day, 'time': hm});
    if (ok) setState(() => t.j['dueOn'] = day);
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final next = stageNext[t.stage ?? 'incoming'];
    final subs = maps(_detail?['subtasks']), comments = maps(_detail?['comments']);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        await _saveText();
        if (context.mounted) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Task'),
          actions: [
            if (t.permalink.isNotEmpty) IconButton(tooltip: 'Open in Asana', icon: const Icon(Icons.open_in_new), onPressed: () => launchUrl(Uri.parse(t.permalink), mode: LaunchMode.externalApplication)),
            PopupMenuButton<String>(
              onSelected: (v) async {
                if (v == 'delete') {
                  final sure = await showDialog<bool>(
                    context: context,
                    builder: (c) => AlertDialog(title: const Text('Delete this task in Asana?'), actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Delete'))]),
                  );
                  if (sure == true && await _do('delete', {}) && context.mounted) Navigator.of(context).pop(true);
                }
                if (v == 'help' && context.mounted) {
                  final r = await guarded(context, () => widget.api.op('ai', {'kind': 'help', 'gid': t.gid}, const Duration(seconds: 120)));
                  if (r != null && context.mounted) showDialog<void>(context: context, builder: (c) => AlertDialog(title: const Text('✦ How to get it done'), content: SingleChildScrollView(child: SelectableText(str(r['text']))), actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('Close'))]));
                }
              },
              itemBuilder: (_) => [if (widget.data.aiAvailable) const PopupMenuItem(value: 'help', child: Text('✦ Help me do this')), const PopupMenuItem(value: 'delete', child: Text('Delete task'))],
            ),
          ],
        ),
        body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          if (_busy) const LinearProgressIndicator(minHeight: 2),
          TextField(controller: _name, maxLines: null, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700), decoration: const InputDecoration(border: InputBorder.none, hintText: 'Task name'), onEditingComplete: _saveText),
          Wrap(spacing: 8, runSpacing: 8, children: [
            ActionChip(avatar: const Icon(Icons.event, size: 16), label: Text(t.dueDay == null ? 'Set due date' : dueLabel(t, widget.data.today)), onPressed: _due),
            if (t.sectionName.isNotEmpty) Chip(label: Text(t.sectionName), visualDensity: VisualDensity.compact),
            for (final p in t.projects) Chip(label: Text(p), visualDensity: VisualDensity.compact),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: FilledButton.icon(
                icon: const Icon(Icons.check),
                label: const Text('Complete'),
                onPressed: () async {
                  if (await _do('complete', {'completed': true}) && context.mounted) Navigator.of(context).pop(true);
                },
              ),
            ),
            const SizedBox(width: 8),
            if (next != null && next.$2 != 'done')
              Expanded(
                child: FilledButton.tonal(
                  onPressed: () async {
                    if (await _do('stage', {'stage': next.$2}, done: next.$1)) setState(() => t.j['sectionName'] = next.$2 == 'todo' ? 'To do' : 'Doing');
                  },
                  child: Text(next.$1),
                ),
              ),
          ]),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            icon: Icon(_timing ? Icons.stop_circle_outlined : Icons.timer_outlined, color: _timing ? cs.error : null),
            label: Text(_timing ? 'Stop timer (logs time as a comment)' : 'Start timer'),
            onPressed: () async {
              if (_timing) {
                final r = await guarded(context, () => widget.api.op('timerStop', {'gid': t.gid}));
                if (r != null && context.mounted) {
                  _changed = true;
                  setState(() => _timing = false);
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Logged ${(numOf(r['seconds']) / 60).round()} min')));
                  _loadDetail();
                }
              } else if (await _do('timerStart', {'name': t.name, 'toDoing': true}, done: 'Timer started')) {
                setState(() => _timing = true);
              }
            },
          ),
          const SectionLabel('Notes'),
          TextField(controller: _notes, minLines: 3, maxLines: null, decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Add notes'), onTapOutside: (_) => _saveText()),
          if (_detail == null) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
          if (_detail?['error'] != null) Padding(padding: const EdgeInsets.all(8), child: Text(str(_detail!['error']), style: TextStyle(color: cs.error))),
          if (subs.isNotEmpty) ...[
            const SectionLabel('Subtasks'),
            for (final s in subs)
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: s['completed'] == true,
                title: Text(str(s['name'])),
                onChanged: (v) async {
                  setState(() => s['completed'] = v == true);
                  final ok = await guarded(context, () => widget.api.op('complete', {'gid': str(s['gid']), 'completed': v == true}));
                  if (ok == null && mounted) setState(() => s['completed'] = v != true);
                },
              ),
          ],
          const SectionLabel('Comments'),
          for (final c in comments)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${str(c['author'] ?? c['by'])}${str(c['at'] ?? c['createdAt']).isNotEmpty ? ' · ${_ago(str(c['at'] ?? c['createdAt']))}' : ''}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: cs.onSurfaceVariant)),
                SelectableText(str(c['text'])),
              ]),
            ),
          Row(children: [
            Expanded(child: TextField(controller: _comment, minLines: 1, maxLines: 4, decoration: const InputDecoration(hintText: 'Add a comment', border: OutlineInputBorder(), isDense: true))),
            IconButton(
              icon: const Icon(Icons.send),
              onPressed: () async {
                final text = _comment.text.trim();
                if (text.isEmpty) return;
                if (await _do('comment', {'text': text})) {
                  _comment.clear();
                  _loadDetail();
                }
              },
            ),
          ]),
        ]),
      ),
    );
  }

  String _ago(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? '' : DateFormat('MMM d, h:mm a').format(d.toLocal());
  }
}

class _NewTask extends StatefulWidget {
  const _NewTask({required this.api, required this.data});
  final AsanaApi api;
  final AsanaData data;
  @override
  State<_NewTask> createState() => _NewTaskState();
}

class _NewTaskState extends State<_NewTask> {
  final _name = TextEditingController(), _notes = TextEditingController();
  late String _day = widget.data.today;
  String _project = '';
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    setState(() => _busy = true);
    final r = await guarded(context, () => widget.api.op('create', {'name': name, 'notes': _notes.text, 'day': _day, 'project': _project}));
    if (!mounted) return;
    setState(() => _busy = false);
    if (r != null) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('New task'), actions: [
          Padding(padding: const EdgeInsets.only(right: 8), child: FilledButton(onPressed: _busy ? null : _save, child: const Text('Create'))),
        ]),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          TextField(controller: _name, autofocus: true, textCapitalization: TextCapitalization.sentences, decoration: const InputDecoration(labelText: 'Task name', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                icon: const Icon(Icons.event, size: 18),
                label: Text(_day.isEmpty ? 'No due date' : DateFormat('EEE, MMM d').format(DateTime.parse(_day))),
                onPressed: () async {
                  final d = await showDatePicker(context: context, initialDate: _day.isEmpty ? DateTime.now() : DateTime.parse(_day), firstDate: DateTime(2000), lastDate: DateTime(2100));
                  if (d != null) setState(() => _day = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
                },
              ),
            ),
            if (_day.isNotEmpty) IconButton(tooltip: 'No due date', icon: const Icon(Icons.close), onPressed: () => setState(() => _day = '')),
          ]),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _project,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Project', border: OutlineInputBorder()),
            items: [const DropdownMenuItem(value: '', child: Text('My Tasks only')), for (final p in widget.data.projects) DropdownMenuItem(value: str(p['gid']), child: Text(str(p['name']), overflow: TextOverflow.ellipsis))],
            onChanged: (v) => setState(() => _project = v ?? ''),
          ),
          const SizedBox(height: 12),
          TextField(controller: _notes, minLines: 3, maxLines: 8, decoration: const InputDecoration(labelText: 'Notes', border: OutlineInputBorder(), alignLabelWithHint: true)),
        ]),
      );
}
