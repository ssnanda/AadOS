import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// A failed AadOS call: HTTP status (0 = no connection) and the server's readable message.
class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;
  bool get unauthorized => status == 401;
  bool get offline => status == 0;
  @override
  String toString() => message;
}

/// JSON client for one AadOS server. The signed session token goes in `Authorization: Bearer`;
/// Gmail/Zoho credentials stay on the server. Every request body is JSON (SvelteKit's origin check
/// only applies to form posts, which the app never sends).
class Api {
  Api({required this.server, this.token, this.onUnauthorized});

  final Uri server;
  String? token;

  /// Called once per 401 so the app can return to the sign-in screen.
  void Function()? onUnauthorized;

  final http.Client _http = http.Client();

  Uri uri(String path, [Map<String, String>? query]) {
    final u = server.resolve(path);
    final q = {...?query}..removeWhere((_, v) => v.isEmpty);
    return q.isEmpty ? u : u.replace(queryParameters: q);
  }

  Map<String, String> get _headers => {
        'accept': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      };

  Future<dynamic> get(String path, {Map<String, String>? query, Duration timeout = const Duration(seconds: 30)}) =>
      _send(() => _http.get(uri(path, query), headers: _headers), timeout);

  Future<dynamic> post(String path, Object body, {Duration timeout = const Duration(seconds: 30)}) => _send(
        () => _http.post(uri(path), headers: {..._headers, 'content-type': 'application/json'}, body: jsonEncode(body)),
        timeout,
      );

  Future<dynamic> _send(Future<http.Response> Function() call, Duration timeout) async {
    http.Response res;
    try {
      res = await call().timeout(timeout);
    } on TimeoutException {
      throw ApiException(0, 'AadOS did not answer in time.');
    } on SocketException {
      throw ApiException(0, 'No connection to AadOS.');
    } on http.ClientException catch (e) {
      throw ApiException(0, 'No connection to AadOS (${e.message}).');
    } on HandshakeException {
      throw ApiException(0, 'Secure connection to AadOS failed.');
    }
    dynamic body;
    try {
      body = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    // SvelteKit `error()` answers {message}; the JSON endpoints answer {error}.
    final msg = body is Map ? (body['error'] ?? body['message'] ?? '').toString() : '';
    // Only AadOS's own session 401 signs out; Asana or BlueBubbles also answer 401 when *their* token is bad.
    if (res.statusCode == 401 && (res.headers['x-aados-signin'] == '1' || msg == 'Sign in again.')) onUnauthorized?.call();
    throw ApiException(res.statusCode, msg.isNotEmpty ? msg : 'AadOS answered HTTP ${res.statusCode}.');
  }

  void close() => _http.close();
}
