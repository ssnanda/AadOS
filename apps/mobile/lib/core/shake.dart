import 'dart:async';
import 'dart:math';

import 'package:sensors_plus/sensors_plus.dart';

/// Calls [onShake] for a deliberate shake: two strong movements within 600 ms, then a 2 s pause before the next.
/// Uses the user accelerometer (gravity removed), so walking or tilting the phone does not trigger it.
class ShakeDetector {
  ShakeDetector(this.onShake);
  final void Function() onShake;
  static const _threshold = 14.0; // m/s²
  StreamSubscription<UserAccelerometerEvent>? _sub;
  DateTime _firstPeak = DateTime.fromMillisecondsSinceEpoch(0), _last = DateTime.fromMillisecondsSinceEpoch(0);
  int _peaks = 0;
  bool _above = false; // a peak counts once per swing (rising edge)

  void start() {
    _sub ??= userAccelerometerEventStream(samplingPeriod: SensorInterval.gameInterval).listen((e) {
      final strong = sqrt(e.x * e.x + e.y * e.y + e.z * e.z) >= _threshold;
      final rising = strong && !_above;
      _above = strong;
      if (!rising) return;
      final now = DateTime.now();
      if (now.difference(_last) < const Duration(seconds: 2)) return;
      if (now.difference(_firstPeak) > const Duration(milliseconds: 600)) { _firstPeak = now; _peaks = 0; }
      if (++_peaks >= 2) { _peaks = 0; _last = now; onShake(); }
    }, onError: (_) {}); // no sensor (simulator): shake simply does nothing
  }

  void stop() { _sub?.cancel(); _sub = null; }
}
