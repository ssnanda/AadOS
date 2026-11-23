import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/scope.dart';
import 'mail_api.dart';
import 'models.dart';

/// Reply / Reply all / Forward (and the residential template reply). Nothing is sent until Send is pressed.
class ComposeScreen extends StatefulWidget {
  const ComposeScreen({super.key, required this.mail, required this.emailKey, required this.draft, required this.aiReady, this.aiBlocked = '', this.startWithAi = false});
  final MailApi mail;
  final String emailKey;
  final ComposeDraft draft;
  final bool aiReady, startWithAi;
  final String aiBlocked;

  @override
  State<ComposeScreen> createState() => _ComposeScreenState();
}

class _ComposeScreenState extends State<ComposeScreen> {
  late final _to = TextEditingController(text: widget.draft.to);
  late final _cc = TextEditingController(text: widget.draft.cc);
  final _bcc = TextEditingController();
  late final _subject = TextEditingController(text: widget.draft.subject);
  late final _text = TextEditingController(text: widget.draft.text);
  late bool _showCc = widget.draft.cc.isNotEmpty;
  bool _showQuoted = false, _sending = false, _ai = false;
  late bool _attachments = widget.draft.mode == 'forward';

  String get _title => switch (widget.draft.mode) { 'replyAll' => 'Reply all', 'forward' => 'Forward', _ => widget.draft.residential ? 'Residential reply' : 'Reply' };

  @override
  void initState() {
    super.initState();
    if (widget.startWithAi && widget.aiReady) WidgetsBinding.instance.addPostFrameCallback((_) => _aiDraft());
  }

  @override
  void dispose() {
    for (final c in [_to, _cc, _bcc, _subject, _text]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _aiDraft() async {
    if (!widget.aiReady) {
      toast(context, widget.aiBlocked.isNotEmpty ? widget.aiBlocked : 'AI is not available.');
      return;
    }
    setState(() => _ai = true);
    try {
      // Typed text is the owner's draft/notes: the AI polishes it instead of replacing it.
      final out = await widget.mail.draft(widget.emailKey, current: _text.text);
      if (mounted && out.trim().isNotEmpty) _text.text = out;
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message);
    } finally {
      if (mounted) setState(() => _ai = false);
    }
  }

  Future<void> _send() async {
    if (_to.text.trim().isEmpty && _cc.text.trim().isEmpty && _bcc.text.trim().isEmpty) {
      toast(context, 'Add at least one recipient.');
      return;
    }
    setState(() => _sending = true);
    try {
      final note = await widget.mail.send(widget.emailKey,
          mode: widget.draft.mode,
          to: _to.text,
          cc: _cc.text,
          bcc: _bcc.text,
          subject: _subject.text,
          text: '${_text.text}${widget.draft.quoted}',
          attachments: _attachments,
          residential: widget.draft.residential);
      if (mounted) Navigator.of(context).pop(note.isEmpty ? 'Sent.' : 'Sent. $note');
    } on ApiException catch (e) {
      if (mounted) toast(context, e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  bool get _dirty => _text.text.trim().isNotEmpty && _text.text != widget.draft.text;

  Future<bool> _confirmDiscard() async =>
      await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Discard this message?'),
          actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep editing')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Discard'))],
        ),
      ) ??
      false;

  Widget _field(String label, TextEditingController c, {TextInputType? type, Widget? trailing}) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(children: [
          SizedBox(width: 62, child: Text(label, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))),
          Expanded(child: TextField(controller: c, keyboardType: type, autocorrect: type != TextInputType.emailAddress, decoration: const InputDecoration(border: InputBorder.none, isDense: true))),
          ?trailing,
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return PopScope(
      canPop: !_dirty || _sending,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _confirmDiscard() && context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(_title),
          actions: [
            IconButton(
              tooltip: _text.text.trim().isEmpty ? 'Draft with AI' : 'Polish with AI',
              onPressed: _ai || _sending ? null : _aiDraft,
              icon: _ai ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(Icons.auto_awesome, color: widget.aiReady ? Colors.deepPurple : cs.outline),
            ),
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilledButton.icon(
                onPressed: _sending ? null : _send,
                icon: _sending ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send, size: 18),
                label: const Text('Send'),
              ),
            ),
          ],
        ),
        body: ListView(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: Text('From  ${widget.draft.from}', style: TextStyle(color: cs.onSurfaceVariant, fontSize: 13)),
          ),
          const Divider(height: 1),
          _field('To', _to, type: TextInputType.emailAddress, trailing: _showCc ? null : TextButton(onPressed: () => setState(() => _showCc = true), child: const Text('Cc/Bcc'))),
          if (_showCc) ...[const Divider(height: 1), _field('Cc', _cc, type: TextInputType.emailAddress), const Divider(height: 1), _field('Bcc', _bcc, type: TextInputType.emailAddress)],
          const Divider(height: 1),
          _field('Subject', _subject),
          const Divider(height: 1),
          if (widget.draft.residential && widget.draft.templateTitle.isNotEmpty)
            Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), child: Text('Template: ${widget.draft.templateTitle}', style: TextStyle(color: cs.primary, fontSize: 12, fontWeight: FontWeight.w700))),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _text,
              autofocus: !widget.startWithAi && widget.draft.text.isEmpty,
              minLines: 8,
              maxLines: null,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(border: InputBorder.none, hintText: 'Write your message…'),
            ),
          ),
          if (widget.draft.mode == 'forward')
            SwitchListTile(value: _attachments, onChanged: (v) => setState(() => _attachments = v), title: const Text('Include attachments')),
          if (widget.draft.quoted.trim().isNotEmpty) ...[
            ListTile(
              leading: Icon(_showQuoted ? Icons.expand_less : Icons.more_horiz),
              title: Text(_showQuoted ? 'Hide quoted text' : 'Show quoted text'),
              onTap: () => setState(() => _showQuoted = !_showQuoted),
            ),
            if (_showQuoted) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), child: Text(widget.draft.quoted.trim(), style: TextStyle(color: cs.onSurfaceVariant, fontSize: 13))),
          ],
        ]),
      ),
    );
  }
}
