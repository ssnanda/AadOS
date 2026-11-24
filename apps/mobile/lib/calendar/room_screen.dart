import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/ui.dart';
import 'calendar_api.dart';
import 'calendar_screen.dart' show EventTile;
import 'event_sheet.dart';
import 'time_grid.dart';

/// Conference Room: one picked calendar (e.g. a Zoho group calendar) — free/busy now, a day timeline with
/// previous/next day, and the next 14 days of bookings. "Book" creates an event on the room calendar.
class RoomScreen extends StatefulWidget {
  const RoomScreen({super.key, required this.api});
  final CalendarApi api;
  @override
  State<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends State<RoomScreen> with AutomaticKeepAliveClientMixin {
  Map<String, dynamic>? _data;
  String _error = '';
  bool _loading = false;
  bool _list = false;
  DateTime _day = DateTime.now();
  Timer? _tick;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
    // Status ("free until…") stays current; bookings reload every 2 minutes.
    _tick = Timer.periodic(const Duration(minutes: 1), (t) {
      if (!mounted) return;
      if (t.tick % 2 == 0) {
        _load(quiet: true);
      } else {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) setState(() => _loading = true);
    try {
      final d = await widget.api.room();
      if (mounted) {
        setState(() {
          _data = d;
          _error = '';
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, dynamic>? get _selected => _data?['selected'] is Map ? mapOf(_data!['selected']) : null;
  List<CalendarInfo> get _calendars => [for (final c in maps(_data?['calendars'])) CalendarInfo({...c, 'syncing': true})];

  List<CalEvent> get _bookings {
    final sel = _selected;
    if (sel == null) return const [];
    return [
      for (final b in maps(_data?['bookings']))
        CalEvent(str(b['key']), {...b, 'color': str(sel['color']).isEmpty ? '#139488' : sel['color'], 'calendar': sel['name'], 'writable': sel['writable'] == true, 'description': b['rawDescription']}),
    ];
  }

  Future<void> _pick() async {
    final cals = _calendars;
    final id = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => ListView(shrinkWrap: true, children: [
        const SectionLabel('Room calendar'),
        for (final cal in cals)
          ListTile(
            leading: Icon(Icons.circle, size: 12, color: cal.color),
            title: Text(cal.name),
            subtitle: Text(str(cal.j['account'])),
            trailing: cal.id == str(_selected?['id']) ? const Icon(Icons.check) : null,
            onTap: () => Navigator.pop(c, cal.id),
          ),
      ]),
    );
    if (id == null || !mounted) return;
    if (await guarded(context, () => widget.api.pickRoom(id).then((_) => true)) == true) _load();
  }

  Future<void> _book({DateTime? day, int? hour}) async {
    final sel = _selected;
    if (sel == null) return;
    if (sel['writable'] != true) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('AadOS may not edit this calendar. Settings → Emails → “Allow calendar editing”.')));
      return;
    }
    final now = DateTime.now();
    final ok = await openEventEditor(context, widget.api,
        calendars: _calendars, calendarId: str(sel['id']), day: day ?? _day, title: 'Conference room', startTime: '${(hour ?? (ymd(_day) == ymd(now) ? now.hour + 1 : 9)).clamp(0, 23).toString().padLeft(2, '0')}:00');
    if (ok) _load(quiet: true);
  }

  Future<void> _open(CalEvent e) async {
    if (await showEventSheet(context, widget.api, e, calendars: _calendars)) _load(quiet: true);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final d = _data;
    if (d == null) return _error.isNotEmpty ? ErrorPane(_error, onRetry: _load) : const Center(child: CircularProgressIndicator());
    final sel = _selected;
    if (sel == null) {
      return ErrorPane(_calendars.isEmpty ? 'No calendars yet. Connect a calendar in Settings → Emails on the web.' : 'Pick the calendar that holds the room’s bookings.',
          icon: Icons.meeting_room_outlined, onRetry: _calendars.isEmpty ? _load : _pick);
    }
    final cs = Theme.of(context).colorScheme;
    final now = DateTime.now();
    final bookings = _bookings;
    final current = bookings.where((b) => !b.allDay && !b.start.isAfter(now) && b.end.isAfter(now)).firstOrNull;
    final next = bookings.where((b) => !b.allDay && b.start.isAfter(now)).firstOrNull;
    final busy = current != null;
    final statusColor = busy ? cs.error : const Color(0xFF1E8E4E);
    final status = busy
        ? 'In use · until ${DateFormat.jm().format(current.end)}'
        : next == null
            ? 'Available'
            : ymd(next.start) == ymd(now)
                ? 'Available until ${DateFormat.jm().format(next.start)}'
                : 'Available today';

    // Day timeline: bookings touching the chosen day.
    final dayStart = DateTime(_day.year, _day.month, _day.day), dayEnd = dayStart.add(const Duration(days: 1));
    final onDay = bookings.where((b) => b.start.isBefore(dayEnd) && b.end.isAfter(dayStart)).toList();
    final calDay = CalDay(ymd(_day), true, ymd(_day) == ymd(now), onDay);

    return Scaffold(
      floatingActionButton: sel['writable'] == true ? FloatingActionButton.extended(onPressed: () => _book(), icon: const Icon(Icons.add), label: const Text('Book')) : null,
      body: Column(children: [
        Container(
          margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
          decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(12), border: Border.all(color: statusColor.withValues(alpha: 0.4))),
          child: Row(children: [
            Icon(busy ? Icons.do_not_disturb_on : Icons.check_circle, color: statusColor),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(status, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: statusColor)),
                if (busy) Text(current.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                if (!busy && next != null) Text('Next: ${next.title} · ${DateFormat('EEE h:mm a').format(next.start)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
              ]),
            ),
            TextButton(onPressed: _pick, child: Text(str(sel['name']), overflow: TextOverflow.ellipsis)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Row(children: [
            IconButton(icon: const Icon(Icons.chevron_left), onPressed: _list ? null : () => setState(() => _day = _day.subtract(const Duration(days: 1)))),
            Expanded(child: Text(_list ? 'Next 14 days' : (ymd(_day) == ymd(now) ? 'Today · ${DateFormat('EEE, MMM d').format(_day)}' : DateFormat('EEEE, MMM d').format(_day)), style: const TextStyle(fontWeight: FontWeight.w700))),
            IconButton(icon: const Icon(Icons.chevron_right), onPressed: _list ? null : () => setState(() => _day = _day.add(const Duration(days: 1)))),
            if (!_list && ymd(_day) != ymd(now)) TextButton(onPressed: () => setState(() => _day = now), child: const Text('Today')),
            IconButton(tooltip: _list ? 'Timeline' : 'List', icon: Icon(_list ? Icons.view_day_outlined : Icons.view_agenda_outlined), onPressed: () => setState(() => _list = !_list)),
          ]),
        ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        Expanded(
          child: _list
              ? RefreshIndicator(
                  onRefresh: () => _load(quiet: true),
                  child: bookings.isEmpty
                      ? ListView(children: const [Padding(padding: EdgeInsets.all(24), child: Text('No bookings in the next 14 days.'))])
                      : ListView(padding: const EdgeInsets.only(bottom: 80), children: [
                          for (final entry in _byDay(bookings).entries) ...[
                            SectionLabel(entry.key == ymd(now) ? 'Today' : DateFormat('EEEE, MMM d').format(DateTime.parse(entry.key))),
                            for (final b in entry.value) EventTile(b, onTap: () => _open(b)),
                          ],
                        ]),
                )
              : TimeGrid(key: ValueKey(ymd(_day)), days: [calDay], onEvent: _open, onSlot: sel['writable'] == true ? (d, h) => _book(day: d, hour: h) : null),
        ),
      ]),
    );
  }

  Map<String, List<CalEvent>> _byDay(List<CalEvent> list) {
    final out = <String, List<CalEvent>>{};
    for (final b in list) {
      (out[ymd(b.start)] ??= []).add(b);
    }
    return out;
  }
}
