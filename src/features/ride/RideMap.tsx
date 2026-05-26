import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { type ThemeColors, useThemeColors } from '../settings/settings';
import type {
  DestinationOption,
  PlannedRoute,
  RidePoint,
  RideSettings,
} from './types';

export function RideMap({
  destinationOptions,
  isNavigating,
  onLoadStateChange,
  onLongPress,
  points,
  plannedRoute,
}: {
  destinationOptions?: DestinationOption[];
  isNavigating?: boolean;
  onCancelNavigation?: () => void;
  onLoadStateChange?: (isLoaded: boolean) => void;
  onLongPress?: () => void;
  points: RidePoint[];
  mapType?: RideSettings['mapType'];
  plannedRoute?: PlannedRoute | null;
  unitSystem?: RideSettings['unitSystem'];
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  useEffect(() => {
    onLoadStateChange?.(true);

    return () => onLoadStateChange?.(false);
  }, [onLoadStateChange]);

  return (
    <Pressable
      delayLongPress={550}
      onLongPress={onLongPress}
      style={styles.container}
    >
      <Text style={styles.title}>Map preview</Text>
      <Text style={styles.copy}>
        Native route rendering is available on iOS and Android. {points.length}{' '}
        route points collected.
      </Text>
      {plannedRoute ? (
        <Text style={styles.copy}>
          {isNavigating ? 'Navigating' : 'Planned bike route'} to{' '}
          {plannedRoute.destination}: {plannedRoute.distanceText},{' '}
          {plannedRoute.durationText}.
        </Text>
      ) : null}
      {destinationOptions && destinationOptions.length > 0 ? (
        <Text style={styles.copy}>
          {destinationOptions.length} destination options found.
        </Text>
      ) : null}
    </Pressable>
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
