import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'models.dart';

/// Email HTML shown like the web reader: JavaScript off, a strict CSP (no scripts, frames or remote fonts;
/// remote https images allowed), links open in the browser. Find highlights matches with <mark>.
class EmailBodyView extends StatefulWidget {
  const EmailBodyView({super.key, required this.body, this.find = ''});
  final MessageBody body;
  final String find;

  /// Number of matches for [term] in the visible text of [body].
  static int matches(MessageBody body, String term) {
    if (term.trim().length < 2) return 0;
    final re = RegExp(RegExp.escape(term.trim()), caseSensitive: false);
    final text = body.html.isNotEmpty ? body.html.replaceAll(RegExp(r'<[^>]*>'), ' ') : body.text;
    return re.allMatches(text).length;
  }

  @override
  State<EmailBodyView> createState() => _EmailBodyViewState();
}

class _EmailBodyViewState extends State<EmailBodyView> {
  late final WebViewController _web;

  static String _esc(String s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  // Same approach as the web viewer: wrap matches outside of tags.
  static String _mark(String html, String term) {
    if (term.trim().length < 2) return html;
    final re = RegExp(RegExp.escape(term.trim()), caseSensitive: false);
    return html.replaceAllMapped(RegExp(r'(^|>)([^<]+)'), (m) => '${m[1]}${m[2]!.replaceAllMapped(re, (x) => '<mark style="background:#ffe066">${x[0]}</mark>')}');
  }

  String _doc() {
    final b = widget.body;
    final content = b.html.isNotEmpty ? b.html : '<pre style="white-space:pre-wrap;font:inherit;margin:0">${_esc(b.text)}</pre>';
    return '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: https:; style-src \'unsafe-inline\'; font-src data:">'
        '<style>html,body{background:#fff}body{margin:14px 16px 40px;font:16px/1.5 -apple-system,Roboto,Helvetica,Arial,sans-serif;color:#1d2433;word-break:break-word;overflow-wrap:anywhere}'
        'img{max-width:100%!important;height:auto!important}table{max-width:100%!important}pre{white-space:pre-wrap}a{color:#3157de}</style>'
        '</head><body>${_mark(content, widget.find)}</body></html>';
  }

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.disabled)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(NavigationDelegate(onNavigationRequest: (req) {
        final u = Uri.tryParse(req.url);
        if (u == null || req.url.startsWith('about:') || req.url.startsWith('data:')) return NavigationDecision.navigate;
        if (const {'http', 'https', 'mailto', 'tel'}.contains(u.scheme)) launchUrl(u, mode: LaunchMode.externalApplication);
        return NavigationDecision.prevent;
      }))
      ..loadHtmlString(_doc());
  }

  @override
  void didUpdateWidget(covariant EmailBodyView old) {
    super.didUpdateWidget(old);
    if (old.body != widget.body || old.find != widget.find) _web.loadHtmlString(_doc());
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _web);
}
