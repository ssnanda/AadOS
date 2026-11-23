import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import 'models.dart';

class CalendarEventDraft {
  CalendarEventDraft({
    required this.title,
    required this.start,
    required this.end,
    required this.allDay,
    required this.location,
    required this.notes,
  });

  final String title, location, notes;
  final DateTime start, end;
  final bool allDay;

  static CalendarEventDraft? fromEmail(EmailRow row, MessageBody body) {
    final text = _plain(body).replaceAll(RegExp(r'\s+'), ' ').trim();
    final eventWords = RegExp(
      r'\b(event|appointment|meeting|reservation|interview|showing|webinar|conference|ceremony|class|call|zoom|teams)\b',
      caseSensitive: false,
    );
    final date = _dateIn(row.due) ?? _dateIn(text);
    if (date == null ||
        (row.action != 'appointment' &&
            !eventWords.hasMatch('${row.subject} $text')))
      return null;

    final time = _timeIn(text);
    final start = DateTime(
      date.year,
      date.month,
      date.day,
      time?.$1 ?? 9,
      time?.$2 ?? 0,
    );
    final location =
        RegExp(
          r'\b(?:location|where|address)\s*:\s*([^\n\r|]{3,120})',
          caseSensitive: false,
        ).firstMatch(_plain(body))?.group(1)?.trim() ??
        '';
    return CalendarEventDraft(
      title: row.subject.trim().isEmpty
          ? 'Event from email'
          : row.subject.trim(),
      start: start,
      end: start.add(const Duration(hours: 1)),
      allDay: time == null,
      location: location,
      notes:
          'From: ${row.sender}\n\n${text.length > 1200 ? '${text.substring(0, 1200)}…' : text}',
    );
  }

  static String _plain(MessageBody body) {
    if (body.text.trim().isNotEmpty) return body.text;
    return body.html
        .replaceAll(
          RegExp(r'<(?:br|/p|/div|/li|/tr)[^>]*>', caseSensitive: false),
          '\n',
        )
        .replaceAll(RegExp(r'<[^>]+>'), ' ')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>');
  }

  static DateTime? _dateIn(String value) {
    final iso = RegExp(
      r'\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b',
    ).firstMatch(value);
    if (iso != null)
      return DateTime(
        int.parse(iso[1]!),
        int.parse(iso[2]!),
        int.parse(iso[3]!),
      );

    final numeric = RegExp(
      r'\b(\d{1,2})/(\d{1,2})/(20\d{2}|\d{2})\b',
    ).firstMatch(value);
    if (numeric != null) {
      var year = int.parse(numeric[3]!);
      if (year < 100) year += 2000;
      return DateTime(year, int.parse(numeric[1]!), int.parse(numeric[2]!));
    }

    final named = RegExp(
      r'\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b',
      caseSensitive: false,
    ).firstMatch(value);
    if (named == null) return null;
    final year = int.tryParse(named[3] ?? '') ?? DateTime.now().year;
    for (final pattern in ['MMMM d y', 'MMM d y']) {
      try {
        return DateFormat(
          pattern,
          'en_US',
        ).parseStrict('${named[1]} ${named[2]} $year');
      } catch (_) {}
    }
    return null;
  }

  static (int, int)? _timeIn(String value) {
    final m = RegExp(
      r'\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b',
      caseSensitive: false,
    ).firstMatch(value);
    if (m == null) return null;
    var hour = int.parse(m[1]!);
    final minute = int.tryParse(m[2] ?? '') ?? 0;
    final pm = m[3]!.toLowerCase().startsWith('p');
    if (hour == 12) hour = 0;
    if (pm) hour += 12;
    return (hour, minute);
  }
}

class AppleCalendar {
  static const _channel = MethodChannel('com.aadnanda.aados/apple_calendar');

  static Future<void> create(
    BuildContext context,
    CalendarEventDraft initial,
  ) async {
    final draft = await showDialog<_EditableEvent>(
      context: context,
      builder: (_) => _EventDialog(initial),
    );
    if (draft == null || !context.mounted) return;
    try {
      await _channel.invokeMethod<bool>('createEvent', {
        'title': draft.title,
        'start': draft.start.millisecondsSinceEpoch,
        'end': draft.end.millisecondsSinceEpoch,
        'allDay': draft.allDay,
        'location': draft.location,
        'notes': draft.notes,
      });
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Added to Apple Calendar.')),
        );
    } on PlatformException catch (e) {
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e.message ?? 'Could not add the event to Apple Calendar.',
            ),
          ),
        );
    }
  }
}

class _EditableEvent {
  const _EditableEvent(
    this.title,
    this.start,
    this.end,
    this.allDay,
    this.location,
    this.notes,
  );
  final String title, location, notes;
  final DateTime start, end;
  final bool allDay;
}

class _EventDialog extends StatefulWidget {
  const _EventDialog(this.initial);
  final CalendarEventDraft initial;

  @override
  State<_EventDialog> createState() => _EventDialogState();
}

class _EventDialogState extends State<_EventDialog> {
  late final _title = TextEditingController(text: widget.initial.title);
  late final _location = TextEditingController(text: widget.initial.location);
  late final _notes = TextEditingController(text: widget.initial.notes);
  late DateTime _start = widget.initial.start, _end = widget.initial.end;
  late bool _allDay = widget.initial.allDay;

  @override
  void dispose() {
    _title.dispose();
    _location.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _pickStart() async {
    final day = await showDatePicker(
      context: context,
      initialDate: _start,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 3650)),
    );
    if (day == null || !mounted) return;
    var next = DateTime(
      day.year,
      day.month,
      day.day,
      _start.hour,
      _start.minute,
    );
    if (!_allDay) {
      final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(_start),
      );
      if (time == null) return;
      next = DateTime(day.year, day.month, day.day, time.hour, time.minute);
    }
    setState(() {
      _start = next;
      if (!_end.isAfter(_start)) _end = _start.add(const Duration(hours: 1));
    });
  }

  Future<void> _pickEnd() async {
    final day = await showDatePicker(
      context: context,
      initialDate: _end,
      firstDate: _start,
      lastDate: DateTime.now().add(const Duration(days: 3650)),
    );
    if (day == null || !mounted) return;
    var next = DateTime(day.year, day.month, day.day, _end.hour, _end.minute);
    if (!_allDay) {
      final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(_end),
      );
      if (time == null) return;
      next = DateTime(day.year, day.month, day.day, time.hour, time.minute);
    }
    if (!next.isAfter(_start)) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('End must be after start.')),
        );
      return;
    }
    setState(() => _end = next);
  }

  @override
  Widget build(BuildContext context) {
    final date = DateFormat.yMMMd().add_jm();
    return AlertDialog(
      title: const Text('Add to Apple Calendar'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _title,
              decoration: const InputDecoration(labelText: 'Title'),
            ),
            TextField(
              controller: _location,
              decoration: const InputDecoration(labelText: 'Location'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('All day'),
              value: _allDay,
              onChanged: (v) => setState(() => _allDay = v),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Starts'),
              subtitle: Text(
                _allDay
                    ? DateFormat.yMMMd().format(_start)
                    : date.format(_start),
              ),
              onTap: _pickStart,
            ),
            if (!_allDay)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Ends'),
                subtitle: Text(date.format(_end)),
                onTap: _pickEnd,
              ),
            TextField(
              controller: _notes,
              minLines: 2,
              maxLines: 5,
              decoration: const InputDecoration(labelText: 'Notes'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _title.text.trim().isEmpty
              ? null
              : () {
                  final end = _allDay
                      ? DateTime(_start.year, _start.month, _start.day + 1)
                      : _end;
                  Navigator.pop(
                    context,
                    _EditableEvent(
                      _title.text.trim(),
                      _start,
                      end,
                      _allDay,
                      _location.text.trim(),
                      _notes.text.trim(),
                    ),
                  );
                },
          child: const Text('Add'),
        ),
      ],
    );
  }
}
