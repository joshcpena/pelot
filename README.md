# pelot

A free bike computer app

## Development

```sh
npm install
npm run start
```

Native maps use OpenFreeMap for map tiles/styles without an API key. Place
search and bike routing need MapTiler and OpenRouteService API keys:

```sh
cp .env.example .env
npm run android
```

Set these in `.env` before starting Expo:

```sh
EXPO_PUBLIC_MAPTILER_API_KEY=...
EXPO_PUBLIC_OPENROUTESERVICE_API_KEY=...
```

Do not commit real API keys. MapLibre is native code and cannot run in Expo Go;
use a development build such as `npx expo run:android` after setting `.env`.

See `docs/maplibre-services.md` for map, search, and routing setup notes.

## Local Android APK

Build an installable APK locally with EAS:

```sh
npm run build:android:local
```

This script loads `.env` before bundling so `EXPO_PUBLIC_MAPTILER_API_KEY` and
`EXPO_PUBLIC_OPENROUTESERVICE_API_KEY` are included in the APK for search and
routing. It also defaults
`ANDROID_HOME` and `ANDROID_SDK_ROOT` to `$HOME/Library/Android/sdk` when those
variables are not already set.

When the build finishes, EAS writes an APK like `build-*.apk` in the project
root. Install it on a USB-connected Android phone with debugging enabled:

```sh
adb devices
adb install -r ./build-*.apk
```

Useful checks:

```sh
npm run lint
npm run typecheck
npm run format:check
```
