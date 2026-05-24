import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  type ThemeColors,
  useThemeColors,
} from '../src/features/settings/settings';
import {
  requestHeartRateBluetoothAccess,
  type BluetoothAccessState,
} from '../src/features/devices/heartRateMonitor';

type PermissionState = {
  foreground: Location.PermissionStatus | 'unknown';
  background: Location.PermissionStatus | 'unknown';
  bluetooth: BluetoothAccessState | 'unknown';
};

export default function PermissionsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [permissions, setPermissions] = useState<PermissionState>({
    foreground: 'unknown',
    background: 'unknown',
    bluetooth: 'unknown',
  });

  async function refreshPermissions() {
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = await Location.getBackgroundPermissionsAsync();
    setPermissions({
      foreground: foreground.status,
      background: background.status,
      bluetooth: permissions.bluetooth,
    });
  }

  async function requestBluetooth() {
    const bluetooth = await requestHeartRateBluetoothAccess();
    setPermissions((current) => ({ ...current, bluetooth }));

    if (bluetooth === 'denied') {
      await Linking.openSettings();
    }
  }

  async function requestForeground() {
    await Location.requestForegroundPermissionsAsync();
    await refreshPermissions();
  }

  async function requestBackground() {
    await Location.requestBackgroundPermissionsAsync();
    await refreshPermissions();
  }

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]).then(([foreground, background]) => {
      if (isMounted) {
        setPermissions({
          foreground: foreground.status,
          background: background.status,
          bluetooth: 'unknown',
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Permissions</Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.backToRideButton,
            pressed && styles.subtleButtonPressed,
          ]}
          onPress={() => router.dismissTo('/')}
        >
          <Text style={styles.backToRideButtonText}>Back to ride</Text>
        </Pressable>
      </View>
      <Text style={styles.copy}>
        Pelot needs location permission to record speed, distance, and route
        points. Background location will be used in the next recording
        milestone.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Foreground location</Text>
        <Text style={styles.value}>{permissions.foreground}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          onPress={requestForeground}
        >
          <Text style={styles.buttonText}>Allow while using app</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Background location</Text>
        <Text style={styles.value}>{permissions.background}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          onPress={requestBackground}
        >
          <Text style={styles.buttonText}>Allow background recording</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Bluetooth heart rate</Text>
        <Text style={styles.value}>{permissions.bluetooth}</Text>
        <Text style={styles.muted}>
          Needed to connect to Garmin watches broadcasting heart rate.
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          onPress={requestBluetooth}
        >
          <Text style={styles.buttonText}>Allow Bluetooth</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      gap: 16,
      backgroundColor: colors.background,
      paddingHorizontal: 20,
      paddingTop: 58,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
    },
    title: {
      flex: 1,
      color: colors.primaryText,
      fontSize: 34,
      fontWeight: '800',
    },
    copy: {
      color: colors.secondaryText,
      fontSize: 16,
      lineHeight: 23,
    },
    card: {
      gap: 8,
      borderRadius: 18,
      backgroundColor: colors.card,
      padding: 18,
    },
    label: {
      color: colors.primaryText,
      fontSize: 18,
      fontWeight: '700',
    },
    value: {
      color: colors.success,
      fontSize: 15,
      textTransform: 'uppercase',
    },
    muted: {
      color: colors.mutedText,
      fontSize: 13,
      lineHeight: 18,
    },
    button: {
      alignItems: 'center',
      borderRadius: 999,
      backgroundColor: colors.success,
      padding: 14,
    },
    buttonPressed: {
      opacity: 0.78,
      transform: [{ scale: 0.97 }],
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    backToRideButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    backToRideButtonText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '900',
    },
    subtleButtonPressed: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      opacity: 0.82,
      transform: [{ scale: 0.98 }],
    },
  });
}
