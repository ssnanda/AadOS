import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';

class AppUser {
  AppUser({required this.name, required this.owner, required this.permissions});
  final String name;
  final bool owner;
  final List<String> permissions;

  bool can(String permission) => owner || permissions.contains(permission);

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        name: (j['name'] ?? '').toString(),
        owner: j['owner'] == true,
        permissions: [for (final p in (j['permissions'] as List? ?? const [])) p.toString()],
      );
  Map<String, dynamic> toJson() => {'name': name, 'owner': owner, 'permissions': permissions};
}

/// Signed-in state: server URL, session token (Keychain / Keystore) and who is signed in.
class Session extends ChangeNotifier {
  static const defaultServer = 'https://os.aadnanda.com';
  static const _kServer = 'aados.server', _kToken = 'aados.token', _kUser = 'aados.user';
  final FlutterSecureStorage _store = const FlutterSecureStorage();

  String server = defaultServer;
  String? token;
  AppUser? user;
  String serverVersion = '';
  bool ready = false;
  late Api api = _newApi();

  bool get signedIn => token != null;

  Api _newApi() => Api(server: Uri.parse(server), token: token, onUnauthorized: _expired);

  /// Restore the saved session. The token is re-checked in the background; offline keeps it.
  Future<void> restore() async {
    try {
      server = await _store.read(key: _kServer) ?? defaultServer;
      token = await _store.read(key: _kToken);
      final u = await _store.read(key: _kUser);
      if (u != null) user = AppUser.fromJson(jsonDecode(u) as Map<String, dynamic>);
    } catch (_) {
      token = null; // unreadable keychain entry (e.g. restored backup): sign in again
    }
    api = _newApi();
    ready = true;
    notifyListeners();
    if (token != null) refreshMe();
  }

  Future<void> refreshMe() async {
    try {
      final me = await api.get('/api/mobile/me') as Map<String, dynamic>;
      user = AppUser.fromJson(me['user'] as Map<String, dynamic>);
      serverVersion = (me['version'] ?? '').toString();
      await _store.write(key: _kUser, value: jsonEncode(user!.toJson()));
      notifyListeners();
    } on ApiException {
      // 401 is handled by onUnauthorized; offline keeps the stored session.
    }
  }

  /// Normalises what was typed ("os.example.com" → https://os.example.com). Plain HTTP only for local dev hosts.
  static String? normaliseServer(String input) {
    var s = input.trim();
    if (s.isEmpty) return null;
    if (!s.contains('://')) s = 'https://$s';
    final u = Uri.tryParse(s);
    if (u == null || u.host.isEmpty) return null;
    const local = {'localhost', '127.0.0.1', '10.0.2.2'};
    if (u.scheme != 'https' && !(u.scheme == 'http' && local.contains(u.host))) return null;
    return Uri(scheme: u.scheme, host: u.host, port: u.hasPort ? u.port : null).toString();
  }

  Future<void> signIn(String serverInput, String username, String password) async {
    final s = normaliseServer(serverInput);
    if (s == null) throw ApiException(400, 'Enter the AadOS address (https://…).');
    final probe = Api(server: Uri.parse(s));
    try {
      final r = await probe.post('/api/mobile/login', {'username': username, 'password': password}) as Map<String, dynamic>;
      server = s;
      token = r['token'] as String;
      user = AppUser.fromJson(r['user'] as Map<String, dynamic>);
    } finally {
      probe.close();
    }
    await _store.write(key: _kServer, value: server);
    await _store.write(key: _kToken, value: token);
    await _store.write(key: _kUser, value: jsonEncode(user!.toJson()));
    api.close();
    api = _newApi();
    notifyListeners();
    refreshMe();
  }

  /// A re-issued token (password change in Settings signs every other session out). Updated in place on the shared
  /// [Api], without notifying, so open screens and the home shell (keyed by token) are not rebuilt.
  Future<void> replaceToken(String next) async {
    if (next.isEmpty || next == token) return;
    token = next;
    api.token = next;
    await _store.write(key: _kToken, value: next);
  }

  /// Forgets the token on this device. (Settings → General → "Sign out everywhere" on the web ends it server-side.)
  Future<void> signOut() async {
    token = null;
    user = null;
    await _store.delete(key: _kToken);
    await _store.delete(key: _kUser);
    api.close();
    api = _newApi();
    notifyListeners();
  }

  bool _expiring = false;
  void _expired() {
    if (_expiring || token == null) return;
    _expiring = true;
    signOut().whenComplete(() => _expiring = false);
  }
}
