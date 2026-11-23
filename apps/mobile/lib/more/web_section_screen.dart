import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../core/session.dart';

/// A section that is not native yet (Calendar, Asana, Finance…) shown from the AadOS web app, signed in with
/// the app's session token as the `aados_session` cookie. Links off the AadOS server open in the browser.
class WebSectionScreen extends StatefulWidget {
  const WebSectionScreen({super.key, required this.session, required this.title, required this.path});
  final Session session;
  final String title, path;

  /// Removes the web session cookie (sign out).
  static Future<void> clearCookies() => WebViewCookieManager().clearCookies();

  @override
  State<WebSectionScreen> createState() => _WebSectionScreenState();
}

class _WebSectionScreenState extends State<WebSectionScreen> {
  late final WebViewController _web;
  int _progress = 0;

  Uri get _server => Uri.parse(widget.session.server);

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
        onNavigationRequest: (req) {
          final u = Uri.tryParse(req.url);
          if (u == null || u.host == _server.host || req.url.startsWith('about:')) return NavigationDecision.navigate;
          launchUrl(u, mode: LaunchMode.externalApplication);
          return NavigationDecision.prevent;
        },
      ));
    _start();
  }

  Future<void> _start() async {
    final token = widget.session.token;
    if (token != null) {
      await WebViewCookieManager().setCookie(WebViewCookie(name: 'aados_session', value: token, domain: _server.host, path: '/'));
    }
    await _web.loadRequest(_server.resolve(widget.path));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _web.canGoBack()) {
          await _web.goBack();
        } else if (context.mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.title),
          actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: () => _web.reload())],
          bottom: _progress < 100 ? PreferredSize(preferredSize: const Size.fromHeight(2), child: LinearProgressIndicator(value: _progress / 100, minHeight: 2)) : null,
        ),
        body: WebViewWidget(controller: _web),
      ),
    );
  }
}
