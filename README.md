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

Set `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env` before starting Expo. For
native Android Gradle builds, the committed manifest uses a placeholder and
Gradle reads the key from either the `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
environment variable or an uncommitted `googleMapsApiKey=...` entry in
`android/local.properties`.

Do not commit real API keys. The checked-in
`android/app/src/main/AndroidManifest.xml` must keep
`android:value="${googleMapsApiKey}"`.

Expo Go cannot apply the Android native Google Maps API key from app config. To
test Android maps with your key, use a development build such as
`npx expo run:android` after setting `.env`.

If Android shows only the Google logo and map controls, see
`docs/android-google-maps.md` for the required Google Cloud API key settings.

Useful checks:

```sh
npm run lint
npm run typecheck
npm run format:check
```
