import 'package:flutter/material.dart';

import 'session.dart';

/// Makes the [Session] available below the app root (`SessionScope.of(context)`), rebuilding on sign-in/out.
class SessionScope extends InheritedNotifier<Session> {
  const SessionScope({super.key, required Session session, required super.child}) : super(notifier: session);

  static Session of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<SessionScope>()!.notifier!;
  static Session read(BuildContext context) => context.getInheritedWidgetOfExactType<SessionScope>()!.notifier!;
}

void toast(BuildContext context, String message, {SnackBarAction? action}) {
  final m = ScaffoldMessenger.maybeOf(context);
  m?.hideCurrentSnackBar();
  m?.showSnackBar(SnackBar(content: Text(message), action: action, duration: Duration(seconds: action == null ? 3 : 5)));
}
