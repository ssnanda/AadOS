import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import 'models.dart';

/// Round initials badge, tinted by provider (Gmail red, Zoho blue).
class SenderAvatar extends StatelessWidget {
  const SenderAvatar({super.key, required this.sender, required this.provider, this.size = 40});
  final String sender, provider;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = AppColors.provider(provider);
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: c.withValues(alpha: 0.14),
      child: Text(initials(sender), style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: size * 0.36)),
    );
  }
}

class Tag extends StatelessWidget {
  const Tag(this.label, {super.key, this.color, this.icon});
  final String label;
  final Color? color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(5)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 11, color: c), const SizedBox(width: 3)],
        Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: c))),
      ]),
    );
  }
}

/// One email in the list: sender, time, subject, preview, and the review tags the web shows.
class EmailTile extends StatelessWidget {
  const EmailTile({super.key, required this.row, this.insight, this.showAccount = false, this.selected = false, this.selecting = false, required this.onTap, this.onLongPress});
  final EmailRow row;
  final Insight? insight;
  final bool showAccount, selected, selecting;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context), cs = t.colorScheme;
    final weight = row.unread ? FontWeight.w800 : FontWeight.w500;
    final muted = cs.onSurfaceVariant;
    final tags = <Widget>[
      if (insight != null) Tag('✦ ${insight!.category}${insight!.paymentDue != null ? ' · due ${insight!.paymentDue}' : ''}', color: AppColors.ai),
      if (row.needsAction) Tag(row.due.isNotEmpty ? '${row.actionLabel} · ${row.due}' : row.actionLabel, color: AppColors.action),
      if (row.followUp) const Tag('Follow-up', color: AppColors.follow),
      if (row.savedKind == 'coupon') Tag('Coupon · expires ${row.savedExpiry}', color: AppColors.star),
      if (row.savedKind == 'gift-card') const Tag('Gift Card · no expiry', color: AppColors.star),
      if (row.threadCount > 1) Tag('${row.threadCount}', icon: Icons.forum_outlined),
      if (showAccount) Tag(row.accountEmail.split('@').first, color: AppColors.provider(row.provider)),
      if (row.to.isNotEmpty) Tag('To ${row.to.first}${row.to.length > 1 ? ' +${row.to.length - 1}' : ''}', icon: Icons.alternate_email),
    ];
    return Material(
      color: selected ? cs.primaryContainer.withValues(alpha: 0.55) : (row.unread ? cs.surface : Colors.transparent),
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 14, 10),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(
              width: 10,
              child: row.unread ? Padding(padding: const EdgeInsets.only(top: 16), child: CircleAvatar(radius: 4, backgroundColor: cs.primary)) : null,
            ),
            const SizedBox(width: 2),
            selecting
                ? SizedBox(width: 40, height: 40, child: Icon(selected ? Icons.check_circle : Icons.radio_button_unchecked, color: selected ? cs.primary : muted))
                : SenderAvatar(sender: row.sender, provider: row.provider),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  if (row.important) const Padding(padding: EdgeInsets.only(right: 4), child: Icon(Icons.star_rounded, size: 16, color: AppColors.star)),
                  Expanded(child: Text(displayName(row.sender), maxLines: 1, overflow: TextOverflow.ellipsis, style: t.textTheme.titleSmall?.copyWith(fontWeight: weight, fontSize: 15.5))),
                  const SizedBox(width: 8),
                  Text(shortTime(row.receivedAt), style: t.textTheme.labelSmall?.copyWith(color: row.unread ? cs.primary : muted, fontWeight: row.unread ? FontWeight.w700 : FontWeight.w400)),
                ]),
                const SizedBox(height: 2),
                Text(row.subject.isEmpty ? '(no subject)' : row.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: t.textTheme.bodyMedium?.copyWith(fontWeight: row.unread ? FontWeight.w700 : FontWeight.w500)),
                if (row.summary.isNotEmpty) Text(row.summary, maxLines: 2, overflow: TextOverflow.ellipsis, style: t.textTheme.bodySmall?.copyWith(color: muted, height: 1.3)),
                if (tags.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 5), child: Wrap(spacing: 5, runSpacing: 4, children: tags)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Background shown while swiping a row (right = read/unread, left = delete).
Widget swipeBackground(BuildContext context, {required bool delete, required bool unread}) {
  final color = delete ? AppColors.danger : Theme.of(context).colorScheme.primary;
  return Container(
    color: color,
    alignment: delete ? Alignment.centerRight : Alignment.centerLeft,
    padding: const EdgeInsets.symmetric(horizontal: 24),
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(delete ? Icons.delete_outline : (unread ? Icons.mark_email_read_outlined : Icons.mark_email_unread_outlined), color: Colors.white),
      const SizedBox(width: 8),
      Text(delete ? 'Delete' : (unread ? 'Read' : 'Unread'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
    ]),
  );
}
