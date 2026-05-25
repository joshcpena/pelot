# MapLibre Services Setup

Pelot renders native maps with MapLibre. MapLibre provides the renderer, while
OpenFreeMap provides map tiles/styles without an API key. Place search and bike
routing come from external services.

Required `.env` values:

```sh
EXPO_PUBLIC_MAPTILER_API_KEY=...
EXPO_PUBLIC_OPENROUTESERVICE_API_KEY=...
```

`EXPO_PUBLIC_MAPTILER_API_KEY` is used for MapTiler place search.
`EXPO_PUBLIC_OPENROUTESERVICE_API_KEY` is used for cycling routes and turn
instructions.

The app uses OpenFreeMap MapLibre style URLs for map display:

```sh
https://tiles.openfreemap.org/styles/positron
https://tiles.openfreemap.org/styles/dark
https://tiles.openfreemap.org/styles/liberty
https://tiles.openfreemap.org/styles/fiord
```

OpenFreeMap does not provide satellite imagery, so Pelot currently exposes
standard and outdoor map styles only. Place search and route planning still
require API keys. MapLibre attribution display is disabled for this app under
the project owner's personal exemption.

MapLibre is native code and cannot run in Expo Go. Rebuild the native app after
installing or changing native map dependencies:

```sh
npx expo run:android
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
