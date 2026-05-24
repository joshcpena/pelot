# pelot

A free bike computer app

## Development

```sh
npm install
npm run start
```

Native maps, place search, and bike routing need MapTiler and OpenRouteService
API keys:

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

Useful checks:

```sh
npm run lint
npm run typecheck
npm run format:check
```
