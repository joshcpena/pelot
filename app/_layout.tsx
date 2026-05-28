import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  RideSettingsProvider,
  useThemeColors,
} from '../src/features/settings/settings';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RideSettingsProvider>
        <AppStack />
      </RideSettingsProvider>
    </GestureHandlerRootView>
  );
}

function AppStack() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.accent,
        headerTitleStyle: { color: colors.primaryText, fontWeight: '900' },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ animation: 'none', headerShown: false }}
      />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="permissions" options={{ title: 'Permissions' }} />
      <Stack.Screen name="history" options={{ title: 'Ride History' }} />
      <Stack.Screen name="menu" options={{ title: 'Menu' }} />
    </Stack>
  );
}
