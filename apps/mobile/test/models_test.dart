import 'package:aados_mobile/core/format.dart';
import 'package:aados_mobile/core/session.dart';
import 'package:aados_mobile/email/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('inbox page parses rows, counts, accounts with folders', () {
    final page = InboxPage.fromJson({
      'rows': [
        {'key': 'a1:m1', 'pipelineId': 'p1', 'messageId': 'm1', 'subject': 'Hi', 'sender': '"Jane Doe" <jane@x.com>', 'receivedAt': '2026-11-20T10:00:00Z', 'unread': true, 'accountId': 'a1', 'accountEmail': 'me@gmail.com', 'provider': 'gmail', 'categories': ['People'], 'importance': 'high', 'action': 'reply', 'reviewed': false, 'followUp': '', 'threadCount': 2}
      ],
      'total': 1, 'page': 1, 'pages': 1,
      'counts': {'unread': 5, 'all': 9, 'needsReply': 1, 'categories': {'People': 3}},
      'accounts': [{'id': 'a1', 'provider': 'gmail', 'email': 'me@gmail.com', 'lastError': ''}],
      'folders': [{'id': 'a1', 'unread': 4, 'folders': [{'id': 'INBOX', 'name': 'Inbox', 'unread': 4, 'total': 10}]}],
      'views': [], 'insights': {}, 'aiAvailable': true, 'aiBlocked': '',
    });
    expect(page.rows.single.important, isTrue);
    expect(page.rows.single.needsAction, isTrue);
    expect(page.rows.single.actionLabel, 'Needs reply');
    expect(page.counts['unread'], 5);
    expect(page.categoryCounts['People'], 3);
    expect(page.accounts.single.folders.single.unread, 4);
    expect(page.aiReady, isTrue);
  });

  test('query params drop empty values and page 1', () {
    expect(const InboxQuery(account: 'a1').params(1), containsPair('account', 'a1'));
    expect(const InboxQuery().params(1).containsKey('page'), isFalse);
    expect(const InboxQuery().params(3)['page'], '3');
  });

  test('sender display helpers', () {
    expect(displayName('"Jane Doe" <jane@x.com>'), 'Jane Doe');
    expect(displayName('<jane@x.com>'), 'jane@x.com');
    expect(initials('Jane Doe <jane@x.com>'), 'JD');
    expect(emailAddress('Jane <jane@x.com>'), 'jane@x.com');
  });

  test('server address: https by default, http only for local dev hosts', () {
    expect(Session.normaliseServer('os.aadnanda.com'), 'https://os.aadnanda.com');
    expect(Session.normaliseServer('https://os.aadnanda.com/emails'), 'https://os.aadnanda.com');
    expect(Session.normaliseServer('http://example.com'), isNull);
    expect(Session.normaliseServer('http://localhost:3000'), 'http://localhost:3000');
    expect(Session.normaliseServer(''), isNull);
  });
}
