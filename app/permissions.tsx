import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type PermissionState = {
  foreground: Location.PermissionStatus | 'unknown';
  background: Location.PermissionStatus | 'unknown';
};

export default function PermissionsScreen() {
  const [permissions, setPermissions] = useState<PermissionState>({
    foreground: 'unknown',
    background: 'unknown',
  });

  async function refreshPermissions() {
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = await Location.getBackgroundPermissionsAsync();
    setPermissions({
      foreground: foreground.status,
      background: background.status,
    });
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
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Permissions</Text>
      <Text style={styles.copy}>
        Pelot needs location permission to record speed, distance, and route
        points. Background location will be used in the next recording
        milestone.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Foreground location</Text>
        <Text style={styles.value}>{permissions.foreground}</Text>
        <Pressable style={styles.button} onPress={requestForeground}>
          <Text style={styles.buttonText}>Allow while using app</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Background location</Text>
        <Text style={styles.value}>{permissions.background}</Text>
        <Pressable style={styles.button} onPress={requestBackground}>
          <Text style={styles.buttonText}>Allow background recording</Text>
        </Pressable>
      </View>

      <Link href="/" style={styles.link}>
        Back to ride
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
    backgroundColor: '#0d1117',
    padding: 24,
    paddingTop: 72,
  },
  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
  },
  copy: {
    color: '#a9b4c0',
    fontSize: 16,
    lineHeight: 23,
  },
  card: {
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#161b22',
    padding: 18,
  },
  label: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  value: {
    color: '#7ee787',
    fontSize: 15,
    textTransform: 'uppercase',
  },
  button: {
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: '#238636',
    padding: 14,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  link: {
    color: '#58a6ff',
    fontSize: 16,
    fontWeight: '700',
  },
});
