import { useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, {
  PROVIDER_GOOGLE,
  Polyline,
  type LatLng,
  type MapType,
} from 'react-native-maps';

import type { RidePoint, RideSettings } from './types';

function toCoordinate(point: RidePoint): LatLng {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function getMapType(mapType: RideSettings['mapType']): MapType {
  if (mapType === 'satellite') {
    return 'satellite';
  }

  if (mapType === 'hybrid') {
    return 'hybrid';
  }

  return 'standard';
}

export function RideMap({
  points,
  mapType,
}: {
  points: RidePoint[];
  mapType: RideSettings['mapType'];
}) {
  const mapRef = useRef<MapView | null>(null);
  const hasGoogleMapsApiKey = Boolean(
    Constants.expoConfig?.extra?.hasGoogleMapsApiKey,
  );
  const isExpoGo = Constants.appOwnership === 'expo';
  const needsGoogleMapsKey = Platform.OS === 'android';
  const coordinates = points.map(toCoordinate);
  const lastCoordinate = coordinates[coordinates.length - 1];
  const initialCoordinate = lastCoordinate ?? {
    latitude: 37.78825,
    longitude: -122.4324,
  };

  useEffect(() => {
    if (coordinates.length < 2) {
      return;
    }

    mapRef.current?.fitToCoordinates(coordinates, {
      animated: true,
      edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
    });
  }, [coordinates]);

  if (needsGoogleMapsKey && (!hasGoogleMapsApiKey || isExpoGo)) {
    return (
      <View style={styles.fallbackContainer}>
        <Text style={styles.fallbackTitle}>Google Maps needs a dev build</Text>
        <Text style={styles.fallbackCopy}>
          Android maps require `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` to be embedded
          in the native app. Expo Go cannot apply that native config, so create
          a development build after setting `.env`. Route recording still works;{' '}
          {points.length} points collected.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={getMapType(mapType)}
        showsUserLocation
        followsUserLocation={coordinates.length < 2}
        initialRegion={{
          latitude: initialCoordinate.latitude,
          longitude: initialCoordinate.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        {coordinates.length > 1 ? (
          <Polyline
            coordinates={coordinates}
            strokeColor="#2f81f7"
            strokeWidth={5}
          />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 260,
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#161b22',
  },
  map: {
    flex: 1,
  },
  fallbackContainer: {
    minHeight: 220,
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#161b22',
    padding: 20,
  },
  fallbackTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  fallbackCopy: {
    marginTop: 8,
    color: '#8b949e',
    fontSize: 15,
    lineHeight: 21,
  },
});
