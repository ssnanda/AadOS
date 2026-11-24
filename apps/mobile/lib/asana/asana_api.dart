import '../core/api.dart';
import '../core/ui.dart';

/// Workflow stage of a My Tasks section (same aliases as the web's asana-model.ts).
String? stageOf(String? section) {
  final n = (section ?? '').trim().toLowerCase();
  if (const ['incoming', 'recently assigned'].contains(n)) return 'incoming';
  if (const ['to do', 'todo', 'to-do', 'acknowledged'].contains(n)) return 'todo';
  if (const ['doing', 'in progress'].contains(n)) return 'doing';
  if (const ['done', 'complete', 'completed'].contains(n)) return 'done';
  return null;
}

const stageNext = {'incoming': ('Acknowledge', 'todo'), 'todo': ('Start', 'doing'), 'doing': ('Done', 'done')};

class AsanaTask {
  AsanaTask(this.j);
  final Map<String, dynamic> j;
  String get gid => str(j['gid']);
  String get name => str(j['name']);
  String get notes => str(j['notes']);
  String? get dueOn => j['dueOn'] == null ? null : str(j['dueOn']);
  String? get dueAt => j['dueAt'] == null ? null : str(j['dueAt']);
  bool get completed => j['completed'] == true;
  String get sectionName => str(j['sectionName']);
  String? get stage => stageOf(sectionName);
  String get permalink => str(j['permalink']);
  int get numSubtasks => numOf(j['numSubtasks']).toInt();
  List<String> get projects => [for (final p in maps(j['projects'])) str(p['name'])];
  bool get recurring => mapOf(j['recurrence'])['type'] != null && mapOf(j['recurrence'])['type'] != 'never';

  /// Due day (YYYY-MM-DD) in the phone's zone for timed tasks.
  String? get dueDay {
    if (dueAt != null && dueAt!.isNotEmpty) {
      final d = DateTime.parse(dueAt!).toLocal();
      return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    }
    return dueOn;
  }

  DateTime? get dueTime => dueAt == null || dueAt!.isEmpty ? null : DateTime.parse(dueAt!).toLocal();
}

class AsanaData {
  AsanaData(this.j) : tasks = [for (final t in maps(j['tasks'])) AsanaTask(t)];
  final Map<String, dynamic> j;
  final List<AsanaTask> tasks;
  bool get connected => j['connected'] == true;
  String get today => str(j['today']);
  String get error => str(j['error']);
  bool get aiAvailable => j['aiAvailable'] == true;
  List<Map<String, dynamic>> get projects => maps(j['projects']);
  Map<String, dynamic> get timers => mapOf(j['timers']);
}

/// Live Asana through AadOS (/asana/data + /asana/api — the token stays on the server).
class AsanaApi {
  AsanaApi(this.api);
  final Api api;

  Future<AsanaData> load() async => AsanaData(await api.get('/asana/data', timeout: const Duration(seconds: 45)) as Map<String, dynamic>);

  Future<Map<String, dynamic>> op(String op, [Map<String, dynamic> body = const {}, Duration timeout = const Duration(seconds: 45)]) async =>
      mapOf(await api.post('/asana/api', {'op': op, ...body}, timeout: timeout));
}
