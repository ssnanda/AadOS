import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/ui.dart';

/// One event occurrence as the calendar page sends it (`details[ref]`), plus its place in a day (`part`).
class CalEvent {
  CalEvent(this.ref, this.j);
  final String ref;
  final Map<String, dynamic> j;

  String get title => str(j['title']).isEmpty ? '(no title)' : str(j['title']);
  bool get allDay => j['allDay'] == true;
  String get startRaw => str(j['start']);
  String get endRaw => str(j['end']);
  Color get color => hexColor(str(j['color']));
  String get calendar => str(j['calendar']);
  String get calendarId => str(j['calendarId']);
  String get eventId => str(j['eventId']);
  String get location => str(j['location']);
  String get description => str(j['description']);
  String get rawDescription => str(j['rawDescription']);
  String get organizer => str(j['organizer']);
  String get meetingUrl => str(j['meetingUrl']);
  String get htmlLink => str(j['htmlLink']);
  String get recurrence => str(j['recurrence']);
  bool get recurring => j['recurring'] == true;
  bool get tentative => j['tentative'] == true;
  bool get writable => j['writable'] == true;
  List<String> get attendees => [for (final a in (j['attendees'] as List? ?? const [])) a is Map ? str(a['name'] ?? a['email']) : str(a)];

  /// Timed events: local instants. All-day: midnight of their dates (end exclusive).
  DateTime get start => allDay ? DateTime.parse(startRaw) : DateTime.parse(startRaw).toLocal();
  DateTime get end {
    if (endRaw.isEmpty) return allDay ? start.add(const Duration(days: 1)) : start.add(const Duration(hours: 1));
    return allDay ? DateTime.parse(endRaw) : DateTime.parse(endRaw).toLocal();
  }
}

class CalDay {
  CalDay(this.date, this.inMonth, this.isToday, this.events);
  final String date; // YYYY-MM-DD
  final bool inMonth, isToday;
  final List<CalEvent> events;
  DateTime get day => DateTime.parse(date);
}

class CalendarInfo {
  CalendarInfo(this.j);
  final Map<String, dynamic> j;
  String get id => str(j['id']);
  String get name => str(j['name']);
  Color get color => hexColor(str(j['color']));
  bool get writable => j['writable'] == true;
  bool get shown => j['shown'] != false;
  bool get syncing => j['syncing'] != false;
  bool get primary => j['primary'] == true;
}

class CalendarPage {
  CalendarPage(this.j)
      : days = [
          for (final d in maps(j['days']))
            CalDay(str(d['date']), d['inMonth'] != false, d['isToday'] == true, [
              for (final i in maps(d['items']))
                CalEvent(str(i['ref']), {...mapOf(mapOf(j['details'])[str(i['ref'])]), 'part': i['part'], if (i['color'] != null) 'color': i['color']}),
            ]),
        ],
        calendars = [for (final c in maps(j['calendars'])) CalendarInfo(c)];
  final Map<String, dynamic> j;
  final List<CalDay> days;
  final List<CalendarInfo> calendars;
  String get view => str(j['view']);
  String get date => str(j['date']);
  String get today => str(j['today']);
  String get prev => str(j['prev']);
  String get next => str(j['next']);
  String get tz => str(j['tz']);
  int get enabled => numOf(j['enabled']).toInt();
  bool get canEditAny => j['canEditAny'] == true;
  List<String> get errors => [for (final e in maps(j['errors'])) '${str(e['label'])}: ${str(e['message'])}'];
}

/// What the event form sends (wall-clock date/time in the owner's zone; all-day end date inclusive).
class EventInput {
  EventInput({this.title = '', this.description = '', this.location = '', this.allDay = false, required this.startDate, this.startTime = '09:00', required this.endDate, this.endTime = '10:00'});
  String title, description, location, startDate, startTime, endDate, endTime;
  bool allDay;
  Map<String, dynamic> toJson() => {'title': title, 'description': description, 'location': location, 'allDay': allDay, 'startDate': startDate, 'startTime': startTime, 'endDate': endDate, 'endTime': endTime};
}

String ymd(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String hm(DateTime d) => '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

/// Calendar and Conference Room endpoints (same data and permission checks as the web pages).
class CalendarApi {
  CalendarApi(this.api);
  final Api api;

  Future<CalendarPage> page({required String view, String date = '', String off = ''}) async =>
      CalendarPage(await api.get('/calendar/data', query: {'view': view, 'date': date, 'off': off}) as Map<String, dynamic>);

  /// Provider sync (Google incremental, Zoho window). True when events changed.
  Future<bool> sync() async {
    final r = await api.post('/calendar/live', const {}, timeout: const Duration(seconds: 90));
    return r is Map && r['changed'] == true;
  }

  Future<void> create(String calendarId, EventInput input) => api.post('/calendar/events', {'op': 'create', 'calendarId': calendarId, 'input': input.toJson()}, timeout: const Duration(seconds: 60));
  Future<void> update(String eventId, EventInput input) => api.post('/calendar/events', {'op': 'update', 'eventId': eventId, 'input': input.toJson()}, timeout: const Duration(seconds: 60));
  Future<void> delete(String eventId) => api.post('/calendar/events', {'op': 'delete', 'eventId': eventId}, timeout: const Duration(seconds: 60));

  Future<Map<String, dynamic>> room() async => await api.get('/room/data') as Map<String, dynamic>;
  Future<void> pickRoom(String id) => api.post('/room/data', {'id': id});
}
