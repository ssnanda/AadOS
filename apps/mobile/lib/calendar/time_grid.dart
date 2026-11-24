import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'calendar_api.dart';

/// Week / day view: an all-day strip, then a 24-hour grid with events placed by time. Overlapping events share
/// the column side by side. Today has a red "now" line. Tapping an empty hour asks to create an event there.
class TimeGrid extends StatefulWidget {
  const TimeGrid({super.key, required this.days, required this.onEvent, this.onSlot, this.hourHeight = 52});
  final List<CalDay> days;
  final void Function(CalEvent) onEvent;
  final void Function(DateTime day, int hour)? onSlot;
  final double hourHeight;

  @override
  State<TimeGrid> createState() => _TimeGridState();
}

class _Placed {
  _Placed(this.e, this.top, this.bottom);
  final CalEvent e;
  final double top, bottom; // minutes from midnight
  int col = 0, cols = 1;
}

class _TimeGridState extends State<TimeGrid> {
  late final ScrollController _scroll;
  Timer? _tick;
  static const _gutter = 44.0;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    final showsToday = widget.days.any((d) => d.date == ymd(now));
    final hour = showsToday ? math.max(0, now.hour - 1) : 7;
    _scroll = ScrollController(initialScrollOffset: hour * widget.hourHeight);
    _tick = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  /// Timed events of one day, clamped to it, with side-by-side columns for overlaps.
  List<_Placed> _layout(CalDay d) {
    final dayStart = DateTime(d.day.year, d.day.month, d.day.day), dayEnd = dayStart.add(const Duration(days: 1));
    final list = <_Placed>[];
    for (final e in d.events.where((e) => !e.allDay && e.j['part'] != 'middle')) {
      final s = e.start.isBefore(dayStart) ? dayStart : e.start;
      var en = e.end.isAfter(dayEnd) ? dayEnd : e.end;
      if (!en.isAfter(s)) en = s.add(const Duration(minutes: 30));
      final top = s.difference(dayStart).inMinutes.toDouble();
      list.add(_Placed(e, top, math.max(top + 20, en.difference(dayStart).inMinutes.toDouble())));
    }
    list.sort((a, b) => a.top.compareTo(b.top) != 0 ? a.top.compareTo(b.top) : b.bottom.compareTo(a.bottom));
    // Clusters of transitively overlapping events share a column count.
    var cluster = <_Placed>[];
    double clusterEnd = -1;
    void close() {
      final cols = <double>[];
      for (final p in cluster) {
        var c = cols.indexWhere((end) => end <= p.top);
        if (c < 0) {
          cols.add(p.bottom);
          c = cols.length - 1;
        } else {
          cols[c] = p.bottom;
        }
        p.col = c;
      }
      for (final p in cluster) {
        p.cols = cols.length;
      }
      cluster = [];
    }

    for (final p in list) {
      if (cluster.isNotEmpty && p.top >= clusterEnd) close();
      cluster.add(p);
      clusterEnd = math.max(clusterEnd, p.bottom);
    }
    if (cluster.isNotEmpty) close();
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context), cs = t.colorScheme;
    final hh = widget.hourHeight, multi = widget.days.length > 1;
    final allDay = [for (final d in widget.days) d.events.where((e) => e.allDay || e.j['part'] == 'middle').toList()];
    final maxAllDay = allDay.fold<int>(0, (m, l) => math.max(m, l.length));
    final now = DateTime.now();

    Widget chip(CalEvent e, {bool dense = false}) => GestureDetector(
          onTap: () => widget.onEvent(e),
          child: Container(
            margin: const EdgeInsets.only(bottom: 2, right: 2),
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            decoration: BoxDecoration(color: e.color, borderRadius: BorderRadius.circular(4)),
            child: Text(e.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: Colors.white, fontSize: dense ? 10 : 12, fontWeight: FontWeight.w600)),
          ),
        );

    return Column(children: [
      if (multi)
        Padding(
          padding: const EdgeInsets.only(left: _gutter),
          child: Row(children: [
            for (final d in widget.days)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(children: [
                    Text(DateFormat.E().format(d.day).toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: d.isToday ? cs.primary : cs.onSurfaceVariant)),
                    const SizedBox(height: 2),
                    Container(
                      width: 26,
                      height: 26,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: d.isToday ? cs.primary : null, shape: BoxShape.circle),
                      child: Text('${d.day.day}', style: TextStyle(fontWeight: FontWeight.w700, color: d.isToday ? cs.onPrimary : null)),
                    ),
                  ]),
                ),
              ),
          ]),
        ),
      if (maxAllDay > 0)
        Container(
          constraints: const BoxConstraints(maxHeight: 76),
          decoration: BoxDecoration(border: Border(bottom: BorderSide(color: cs.outlineVariant))),
          child: SingleChildScrollView(
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(width: _gutter, child: Padding(padding: const EdgeInsets.only(top: 3, right: 4), child: Text('all-day', textAlign: TextAlign.right, style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)))),
              for (final l in allDay) Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final e in l) chip(e, dense: multi)])),
            ]),
          ),
        ),
      Expanded(
        child: SingleChildScrollView(
          controller: _scroll,
          child: SizedBox(
            height: hh * 24 + 8,
            child: LayoutBuilder(builder: (context, box) {
              final colW = (box.maxWidth - _gutter) / widget.days.length;
              return Stack(children: [
                // Hour lines and labels.
                for (var h = 0; h < 24; h++) ...[
                  Positioned(top: h * hh, left: _gutter, right: 0, child: Divider(height: 1, color: cs.outlineVariant.withValues(alpha: 0.6))),
                  if (h > 0)
                    Positioned(
                      top: h * hh - 7,
                      left: 0,
                      width: _gutter - 6,
                      child: Text(DateFormat.j().format(DateTime(2000, 1, 1, h)), textAlign: TextAlign.right, style: TextStyle(fontSize: 10, color: cs.onSurfaceVariant)),
                    ),
                ],
                for (var i = 1; i < widget.days.length; i++) Positioned(top: 0, bottom: 0, left: _gutter + i * colW, child: VerticalDivider(width: 1, color: cs.outlineVariant.withValues(alpha: 0.6))),
                // Empty slots: tap to create.
                if (widget.onSlot != null)
                  for (var i = 0; i < widget.days.length; i++)
                    Positioned(
                      left: _gutter + i * colW,
                      width: colW,
                      top: 0,
                      height: hh * 24,
                      child: GestureDetector(behavior: HitTestBehavior.translucent, onTapUp: (d) => widget.onSlot!(widget.days[i].day, (d.localPosition.dy / hh).floor().clamp(0, 23))),
                    ),
                // Events.
                for (var i = 0; i < widget.days.length; i++)
                  for (final p in _layout(widget.days[i]))
                    Positioned(
                      top: p.top / 60 * hh + 1,
                      height: (p.bottom - p.top) / 60 * hh - 2,
                      left: _gutter + i * colW + p.col * (colW / p.cols) + 1,
                      width: colW / p.cols - 2,
                      child: GestureDetector(
                        onTap: () => widget.onEvent(p.e),
                        child: Container(
                          padding: const EdgeInsets.fromLTRB(4, 2, 2, 2),
                          decoration: BoxDecoration(
                            color: p.e.color.withValues(alpha: t.brightness == Brightness.dark ? 0.45 : 0.2),
                            borderRadius: BorderRadius.circular(4),
                            border: Border(left: BorderSide(color: p.e.color, width: 3)),
                          ),
                          child: Text.rich(
                            TextSpan(children: [
                              TextSpan(text: p.e.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                              if ((p.bottom - p.top) >= 45 && !multi) TextSpan(text: '\n${DateFormat.jm().format(p.e.start)} – ${DateFormat.jm().format(p.e.end)}'),
                              if (p.e.location.isNotEmpty && (p.bottom - p.top) >= 60 && !multi) TextSpan(text: '\n${p.e.location}'),
                            ]),
                            overflow: TextOverflow.fade,
                            style: TextStyle(fontSize: multi ? 10 : 12, color: cs.onSurface, height: 1.2),
                          ),
                        ),
                      ),
                    ),
                // Now line.
                for (var i = 0; i < widget.days.length; i++)
                  if (widget.days[i].date == ymd(now))
                    Positioned(
                      top: (now.hour * 60 + now.minute) / 60 * hh - 4,
                      left: _gutter + i * colW - 4,
                      width: colW + 4,
                      child: Row(children: [
                        Container(width: 8, height: 8, decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle)),
                        Expanded(child: Container(height: 2, color: Colors.red)),
                      ]),
                    ),
              ]);
            }),
          ),
        ),
      ),
    ]);
  }
}
