# AadOS iOS

The released iOS app is the Flutter project in `apps/mobile`. It provides native authentication and email workflows and uses bundle identifier `com.aadnanda.aados`, replacing the retired SwiftUI web-shell install.

## Owner verification

Prepare dependencies and verify the app before publishing:

```sh
cd /Users/sandip/Projects/aados/apps/mobile
flutter pub get
flutter analyze
flutter test
flutter run
```

The first Flutter run generates `ios/Flutter/ephemeral`, including `FlutterGeneratedPluginSwiftPackage`. These files are build inputs and remain gitignored.

## IPA

After the Flutter app runs successfully on the simulator or a connected iPhone:

```sh
cd /Users/sandip/Projects/aados
./bin/build-ipa.sh --local
```

The script builds `apps/mobile` with `flutter build ios --release --no-codesign`, using the root `VERSION` and Git commit count. It validates the generated bundle and executable, then packages `Runner.app` as `Payload/AadOS.app` in `build/ios/ipa/aados.ipa`.

Only after the local build and installed app are verified, publish with:

```sh
./bin/build-ipa.sh
```

The publishing path updates and pushes `altstore.json`, moves the `ios-latest` tag, and replaces the rolling GitHub release. Set `IOS_BUILD_NUMBER` to override the Git-derived build number. The default repository is `ssnanda/AadOS`; override it with `--repo OWNER/REPO`.

Install the unsigned IPA through AltStore or another signer. App Store or TestFlight delivery requires a separate signed archive workflow.
