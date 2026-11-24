import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'api.dart';

/// '#3157de' / '#35d' / '#3157deff' → Color (fallback when missing or malformed).
Color hexColor(String? hex, [Color fallback = const Color(0xFF3157DE)]) {
  var h = (hex ?? '').replaceFirst('#', '');
  if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
  if (h.length == 8) h = h.substring(6) + h.substring(0, 6); // CSS #RRGGBBAA → AARRGGBB
  if (h.length == 6) h = 'FF$h';
  final v = int.tryParse(h, radix: 16);
  return v == null || h.length != 8 ? fallback : Color(v);
}

String str(Object? v) => v == null ? '' : v.toString();
num numOf(Object? v) => v is num ? v : num.tryParse(str(v)) ?? 0;
num? numOrNull(Object? v) => v == null ? null : (v is num ? v : num.tryParse(str(v)));
List<Map<String, dynamic>> maps(Object? v) => [for (final x in (v as List? ?? const [])) if (x is Map) Map<String, dynamic>.from(x)];
Map<String, dynamic> mapOf(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

final _usd0 = NumberFormat.simpleCurrency(name: 'USD', decimalDigits: 0);
final _usd2 = NumberFormat.simpleCurrency(name: 'USD', decimalDigits: 2);
String usd(num? v, {int digits = 0}) => v == null ? '—' : (digits == 0 ? _usd0 : _usd2).format(v);
String pct(num? v) => v == null || !v.isFinite ? '—' : '${v >= 0 ? '+' : ''}${v.toStringAsFixed(2)}%';
Color? tone(BuildContext context, num? v) => v == null || v == 0 ? null : (v > 0 ? const Color(0xFF1E8E4E) : Theme.of(context).colorScheme.error);

/// Error state with a retry button (offline, server error, not configured).
class ErrorPane extends StatelessWidget {
  const ErrorPane(this.message, {super.key, this.onRetry, this.icon = Icons.cloud_off_outlined});
  final String message;
  final VoidCallback? onRetry;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 36, color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            if (onRetry != null) ...[const SizedBox(height: 8), OutlinedButton(onPressed: onRetry, child: const Text('Retry'))],
          ]),
        ),
      );
}

/// Section label used across native screens.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 4),
        child: Row(children: [
          Expanded(child: Text(text.toUpperCase(), style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1, fontWeight: FontWeight.w700))),
          ?trailing,
        ]),
      );
}

/// Runs [work], shows its error as a snackbar, returns null on failure.
Future<T?> guarded<T>(BuildContext context, Future<T> Function() work) async {
  try {
    return await work();
  } on ApiException catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.maybeOf(context)
        ?..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(e.message)));
    }
    return null;
  }
}
