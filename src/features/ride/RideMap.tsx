import { StyleSheet, Text, View } from 'react-native';

import type { RidePoint, RideSettings } from './types';

export function RideMap({
  points,
}: {
  points: RidePoint[];
  mapType?: RideSettings['mapType'];
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Map preview</Text>
      <Text style={styles.copy}>
        Native route rendering is available on iOS and Android. {points.length}{' '}
        route points collected.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 220,
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#161b22',
    padding: 20,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  copy: {
    marginTop: 8,
    color: '#8b949e',
    fontSize: 15,
    lineHeight: 21,
  },
});
