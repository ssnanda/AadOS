import '../core/api.dart';
import 'models.dart';

/// Email endpoints on the AadOS server. Everything that touches Gmail/Zoho runs there.
class MailApi {
  MailApi(this.api);
  final Api api;

  Future<InboxPage> list(InboxQuery q, {int page = 1}) async =>
      InboxPage.fromJson(await api.get('/api/mobile/emails', query: q.params(page)) as Map<String, dynamic>);

  /// Live sync of what is on screen (newest page of the open folder). True when stored mail changed.
  Future<bool> liveSync(InboxQuery q, {bool force = false}) async {
    final r = await api.post('/sync/live', {'account': q.account, 'folder': q.folder, 'pipeline': q.pipeline, 'q': q.q, 'force': force}, timeout: const Duration(seconds: 60));
    return r is Map && r['changed'] == true;
  }

  /// delete | mark-read | mark-unread | importance-high | importance-normal | follow-up | clear-follow-up |
  /// actionable | reviewed | dismissed | clear-action. Returns a warning for partly failed changes ('' = none).
  Future<String> mark(String op, List<String> keys) async {
    final r = await api.post('/api/mobile/emails/mark', {'op': op, 'keys': keys}, timeout: const Duration(seconds: 60));
    return r is Map ? (r['warning'] ?? '').toString() : '';
  }

  /// Opening (not prefetching) marks the email read, in AadOS and in the mailbox.
  Future<MessageBody> body(EmailRow row, {bool prefetch = false}) async {
    final r = await api.get('/pipelines/${Uri.encodeComponent(row.pipelineId)}/message/${Uri.encodeComponent(row.messageId)}',
        query: prefetch ? {'prefetch': '1'} : null, timeout: const Duration(seconds: 45)) as Map<String, dynamic>;
    return MessageBody((r['html'] ?? '').toString(), (r['text'] ?? '').toString());
  }

  Future<Map<String, dynamic>> _tool(String op, String key, [Map<String, dynamic> extra = const {}, Duration timeout = const Duration(seconds: 45)]) async =>
      await api.post('/emails/tools', {'op': op, 'key': key, ...extra}, timeout: timeout) as Map<String, dynamic>;

  Future<MessageDetails> details(String key) async => MessageDetails.fromJson(await _tool('details', key));

  Future<ComposeDraft> prepare(String key, String mode) async => ComposeDraft.fromJson(await _tool('prepare', key, {'mode': mode}), mode: mode);

  Future<ComposeDraft> prepareResidential(String key) async => ComposeDraft.fromJson(await _tool('prepareResidential', key), mode: 'reply', residential: true);

  /// Sends only on this explicit call. Returns the server's note ('' = none).
  Future<String> send(String key, {required String mode, required String to, required String cc, required String bcc, required String subject, required String text, required bool attachments, bool residential = false}) async {
    final r = await _tool('send', key, {'mode': mode, 'to': to, 'cc': cc, 'bcc': bcc, 'subject': subject, 'text': text, 'attachments': attachments, 'residential': residential}, const Duration(seconds: 90));
    return (r['note'] ?? '').toString();
  }

  Future<RelatedResult> related(EmailRow row, {bool domain = false}) async {
    final r = await _tool('related', row.key, {'scope': domain ? 'domain' : 'sender', 'sameSubject': false});
    return RelatedResult((r['sender'] ?? '').toString(), (r['domain'] ?? '').toString(), (r['total'] as num?)?.toInt() ?? 0,
        [for (final x in (r['rows'] as List? ?? const [])) EmailRow.related(x as Map<String, dynamic>, fallbackAccount: row.accountId)]);
  }

  // ---- AI (AJMCP on the server; nothing here sends or changes mail) ----
  Future<Insight?> insight(String key) async {
    final r = await api.post('/emails/ai', {'op': 'state', 'key': key}) as Map<String, dynamic>;
    final i = r['insight'];
    if (i is Map && i['status'] == 'done' && i['insight'] is Map) return Insight.fromJson(i['insight'] as Map<String, dynamic>);
    return null;
  }

  /// summarize | explain | followup → the AI's answer text.
  Future<String> ask(String op, String key) async {
    final r = await api.post('/emails/ai', {'op': op, 'key': key}, timeout: const Duration(seconds: 90)) as Map<String, dynamic>;
    return (r['answer'] ?? r['reply'] ?? r['text'] ?? '').toString();
  }

  /// A reply draft; with [current] text the AI polishes it instead of replacing it.
  Future<String> draft(String key, {String current = ''}) async {
    final r = await api.post('/emails/ai', {'op': 'draft', 'key': key, 'tone': current.trim().isEmpty ? 'reply' : 'polish', 'current': current},
        timeout: const Duration(seconds: 90)) as Map<String, dynamic>;
    return ((r['draft'] as Map?)?['content'] ?? '').toString();
  }
}
