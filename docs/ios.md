# AadOS iOS

The native project is `ios/AadOS.xcodeproj`. The first release is a SwiftUI shell around the authenticated AadOS web workspace, so provider credentials and the internal API service token remain server-side.

## First Xcode setup

1. Open `ios/AadOS.xcodeproj` in Xcode.
2. Select the AadOS target, then **Signing & Capabilities**.
3. Select the owner's Apple Developer team.
4. Confirm or replace the bundle identifier `com.aadnanda.aados` if it is unavailable.
5. Choose an iPhone simulator or connected iPhone and run the app.
6. Sign in to AadOS. The default server is `https://os.aadnanda.com`; change it from the app's gear button if needed.

The web session is stored in WebKit's persistent website data store. The app permits plain HTTP only for `localhost`/`127.0.0.1` development; normal servers must use HTTPS.

## IPA

After the project runs successfully:

```sh
cd /Users/sandip/Projects/aados
./bin/build-ipa.sh
```

The shared `AadOS` scheme and project are auto-detected. Matching the established `ajopsios` workflow, the default command runs `bin/bump.sh --if-dirty` first, builds the unsigned release iPhoneOS `.app`, packages `Payload/AadOS.app` as `build/ios/ipa/aados.ipa`, updates and pushes the root `altstore.json`, and uploads only `aados.ipa` to the rolling GitHub release `ios-latest`. The Git commit count supplies an increasing iOS build number; set `IOS_BUILD_NUMBER` to override it.

For a local-only build:

```sh
./bin/build-ipa.sh --local
```

The default GitHub repository is `ssnanda/AadOS`; override it with `--repo OWNER/REPO`. GitHub publishing requires an authenticated `gh` CLI session.

Install the unsigned IPA through AltStore or another signer. App Store/TestFlight delivery remains a separate future workflow and will require Apple Distribution signing; the export-option plists are retained for that purpose.
