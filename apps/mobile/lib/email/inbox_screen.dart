import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/scope.dart';
import '../core/theme.dart';
import 'inbox_controller.dart';
import 'models.dart';
import 'reader_screen.dart';
import 'widgets.dart';

class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key, required this.inbox});
  final InboxController inbox;

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();
  final Set<String> _selected = {};
  bool _searching = false;

  InboxController get c => widget.inbox;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.extentAfter < 600) c.loadMore();
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _open(InboxQuery q) {
    _selected.clear();
    if (_scroll.hasClients) _scroll.jumpTo(0);
    c.open(q);
  }

  String get _title {
    final q = c.query, d = c.data;
    if (q.q.isNotEmpty) return '“${q.q}”';
    if (q.folder.isNotEmpty)
      return (d?.folderName.isNotEmpty ?? false)
          ? d!.folderName.replaceFirst(
              RegExp(r'^inbox/', caseSensitive: false),
              '',
            )
          : 'Folder';
    if (q.pipeline.isNotEmpty)
      return d?.views.where((v) => v.id == q.pipeline).firstOrNull?.name ??
          'View';
    if (q.account.isNotEmpty)
      return d?.accounts
              .where((a) => a.id == q.account)
              .firstOrNull
              ?.email
              .split('@')
              .first ??
          'Inbox';
    return 'All inboxes';
  }

  Future<void> _bulk(String op) async {
    final keys = _selected.toList();
    if (keys.isEmpty) return;
    if (op == 'delete' && keys.length > 1) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(
          title: Text('Move ${keys.length} emails to Trash?'),
          content: const Text('They go to the Gmail/Zoho Trash.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(d, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(d, true),
              child: const Text('Delete'),
            ),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(_selected.clear);
    final msg = switch (op) {
      'delete' => await c.delete(keys),
      'mark-read' => await c.setUnread(keys, false),
      'mark-unread' => await c.setUnread(keys, true),
      'important' => await c.setImportant(keys, true),
      'follow-up' => await c.setFollowUp(keys, true),
      'pending-action' => await c.review('actionable', keys),
      _ => await c.review('reviewed', keys),
    };
    if (mounted && msg.isNotEmpty) toast(context, msg);
  }

  Future<void> _openReader(int index) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            ReaderScreen(inbox: c, rows: [...c.rows], initialIndex: index),
      ),
    );
    if (mounted) c.load(quiet: true);
  }

  PreferredSizeWidget _appBar() {
    if (_selected.isNotEmpty) {
      return AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => setState(_selected.clear),
        ),
        title: Text('${_selected.length}'),
        actions: [
          IconButton(
            tooltip: 'Select all',
            icon: const Icon(Icons.select_all),
            onPressed: () =>
                setState(() => _selected.addAll(c.rows.map((r) => r.key))),
          ),
          IconButton(
            tooltip: 'Mark read',
            icon: const Icon(Icons.mark_email_read_outlined),
            onPressed: () => _bulk('mark-read'),
          ),
          IconButton(
            tooltip: 'Mark unread',
            icon: const Icon(Icons.mark_email_unread_outlined),
            onPressed: () => _bulk('mark-unread'),
          ),
          IconButton(
            tooltip: 'Delete',
            icon: const Icon(Icons.delete_outline, color: AppColors.danger),
            onPressed: () => _bulk('delete'),
          ),
          PopupMenuButton<String>(
            onSelected: _bulk,
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'important', child: Text('★ Important')),
              PopupMenuItem(value: 'follow-up', child: Text('＋ Follow-up')),
              PopupMenuItem(value: 'pending-action', child: Text('⚑ Pending action')),
              PopupMenuItem(value: 'reviewed', child: Text('✓ Reviewed')),
            ],
          ),
        ],
      );
    }
    if (_searching) {
      return AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            setState(() => _searching = false);
            if (c.query.q.isNotEmpty) {
              _search.clear();
              _open(c.query.copyWith(q: ''));
            }
          },
        ),
        title: TextField(
          controller: _search,
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(
            hintText: 'Search all accounts',
            border: InputBorder.none,
          ),
          onSubmitted: (v) => _open(
            c.query.copyWith(
              q: v.trim(),
              view: v.trim().isEmpty ? c.query.view : 'all',
            ),
          ),
        ),
      );
    }
    return AppBar(
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_title, maxLines: 1, overflow: TextOverflow.ellipsis),
          Text(
            _subtitle,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          tooltip: 'Search',
          icon: const Icon(Icons.search),
          onPressed: () => setState(() => _searching = true),
        ),
      ],
    );
  }

  String get _subtitle {
    if (c.syncing) return 'Checking for mail…';
    final checked = c.data?.accounts
        .map((a) => a.lastChecked)
        .whereType<DateTime>()
        .fold<DateTime?>(null, (p, d) => p == null || d.isAfter(p) ? d : p);
    final unread = c.count('unread');
    return '$unread unread${checked != null ? ' · checked ${shortTime(checked)}' : ''}';
  }

  Widget _savedTiles() {
    final d = c.data;
    final shopping = d?.views.where((v) => v.id == c.query.pipeline).firstOrNull?.parser == 'shop';
    if (d == null || !shopping || (d.savedCoupons.isEmpty && d.savedGiftCards.isEmpty)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
      child: Row(children: [
        if (d.savedCoupons.isNotEmpty)
          Expanded(child: _SavedTile(icon: Icons.local_offer_outlined, label: 'Coupon', count: d.savedCoupons.length, detail: 'Next expires ${d.savedCoupons.first.expiresOn}')),
        if (d.savedCoupons.isNotEmpty && d.savedGiftCards.isNotEmpty) const SizedBox(width: 8),
        if (d.savedGiftCards.isNotEmpty)
          Expanded(child: _SavedTile(icon: Icons.card_giftcard_outlined, label: 'Gift Card', count: d.savedGiftCards.length, detail: 'No expiry')),
      ]),
    );
  }

  Widget _filters() {
    final q = c.query;
    final chips = <Widget>[
      if (q.category.isNotEmpty)
        InputChip(
          label: Text(q.category),
          onDeleted: () => _open(q.copyWith(category: '')),
        ),
      if (q.sender.isNotEmpty)
        InputChip(
          label: Text(q.sender),
          onDeleted: () => _open(q.copyWith(sender: '')),
        ),
      if (q.thread.isNotEmpty)
        InputChip(
          avatar: const Icon(Icons.forum_outlined, size: 16),
          label: const Text('Conversation'),
          onDeleted: () => _open(q.copyWith(thread: '')),
        ),
    ];
    if (chips.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
      child: Wrap(spacing: 6, children: chips),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final d = c.data;
        final errors =
            d?.accounts.where((a) => a.lastError.isNotEmpty).toList() ??
            const [];
        return PopScope(
          canPop: _selected.isEmpty && !_searching,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop)
              setState(() {
                _selected.clear();
                _searching = false;
              });
          },
          child: Scaffold(
            appBar: _appBar(),
            drawer: _FolderDrawer(
              inbox: c,
              onOpen: (q) {
                Navigator.pop(context);
                _open(q);
              },
            ),
            body: Column(
              children: [
                if (c.syncing || c.loading)
                  const LinearProgressIndicator(minHeight: 2)
                else
                  const SizedBox(height: 2),
                _savedTiles(),
                _filters(),
                for (final a in errors) _Banner('${a.email}: ${a.lastError}'),
                if (c.error.isNotEmpty) _Banner(c.error),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () => c.sync(force: true),
                    child: c.rows.isEmpty
                        ? ListView(
                            children: [
                              SizedBox(
                                height: 320,
                                child: Center(
                                  child: c.loading
                                      ? const CircularProgressIndicator()
                                      : Text(
                                          d == null
                                              ? ''
                                              : (d.accounts.isEmpty
                                                    ? 'No accounts connected.\nConnect Gmail or Zoho in AadOS Settings → Emails.'
                                                    : (c.query.view == 'unread'
                                                          ? 'All caught up.'
                                                          : 'No messages match.')),
                                          textAlign: TextAlign.center,
                                        ),
                                ),
                              ),
                            ],
                          )
                        : ListView.separated(
                            controller: _scroll,
                            physics: const AlwaysScrollableScrollPhysics(),
                            itemCount: c.rows.length + (c.hasMore ? 1 : 0),
                            separatorBuilder: (_, _) =>
                                const Divider(height: 1, indent: 64),
                            itemBuilder: (context, i) {
                              if (i >= c.rows.length)
                                return const Padding(
                                  padding: EdgeInsets.all(20),
                                  child: Center(
                                    child: CircularProgressIndicator(),
                                  ),
                                );
                              final r = c.rows[i];
                              final selecting = _selected.isNotEmpty;
                              final tile = EmailTile(
                                row: r,
                                insight: d?.insights[r.key],
                                showAccount:
                                    c.query.account.isEmpty &&
                                    (d?.accounts.length ?? 0) > 1,
                                selected: _selected.contains(r.key),
                                selecting: selecting,
                                onTap: () => selecting
                                    ? setState(
                                        () => _selected.contains(r.key)
                                            ? _selected.remove(r.key)
                                            : _selected.add(r.key),
                                      )
                                    : _openReader(i),
                                onLongPress: () =>
                                    setState(() => _selected.add(r.key)),
                              );
                              if (selecting) return tile;
                              return Dismissible(
                                key: ValueKey(r.key),
                                background: swipeBackground(
                                  context,
                                  delete: false,
                                  unread: r.unread,
                                ),
                                secondaryBackground: swipeBackground(
                                  context,
                                  delete: true,
                                  unread: r.unread,
                                ),
                                confirmDismiss: (dir) async {
                                  if (dir == DismissDirection.startToEnd) {
                                    final msg = await c.setUnread([
                                      r.key,
                                    ], !r.unread);
                                    if (context.mounted && msg.isNotEmpty)
                                      toast(context, msg);
                                    return false;
                                  }
                                  return true;
                                },
                                onDismissed: (_) async {
                                  final msg = await c.delete([r.key]);
                                  if (context.mounted && msg.isNotEmpty)
                                    toast(context, msg);
                                },
                                child: tile,
                              );
                            },
                          ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _SavedTile extends StatelessWidget {
  const _SavedTile({required this.icon, required this.label, required this.count, required this.detail});
  final IconData icon;
  final String label, detail;
  final int count;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: const Color(0xFFFFF8E5), border: Border.all(color: const Color(0xFFE4D6A5)), borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          Icon(icon, color: const Color(0xFF80621A)),
          const SizedBox(width: 9),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontWeight: FontWeight.w800)), Text(detail, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: Color(0xFF806D3D)))])),
          Text('$count', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF55451E))),
        ]),
      );
}

class _Banner extends StatelessWidget {
  const _Banner(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.fromLTRB(12, 0, 12, 6),
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: AppColors.danger.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Text(
      text,
      style: const TextStyle(color: AppColors.danger, fontSize: 12.5),
    ),
  );
}

/// Accounts with their folders (unread counts) and saved views — the web sidebar's Emails menu.
class _FolderDrawer extends StatelessWidget {
  const _FolderDrawer({required this.inbox, required this.onOpen});
  final InboxController inbox;
  final void Function(InboxQuery) onOpen;

  @override
  Widget build(BuildContext context) {
    final d = inbox.data, q = inbox.query, t = Theme.of(context);
    Widget count(int n) => n > 0
        ? Text(
            '$n',
            style: TextStyle(
              color: t.colorScheme.primary,
              fontWeight: FontWeight.w700,
            ),
          )
        : const SizedBox.shrink();
    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(vertical: 8),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Text(
                'Mail',
                style: t.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.all_inbox_outlined),
              title: const Text('All inboxes'),
              trailing: count(inbox.count('unread')),
              selected: q.account.isEmpty && q.pipeline.isEmpty,
              onTap: () => onOpen(const InboxQuery()),
            ),
            for (final a in (d?.accounts ?? const <MailAccount>[]).where(
              (a) => a.unread > 0,
            )) ...[
              const Divider(),
              ListTile(
                leading: CircleAvatar(
                  radius: 13,
                  backgroundColor: AppColors.provider(
                    a.provider,
                  ).withValues(alpha: 0.15),
                  child: Text(
                    a.provider == 'gmail' ? 'G' : 'Z',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: AppColors.provider(a.provider),
                    ),
                  ),
                ),
                title: Text(
                  a.email,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: a.lastError.isNotEmpty
                    ? Text(
                        a.lastError,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.danger),
                      )
                    : null,
                trailing: count(a.unread),
                selected: q.account == a.id && q.folder.isEmpty,
                onTap: () => onOpen(InboxQuery(account: a.id)),
              ),
              for (final f in a.folders.where((f) => f.unread > 0))
                ListTile(
                  contentPadding: const EdgeInsets.only(left: 56, right: 16),
                  leading: const Icon(Icons.folder_outlined, size: 20),
                  title: Text(
                    f.name.replaceFirst(
                      RegExp(r'^inbox/', caseSensitive: false),
                      '',
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: count(f.unread),
                  selected: q.account == a.id && q.folder == f.id,
                  onTap: () => onOpen(InboxQuery(account: a.id, folder: f.id)),
                ),
            ],
            if ((d?.views ?? const []).isNotEmpty) ...[
              const Divider(),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
                child: Text(
                  'VIEWS',
                  style: t.textTheme.labelSmall?.copyWith(
                    letterSpacing: 1,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              for (final v in d!.views)
                ListTile(
                  leading: const Icon(Icons.filter_list),
                  title: Text(
                    v.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: count(v.unread),
                  selected: q.pipeline == v.id,
                  onTap: () => onOpen(InboxQuery(view: 'all', pipeline: v.id)),
                ),
            ],
            if ((d?.categoryCounts ?? const {}).isNotEmpty) ...[
              const Divider(),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
                child: Text(
                  'CATEGORIES',
                  style: t.textTheme.labelSmall?.copyWith(
                    letterSpacing: 1,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final cat in d!.categories.where(
                      (x) => (d.categoryCounts[x] ?? 0) > 0,
                    ))
                      ActionChip(
                        label: Text('$cat ${d.categoryCounts[cat]}'),
                        onPressed: () =>
                            onOpen(q.copyWith(view: 'all', category: cat)),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
