# Android Google Maps Setup

If the map shows only the Google logo and controls, Google is rejecting the API key.

In Google Cloud Console:

1. Enable **Maps SDK for Android** for the project that owns `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.
2. Enable **Directions API** if you want in-app bicycling route planning.
3. Ensure billing is enabled for that Google Cloud project.
4. Restrict the API key to Android apps using this debug build identity:

```text
Package name: com.josh.pelot
SHA-1 certificate fingerprint: 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

5. Restrict API usage to **Maps SDK for Android** and **Directions API**.
6. Reopen the app after Google Cloud changes propagate. This can take a few minutes.

Note: Google web-service APIs such as Directions API may need a separate API key
restriction strategy from Android Maps SDK in production. The current app uses
`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` directly for route planning, which is suitable
for development but not a hardened production setup.

If you replace the key in `.env`, rebuild the native app:

```sh
npx expo run:android
```

To reprint the current debug fingerprint:

```sh
cd android
./gradlew signingReport
```

## Emulator Route Playback

Use `docs/ballston-1mi-loop.gpx` to test ride recording without physically
moving a phone.

In Android Studio:

1. Open **Device Manager**.
2. Start an emulator.
3. Open **Extended Controls** for that emulator.
4. Choose **Location**.
5. Load `docs/ballston-1mi-loop.gpx`.
6. Start playback, then start a ride in Pelot.
