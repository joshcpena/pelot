import { StyleSheet, Text, View } from 'react-native';

import { type ThemeColors, useThemeColors } from '../settings/settings';
import type { RidePoint } from './types';

export function HistoryRouteMap({ points }: { points: RidePoint[] }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Route map</Text>
      <Text style={styles.copy}>
        Native route maps are available on iOS and Android. {points.length}{' '}
        points saved.
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      minHeight: 150,
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: colors.background,
      padding: 18,
    },
    title: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '900',
    },
    copy: {
      marginTop: 6,
      color: colors.mutedText,
      fontSize: 13,
      lineHeight: 18,
    },
  });
}
