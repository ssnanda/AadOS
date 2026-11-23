import 'package:flutter/material.dart';

import 'app.dart';
import 'core/session.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final session = Session();
  runApp(AadOSApp(session: session));
  session.restore();
}
