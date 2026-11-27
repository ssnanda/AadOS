import 'package:flutter/material.dart';

import '../core/home_widget.dart';
import '../core/scope.dart';

/// Settings → Widgets: what the home-screen mail widgets show, top to bottom. Each size shows the sections that fit
/// (Small: the first section; Medium: about two; Large: about four), so order matters.
class WidgetSettingsScreen extends StatefulWidget {
  const WidgetSettingsScreen({super.key});
  @override
  State<WidgetSettingsScreen> createState() => _WidgetSettingsState();
}

class _WidgetSettingsState extends State<WidgetSettingsScreen> {
  WidgetConfig? _c;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetConfig.load().then((c) { if (mounted) setState(() => _c = c); });
  }

  Future<void> _save({bool push = true}) async {
    final c = _c;
    if (c == null) return;
    await c.save();
    if (!push || !mounted) return;
    setState(() => _busy = true);
    final msg = await HomeWidgets.push(SessionScope.read(context).api, force: true);
    if (!mounted) return;
    setState(() => _busy = false);
    if (msg.isNotEmpty) toast(context, msg);
  }

  @override
  Widget build(BuildContext context) {
    final c = _c, t = Theme.of(context);
    final byId = {for (final s in widgetSections) s.id: s};
    return Scaffold(
      appBar: AppBar(title: const Text('Widgets'), actions: [
        IconButton(tooltip: 'Defaults', icon: const Icon(Icons.restart_alt), onPressed: c == null ? null : () { setState(() => _c = WidgetConfig.defaults()); _save(); }),
      ]),
      body: c == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(children: [
              const ListTile(
                dense: true,
                title: Text('Home-screen mail widgets'),
                subtitle: Text('Add one: long-press the home screen → + → AadOS → Small (4), Medium (8) or Large (16). Full screen = Large + Medium.'),
              ),
              const Padding(padding: EdgeInsets.fromLTRB(16, 8, 16, 4), child: Text('SECTIONS · drag to reorder · top fits first', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1))),
              ReorderableListView(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                buildDefaultDragHandles: false,
                onReorderItem: (from, to) {
                  setState(() => c.order.insert(to, c.order.removeAt(from)));
                  _save();
                },
                children: [
                  for (var i = 0; i < c.order.length; i++)
                    SwitchListTile(
                      key: ValueKey(c.order[i]),
                      value: c.enabled.contains(c.order[i]),
                      title: Text(byId[c.order[i]]!.label),
                      subtitle: Text(byId[c.order[i]]!.hint),
                      secondary: ReorderableDragStartListener(index: i, child: const Icon(Icons.drag_handle)),
                      onChanged: (on) { setState(() => on ? c.enabled.add(c.order[i]) : c.enabled.remove(c.order[i])); _save(); },
                    ),
                ],
              ),
              const Divider(),
              ListTile(
                title: const Text('Latest emails on Large'),
                subtitle: Text('${c.latest} emails (Medium shows fewer)'),
                trailing: SizedBox(
                  width: 180,
                  child: Slider(value: c.latest.toDouble(), min: 2, max: 10, divisions: 8, label: '${c.latest}', onChanged: (v) => setState(() => c.latest = v.round()), onChangeEnd: (_) => _save()),
                ),
              ),
              const Divider(),
              Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton.icon(onPressed: _busy ? null : () => _save(), icon: const Icon(Icons.refresh), label: Text(_busy ? 'Updating…' : 'Update widget now')),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text('The widget refreshes when the app opens, comes back, or syncs; otherwise iOS redraws it every 15–60 minutes.', style: t.textTheme.bodySmall),
              ),
            ]),
    );
  }
}
