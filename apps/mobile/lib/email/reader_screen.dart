import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/scope.dart';
import '../core/theme.dart';
import 'apple_calendar.dart';
import 'body_view.dart';
import 'compose_screen.dart';
import 'inbox_controller.dart';
import 'mail_api.dart';
import 'models.dart';
import 'related_sheet.dart';
import 'widgets.dart';

/// Full-screen reader. Swipe left/right between emails of the list it was opened from (the web's ↑/↓).
/// Delete and "Keep unread" move on to the next email, like the web preview; their "& close" variants are in ⋯.
class ReaderScreen extends StatefulWidget {
  const ReaderScreen({
    super.key,
    required this.inbox,
    required this.rows,
    required this.initialIndex,
  });
  final InboxController inbox;
  final List<EmailRow> rows;
  final int initialIndex;

  @override
  State<ReaderScreen> createState() => _ReaderScreenState();
}

class _ReaderScreenState extends State<ReaderScreen> {
  late final List<EmailRow> _rows = [...widget.rows];
  late int _index = widget.initialIndex.clamp(0, _rows.length - 1);
  late final PageController _pages = PageController(initialPage: _index);
  final Map<String, Future<MessageBody>> _bodies = {};
  final Map<String, Future<MessageDetails>> _details = {};
  bool _finding = false;
  final _find = TextEditingController();
  String _term = '';

  MailApi get _mail => widget.inbox.mail;
  EmailRow get _row => _rows[_index];
  InboxPage? get _data => widget.inbox.data;

  @override
  void initState() {
    super.initState();
    _opened(_index);
  }

  @override
  void dispose() {
    _pages.dispose();
    _find.dispose();
    super.dispose();
  }

  final Set<String> _read = {};

  /// Showing an email loads its body without the prefetch flag, so the server marks it read (AadOS + mailbox).
  /// Neighbours (the next email, a half-swiped page) load with `prefetch` and stay unread.
  void _opened(int i) {
    final row = _rows[i];
    if (_read.add(row.key)) {
      final f = _mail.body(row);
      _bodies[row.key] ??= f;
      f.then((_) => widget.inbox.markSeen(row.key), onError: (Object _) {});
      row.unread = false;
    }
    if (i + 1 < _rows.length) _peek(_rows[i + 1]);
  }

  Future<MessageBody> _peek(EmailRow r) =>
      _bodies[r.key] ??= _mail.body(r, prefetch: true);

  Future<MessageDetails> _detailsOf(EmailRow r) {
    final f = _details[r.key] ??= _mail.details(r.key);
    f.then(
      (_) {},
      onError: (Object _) {
        _details.remove(r.key); // retry next time after a failure
      },
    );
    return f;
  }

  void _changed(int i) {
    setState(() {
      _index = i;
      _term = '';
      _find.clear();
      _finding = false;
    });
    _opened(i);
  }

  void _goTo(int i) {
    if (i < 0 || i >= _rows.length) return;
    _pages.jumpToPage(i);
    _changed(i);
  }

  // ---- actions ----
  Future<void> _delete({bool close = false}) async {
    final row = _row, at = _index;
    setState(() => _rows.removeAt(at));
    if (_rows.isEmpty || close) {
      Navigator.of(context).pop();
    } else {
      final i = at.clamp(0, _rows.length - 1);
      _pages.jumpToPage(i);
      _changed(i);
    }
    final msg = await widget.inbox.delete([row.key]);
    if (msg.isNotEmpty && mounted) {
      toast(context, msg);
      setState(() => _rows.insert(at.clamp(0, _rows.length), row));
    }
  }

  Future<void> _keepUnread({bool close = false}) async {
    final row = _row;
    row.unread = true;
    if (close || _index + 1 >= _rows.length) {
      Navigator.of(context).pop();
    } else {
      _goTo(_index + 1);
    }
    final msg = await widget.inbox.setUnread([row.key], true);
    if (msg.isNotEmpty && mounted) toast(context, msg);
  }

  Future<void> _run(Future<String> Function() action) async {
    final msg = await action();
    if (!mounted) return;
    if (msg.isNotEmpty) toast(context, msg);
    setState(() {});
  }

  Future<void> _saveCoupon() async {
    final date = await showDatePicker(context: context, initialDate: DateTime.now().add(const Duration(days: 30)), firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 3650)));
    if (date == null) return;
    final expiry = '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    await _run(() => widget.inbox.saveValue(_row.key, kind: 'coupon', expiry: expiry));
  }

  Future<T?> _busy<T>(Future<T> work) async {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );
    try {
      return await work;
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message);
      return null;
    } finally {
      if (mounted) Navigator.of(context, rootNavigator: true).pop();
    }
  }

  Future<void> _compose(
    String mode, {
    bool ai = false,
    bool residential = false,
  }) async {
    final row = _row;
    final draft = await _busy(
      residential
          ? _mail.prepareResidential(row.key)
          : _mail.prepare(row.key, mode),
    );
    if (draft == null || !mounted) return;
    final sent = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => ComposeScreen(
          mail: _mail,
          emailKey: row.key,
          draft: draft,
          aiReady: _data?.aiReady ?? false,
          aiBlocked: _data?.aiBlocked ?? '',
          startWithAi: ai,
        ),
      ),
    );
    if (sent != null && mounted) toast(context, sent);
  }

  Future<void> _replySheet() async {
    final row = _row;
    final details = _detailsOf(row);
    final aiReady = _data?.aiReady ?? false, aiBlocked = _data?.aiBlocked ?? '';
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.reply),
              title: const Text('Reply'),
              onTap: () => Navigator.pop(c, 'reply'),
            ),
            ListTile(
              leading: const Icon(Icons.reply_all),
              title: const Text('Reply all'),
              onTap: () => Navigator.pop(c, 'replyAll'),
            ),
            ListTile(
              leading: const Icon(Icons.forward),
              title: const Text('Forward'),
              onTap: () => Navigator.pop(c, 'forward'),
            ),
            ListTile(
              leading: Icon(
                Icons.auto_awesome,
                color: aiReady ? AppColors.ai : null,
              ),
              title: const Text('Reply using AI'),
              subtitle: aiReady
                  ? null
                  : Text(aiBlocked.isEmpty ? 'AI is not available' : aiBlocked),
              enabled: aiReady,
              onTap: () => Navigator.pop(c, 'ai'),
            ),
            ListTile(
              leading: Icon(
                Icons.auto_awesome_outlined,
                color: aiReady ? AppColors.ai : null,
              ),
              title: const Text('Reply all using AI'),
              enabled: aiReady,
              onTap: () => Navigator.pop(c, 'aiAll'),
            ),
            FutureBuilder<MessageDetails>(
              future: details,
              builder: (_, s) => s.data?.residential == true
                  ? ListTile(
                      leading: const Icon(Icons.home_work_outlined),
                      title: const Text('Reply with Residential Template'),
                      onTap: () => Navigator.pop(c, 'residential'),
                    )
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
    switch (choice) {
      case 'reply' || 'replyAll' || 'forward':
        await _compose(choice!);
      case 'ai':
        await _compose('reply', ai: true);
      case 'aiAll':
        await _compose('replyAll', ai: true);
      case 'residential':
        await _compose('reply', residential: true);
    }
  }

  Future<void> _showDetails() async {
    final d = await _busy(_detailsOf(_row));
    if (d == null || !mounted) return;
    final row = _row;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final (k, v) in [
                ('From', d.from),
                ('To', d.to),
                ('Cc', d.cc),
                ('Account', d.account),
                ('Date', longTime(row.receivedAt)),
              ])
                if (v.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 70,
                          child: Text(
                            k,
                            style: TextStyle(
                              color: Theme.of(c).colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                        Expanded(child: SelectableText(v)),
                      ],
                    ),
                  ),
              if (d.unsubscribeUrl.isNotEmpty ||
                  d.unsubscribeMailto.isNotEmpty) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  icon: const Icon(Icons.unsubscribe_outlined),
                  label: const Text('Unsubscribe'),
                  onPressed: () => launchUrl(
                    Uri.parse(
                      d.unsubscribeUrl.isNotEmpty
                          ? d.unsubscribeUrl
                          : d.unsubscribeMailto,
                    ),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _aiAsk(String op, String title) async {
    final text = await _busy(_mail.ask(op, _row.key));
    if (text == null || !mounted) return;
    showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(
          child: SelectableText(text.isEmpty ? 'No answer.' : text),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Future<void> _related() async {
    final opened = await showRelatedSheet(
      context,
      inbox: widget.inbox,
      row: _row,
    );
    if (opened == null || !mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ReaderScreen(
          inbox: widget.inbox,
          rows: opened.$1,
          initialIndex: opened.$2,
        ),
      ),
    );
  }

  void _menu(String v) {
    final row = _row;
    switch (v) {
      case 'delete-close':
        _delete(close: true);
      case 'unread-close':
        _keepUnread(close: true);
      case 'follow':
        _run(() => widget.inbox.setFollowUp([row.key], !row.followUp));
      case 'reviewed':
        _run(
          () => widget.inbox.review(
            row.needsAction ? 'reviewed' : 'clear-action',
            [row.key],
          ),
        );
      case 'actionable':
        _run(() => widget.inbox.review('actionable', [row.key]));
      case 'clear-action':
        _run(() => widget.inbox.review('clear-action', [row.key]));
      case 'save-coupon':
        _saveCoupon();
      case 'save-gift-card':
        _run(() => widget.inbox.saveValue(row.key, kind: 'gift-card'));
      case 'clear-saved-value':
        _run(() => widget.inbox.saveValue(row.key, kind: ''));
      case 'find':
        setState(() => _finding = true);
      case 'details':
        _showDetails();
      case 'summarize':
        _aiAsk('summarize', 'Summary');
      case 'followup-ai':
        _aiAsk('followup', 'Suggested follow-up');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_rows.isEmpty) return const Scaffold();
    final row = _row, aiReady = _data?.aiReady ?? false;
    return Scaffold(
      appBar: AppBar(
        title: _finding
            ? TextField(
                controller: _find,
                autofocus: true,
                textInputAction: TextInputAction.search,
                decoration: const InputDecoration(
                  hintText: 'Find in email',
                  border: InputBorder.none,
                ),
                onSubmitted: (v) => setState(() => _term = v),
                onChanged: (v) {
                  if (v.trim().length >= 2 || v.isEmpty)
                    setState(() => _term = v);
                },
              )
            : Text(
                '${_index + 1} of ${_rows.length}',
                style: const TextStyle(fontSize: 15),
              ),
        actions: [
          if (_finding)
            IconButton(
              icon: const Icon(Icons.close),
              onPressed: () => setState(() {
                _finding = false;
                _term = '';
                _find.clear();
              }),
            )
          else ...[
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_up),
              tooltip: 'Previous',
              onPressed: _index > 0 ? () => _goTo(_index - 1) : null,
            ),
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_down),
              tooltip: 'Next',
              onPressed: _index + 1 < _rows.length
                  ? () => _goTo(_index + 1)
                  : null,
            ),
            IconButton(
              icon: Icon(
                row.important ? Icons.star_rounded : Icons.star_outline_rounded,
                color: row.important ? AppColors.star : null,
              ),
              tooltip: row.important ? 'Not important' : 'Important',
              onPressed: () => _run(
                () => widget.inbox.setImportant([row.key], !row.important),
              ),
            ),
            PopupMenuButton<String>(
              onSelected: _menu,
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'delete-close',
                  child: ListTile(
                    leading: Icon(Icons.delete_outline),
                    title: Text('Delete & close'),
                  ),
                ),
                const PopupMenuItem(
                  value: 'unread-close',
                  child: ListTile(
                    leading: Icon(Icons.mark_email_unread_outlined),
                    title: Text('Unread & close'),
                  ),
                ),
                const PopupMenuDivider(),
                PopupMenuItem(
                  value: 'follow',
                  child: ListTile(
                    leading: const Icon(Icons.flag_outlined),
                    title: Text(
                      row.followUp ? 'Remove follow-up' : 'Follow-up',
                    ),
                  ),
                ),
                if (row.manuallyPending)
                  const PopupMenuItem(
                    value: 'clear-action',
                    child: ListTile(
                      leading: Icon(Icons.outlined_flag),
                      title: Text('Clear pending action'),
                    ),
                  )
                else if (row.action != null)
                  PopupMenuItem(
                    value: 'reviewed',
                    child: ListTile(
                      leading: const Icon(Icons.check_circle_outline),
                      title: Text(
                        row.needsAction ? 'Mark reviewed' : 'Reset action',
                      ),
                    ),
                  )
                else
                  const PopupMenuItem(
                    value: 'actionable',
                    child: ListTile(
                      leading: Icon(Icons.outlined_flag),
                      title: Text('Pending action'),
                    ),
                  ),
                const PopupMenuDivider(),
                if (row.savedKind.isNotEmpty)
                  const PopupMenuItem(
                    value: 'clear-saved-value',
                    child: ListTile(leading: Icon(Icons.bookmark_remove_outlined), title: Text('Remove saved item')),
                  )
                else ...[
                  const PopupMenuItem(
                    value: 'save-coupon',
                    child: ListTile(leading: Icon(Icons.local_offer_outlined), title: Text('Save as coupon')),
                  ),
                  const PopupMenuItem(
                    value: 'save-gift-card',
                    child: ListTile(leading: Icon(Icons.card_giftcard_outlined), title: Text('Save as gift card')),
                  ),
                ],
                const PopupMenuItem(
                  value: 'find',
                  child: ListTile(
                    leading: Icon(Icons.search),
                    title: Text('Find in email'),
                  ),
                ),
                const PopupMenuItem(
                  value: 'details',
                  child: ListTile(
                    leading: Icon(Icons.info_outline),
                    title: Text('Details & unsubscribe'),
                  ),
                ),
                if (aiReady) ...[
                  const PopupMenuDivider(),
                  const PopupMenuItem(
                    value: 'summarize',
                    child: ListTile(
                      leading: Icon(Icons.auto_awesome, color: AppColors.ai),
                      title: Text('Summarize'),
                    ),
                  ),
                  const PopupMenuItem(
                    value: 'followup-ai',
                    child: ListTile(
                      leading: Icon(Icons.auto_awesome, color: AppColors.ai),
                      title: Text('Suggest follow-up'),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
      body: PageView.builder(
        controller: _pages,
        itemCount: _rows.length,
        onPageChanged: _changed,
        itemBuilder: (_, i) {
          final r = _rows[i];
          return _EmailPage(
            key: ValueKey(r.key),
            row: r,
            body: _peek(r),
            insight: _data?.insights[r.key],
            find: i == _index ? _term : '',
            onCreateEvent: (draft) => AppleCalendar.create(context, draft),
          );
        },
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _BarButton(
                icon: Icons.delete_outline,
                label: 'Delete',
                color: AppColors.danger,
                onTap: _delete,
              ),
              _BarButton(
                icon: Icons.mark_email_unread_outlined,
                label: 'Unread',
                onTap: _keepUnread,
              ),
              _BarButton(icon: Icons.reply, label: 'Reply', onTap: _replySheet),
              _BarButton(
                icon: Icons.person_search_outlined,
                label: 'Sender',
                onTap: _related,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BarButton extends StatelessWidget {
  const _BarButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.onSurface;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: c),
              const SizedBox(height: 2),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  color: c,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmailPage extends StatelessWidget {
  const _EmailPage({
    super.key,
    required this.row,
    required this.body,
    required this.onCreateEvent,
    this.insight,
    this.find = '',
  });
  final EmailRow row;
  final Future<MessageBody> body;
  final Insight? insight;
  final String find;
  final ValueChanged<CalendarEventDraft> onCreateEvent;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context), cs = t.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                row.subject.isEmpty ? '(no subject)' : row.subject,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: t.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  height: 1.2,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  SenderAvatar(
                    sender: row.sender,
                    provider: row.provider,
                    size: 36,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          displayName(row.sender),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: t.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          [
                            emailAddress(row.sender) ?? '',
                            shortTime(row.receivedAt),
                          ].where((s) => s.isNotEmpty).join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: t.textTheme.bodySmall?.copyWith(
                            color: cs.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Tag(
                    row.accountEmail.split('@').first,
                    color: AppColors.provider(row.provider),
                  ),
                ],
              ),
              if (insight != null) ...[
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.ai.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '✦ ${insight!.category}${insight!.paymentDue != null ? ' · due ${insight!.paymentDue}' : ''}\n${insight!.summary}',
                    style: t.textTheme.bodySmall?.copyWith(
                      color: cs.onSurface,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
              if (row.needsAction || row.followUp) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  children: [
                    if (row.needsAction)
                      Tag(
                        row.due.isNotEmpty
                            ? '${row.actionLabel} · ${row.due}'
                            : row.actionLabel,
                        color: AppColors.action,
                      ),
                    if (row.followUp)
                      const Tag('Follow-up', color: AppColors.follow),
                  ],
                ),
              ],
              if (row.savedKind.isNotEmpty) ...[
                const SizedBox(height: 8),
                Tag(row.savedKind == 'coupon' ? 'Coupon · expires ${row.savedExpiry}' : 'Gift Card · no expiry', color: AppColors.star),
              ],
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: FutureBuilder<MessageBody>(
            future: body,
            builder: (context, s) {
              if (s.hasError) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      s.error.toString(),
                      textAlign: TextAlign.center,
                    ),
                  ),
                );
              }
              if (!s.hasData)
                return const Center(child: CircularProgressIndicator());
            final event = Platform.isIOS ? CalendarEventDraft.fromEmail(row, s.data!) : null;
              return Column(
                children: [
                  if (event != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                      child: SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.event_available_outlined),
                          label: const Text('Add event to Apple Calendar'),
                          onPressed: () => onCreateEvent(event),
                        ),
                      ),
                    ),
                  if (find.trim().length >= 2)
                    Container(
                      width: double.infinity,
                      color: const Color(0xFFFFF4C2),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 6,
                      ),
                      child: Text(
                        '${EmailBodyView.matches(s.data!, find)} match(es) highlighted',
                        style: const TextStyle(
                          color: Colors.black87,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  Expanded(
                    child: EmailBodyView(body: s.data!, find: find),
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}
