# Agent Notes

- Pelot is an Expo React Native app using npm and TypeScript.
- Use Expo Router: route files live under `app/`, and `package.json` points `main` at `expo-router/entry`.
- Shared app code should go under `src/`; ride-specific code belongs in `src/features/ride/`.
- Common commands: `npm run start`, `npm run ios`, `npm run android`, `npm run web`, `npm run lint`, `npm run typecheck`, `npm run format:check`.
- Android Google Maps requires `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env` and a native development build; Expo Go cannot apply that native API key, so the app shows a fallback there instead of rendering a black map.
- There is no test runner yet; do not claim `npm test` works until a test script exists.
- Current Expo/RN packages warn on Node `v23.7.0`; use a supported Node line such as `22.13+` or `24.3+` if engine warnings block tooling.
