# Agent Notes

- Pelot is an Expo React Native app using npm and TypeScript.
- Use Expo Router: route files live under `app/`, and `package.json` points `main` at `expo-router/entry`.
- Shared app code should go under `src/`; ride-specific code belongs in `src/features/ride/`.
- Common commands: `npm run start`, `npm run ios`, `npm run android`, `npm run web`, `npm run lint`, `npm run typecheck`, `npm run format:check`.
- Native maps use MapLibre and require a development build; Expo Go cannot run the native MapLibre module. OpenFreeMap powers map styles/tiles without an API key, MapTiler powers place search via `EXPO_PUBLIC_MAPTILER_API_KEY`, and OpenRouteService powers cycling routes/navigation via `EXPO_PUBLIC_OPENROUTESERVICE_API_KEY`.
- There is no test runner yet; do not claim `npm test` works until a test script exists.
- Current Expo/RN packages warn on Node `v23.7.0`; use a supported Node line such as `22.13+` or `24.3+` if engine warnings block tooling.
