import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/ui.dart';
import 'calendar_api.dart';

String eventWhen(CalEvent e) {
  final s = e.start, en = e.end;
  if (e.allDay) {
    final last = en.subtract(const Duration(days: 1));
    return ymd(last) == ymd(s) || !last.isAfter(s) ? '${DateFormat('EEE, MMM d').format(s)} · All day' : '${DateFormat('EEE, MMM d').format(s)} – ${DateFormat('EEE, MMM d').format(last)} · All day';
  }
  final sameDay = ymd(s) == ymd(en) || (en.hour == 0 && en.minute == 0 && en.difference(s).inHours < 24);
  return sameDay
      ? '${DateFormat('EEE, MMM d').format(s)} · ${DateFormat.jm().format(s)} – ${DateFormat.jm().format(en)}'
      : '${DateFormat('EEE, MMM d · h:mm a').format(s)} – ${DateFormat('EEE, MMM d · h:mm a').format(en)}';
}

/// Read-only details with Edit / Delete when AadOS may edit that calendar. Returns true when something changed.
Future<bool> showEventSheet(BuildContext context, CalendarApi api, CalEvent e, {List<CalendarInfo> calendars = const []}) async {
  final changed = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (c) {
      final t = Theme.of(c);
      Widget row(IconData icon, Widget child) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(icon, size: 18, color: t.colorScheme.onSurfaceVariant), const SizedBox(width: 12), Expanded(child: child)]),
          );
      return DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.55,
        maxChildSize: 0.92,
        builder: (c, scroll) => ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(20, 0, 20, 24), children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(width: 12, height: 12, margin: const EdgeInsets.only(top: 7, right: 10), decoration: BoxDecoration(color: e.color, borderRadius: BorderRadius.circular(3))),
            Expanded(child: Text(e.title, style: t.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700))),
          ]),
          const SizedBox(height: 8),
          row(Icons.schedule, Text(eventWhen(e))),
          if (e.recurrence.isNotEmpty || e.recurring) row(Icons.repeat, Text(e.recurrence.isNotEmpty ? e.recurrence : 'Repeats')),
          if (e.tentative) row(Icons.help_outline, const Text('Tentative')),
          if (e.calendar.isNotEmpty) row(Icons.event_note_outlined, Text(e.calendar)),
          if (e.location.isNotEmpty) row(Icons.place_outlined, SelectableText(e.location)),
          if (e.meetingUrl.isNotEmpty)
            row(Icons.videocam_outlined, InkWell(onTap: () => launchUrl(Uri.parse(e.meetingUrl), mode: LaunchMode.externalApplication), child: Text('Join meeting', style: TextStyle(color: t.colorScheme.primary, fontWeight: FontWeight.w600)))),
          if (e.organizer.isNotEmpty) row(Icons.person_outline, Text('Organizer: ${e.organizer}')),
          if (e.attendees.isNotEmpty) row(Icons.group_outlined, Text(e.attendees.join(', '))),
          if (e.description.isNotEmpty) row(Icons.notes, SelectableText(e.description)),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (e.writable)
              FilledButton.tonalIcon(
                icon: const Icon(Icons.edit_outlined, size: 18),
                label: Text(e.recurring ? 'Edit series' : 'Edit'),
                onPressed: () async {
                  final ok = await openEventEditor(c, api, calendars: calendars, existing: e);
                  if (ok && c.mounted) Navigator.pop(c, true);
                },
              ),
            if (e.writable)
              OutlinedButton.icon(
                icon: Icon(Icons.delete_outline, size: 18, color: t.colorScheme.error),
                label: Text(e.recurring ? 'Delete series' : 'Delete', style: TextStyle(color: t.colorScheme.error)),
                onPressed: () async {
                  final sure = await showDialog<bool>(
                    context: c,
                    builder: (d) => AlertDialog(
                      title: Text(e.recurring ? 'Delete every event in this series?' : 'Delete this event?'),
                      content: Text('It is removed from ${e.calendar.isEmpty ? 'the calendar' : e.calendar} for everyone.'),
                      actions: [TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Delete'))],
                    ),
                  );
                  if (sure != true || !c.mounted) return;
                  final ok = await guarded(c, () => api.delete(e.eventId).then((_) => true));
                  if (ok == true && c.mounted) Navigator.pop(c, true);
                },
              ),
            if (e.htmlLink.isNotEmpty) TextButton.icon(icon: const Icon(Icons.open_in_new, size: 16), label: const Text('Open in Google'), onPressed: () => launchUrl(Uri.parse(e.htmlLink), mode: LaunchMode.externalApplication)),
          ]),
        ]),
      );
    },
  );
  return changed == true;
}

/// Create (no [existing]) or edit an event. [calendarId] preselects a calendar; [day]/[startTime] prefill the time.
Future<bool> openEventEditor(BuildContext context, CalendarApi api, {required List<CalendarInfo> calendars, CalEvent? existing, String? calendarId, DateTime? day, String? startTime, String? title}) async {
  final r = await Navigator.of(context).push<bool>(MaterialPageRoute(
    fullscreenDialog: true,
    builder: (_) => _EventEditor(api: api, calendars: calendars.where((c) => c.writable && c.syncing).toList(), existing: existing, calendarId: calendarId, day: day, startTime: startTime, title: title),
  ));
  return r == true;
}

class _EventEditor extends StatefulWidget {
  const _EventEditor({required this.api, required this.calendars, this.existing, this.calendarId, this.day, this.startTime, this.title});
  final CalendarApi api;
  final List<CalendarInfo> calendars;
  final CalEvent? existing;
  final String? calendarId, startTime, title;
  final DateTime? day;
  @override
  State<_EventEditor> createState() => _EventEditorState();
}

class _EventEditorState extends State<_EventEditor> {
  late final EventInput input;
  late final TextEditingController _title, _location, _notes;
  String _calendar = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      final endInclusive = e.allDay ? e.end.subtract(const Duration(days: 1)) : e.end;
      input = EventInput(title: e.title, location: e.location, description: e.rawDescription, allDay: e.allDay, startDate: ymd(e.start), startTime: hm(e.start), endDate: ymd(endInclusive.isBefore(e.start) ? e.start : endInclusive), endTime: hm(e.end));
      _calendar = e.calendarId;
    } else {
      final d = widget.day ?? DateTime.now();
      var start = widget.startTime ?? '${(DateTime.now().hour + 1).clamp(0, 23).toString().padLeft(2, '0')}:00';
      final h = int.parse(start.substring(0, 2)), m = start.substring(3);
      final end = '${(h + 1).clamp(0, 23).toString().padLeft(2, '0')}:${h == 23 ? '59' : m}';
      input = EventInput(title: widget.title ?? '', startDate: ymd(d), endDate: ymd(d), startTime: start, endTime: end);
      final pick = widget.calendars.where((c) => c.id == widget.calendarId).firstOrNull ?? widget.calendars.where((c) => c.primary).firstOrNull ?? widget.calendars.firstOrNull;
      _calendar = pick?.id ?? '';
    }
    _title = TextEditingController(text: input.title);
    _location = TextEditingController(text: input.location);
    _notes = TextEditingController(text: input.description);
  }

  @override
  void dispose() {
    _title.dispose();
    _location.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _pickDate(bool start) async {
    final cur = DateTime.parse(start ? input.startDate : input.endDate);
    final d = await showDatePicker(context: context, initialDate: cur, firstDate: DateTime(2000), lastDate: DateTime(2100));
    if (d == null) return;
    setState(() {
      if (start) {
        final span = DateTime.parse(input.endDate).difference(DateTime.parse(input.startDate));
        input.startDate = ymd(d);
        input.endDate = ymd(d.add(span));
      } else {
        input.endDate = ymd(d);
      }
    });
  }

  Future<void> _pickTime(bool start) async {
    final v = start ? input.startTime : input.endTime;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.parse(v.substring(0, 2)), minute: int.parse(v.substring(3))));
    if (t == null) return;
    final s = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    setState(() {
      if (start) {
        // Keep the duration when the start moves.
        final old = int.parse(input.startTime.substring(0, 2)) * 60 + int.parse(input.startTime.substring(3));
        final oldEnd = int.parse(input.endTime.substring(0, 2)) * 60 + int.parse(input.endTime.substring(3));
        final ne = (t.hour * 60 + t.minute + (oldEnd - old)).clamp(0, 23 * 60 + 59);
        input.startTime = s;
        if (input.startDate == input.endDate) input.endTime = '${(ne ~/ 60).toString().padLeft(2, '0')}:${(ne % 60).toString().padLeft(2, '0')}';
      } else {
        input.endTime = s;
      }
    });
  }

  Future<void> _save() async {
    input
      ..title = _title.text.trim()
      ..location = _location.text.trim()
      ..description = _notes.text;
    if (input.title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Give the event a title.')));
      return;
    }
    setState(() => _busy = true);
    final ok = await guarded(context, () async {
      if (widget.existing != null) {
        await widget.api.update(widget.existing!.eventId, input);
      } else {
        await widget.api.create(_calendar, input);
      }
      return true;
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok == true) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    String fmtDate(String d) => DateFormat('EEE, MMM d, y').format(DateTime.parse(d));
    String fmtTime(String t) => DateFormat.jm().format(DateTime(2000, 1, 1, int.parse(t.substring(0, 2)), int.parse(t.substring(3))));
    return Scaffold(
      appBar: AppBar(
        title: Text(editing ? 'Edit event' : 'New event'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilledButton(onPressed: _busy || (!editing && _calendar.isEmpty) ? null : _save, child: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save')),
          ),
        ],
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _title, autofocus: !editing, textCapitalization: TextCapitalization.sentences, decoration: const InputDecoration(labelText: 'Title', border: OutlineInputBorder())),
        const SizedBox(height: 12),
        if (!editing)
          widget.calendars.isEmpty
              ? const Text('No calendar allows editing. Settings → Emails → “Allow calendar editing”.')
              : DropdownButtonFormField<String>(
                  initialValue: _calendar.isEmpty ? null : _calendar,
                  decoration: const InputDecoration(labelText: 'Calendar', border: OutlineInputBorder()),
                  items: [
                    for (final c in widget.calendars)
                      DropdownMenuItem(value: c.id, child: Row(children: [Container(width: 10, height: 10, decoration: BoxDecoration(color: c.color, shape: BoxShape.circle)), const SizedBox(width: 8), Flexible(child: Text(c.name, overflow: TextOverflow.ellipsis))])),
                  ],
                  onChanged: (v) => setState(() => _calendar = v ?? ''),
                ),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('All day'), value: input.allDay, onChanged: (v) => setState(() => input.allDay = v)),
        Row(children: [
          const SizedBox(width: 56, child: Text('Starts')),
          Expanded(child: OutlinedButton(onPressed: () => _pickDate(true), child: Text(fmtDate(input.startDate)))),
          if (!input.allDay) ...[const SizedBox(width: 8), OutlinedButton(onPressed: () => _pickTime(true), child: Text(fmtTime(input.startTime)))],
        ]),
        const SizedBox(height: 8),
        Row(children: [
          const SizedBox(width: 56, child: Text('Ends')),
          Expanded(child: OutlinedButton(onPressed: () => _pickDate(false), child: Text(fmtDate(input.endDate)))),
          if (!input.allDay) ...[const SizedBox(width: 8), OutlinedButton(onPressed: () => _pickTime(false), child: Text(fmtTime(input.endTime)))],
        ]),
        const SizedBox(height: 12),
        TextField(controller: _location, decoration: const InputDecoration(labelText: 'Location', border: OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(controller: _notes, minLines: 3, maxLines: 8, decoration: const InputDecoration(labelText: 'Notes', border: OutlineInputBorder(), alignLabelWithHint: true)),
        if (editing && widget.existing!.recurring) const Padding(padding: EdgeInsets.only(top: 12), child: Text('Changes apply to the whole series.')),
      ]),
    );
  }
}
