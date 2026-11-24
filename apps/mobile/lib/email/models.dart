// Mirrors of the server's inbox JSON (apps/web/src/lib/server/inbox.ts InboxRow / InboxResult, email-list.ts).

List<String> _strings(dynamic v) => [for (final x in (v as List? ?? const [])) x.toString()];
int _int(dynamic v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
String _str(dynamic v) => v == null ? '' : v.toString();

class EmailRow {
  EmailRow.fromJson(Map<String, dynamic> j)
      : key = _str(j['key']),
        id = _str(j['id']),
        pipelineId = _str(j['pipelineId']),
        messageId = _str(j['messageId']),
        subject = _str(j['subject']),
        sender = _str(j['sender']),
        to = _strings(j['to']),
        receivedAt = DateTime.tryParse(_str(j['receivedAt'])),
        summary = _str(j['summary']),
        unread = j['unread'] == true,
        accountId = _str(j['accountId']),
        accountEmail = _str(j['accountEmail']),
        provider = _str(j['provider']),
        categories = _strings(j['categories']),
        important = j['importance'] == 'high',
        action = j['action'] == null ? null : _str(j['action']),
        actionReason = _str(j['actionReason']),
        due = _str(j['due']),
        reviewed = j['reviewed'] == true,
        followUp = _str(j['followUp']).isNotEmpty,
        threadId = _str(j['threadId']),
        threadCount = _int(j['threadCount']),
        pipelines = _strings(j['pipelines']),
        savedKind = _str(j['savedKind']),
        savedExpiry = _str(j['savedExpiry']);

  /// Related-email rows ("More from sender") carry fewer fields.
  EmailRow.related(Map<String, dynamic> j, {required String fallbackAccount})
      : key = _str(j['key']),
        id = '',
        pipelineId = _str(j['pipelineId']),
        messageId = _str(j['messageId']),
        subject = _str(j['subject']),
        sender = _str(j['sender']),
        to = const [],
        receivedAt = DateTime.tryParse(_str(j['receivedAt'])),
        summary = _str(j['summary']),
        unread = j['unread'] == true,
        accountId = _str(j['key']).contains(':') ? _str(j['key']).split(':').first : fallbackAccount,
        accountEmail = _str(j['accountEmail']),
        provider = _str(j['provider']),
        categories = const [],
        important = false,
        action = null,
        actionReason = '',
        due = '',
        reviewed = false,
        followUp = false,
        threadId = '',
        threadCount = 0,
        pipelines = const [],
        savedKind = '',
        savedExpiry = '';

  final String key, id, pipelineId, messageId, subject, sender, summary, accountId, accountEmail, provider, due, threadId;
  final DateTime? receivedAt;
  final List<String> categories, pipelines;

  /// Addresses the email was sent to (aliases included), lower-case.
  final List<String> to;
  String actionReason;
  String? action;
  String savedKind, savedExpiry;
  final int threadCount;
  // Changed optimistically by the app before the server confirms.
  bool unread, important, reviewed, followUp;

  bool get manuallyPending => actionReason == 'Marked by you' && !reviewed;
  String get actionLabel {
    if (manuallyPending) return 'Pending action';
    return switch (action) {
      'reply' => 'Needs reply',
      'financial' => 'Payment',
      'appointment' => 'Appointment',
      null => '',
      _ => 'To-do',
    };
  }
  bool get needsAction => action != null && !reviewed;
}

class Insight {
  Insight.fromJson(Map<String, dynamic> j)
      : summary = _str(j['summary']),
        category = _str(j['category']),
        confidence = (j['confidence'] as num?)?.toDouble() ?? 0,
        needsReply = j['needsReply'] == true,
        paymentDue = j['paymentDue'] == null ? null : _str(j['paymentDue']);
  final String summary, category;
  final double confidence;
  final bool needsReply;
  final String? paymentDue;
}

class MailFolder {
  MailFolder.fromJson(Map<String, dynamic> j)
      : id = _str(j['id']),
        name = _str(j['name']),
        unread = _int(j['unread']),
        total = _int(j['total']);
  final String id, name;
  final int unread, total;
}

class MailAccount {
  MailAccount(Map<String, dynamic> a, Map<String, dynamic>? f)
      : id = _str(a['id']),
        provider = _str(a['provider']),
        email = _str(a['email']),
        lastError = _str(a['lastError']),
        paused = a['paused'] == true,
        lastChecked = [DateTime.tryParse(_str(a['lastSync'])), DateTime.tryParse(_str(a['unreadCheckedAt']))].whereType<DateTime>().fold<DateTime?>(null, (p, d) => p == null || d.isAfter(p) ? d : p),
        unread = f == null ? _int(a['unread']) : _int(f['unread']),
        folders = [for (final x in (f?['folders'] as List? ?? const [])) MailFolder.fromJson(x as Map<String, dynamic>)];
  final String id, provider, email, lastError;
  final bool paused;
  final DateTime? lastChecked;
  final int unread;
  final List<MailFolder> folders;
}

class SavedView {
  SavedView.fromJson(Map<String, dynamic> j)
      : id = _str(j['id']),
        name = _str(j['name']),
        parser = _str(j['parser']),
        unread = _int(j['unread']),
        total = _int(j['total']);
  final String id, name, parser;
  final int unread, total;
}

/// What is on screen: the web's URL parameters for /emails.
class InboxQuery {
  const InboxQuery({this.view = 'unread', this.account = '', this.folder = '', this.q = '', this.category = '', this.sender = '', this.thread = '', this.pipeline = '', this.kind = '', this.saved = ''});
  final String view, account, folder, q, category, sender, thread, pipeline;

  /// Shopping tile picked: a parsed kind of the view's copy (order, shipping…) or a saved value (coupon, gift-card).
  final String kind, saved;

  InboxQuery copyWith({String? view, String? account, String? folder, String? q, String? category, String? sender, String? thread, String? pipeline, String? kind, String? saved}) => InboxQuery(
        view: view ?? this.view,
        account: account ?? this.account,
        folder: folder ?? this.folder,
        q: q ?? this.q,
        category: category ?? this.category,
        sender: sender ?? this.sender,
        thread: thread ?? this.thread,
        pipeline: pipeline ?? this.pipeline,
        kind: kind ?? this.kind,
        saved: saved ?? this.saved,
      );

  /// The Shopping tile this query lists (`saved:coupon`, `kind:order`), or '' when none is picked.
  String get tileKey => saved.isNotEmpty ? 'saved:$saved' : kind.isNotEmpty ? 'kind:$kind' : '';

  /// Opens a Shopping tile (its key from the server), or none with ''.
  InboxQuery withTile(String key) => copyWith(
        kind: key.startsWith('kind:') ? key.substring(5) : '',
        saved: key.startsWith('saved:') ? key.substring(6) : '',
      );

  Map<String, String> params(int page) => {
        'view': view,
        'account': account,
        'folder': folder,
        'q': q,
        'category': category,
        'sender': sender,
        'thread': thread,
        'pipeline': pipeline,
        if (kind.isNotEmpty) 'kind': kind,
        if (saved.isNotEmpty) 'saved': saved,
        if (page > 1) 'page': '$page',
      };

  bool get narrowed => category.isNotEmpty || sender.isNotEmpty || thread.isNotEmpty || pipeline.isNotEmpty;
  String get cacheKey => params(1).entries.map((e) => '${e.key}=${e.value}').join('&');
}

class InboxPage {
  InboxPage.fromJson(Map<String, dynamic> j)
      : raw = j,
        rows =[for (final r in (j['rows'] as List? ?? const [])) EmailRow.fromJson(r as Map<String, dynamic>)],
        total = _int(j['total']),
        page = _int(j['page']),
        pages = _int(j['pages']),
        counts = {for (final e in ((j['counts'] as Map?) ?? const {}).entries) if (e.value is num) e.key.toString(): (e.value as num).toInt()},
        categoryCounts = {for (final e in (((j['counts'] as Map?)?['categories'] as Map?) ?? const {}).entries) e.key.toString(): _int(e.value)},
        categories = _strings(j['categories']),
        insights = {for (final e in ((j['insights'] as Map?) ?? const {}).entries) e.key.toString(): Insight.fromJson(e.value as Map<String, dynamic>)},
        accounts = _accounts(j),
        views = [for (final v in (j['views'] as List? ?? const [])) SavedView.fromJson(v as Map<String, dynamic>)],
        folderName = _str(j['folderName']),
        aiAvailable = j['aiAvailable'] == true,
        aiBlocked = _str(j['aiBlocked']),
        savedCoupons = [for (final x in (((j['saved'] as Map?)?['coupons'] as List?) ?? const [])) SavedEmailValue.fromJson(x as Map<String, dynamic>)],
        savedGiftCards = [for (final x in (((j['saved'] as Map?)?['giftCards'] as List?) ?? const [])) SavedEmailValue.fromJson(x as Map<String, dynamic>)],
        shopTiles = j['shop'] is Map ? [for (final t in ((j['shop'] as Map)['tiles'] as List? ?? const [])) ShopTile.fromJson((t as Map).cast<String, dynamic>())] : null;

  /// Accounts joined with their folder drawer entries (`folders`, sent by /api/mobile/emails).
  static List<MailAccount> _accounts(Map<String, dynamic> j) {
    final folders = <String, Map<String, dynamic>>{
      for (final f in (j['folders'] as List? ?? const [])) _str((f as Map)['id']): f.cast<String, dynamic>(),
    };
    return [
      for (final a in (j['accounts'] as List? ?? const [])) MailAccount((a as Map).cast<String, dynamic>(), folders[_str(a['id'])]),
    ];
  }

  /// The server's JSON (kept for the instant-start cache).
  final Map<String, dynamic> raw;
  final List<EmailRow> rows;
  final int total, page, pages;
  final Map<String, int> counts, categoryCounts;
  final List<String> categories;
  final Map<String, Insight> insights;
  final List<MailAccount> accounts;
  final List<SavedView> views;
  final String folderName, aiBlocked;
  final bool aiAvailable;
  final List<SavedEmailValue> savedCoupons, savedGiftCards;

  /// Shopping view tiles (null for every other list): saved Coupons, Gift Cards, then each parsed kind.
  final List<ShopTile>? shopTiles;
  bool get aiReady => aiAvailable && aiBlocked.isEmpty;
}

class ShopTile {
  ShopTile.fromJson(Map<String, dynamic> j)
      : key = _str(j['key']),
        label = _str(j['label']),
        detail = _str(j['detail']),
        count = _int(j['count']);
  final String key, label, detail;
  final int count;
}

class SavedEmailValue {
  SavedEmailValue.fromJson(Map<String, dynamic> j)
      : key = _str(j['key']),
        subject = _str(j['subject']),
        sender = _str(j['sender']),
        expiresOn = _str(j['expiresOn']);
  final String key, subject, sender, expiresOn;
}

class MessageBody {
  MessageBody(this.html, this.text);
  final String html, text;
}

class MessageDetails {
  MessageDetails.fromJson(Map<String, dynamic> j)
      : from = _str(j['from']),
        to = _str(j['to']),
        cc = _str(j['cc']),
        account = _str(j['account']),
        provider = _str(j['provider']),
        unsubscribeUrl = _str((j['unsubscribe'] as Map?)?['url']),
        unsubscribeMailto = _str((j['unsubscribe'] as Map?)?['mailto']),
        canSend = j['canSend'] == true,
        canModify = j['canModify'] == true;
  final String from, to, cc, account, provider, unsubscribeUrl, unsubscribeMailto;
  final bool canSend, canModify;
  bool get residential => provider == 'zoho' && account.toLowerCase().endsWith('@intlord.com');
}

class ComposeDraft {
  ComposeDraft.fromJson(Map<String, dynamic> j, {required this.mode, this.residential = false})
      : from = _str(j['from']),
        to = _str(j['to']),
        cc = _str(j['cc']),
        subject = _str(j['subject']),
        quoted = _str(j['quoted']),
        provider = _str(j['provider']),
        text = _str(j['template']),
        templateTitle = _str(j['templateTitle']);
  final String mode; // reply | replyAll | forward
  final bool residential;
  final String from, to, cc, subject, quoted, provider, text, templateTitle;
}

class RelatedResult {
  RelatedResult(this.sender, this.domain, this.total, this.rows);
  final String sender, domain;
  final int total;
  final List<EmailRow> rows;
}
