# MapLibre Services Setup

Pelot renders native maps with MapLibre. MapLibre provides the renderer; map
tiles/styles, place search, and bike routing come from external services.

Required `.env` values:

```sh
EXPO_PUBLIC_MAPTILER_API_KEY=...
EXPO_PUBLIC_OPENROUTESERVICE_API_KEY=...
```

`EXPO_PUBLIC_MAPTILER_API_KEY` is used for MapTiler raster map tiles and place search.
`EXPO_PUBLIC_OPENROUTESERVICE_API_KEY` is used for cycling routes and turn
instructions.

The app builds MapLibre styles from explicit raster tile URLs. This avoids
MapLibre Native parse warnings from style JSON sources that point at TileJSON
URLs instead of including `tiles` directly.

If no MapTiler key is present, the app falls back to OpenStreetMap raster tiles
for map rendering, but place search and route planning still require API keys.

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
