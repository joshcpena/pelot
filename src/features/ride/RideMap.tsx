import { StyleSheet, Text, View } from 'react-native';

import { type ThemeColors, useThemeColors } from '../settings/settings';
import type { PlannedRoute, RidePoint, RideSettings } from './types';

export function RideMap({
  points,
  plannedRoute,
}: {
  points: RidePoint[];
  mapType?: RideSettings['mapType'];
  plannedRoute?: PlannedRoute | null;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Map preview</Text>
      <Text style={styles.copy}>
        Native route rendering is available on iOS and Android. {points.length}{' '}
        route points collected.
      </Text>
      {plannedRoute ? (
        <Text style={styles.copy}>
          Planned bike route to {plannedRoute.destination}:{' '}
          {plannedRoute.distanceText}, {plannedRoute.durationText}.
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      backgroundColor: colors.card,
      padding: 20,
    },
    title: {
      color: colors.primaryText,
      fontSize: 22,
      fontWeight: '900',
    },
    copy: {
      marginTop: 8,
      color: colors.mutedText,
      fontSize: 15,
      lineHeight: 21,
    },
  });
}
