import 'package:flutter/material.dart';

/// AadOS colours (the web app's blue accent), light and dark.
class AppColors {
  static const accent = Color(0xFF3157DE);
  static const gmail = Color(0xFFD94D43);
  static const zoho = Color(0xFF3157DE);
  static const danger = Color(0xFFC0392B);
  static const star = Color(0xFFE0A21B);
  static const ai = Color(0xFF7C4DDE);
  static const follow = Color(0xFF0F7F74);
  static const action = Color(0xFFA1752A);

  static Color provider(String p) => p == 'gmail' ? gmail : zoho;
}

ThemeData buildTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(seedColor: AppColors.accent, brightness: brightness);
  final dark = brightness == Brightness.dark;
  return ThemeData(
    useMaterial3: true,
    visualDensity: VisualDensity.compact,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? const Color(0xFF111318) : const Color(0xFFF6F7FB),
    appBarTheme: AppBarTheme(
      backgroundColor: dark ? const Color(0xFF111318) : const Color(0xFFF6F7FB),
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0.5,
    ),
    listTileTheme: const ListTileThemeData(dense: true),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
