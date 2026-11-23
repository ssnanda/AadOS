import 'package:intl/intl.dart';

/// "9:41 AM" today, "Nov 3" this year, else "Nov 3, 2025".
String shortTime(DateTime? d) {
  if (d == null) return '';
  final local = d.toLocal(), now = DateTime.now();
  if (local.year == now.year && local.month == now.month && local.day == now.day) return DateFormat.jm().format(local);
  if (now.difference(local).inDays < 6 && local.isBefore(now)) return DateFormat.E().format(local);
  return local.year == now.year ? DateFormat.MMMd().format(local) : DateFormat.yMMMd().format(local);
}

String longTime(DateTime? d) => d == null ? '' : DateFormat('EEE, MMM d, y · h:mm a').format(d.toLocal());

/// `"Jane Doe" <jane@x.com>` → Jane Doe (falls back to the address).
String displayName(String sender) {
  final name = sender.replaceAll(RegExp(r'<[^>]*>'), '').replaceAll(RegExp('["\']'), '').trim();
  if (name.isNotEmpty) return name;
  final m = RegExp(r'[\w.+\x27-]+@[\w.-]+').firstMatch(sender);
  return m?.group(0) ?? sender;
}

String? emailAddress(String sender) => RegExp(r'[\w.+\x27-]+@[\w.-]+').firstMatch(sender)?.group(0);

String initials(String sender) {
  final n = displayName(sender).trim();
  if (n.isEmpty) return '?';
  final parts = n.split(RegExp(r'\s+')).where((p) => p.isNotEmpty && RegExp(r'[A-Za-z0-9]').hasMatch(p[0])).toList();
  if (parts.isEmpty) return n[0].toUpperCase();
  return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
}
