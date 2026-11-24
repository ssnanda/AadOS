import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../email/mail_api.dart';
import '../email/models.dart';
import '../email/widgets.dart';

/// Home: mail metrics, then Views, then Email (All inboxes and each account). Tapping anything opens it in Mail.
/// Uses the inbox API with no account picked, so its counts cover every mailbox (the "recent" list keeps the call small).
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, required this.mail, required this.onOpen});
  final MailApi mail;
  final void Function(InboxQuery) onOpen;

  @override
  State<DashboardScreen> createState() => DashboardScreenState();
}

class DashboardScreenState extends State<DashboardScreen> {
  static const _query = InboxQuery(view: 'recent');
  InboxPage? _data;
  String _error = '';
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    reload();
  }

  /// Fresh counts (the shell calls this whenever the tab is shown). [sync] first checks the mailboxes for new mail.
  Future<void> reload({bool sync = false}) async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      if (sync) await widget.mail.liveSync(const InboxQuery(), force: true);
      final d = await widget.mail.list(_query);
      if (mounted) setState(() { _data = d; _error = ''; });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  int _count(String key) => _data?.counts[key] ?? 0;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context), d = _data;
    final checked = d?.accounts.map((a) => a.lastChecked).whereType<DateTime>().fold<DateTime?>(null, (p, x) => p == null || x.isAfter(p) ? x : p);
    final errors = d?.accounts.where((a) => a.lastError.isNotEmpty).toList() ?? const <MailAccount>[];
    Widget header(String text) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
          child: Text(text, style: t.textTheme.labelSmall?.copyWith(letterSpacing: 1, fontWeight: FontWeight.w700)),
        );
    final metrics = <(IconData, String, int, InboxQuery, Color)>[
      (Icons.mark_email_unread_outlined, 'Unread', _count('unread'), const InboxQuery(), AppColors.accent),
      (Icons.reply_outlined, 'Needs reply', _count('needsReply'), const InboxQuery(view: 'needs-reply'), AppColors.action),
      (Icons.priority_high, 'Needs attention', _count('attention'), const InboxQuery(view: 'attention'), AppColors.danger),
      (Icons.receipt_long_outlined, 'Bills & renewals', _count('bills'), const InboxQuery(view: 'bills'), AppColors.action),
      (Icons.people_outline, 'People', _count('people'), const InboxQuery(view: 'people'), AppColors.follow),
      (Icons.inventory_2_outlined, 'Bulk', _count('bulk'), const InboxQuery(view: 'bulk'), Colors.blueGrey),
      (Icons.local_offer_outlined, 'Coupons', d?.savedCoupons.length ?? 0, const InboxQuery(view: 'all', saved: 'coupon'), AppColors.star),
      (Icons.card_giftcard_outlined, 'Gift Cards', d?.savedGiftCards.length ?? 0, const InboxQuery(view: 'all', saved: 'gift-card'), AppColors.star),
    ];
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Dashboard'),
          Text(
            _loading ? 'Updating…' : '${_count('all')} emails${checked != null ? ' · checked ${shortTime(checked)}' : ''}',
            style: t.textTheme.labelSmall?.copyWith(color: t.colorScheme.onSurfaceVariant),
          ),
        ]),
      ),
      body: RefreshIndicator(
        onRefresh: () => reload(sync: true),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            if (_loading && d == null) const LinearProgressIndicator(minHeight: 2),
            // Views are part of the Dashboard, at the top: one expandable list, no counts.
            if ((d?.views ?? const []).isNotEmpty)
              ExpansionTile(
                leading: const Icon(Icons.dashboard_customize_outlined),
                title: const Text('Views', style: TextStyle(fontWeight: FontWeight.w700)),
                initiallyExpanded: true,
                shape: const Border(),
                childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final v in d!.views)
                        ActionChip(avatar: Icon(viewIcon(v.parser), size: 18), label: Text(v.name), onPressed: () => widget.onOpen(InboxQuery(view: 'all', pipeline: v.id))),
                    ]),
                  ),
                ],
              ),
            if (_error.isNotEmpty) _Notice(_error),
            for (final a in errors) _Notice('${a.email}: ${a.lastError}'),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
              child: GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 2.4,
                children: [for (final (icon, label, n, q, color) in metrics) _Metric(icon: icon, label: label, count: n, color: color, onTap: () => widget.onOpen(q))],
              ),
            ),
            if (d != null) ...[
              header('EMAIL'),
              ListTile(
                leading: const Icon(Icons.all_inbox_outlined),
                title: const Text('All inboxes'),
                trailing: _Badge(_count('unread')),
                onTap: () => widget.onOpen(const InboxQuery()),
              ),
              for (final a in d.accounts)
                ListTile(
                  leading: CircleAvatar(
                    radius: 13,
                    backgroundColor: AppColors.provider(a.provider).withValues(alpha: 0.15),
                    child: Text(a.provider == 'gmail' ? 'G' : 'Z', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.provider(a.provider))),
                  ),
                  title: Text(a.email, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: a.paused ? const Text('Paused') : null,
                  trailing: _Badge(a.unread),
                  onTap: () => widget.onOpen(InboxQuery(account: a.id)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.icon, required this.label, required this.count, required this.color, required this.onTap});
  final IconData icon;
  final String label;
  final int count;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Material(
      color: t.colorScheme.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: t.dividerColor.withValues(alpha: 0.4))),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(width: 8),
            Expanded(child: Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
            Text('$count', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: color)),
          ]),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge(this.n);
  final int n;
  @override
  Widget build(BuildContext context) => n > 0
      ? Text('$n', style: TextStyle(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.w700))
      : const SizedBox.shrink();
}

class _Notice extends StatelessWidget {
  const _Notice(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: AppColors.danger.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
        child: Text(text, style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
      );
}
