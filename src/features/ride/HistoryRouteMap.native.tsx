import { useEffect, useMemo, useRef } from 'react';
import Constants from 'expo-constants';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, {
  PROVIDER_GOOGLE,
  Polyline,
  type LatLng,
} from 'react-native-maps';

import { type ThemeColors, useThemeColors } from '../settings/settings';
import type { RidePoint } from './types';

function toCoordinate(point: RidePoint): LatLng {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function getInitialRegion(coordinates: LatLng[]) {
  const firstCoordinate = coordinates[0] ?? {
    latitude: 37.78825,
    longitude: -122.4324,
  };

  if (coordinates.length < 2) {
    return {
      ...firstCoordinate,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.35, 0.01),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.35, 0.01),
  };
}

export function HistoryRouteMap({ points }: { points: RidePoint[] }) {
  const mapRef = useRef<MapView | null>(null);
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const coordinates = useMemo(() => points.map(toCoordinate), [points]);
  const hasGoogleMapsApiKey = Boolean(
    Constants.expoConfig?.extra?.hasGoogleMapsApiKey,
  );
  const isExpoGo = Constants.appOwnership === 'expo';
  const needsGoogleMapsKey = Platform.OS === 'android';

  useEffect(() => {
    if (coordinates.length < 2) {
      return;
    }

    requestAnimationFrame(() => {
      mapRef.current?.fitToCoordinates(coordinates, {
        animated: false,
        edgePadding: { top: 24, right: 24, bottom: 24, left: 24 },
      });
    });
  }, [coordinates]);

  if (points.length < 2) {
    return (
      <View style={styles.fallbackContainer}>
        <Text style={styles.fallbackTitle}>No route saved</Text>
        <Text style={styles.fallbackCopy}>
          This ride does not have enough GPS points for a map preview.
        </Text>
      </View>
    );
  }

  if (needsGoogleMapsKey && (!hasGoogleMapsApiKey || isExpoGo)) {
    return (
      <View style={styles.fallbackContainer}>
        <Text style={styles.fallbackTitle}>Map preview unavailable</Text>
        <Text style={styles.fallbackCopy}>
          Android map tiles need a Google Maps development build.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container} pointerEvents="none">
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={getInitialRegion(coordinates)}
        pitchEnabled={false}
        rotateEnabled={false}
        scrollEnabled={false}
        showsCompass={false}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        zoomEnabled={false}
      >
        <Polyline
          coordinates={coordinates}
          strokeColor="#2ea043"
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />
      </MapView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      height: 150,
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: colors.background,
    },
    map: {
      flex: 1,
    },
    fallbackContainer: {
      minHeight: 150,
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: colors.background,
      padding: 18,
    },
    fallbackTitle: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '900',
    },
    fallbackCopy: {
      marginTop: 6,
      color: colors.mutedText,
      fontSize: 13,
      lineHeight: 18,
    },
  });
}
