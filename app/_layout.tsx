import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RideSettingsProvider } from '../src/features/settings/settings';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RideSettingsProvider>
        <Stack
          screenOptions={{ animation: 'slide_from_right', headerShown: false }}
        >
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="settings" options={{ animation: 'none' }} />
          <Stack.Screen name="permissions" options={{ animation: 'none' }} />
          <Stack.Screen name="history" options={{ animation: 'none' }} />
        </Stack>
      </RideSettingsProvider>
    </GestureHandlerRootView>
  );
}
