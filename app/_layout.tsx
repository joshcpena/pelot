import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RideSettingsProvider } from '../src/features/settings/settings';
import '../src/features/ride/backgroundLocation';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RideSettingsProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </RideSettingsProvider>
    </GestureHandlerRootView>
  );
}
