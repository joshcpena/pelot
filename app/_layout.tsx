import { Stack } from 'expo-router';

import '../src/features/ride/backgroundLocation';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
