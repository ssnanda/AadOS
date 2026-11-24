import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api.dart';
import '../core/ui.dart';
import 'line_chart.dart';

/// Finance & Investments, native. Same data as the web Finance page (/finance/data); actions through /finance/api.
/// Read-only toward brokerages. Editing holdings/accounts and provider setup stay on the web (Settings tab there).
class FinanceScreen extends StatefulWidget {
  const FinanceScreen({super.key, required this.api});
  final Api api;
  @override
  State<FinanceScreen> createState() => _FinanceScreenState();
}

class _FinanceScreenState extends State<FinanceScreen> {
  Map<String, dynamic>? _d;
  String _error = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = mapOf(await widget.api.get('/finance/data', timeout: const Duration(seconds: 45)));
      if (mounted) {
        setState(() {
          _d = d;
          _error = d['available'] == true ? '' : (str(d['error']).isNotEmpty ? str(d['error']) : 'Finance needs the PostgreSQL storage (AADOS_STORAGE=postgres).');
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<Map<String, dynamic>?> op(String op, [Map<String, dynamic> body = const {}]) async {
    setState(() => _busy = true);
    final r = await guarded(context, () async => mapOf(await widget.api.post('/finance/api', {'op': op, ...body}, timeout: const Duration(seconds: 120))));
    if (mounted) setState(() => _busy = false);
    return r;
  }

  Future<void> _refresh() async {
    final r = await op('refresh');
    if (r == null || !mounted) return;
    final failed = (r['failedTickers'] as List? ?? const []).join(', ');
    final msg = str(r['error']).isNotEmpty ? str(r['error']) : 'Prices refreshed: ${numOf(r['updated']).toInt()} of ${numOf(r['totalTickers']).toInt()}${failed.isEmpty ? '' : ' (failed: $failed)'}.';
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    const tabs = ['Overview', 'Positions', 'Accounts', 'Watchlist', 'Real estate', 'Insights'];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Finance'),
          actions: [IconButton(tooltip: 'Refresh prices', icon: const Icon(Icons.sync), onPressed: _busy || d?['available'] != true ? null : _refresh)],
          bottom: d?['available'] == true ? TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [for (final t in tabs) Tab(text: t)]) : null,
        ),
        body: Column(children: [
          if (_busy) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: d == null || d['available'] != true
                ? (_error.isNotEmpty ? ErrorPane(_error, onRetry: _load) : const Center(child: CircularProgressIndicator()))
                : TabBarView(children: [
                    _Overview(d: d, onRefresh: _load),
                    _Positions(d: d, onRefresh: _load, api: this),
                    _Accounts(d: d, onRefresh: _load, api: this),
                    _Watchlist(d: d, onRefresh: _load),
                    _RealEstate(d: d, onRefresh: _load),
                    _Insights(d: d, onRefresh: _load, api: this),
                  ]),
          ),
        ]),
      ),
    );
  }
}

Widget _refreshable(Future<void> Function() onRefresh, List<Widget> children) =>
    RefreshIndicator(onRefresh: onRefresh, child: ListView(padding: const EdgeInsets.only(bottom: 32), children: children));

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value, {this.sub, this.subColor});
  final String label, value;
  final String? sub;
  final Color? subColor;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: cs.surfaceContainerHighest.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(10)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: cs.onSurfaceVariant)),
        const SizedBox(height: 2),
        FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
        if (sub != null) Text(sub!, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: subColor ?? cs.onSurfaceVariant)),
      ]),
    );
  }
}

class _Overview extends StatefulWidget {
  const _Overview({required this.d, required this.onRefresh});
  final Map<String, dynamic> d;
  final Future<void> Function() onRefresh;
  @override
  State<_Overview> createState() => _OverviewState();
}

class _OverviewState extends State<_Overview> {
  String _range = '3M';

  @override
  Widget build(BuildContext context) {
    final s = mapOf(widget.d['summary']);
    final cs = Theme.of(context).colorScheme;
    final dayChange = numOf(s['dayChange']), gain = numOf(s['gain']), cost = numOf(s['costBasis']);
    final invested = numOf(s['investments']) + numOf(s['cash']);
    final dayPct = invested - dayChange == 0 ? null : dayChange / (invested - dayChange) * 100;
    final series = [for (final p in maps(widget.d['series'])) (DateTime.parse(str(p['date'])), numOf(p['total']).toDouble(), numOf(p['cost']).toDouble())];
    final from = _from(series.isEmpty ? null : series.first.$1);
    final win = series.where((p) => !p.$1.isBefore(from)).toList();
    final change = win.length > 1 ? win.last.$2 - win.first.$2 : null;
    final buckets = mapOf(s['buckets']);
    final total = buckets.values.fold<num>(0, (t, v) => t + (numOf(v) > 0 ? numOf(v) : 0));
    const bucketNames = {'stocks': 'Stocks', 'funds': 'Funds', 'cash': 'Cash', 'realEstateOther': 'Real estate & other'};
    const bucketColors = {'stocks': Color(0xFF3157DE), 'funds': Color(0xFF139488), 'cash': Color(0xFFC98A1D), 'realEstateOther': Color(0xFF7C4DDE)};
    final alerts = maps(widget.d['recentAlerts']);
    final stale = maps(s['stalePrices']), missing = maps(s['missingPrices']);
    final last = mapOf(widget.d['lastRefresh']);
    return _refreshable(widget.onRefresh, [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('NET WORTH', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1, color: cs.onSurfaceVariant)),
          Text(usd(numOf(s['netWorth'])), style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800)),
          Text('${dayChange >= 0 ? '+' : ''}${usd(dayChange)} (${pct(dayPct)}) today', style: TextStyle(fontWeight: FontWeight.w700, color: tone(context, dayChange))),
          if (DateTime.tryParse(str(last['refreshedAt'])) != null)
            Text('Prices ${DateFormat('MMM d, h:mm a').format(DateTime.parse(str(last['refreshedAt'])).toLocal())}', style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            height: 36,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (final r in const ['1W', '1M', '3M', 'YTD', '1Y', 'ALL'])
                Padding(padding: const EdgeInsets.only(right: 4), child: ChoiceChip(visualDensity: VisualDensity.compact, label: Text(r), selected: _range == r, onSelected: (_) => setState(() => _range = r))),
            ]),
          ),
          if (change != null) Text('${change >= 0 ? '+' : ''}${usd(change)} over $_range', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: tone(context, change))),
          LineChart(points: [for (final p in win) (p.$1, p.$2)], secondary: [for (final p in win) (p.$1, p.$3)], color: (change ?? 0) >= 0 ? const Color(0xFF2A9D5C) : cs.error),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.all(12),
        child: GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 2.1,
          children: [
            _Stat('Investments', usd(numOf(s['investments']))),
            _Stat('Cash', usd(numOf(s['cash']))),
            _Stat('Total gain', '${gain >= 0 ? '+' : ''}${usd(gain)}', sub: cost > 0 ? pct(gain / cost * 100) : null, subColor: tone(context, gain)),
            _Stat('Real estate equity', usd(numOf(s['realEstateEquity'])), sub: 'Cash flow ${usd(numOf(s['monthlyRentalCashFlow']))}/mo'),
          ],
        ),
      ),
      if (total > 0) ...[
        const SectionLabel('Allocation'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: Row(children: [
              for (final e in buckets.entries.where((e) => numOf(e.value) > 0))
                Expanded(flex: (numOf(e.value) / total * 1000).round().clamp(1, 1000), child: Container(height: 12, color: bucketColors[e.key] ?? cs.primary)),
            ]),
          ),
        ),
        for (final e in buckets.entries.where((e) => numOf(e.value) > 0))
          ListTile(
            dense: true,
            leading: Icon(Icons.circle, size: 12, color: bucketColors[e.key]),
            title: Text(bucketNames[e.key] ?? e.key),
            trailing: Text('${usd(numOf(e.value))} · ${(numOf(e.value) / total * 100).toStringAsFixed(1)}%'),
          ),
      ],
      if (alerts.isNotEmpty) ...[
        const SectionLabel('Alerts'),
        for (final a in alerts.take(10))
          ListTile(
            dense: true,
            leading: const Icon(Icons.notifications_active_outlined, color: Color(0xFFC98A1D)),
            title: Text(str(a['title'])),
            subtitle: Text(DateFormat('MMM d, h:mm a').format(DateTime.parse(str(a['at'])).toLocal())),
          ),
      ],
      if (missing.isNotEmpty || stale.isNotEmpty) ...[
        const SectionLabel('Data'),
        if (missing.isNotEmpty) ListTile(dense: true, leading: Icon(Icons.help_outline, color: cs.error), title: Text('No price: ${missing.map((m) => str(m['ticker'])).join(', ')}')),
        if (stale.isNotEmpty) ListTile(dense: true, leading: const Icon(Icons.schedule), title: Text('Stale price: ${stale.map((m) => str(m['ticker'])).join(', ')}')),
      ],
    ]);
  }

  DateTime _from(DateTime? earliest) {
    final now = DateTime.now();
    return switch (_range) {
      '1W' => now.subtract(const Duration(days: 7)),
      '1M' => DateTime(now.year, now.month - 1, now.day),
      '3M' => DateTime(now.year, now.month - 3, now.day),
      'YTD' => DateTime(now.year, 1, 1),
      '1Y' => DateTime(now.year - 1, now.month, now.day),
      _ => earliest ?? DateTime(2000),
    };
  }
}

/// History drill-down (account or holding) in a sheet.
Future<void> _history(BuildContext context, _FinanceScreenState api, String title, String op, Map<String, dynamic> body, {bool price = false}) async {
  final r = await api.op(op, body);
  if (r == null || !context.mounted) return;
  final series = maps(r['series']);
  final prices = maps(r['prices']);
  final points = price && prices.length > 1
      ? [for (final p in prices) (DateTime.parse(str(p['date'])), numOf(p['close']).toDouble())]
      : [for (final p in series) (DateTime.parse(str(p['date'])), numOf(p['value']).toDouble())];
  final cost = price ? <(DateTime, double)>[] : [for (final p in series) (DateTime.parse(str(p['date'])), numOf(p['cost']).toDouble())];
  showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (c) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: Theme.of(c).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        LineChart(points: points, secondary: cost, color: const Color(0xFF2F7CF6), height: 220),
      ]),
    ),
  );
}

class _Positions extends StatefulWidget {
  const _Positions({required this.d, required this.onRefresh, required this.api});
  final Map<String, dynamic> d;
  final Future<void> Function() onRefresh;
  final _FinanceScreenState api;
  @override
  State<_Positions> createState() => _PositionsState();
}

class _PositionsState extends State<_Positions> {
  String _sort = 'value';
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final list = maps(widget.d['positions'])
      ..sort((a, b) => switch (_sort) {
            'ticker' => str(a['ticker']).compareTo(str(b['ticker'])),
            'gain' => (numOf(b['marketValue']) - numOf(b['costBasis'])).compareTo(numOf(a['marketValue']) - numOf(a['costBasis'])),
            'day' => numOf(b['todayChange']).compareTo(numOf(a['todayChange'])),
            _ => numOf(b['marketValue']).compareTo(numOf(a['marketValue'])),
          });
    return _refreshable(widget.onRefresh, [
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: SegmentedButton<String>(
          showSelectedIcon: false,
          style: const ButtonStyle(visualDensity: VisualDensity.compact),
          segments: const [ButtonSegment(value: 'value', label: Text('Value')), ButtonSegment(value: 'day', label: Text('Today')), ButtonSegment(value: 'gain', label: Text('Gain')), ButtonSegment(value: 'ticker', label: Text('A–Z'))],
          selected: {_sort},
          onSelectionChanged: (s) => setState(() => _sort = s.first),
        ),
      ),
      if (list.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No positions yet.')),
      for (final p in list)
        Builder(builder: (context) {
          final mv = numOf(p['marketValue']), cb = numOf(p['costBasis']), day = numOf(p['todayChange']), prev = numOf(p['previousValue']);
          final gain = mv - cb;
          return ListTile(
            onTap: () => _history(context, widget.api, '${str(p['ticker'])} — price (1 year)', 'history.holding', {'ticker': str(p['ticker']), 'range': '1y'}, price: true),
            title: Row(children: [
              Text(str(p['ticker']), style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(width: 8),
              Expanded(child: Text(str(p['name']), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant))),
              Text(usd(mv), style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
            subtitle: Row(children: [
              Expanded(child: Text('${_qty(numOf(p['quantity']))} @ ${usd(numOrNull(p['currentPrice']), digits: 2)} · ${(p['accountNames'] as List? ?? const []).join(', ')}', maxLines: 1, overflow: TextOverflow.ellipsis)),
              Text('${day >= 0 ? '+' : ''}${usd(day)} ${pct(prev == 0 ? null : day / prev * 100)}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: tone(context, day))),
              const SizedBox(width: 8),
              Text(pct(cb == 0 ? null : gain / cb * 100), style: TextStyle(fontSize: 12, color: tone(context, gain))),
            ]),
          );
        }),
    ]);
  }
}

String _qty(num q) => q == q.roundToDouble() ? q.toInt().toString() : q.toStringAsFixed(3);

class _Accounts extends StatelessWidget {
  const _Accounts({required this.d, required this.onRefresh, required this.api});
  final Map<String, dynamic> d;
  final Future<void> Function() onRefresh;
  final _FinanceScreenState api;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final by = maps(mapOf(d['summary'])['byAccount']);
    final accounts = {for (final a in maps(d['accounts'])) str(a['id']): a};
    final holdings = maps(d['holdings']);
    return _refreshable(onRefresh, [
      if (by.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No accounts yet. Add them in Finance on the web.')),
      for (final a in by)
        ExpansionTile(
          title: Row(children: [
            Expanded(child: Text(str(a['name']), style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
            Text(usd(numOf(a['value']) + numOf(a['cash'])), style: const TextStyle(fontWeight: FontWeight.w700)),
          ]),
          subtitle: Row(children: [
            Expanded(child: Text([str(a['type']), str(a['owner']), str(accounts[str(a['id'])]?['brokerage'])].where((x) => x.isNotEmpty).join(' · '), overflow: TextOverflow.ellipsis)),
            Text('${numOf(a['dayChange']) >= 0 ? '+' : ''}${usd(numOf(a['dayChange']))}', style: TextStyle(fontSize: 12, color: tone(context, numOf(a['dayChange'])))),
          ]),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(icon: const Icon(Icons.show_chart, size: 18), label: const Text('Value history'), onPressed: () => _history(context, api, '${str(a['name'])} — value', 'history.account', {'id': str(a['id'])})),
            ),
            for (final h in holdings.where((h) => str(h['accountId']) == str(a['id'])).toList()..sort((x, y) => (numOf(y['quantity']) * numOf(y['currentPrice'])).compareTo(numOf(x['quantity']) * numOf(x['currentPrice']))))
              ListTile(
                dense: true,
                title: Text('${str(h['ticker'])}  ${str(h['name'])}', maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text('${_qty(numOf(h['quantity']))} @ ${usd(numOrNull(h['currentPrice']), digits: 2)}'),
                trailing: Text(h['currentPrice'] == null ? '—' : usd(numOf(h['quantity']) * numOf(h['currentPrice'])), style: TextStyle(color: cs.onSurface, fontWeight: FontWeight.w600)),
              ),
          ],
        ),
    ]);
  }
}

class _Watchlist extends StatelessWidget {
  const _Watchlist({required this.d, required this.onRefresh});
  final Map<String, dynamic> d;
  final Future<void> Function() onRefresh;
  @override
  Widget build(BuildContext context) {
    final list = maps(d['watchlist']);
    return _refreshable(onRefresh, [
      if (list.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('Watchlist is empty.')),
      for (final w in list)
        Builder(builder: (context) {
          final price = numOrNull(w['currentPrice']), prev = numOrNull(w['previousClose']), target = numOrNull(w['targetPrice']);
          final ch = price != null && prev != null && prev != 0 ? (price - prev) / prev * 100 : null;
          final atTarget = price != null && target != null && price <= target;
          return ListTile(
            title: Row(children: [
              Text(str(w['ticker']), style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(width: 8),
              Expanded(child: Text(str(w['name']), overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12))),
              Text(usd(price, digits: 2), style: const TextStyle(fontWeight: FontWeight.w700)),
            ]),
            subtitle: Row(children: [
              Expanded(child: Text(target == null ? (str(w['thesis']).isEmpty ? 'No target' : str(w['thesis'])) : 'Target ${usd(target, digits: 2)}${atTarget ? ' · at target' : ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: atTarget ? FontWeight.w800 : null))),
              Text(pct(ch), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: tone(context, ch))),
            ]),
          );
        }),
    ]);
  }
}

class _RealEstate extends StatelessWidget {
  const _RealEstate({required this.d, required this.onRefresh});
  final Map<String, dynamic> d;
  final Future<void> Function() onRefresh;
  @override
  Widget build(BuildContext context) {
    final props = maps(d['properties']);
    final metrics = mapOf(d['propertyMetrics']);
    final s = mapOf(d['summary']);
    final cs = Theme.of(context).colorScheme;
    return _refreshable(onRefresh, [
      Padding(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          Expanded(child: _Stat('Value', usd(numOf(s['realEstateValue'])))),
          const SizedBox(width: 8),
          Expanded(child: _Stat('Equity', usd(numOf(s['realEstateEquity'])))),
          const SizedBox(width: 8),
          Expanded(child: _Stat('Cash flow', '${usd(numOf(s['monthlyRentalCashFlow']))}/mo')),
        ]),
      ),
      if (props.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No properties yet.')),
      for (final p in props)
        Builder(builder: (context) {
          final m = mapOf(metrics[str(p['id'])]);
          final cf = numOrNull(m['cashFlow']);
          return ExpansionTile(
            title: Text(str(p['name']).isNotEmpty ? str(p['name']) : str(p['location']), style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('Equity ${usd(numOf(m['equity']))} · ${cf == null ? 'cash flow —' : '${usd(cf)}/mo'}', style: TextStyle(color: cf == null ? null : tone(context, cf))),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (str(p['name']).isNotEmpty) Text(str(p['location']), style: TextStyle(color: cs.onSurfaceVariant)),
              _kv('Value (${str(m['valueSource'])})', usd(numOf(m['value']))),
              _kv('Mortgage balance', usd(numOf(m['mortgage']))),
              _kv('Mortgage payment', usd(numOrNull(p['mortgagePayment']))),
              _kv('Rent', usd(numOrNull(p['currentRent']))),
              _kv('Monthly costs', usd(numOf(m['monthlyCosts']))),
              if (numOrNull(m['gain']) != null) _kv('Gain vs cost', usd(numOrNull(m['gain']))),
              _kv('Units', '${numOf(p['units']).toInt()}'),
              if (str(p['notes']).isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(str(p['notes']))),
            ],
          );
        }),
    ]);
  }

  Widget _kv(String k, String v) => Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(children: [Expanded(child: Text(k)), Text(v, style: const TextStyle(fontWeight: FontWeight.w600))]));
}

class _Insights extends StatelessWidget {
  const _Insights({required this.d, required this.onRefresh, required this.api});
  final Map<String, dynamic> d;
  final Future<void> Function() onRefresh;
  final _FinanceScreenState api;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final signals = maps(d['signals']);
    final decisions = maps(d['decisions']).where((x) => str(x['status']) == 'open' || str(x['status']) == 'scheduled').toList();
    Color toneColor(String t) => switch (t) { 'up' => const Color(0xFF1E8E4E), 'down' => cs.error, 'warn' => const Color(0xFFC98A1D), _ => cs.primary };
    return _refreshable(onRefresh, [
      SectionLabel('Insights (${signals.length})${numOf(d['mutedCount']) > 0 ? ' · ${numOf(d['mutedCount']).toInt()} muted' : ''}'),
      if (signals.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Nothing needs attention.')),
      for (final s in signals)
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(width: 4, height: 44, margin: const EdgeInsets.only(right: 10), decoration: BoxDecoration(color: toneColor(str(s['tone'])), borderRadius: BorderRadius.circular(2))),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(str(s['title']), style: const TextStyle(fontWeight: FontWeight.w700)),
                  if (str(s['why']).isNotEmpty) Text(str(s['why']), style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                  if (str(s['next']).isNotEmpty) Text('Next: ${str(s['next'])}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                ]),
              ),
              PopupMenuButton<String>(
                tooltip: 'Mute',
                icon: const Icon(Icons.notifications_off_outlined, size: 20),
                onSelected: (dur) async {
                  final r = await api.op('signal.mute', {'signalId': str(s['id']), 'title': str(s['title']), 'kind': str(s['kind']), 'ticker': str(s['ticker']), 'duration': dur});
                  if (r != null) onRefresh();
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: '1d', child: Text('Mute 1 day')),
                  PopupMenuItem(value: '1w', child: Text('Mute 1 week')),
                  PopupMenuItem(value: '1m', child: Text('Mute 1 month')),
                  PopupMenuItem(value: 'forever', child: Text('Mute forever')),
                ],
              ),
            ]),
          ),
        ),
      if (decisions.isNotEmpty) ...[
        const SectionLabel('Open decisions'),
        for (final x in decisions)
          ListTile(
            dense: true,
            title: Text('${str(x['type']).toUpperCase()} ${str(x['ticker'])}', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text([str(x['notes']), if (str(x['scheduledFor']).isNotEmpty) 'for ${DateFormat.yMMMd().format(DateTime.parse(str(x['scheduledFor'])).toLocal())}'].where((e) => e.isNotEmpty).join(' · '), maxLines: 2, overflow: TextOverflow.ellipsis),
          ),
      ],
    ]);
  }
}
