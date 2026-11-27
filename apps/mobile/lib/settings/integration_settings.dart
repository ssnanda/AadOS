import 'package:flutter/material.dart';

import '../core/scope.dart';
import '../core/ui.dart';
import 'settings_api.dart';

Widget _button(String label, VoidCallback? onPressed, {bool primary = false}) =>
    primary ? FilledButton.tonal(onPressed: onPressed, child: Text(label)) : OutlinedButton(onPressed: onPressed, child: Text(label));

Widget _buttons(List<Widget> children) => Padding(
  padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
  child: Wrap(spacing: 8, runSpacing: 4, children: children),
);

/// Settings → Messages: the BlueBubbles server on the Mac (password stored encrypted, never sent back).
class MessagesSettingsScreen extends StatefulWidget {
  const MessagesSettingsScreen({super.key});
  @override
  State<MessagesSettingsScreen> createState() => _MessagesState();
}

class _MessagesState extends SettingsPageState<MessagesSettingsScreen> {
  @override
  String get page => 'messages';
  final _url = TextEditingController(), _pw = TextEditingController();
  bool _filled = false;

  @override
  void dispose() {
    _url.dispose();
    _pw.dispose();
    super.dispose();
  }

  String _info(Map<String, dynamic> r) {
    final i = mapOf(r['info']);
    final parts = [
      'Connected',
      if (str(i['version']).isNotEmpty) 'BlueBubbles ${str(i['version'])}',
      if (str(i['os']).isNotEmpty) 'macOS ${str(i['os'])}',
      i['privateApi'] == true ? 'Private API on' : 'Private API off (SMS may go as iMessage)',
      if (r.containsKey('hookError')) r['hook'] == true ? 'live updates on' : 'live updates not set up (${str(r['hookError'])})',
    ];
    return parts.join(' · ');
  }

  Future<void> _act(String action, [Map<String, Object?> fields = const {}]) async {
    final r = await run(action, fields: fields);
    if (r == null || !mounted) return;
    toast(
      context,
      r.containsKey('info') ? _info(r) : (r['disconnected'] == true ? 'Disconnected.' : (r['hook'] == true ? 'Live updates registered.' : 'Done.')),
    );
    if (action == 'save') _pw.clear();
  }

  @override
  Widget build(BuildContext context) => scaffold('Messages', (d) {
    if (!_filled) {
      _filled = true;
      _url.text = str(d['url']);
    }
    final connected = str(d['url']).isNotEmpty;
    return [
      const Padding(padding: EdgeInsets.fromLTRB(16, 10, 16, 4), child: Text('iMessage through the BlueBubbles server on your Mac.')),
      Field(_url, 'Server URL', hint: 'http://192.168.1.20:1234 or https://…', keyboard: TextInputType.url),
      Field(_pw, 'Password', secret: true, hint: d['hasPassword'] == true ? 'Saved — leave empty to keep' : 'BlueBubbles server password'),
      _buttons([
        _button('Save & connect', busy ? null : () => _act('save', {'url': _url.text.trim(), 'password': _pw.text}), primary: true),
        if (connected) _button('Test', busy ? null : () => _act('test')),
        if (connected) _button('Re-register live updates', busy ? null : () => _act('webhook')),
        if (connected)
          TextButton(
            onPressed: busy
                ? null
                : () async {
                    if (await confirm('Disconnect BlueBubbles?', ok: 'Disconnect', danger: true)) _act('disconnect');
                  },
            child: Text('Disconnect', style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
      ]),
      if (str(d['hook']).isNotEmpty) InfoRow('Live updates', str(d['hook'])),
    ];
  });
}

/// Settings → AI: AJMCP gateway (token never sent back), what AI may do and see, email triage.
class AiSettingsScreen extends StatefulWidget {
  const AiSettingsScreen({super.key});
  @override
  State<AiSettingsScreen> createState() => _AiState();
}

class _AiState extends SettingsPageState<AiSettingsScreen> {
  @override
  String get page => 'ai';
  final _url = TextEditingController(), _token = TextEditingController();
  bool _filled = false, _clearToken = false;
  Map<String, bool> _opts = {};

  @override
  void dispose() {
    _url.dispose();
    _token.dispose();
    super.dispose();
  }

  Widget _opt(String key, String title, [String? sub]) => SwitchListTile(
    title: Text(title),
    subtitle: sub == null ? null : Text(sub),
    value: _opts[key] ?? false,
    onChanged: (v) => setState(() => _opts[key] = v),
  );

  @override
  Widget build(BuildContext context) => scaffold('AI', (d) {
    final g = mapOf(d['gateway']), ai = mapOf(d['ai']), share = mapOf(ai['share']), st = mapOf(d['status']);
    if (!_filled) {
      _filled = true;
      _url.text = str(g['url']);
      _opts = {
        'enabled': ai['enabled'] == true,
        'background': ai['background'] == true,
        'emailBodies': ai['emailBodies'] == true,
        'shareEmail': share['email'] == true,
        'shareCalendar': share['calendar'] == true,
        'shareDocuments': share['documents'] == true,
        'shareFinance': share['finance'] == true,
      };
    }
    final configured = d['configured'] == true;
    final triage = mapOf(d['triage']), ins = mapOf(d['insights']);
    return [
      ListTile(
        title: Text(!configured ? 'Not configured' : (ai['enabled'] == true ? 'On' : 'Off'), style: const TextStyle(fontWeight: FontWeight.w700)),
        leading: Icon(Icons.auto_awesome, color: configured && ai['enabled'] == true ? const Color(0xFF0F7F74) : null),
      ),
      const SectionLabel('AJMCP gateway'),
      Field(
        _url,
        'Gateway URL',
        hint: 'https://ajmcp.example.com',
        enabled: g['urlFromEnv'] != true,
        helper: g['urlFromEnv'] == true ? 'Set by environment' : 'Server origin only',
        keyboard: TextInputType.url,
      ),
      Field(
        _token,
        'AadOS site token',
        secret: true,
        enabled: g['tokenFromEnv'] != true,
        hint: g['hasToken'] == true ? 'Saved — leave blank to keep' : null,
        helper: g['tokenFromEnv'] == true ? 'Set by environment' : null,
      ),
      if (g['hasToken'] == true && g['tokenFromEnv'] != true)
        CheckboxListTile(dense: true, title: const Text('Remove saved token'), value: _clearToken, onChanged: (v) => setState(() => _clearToken = v == true)),
      _buttons([
        _button(
          'Save',
          busy
              ? null
              : () async {
                  // A field fixed by the environment is not submitted (as on the web).
                  final r = await run(
                    'gateway',
                    fields: {
                      if (g['urlFromEnv'] != true) 'url': _url.text.trim(),
                      if (g['tokenFromEnv'] != true) 'token': _token.text.trim(),
                      'clearToken': _clearToken,
                    },
                  );
                  if (r != null) {
                    _token.clear();
                    setState(() => _clearToken = false);
                  }
                },
          primary: true,
        ),
        _button('Test connection', busy || !configured ? null : () => run('test')),
      ]),
      InfoRow(
        'Provider',
        [str(st['provider']), str(st['model'])].where((x) => x.isNotEmpty).join(' · ') +
            (str(st['gatewayVersion']).isEmpty ? '' : ' · AJMCP ${str(st['gatewayVersion'])}'),
      ),
      InfoRow('Last success', when(st['lastOk'])),
      InfoRow('Last error', str(st['lastError']).isEmpty ? '' : '${str(st['lastError'])} (${when(st['lastErrorAt'])})', bad: str(st['lastError']).isNotEmpty),
      const SectionLabel('Processing'),
      _opt('enabled', 'Enable AI', 'Assistant answers, summaries, drafts and briefings'),
      _opt('background', 'Background email triage', 'New email (last 21 days), each message once'),
      _opt('emailBodies', 'Send full email text', 'Off: subject, sender and preview only'),
      const SectionLabel('Data the AI may see'),
      _opt('shareEmail', 'Email'),
      _opt('shareCalendar', 'Calendar'),
      _opt('shareDocuments', 'Documents'),
      _opt('shareFinance', 'Finance'),
      _buttons([_button('Save', busy ? null : () => run('save', fields: _opts, done: 'Saved.'), primary: true)]),
      const SectionLabel('Email triage'),
      InfoRow(
        'Classified',
        ins.isEmpty
            ? ''
            : '${numOf(ins['done']).toInt()} done · ${numOf(ins['failed']).toInt()} failed${str(ins['last']).isEmpty ? '' : ' · last ${when(ins['last'])}'}',
      ),
      InfoRow('Last pass', str(triage['last']).isEmpty ? '' : '${when(triage['last'])} · ${str(triage['note'])}'),
      _buttons([_button('Run triage now', busy || ai['enabled'] != true || ai['background'] != true ? null : () => run('triage'))]),
    ];
  });
}

/// Settings → Storage: the RustFS (S3-compatible) bucket for Documents. Keys are never sent back.
class StorageSettingsScreen extends StatefulWidget {
  const StorageSettingsScreen({super.key});
  @override
  State<StorageSettingsScreen> createState() => _StorageState();
}

class _StorageState extends SettingsPageState<StorageSettingsScreen> {
  @override
  String get page => 'storage';
  final _c = {
    for (final k in const ['endpoint', 'bucket', 'region', 'prefix', 'accessKey', 'secretKey']) k: TextEditingController(),
  };
  bool _filled = false, _pathStyle = true, _clearKeys = false;

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => scaffold('Storage', (d) {
    final f = mapOf(d['form']), locked = mapOf(d['locked']), st = mapOf(d['status']), usage = mapOf(d['usage']);
    if (!_filled) {
      _filled = true;
      for (final k in const ['endpoint', 'bucket', 'region', 'prefix']) {
        _c[k]!.text = str(f[k]);
      }
      _pathStyle = f['forcePathStyle'] != false;
    }
    bool lock(String k) => locked[k] == true;
    String? env(String k) => lock(k) ? 'Set by environment' : null;
    final configured = st['configured'] == true;
    return [
      ListTile(
        leading: Icon(Icons.inventory_2_outlined, color: configured ? const Color(0xFF0F7F74) : null),
        title: Text(configured ? 'Configured' : 'Not configured', style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
      const SectionLabel('RustFS (S3-compatible)'),
      Field(_c['endpoint']!, 'Endpoint', hint: 'https://rustfs.example.com', enabled: !lock('endpoint'), helper: env('endpoint'), keyboard: TextInputType.url),
      Field(_c['bucket']!, 'Bucket', hint: 'aados', enabled: !lock('bucket'), helper: env('bucket')),
      Field(_c['region']!, 'Region (optional)', hint: 'us-east-1', enabled: !lock('region'), helper: env('region')),
      Field(
        _c['accessKey']!,
        'Access key',
        secret: true,
        enabled: !lock('accessKey'),
        hint: f['hasAccessKey'] == true ? 'Saved — leave blank to keep' : 'Access key ID',
        helper: env('accessKey'),
      ),
      Field(
        _c['secretKey']!,
        'Secret key',
        secret: true,
        enabled: !lock('secretKey'),
        hint: f['hasSecretKey'] == true ? 'Saved — leave blank to keep' : 'Secret access key',
        helper: env('secretKey'),
      ),
      Field(_c['prefix']!, 'Key prefix (optional)', hint: 'aados/', enabled: !lock('prefix'), helper: env('prefix')),
      SwitchListTile(
        title: const Text('Path-style addressing'),
        subtitle: const Text('Usual for RustFS'),
        value: _pathStyle,
        onChanged: lock('forcePathStyle') ? null : (v) => setState(() => _pathStyle = v),
      ),
      if (f['hasAccessKey'] == true && !lock('accessKey'))
        CheckboxListTile(dense: true, title: const Text('Remove saved keys'), value: _clearKeys, onChanged: (v) => setState(() => _clearKeys = v == true)),
      _buttons([
        _button(
          'Save',
          busy
              ? null
              : () async {
                  // Fields fixed by the environment are not submitted (as on the web).
                  final r = await run(
                    'save',
                    fields: {
                      for (final k in const ['endpoint', 'bucket', 'region', 'prefix', 'accessKey', 'secretKey'])
                        if (!lock(k)) k: _c[k]!.text.trim(),
                      if (!lock('forcePathStyle')) 'forcePathStyle': _pathStyle,
                      'clearKeys': _clearKeys,
                    },
                  );
                  if (r != null) {
                    _c['accessKey']!.clear();
                    _c['secretKey']!.clear();
                    setState(() => _clearKeys = false);
                  }
                },
          primary: true,
        ),
        _button('Test connection', busy || !configured ? null : () => run('test')),
      ]),
      InfoRow('Status', configured ? 'Ready · ${str(st['endpoint'])} · ${str(st['bucket'])}' : str(st['problem']), bad: !configured),
      InfoRow('Last success', str(d['lastOk']).isEmpty ? '' : when(d['lastOk'])),
      InfoRow('Used by AadOS', usage.isEmpty ? '' : '${numOf(usage['files']).toInt()} files · ${(numOf(usage['bytes']) / 1024 / 1024).toStringAsFixed(1)} MB'),
    ];
  });
}
