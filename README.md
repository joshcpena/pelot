# pelot

A free bike computer app

## Development

```sh
npm install
npm run start
```

Android maps need a Google Maps API key:

```sh
cp .env.example .env
npm run android
```

Set `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env` before starting Expo.

Expo Go cannot apply the Android native Google Maps API key from app config. To
test Android maps with your key, use a development build such as
`npx expo run:android` after setting `.env`.

Useful checks:

```sh
npm run lint
npm run typecheck
npm run format:check
```
