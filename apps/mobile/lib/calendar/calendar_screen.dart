import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/ui.dart';
import 'calendar_api.dart';
import 'event_sheet.dart';
import 'room_screen.dart';
import 'time_grid.dart';

/// Calendar tab: Calendar (month / week / day / agenda) and Conference Room, as two top tabs.
class CalendarTab extends StatelessWidget {
  const CalendarTab({super.key, required this.api});
  final CalendarApi api;

  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 2,
        child: Scaffold(
          body: SafeArea(
            bottom: false,
            child: Column(children: [
              const TabBar(tabs: [Tab(text: 'Calendar'), Tab(text: 'Conference Room')]),
              Expanded(child: TabBarView(physics: const NeverScrollableScrollPhysics(), children: [CalendarScreen(api: api), RoomScreen(api: api)])),
            ]),
          ),
        ),
      );
}

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key, required this.api});
  final CalendarApi api;
  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> with AutomaticKeepAliveClientMixin {
  String _view = 'month', _date = '', _selected = '';
  final Set<String> _off = {};
  CalendarPage? _page;
  String _error = '';
  bool _loading = false;
  int _gen = 0;
  Timer? _timer;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
    unawaited(_sync());
    _timer = Timer.periodic(const Duration(minutes: 2), (_) => _sync());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _sync() async {
    try {
      if (await widget.api.sync() && mounted) await _load(quiet: true);
    } on ApiException {
      // Sync errors show per account in the page data; a failed call keeps the stored events.
    }
  }

  Future<void> _load({bool quiet = false}) async {
    final gen = ++_gen;
    if (!quiet) setState(() => _loading = true);
    try {
      final p = await widget.api.page(view: _view, date: _date, off: _off.join(','));
      if (!mounted || gen != _gen) return;
      setState(() {
        _page = p;
        _date = p.date;
        _error = '';
        if (_selected.isEmpty || !p.days.any((d) => d.date == _selected)) {
          _selected = p.days.any((d) => d.date == p.today) && (p.view != 'month' || p.today.substring(0, 7) == p.date.substring(0, 7)) ? p.today : p.date;
        }
      });
    } on ApiException catch (e) {
      if (mounted && gen == _gen) setState(() => _error = e.message);
    } finally {
      if (mounted && gen == _gen) setState(() => _loading = false);
    }
  }

  void _go(String date) {
    _date = date;
    _selected = '';
    _load();
  }

  void _setView(String v) {
    if (v == _view) return;
    setState(() => _view = v);
    // Day/week open on the selected day of the month view.
    _date = _selected.isNotEmpty ? _selected : _date;
    _load();
  }

  Future<void> _openEvent(CalEvent e) async {
    if (await showEventSheet(context, widget.api, e, calendars: _page?.calendars ?? const [])) _load(quiet: true);
  }

  Future<void> _create({DateTime? day, int? hour}) async {
    final p = _page;
    if (p == null) return;
    if (!p.canEditAny) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No calendar allows editing. Settings → Emails → “Allow calendar editing”.')));
      return;
    }
    final ok = await openEventEditor(context, widget.api,
        calendars: p.calendars, day: day ?? (_selected.isNotEmpty ? DateTime.parse(_selected) : null), startTime: hour == null ? null : '${hour.toString().padLeft(2, '0')}:00');
    if (ok) _load(quiet: true);
  }

  String get _title {
    final p = _page;
    if (p == null) return 'Calendar';
    final d = DateTime.parse(p.date);
    switch (p.view) {
      case 'day':
        return DateFormat('EEE, MMM d').format(d);
      case 'week':
        final a = p.days.first.day, b = p.days.last.day;
        return a.month == b.month ? DateFormat('MMMM y').format(a) : '${DateFormat.MMM().format(a)} – ${DateFormat('MMM y').format(b)}';
      case 'agenda':
        return 'From ${DateFormat('MMM d').format(d)}';
      default:
        return DateFormat('MMMM y').format(d);
    }
  }

  void _filters() {
    final p = _page;
    if (p == null) return;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => ListView(shrinkWrap: true, children: [
          const SectionLabel('Calendars'),
          for (final cal in p.calendars.where((x) => x.syncing))
            CheckboxListTile(
              value: !_off.contains(cal.id),
              activeColor: cal.color,
              title: Text(cal.name),
              secondary: Icon(Icons.circle, size: 12, color: cal.color),
              onChanged: (v) {
                set(() => v == true ? _off.remove(cal.id) : _off.add(cal.id));
                _load(quiet: true);
              },
            ),
          if (p.errors.isNotEmpty) ...[const SectionLabel('Sync problems'), for (final e in p.errors) ListTile(leading: const Icon(Icons.error_outline), title: Text(e))],
          const SizedBox(height: 16),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final p = _page;
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      floatingActionButton: p?.canEditAny == true ? FloatingActionButton(onPressed: () => _create(), child: const Icon(Icons.add)) : null,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 4, 4, 0),
          child: Row(children: [
            IconButton(tooltip: 'Previous', icon: const Icon(Icons.chevron_left), onPressed: p == null ? null : () => _go(p.prev)),
            Expanded(child: Text(_title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
            IconButton(tooltip: 'Next', icon: const Icon(Icons.chevron_right), onPressed: p == null ? null : () => _go(p.next)),
            TextButton(onPressed: p == null ? null : () => _go(p.today), child: const Text('Today')),
            IconButton(tooltip: 'Calendars', icon: Badge(isLabelVisible: (p?.errors.isNotEmpty ?? false), child: const Icon(Icons.tune)), onPressed: _filters),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: SizedBox(
            width: double.infinity,
            child: SegmentedButton<String>(
              showSelectedIcon: false,
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
              segments: const [ButtonSegment(value: 'month', label: Text('Month')), ButtonSegment(value: 'week', label: Text('Week')), ButtonSegment(value: 'day', label: Text('Day')), ButtonSegment(value: 'agenda', label: Text('List'))],
              selected: {_view},
              onSelectionChanged: (s) => _setView(s.first),
            ),
          ),
        ),
        if (_loading) const LinearProgressIndicator(minHeight: 2) else const SizedBox(height: 2),
        Expanded(
          child: p == null
              ? (_error.isNotEmpty ? ErrorPane(_error, onRetry: _load) : const SizedBox())
              : p.enabled == 0
                  ? const ErrorPane('No calendar connected. Turn on Calendar for an account in Settings → Emails on the web.', icon: Icons.event_busy)
                  : GestureDetector(
                      // Swipe sideways for the previous / next month, week or day.
                      onHorizontalDragEnd: (d) {
                        final v = d.primaryVelocity ?? 0;
                        if (v.abs() < 300) return;
                        _go(v < 0 ? p.next : p.prev);
                      },
                      child: switch (p.view) {
                        'week' || 'day' => TimeGrid(key: ValueKey('${p.view}${p.date}'), days: p.days, onEvent: _openEvent, onSlot: p.canEditAny ? (d, h) => _create(day: d, hour: h) : null),
                        'agenda' => _Agenda(days: p.days, onEvent: _openEvent, onRefresh: () => _load(quiet: true)),
                        _ => _Month(page: p, selected: _selected, onSelect: (d) => setState(() => _selected = d), onOpenDay: (d) {
                            _selected = d;
                            _setView('day');
                          }, onEvent: _openEvent, onRefresh: () => _load(quiet: true), accent: cs.primary),
                      },
                    ),
        ),
      ]),
    );
  }
}

/// Month grid (dots/labels per day) with the selected day's events listed below, like a phone calendar.
class _Month extends StatelessWidget {
  const _Month({required this.page, required this.selected, required this.onSelect, required this.onOpenDay, required this.onEvent, required this.onRefresh, required this.accent});
  final CalendarPage page;
  final String selected;
  final ValueChanged<String> onSelect, onOpenDay;
  final void Function(CalEvent) onEvent;
  final Future<void> Function() onRefresh;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final weeks = (page.days.length / 7).ceil();
    final day = page.days.where((d) => d.date == selected).firstOrNull;
    return LayoutBuilder(builder: (context, box) {
      final gridH = (box.maxHeight * 0.58).clamp(260.0, 460.0);
      final cellH = (gridH - 18) / weeks;
      final maxLabels = ((cellH - 22) / 14).floor().clamp(0, 4);
      return Column(children: [
        Row(children: [
          for (final d in page.days.take(7))
            Expanded(child: Center(child: Text(DateFormat.E().format(d.day).substring(0, 1), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: cs.onSurfaceVariant)))),
        ]),
        const SizedBox(height: 4),
        SizedBox(
          height: gridH - 18,
          child: Column(children: [
            for (var w = 0; w < weeks; w++)
              Expanded(
                child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  for (final d in page.days.skip(w * 7).take(7))
                    Expanded(
                      child: InkWell(
                        onTap: () => onSelect(d.date),
                        child: Container(
                          decoration: BoxDecoration(
                            color: d.date == selected ? accent.withValues(alpha: 0.10) : null,
                            border: Border(top: BorderSide(color: cs.outlineVariant.withValues(alpha: 0.6))),
                          ),
                          padding: const EdgeInsets.all(2),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                            Center(
                              child: Container(
                                width: 22,
                                height: 22,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(color: d.isToday ? accent : null, shape: BoxShape.circle),
                                child: Text('${d.day.day}',
                                    style: TextStyle(fontSize: 12, fontWeight: d.isToday ? FontWeight.w800 : FontWeight.w500, color: d.isToday ? cs.onPrimary : (d.inMonth ? cs.onSurface : cs.onSurfaceVariant.withValues(alpha: 0.5)))),
                              ),
                            ),
                            for (final e in d.events.take(maxLabels))
                              Container(
                                margin: const EdgeInsets.only(top: 1),
                                padding: const EdgeInsets.symmetric(horizontal: 2),
                                decoration: BoxDecoration(color: e.allDay ? e.color : e.color.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(3)),
                                child: Text(e.title, maxLines: 1, overflow: TextOverflow.clip, softWrap: false, style: TextStyle(fontSize: 9.5, height: 1.25, color: e.allDay ? Colors.white : cs.onSurface)),
                              ),
                            if (d.events.length > maxLabels)
                              maxLabels == 0
                                  ? Row(mainAxisAlignment: MainAxisAlignment.center, children: [for (final e in d.events.take(4)) Container(width: 5, height: 5, margin: const EdgeInsets.all(1), decoration: BoxDecoration(color: e.color, shape: BoxShape.circle))])
                                  : Text('+${d.events.length - maxLabels}', textAlign: TextAlign.center, style: TextStyle(fontSize: 9, color: cs.onSurfaceVariant)),
                          ]),
                        ),
                      ),
                    ),
                ]),
              ),
          ]),
        ),
        Divider(height: 1, color: cs.outlineVariant),
        Expanded(
          child: RefreshIndicator(
            onRefresh: onRefresh,
            child: ListView(padding: const EdgeInsets.only(bottom: 80), children: [
              if (day != null) SectionLabel(DateFormat('EEEE, MMMM d').format(day.day), trailing: TextButton(onPressed: () => onOpenDay(day.date), child: const Text('Day view'))),
              if (day == null || day.events.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No events.')),
              if (day != null) for (final e in day.events) EventTile(e, onTap: () => onEvent(e)),
            ]),
          ),
        ),
      ]);
    });
  }
}

class _Agenda extends StatelessWidget {
  const _Agenda({required this.days, required this.onEvent, required this.onRefresh});
  final List<CalDay> days;
  final void Function(CalEvent) onEvent;
  final Future<void> Function() onRefresh;
  @override
  Widget build(BuildContext context) {
    final withEvents = days.where((d) => d.events.isNotEmpty).toList();
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: withEvents.isEmpty
          ? ListView(children: const [Padding(padding: EdgeInsets.all(24), child: Text('Nothing in the next 30 days.'))])
          : ListView(padding: const EdgeInsets.only(bottom: 80), children: [
              for (final d in withEvents) ...[
                SectionLabel(d.isToday ? 'Today · ${DateFormat('EEE, MMM d').format(d.day)}' : DateFormat('EEEE, MMM d').format(d.day)),
                for (final e in d.events) EventTile(e, onTap: () => onEvent(e)),
              ],
            ]),
    );
  }
}

/// One event in a list: colour bar, time, title, location.
class EventTile extends StatelessWidget {
  const EventTile(this.e, {super.key, required this.onTap});
  final CalEvent e;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final part = str(e.j['part']);
    final time = e.allDay || part == 'middle'
        ? 'All day'
        : part == 'end'
            ? 'until ${DateFormat.jm().format(e.end)}'
            : DateFormat.jm().format(e.start);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 70, child: Text(time, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant, fontWeight: FontWeight.w600))),
          Container(width: 4, height: 36, margin: const EdgeInsets.only(right: 10), decoration: BoxDecoration(color: e.color, borderRadius: BorderRadius.circular(2))),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(e.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14), maxLines: 2, overflow: TextOverflow.ellipsis),
              if (!e.allDay && part != 'middle') Text('${DateFormat.jm().format(e.start)} – ${DateFormat.jm().format(e.end)}', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
              if (e.location.isNotEmpty) Text(e.location, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant), maxLines: 1, overflow: TextOverflow.ellipsis),
            ]),
          ),
        ]),
      ),
    );
  }
}
