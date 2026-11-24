import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat, NumberFormat;

import '../core/ui.dart';

/// Minimal line chart (no chart package): one or two series over dates, touch to read a value.
class LineChart extends StatefulWidget {
  const LineChart({super.key, required this.points, this.secondary = const [], this.color = const Color(0xFF2A9D5C), this.height = 180});
  final List<(DateTime, double)> points;
  final List<(DateTime, double)> secondary; // dashed (e.g. cost basis)
  final Color color;
  final double height;
  @override
  State<LineChart> createState() => _LineChartState();
}

class _LineChartState extends State<LineChart> {
  int? _touch;

  @override
  Widget build(BuildContext context) {
    final p = widget.points;
    final cs = Theme.of(context).colorScheme;
    if (p.length < 2) return SizedBox(height: widget.height, child: Center(child: Text('Not enough history yet.', style: TextStyle(color: cs.onSurfaceVariant))));
    final i = _touch?.clamp(0, p.length - 1);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(
        height: 18,
        child: i == null ? null : Text('${DateFormat.yMMMd().format(p[i].$1)} · ${usd(p[i].$2)}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant, fontWeight: FontWeight.w600)),
      ),
      SizedBox(
        height: widget.height,
        child: LayoutBuilder(builder: (context, box) {
          void at(Offset o) => setState(() => _touch = (o.dx / box.maxWidth * (p.length - 1)).round());
          return GestureDetector(
            onPanDown: (d) => at(d.localPosition),
            onPanUpdate: (d) => at(d.localPosition),
            onPanEnd: (_) => setState(() => _touch = null),
            onPanCancel: () => setState(() => _touch = null),
            child: CustomPaint(size: Size(box.maxWidth, widget.height), painter: _Painter(p, widget.secondary, widget.color, cs.outlineVariant, cs.onSurfaceVariant, i)),
          );
        }),
      ),
    ]);
  }
}

class _Painter extends CustomPainter {
  _Painter(this.p, this.s, this.color, this.grid, this.label, this.touch);
  final List<(DateTime, double)> p, s;
  final Color color, grid, label;
  final int? touch;

  @override
  void paint(Canvas canvas, Size size) {
    final all = [...p.map((e) => e.$2), ...s.map((e) => e.$2)];
    var lo = all.reduce(math.min), hi = all.reduce(math.max);
    if (hi == lo) {
      hi += 1;
      lo -= 1;
    }
    final pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    final t0 = p.first.$1.millisecondsSinceEpoch.toDouble(), t1 = p.last.$1.millisecondsSinceEpoch.toDouble();
    double x(DateTime d) => t1 == t0 ? 0 : (d.millisecondsSinceEpoch - t0) / (t1 - t0) * size.width;
    double y(double v) => size.height - (v - lo) / (hi - lo) * size.height;

    final gp = Paint()
      ..color = grid.withValues(alpha: 0.5)
      ..strokeWidth = 1;
    for (var k = 0; k <= 3; k++) {
      final yy = size.height * k / 3;
      canvas.drawLine(Offset(0, yy), Offset(size.width, yy), gp);
    }
    final tp = TextPainter(textDirection: TextDirection.ltr);
    for (final v in [hi - pad, lo + pad]) {
      tp.text = TextSpan(text: NumberFormat.compactSimpleCurrency().format(v), style: TextStyle(fontSize: 10, color: label));
      tp.layout();
      tp.paint(canvas, Offset(2, y(v) - (v == hi - pad ? 0 : tp.height)));
    }

    Path line(List<(DateTime, double)> l) {
      final path = Path()..moveTo(x(l.first.$1), y(l.first.$2));
      for (final e in l.skip(1)) {
        path.lineTo(x(e.$1), y(e.$2));
      }
      return path;
    }

    if (s.length > 1) {
      final dash = Paint()
        ..color = label.withValues(alpha: 0.6)
        ..strokeWidth = 1.2
        ..style = PaintingStyle.stroke;
      for (final m in line(s).computeMetrics()) {
        for (double d = 0; d < m.length; d += 8) {
          canvas.drawPath(m.extractPath(d, math.min(d + 4, m.length)), dash);
        }
      }
    }
    final main = line(p);
    final fill = Path.from(main)
      ..lineTo(x(p.last.$1), size.height)
      ..lineTo(x(p.first.$1), size.height)
      ..close();
    canvas.drawPath(fill, Paint()..shader = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [color.withValues(alpha: 0.25), color.withValues(alpha: 0)]).createShader(Offset.zero & size));
    canvas.drawPath(
        main,
        Paint()
          ..color = color
          ..strokeWidth = 2
          ..style = PaintingStyle.stroke);
    if (touch != null) {
      final e = p[touch!];
      canvas.drawLine(Offset(x(e.$1), 0), Offset(x(e.$1), size.height), Paint()..color = label.withValues(alpha: 0.5));
      canvas.drawCircle(Offset(x(e.$1), y(e.$2)), 4, Paint()..color = color);
    }
  }

  @override
  bool shouldRepaint(covariant _Painter old) => old.p != p || old.touch != touch || old.s != s;
}
