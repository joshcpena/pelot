import { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, {
  PROVIDER_GOOGLE,
  Polyline,
  type LatLng,
  type MapType,
} from 'react-native-maps';

import { type ThemeColors, useThemeColors } from '../settings/settings';
import type { PlannedRoute, RidePoint, RideSettings } from './types';

function toCoordinate(point: { latitude: number; longitude: number }): LatLng {
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

const DEFAULT_COORDINATE = {
  latitude: 37.78825,
  longitude: -122.4324,
};

const NAVIGATION_MAP_STYLE = [
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#ffffff' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#e8eef7' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#d7e5f6' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'landscape',
    stylers: [{ color: '#f5f7fb' }],
  },
  {
    featureType: 'water',
    stylers: [{ color: '#cfe8ff' }],
  },
];

function getHeading(points: RidePoint[]) {
  const lastPoint = points[points.length - 1];

  if (typeof lastPoint?.heading === 'number' && lastPoint.heading >= 0) {
    return lastPoint.heading;
  }

  return 0;
}

export function RideMap({
  points,
  mapType,
  plannedRoute,
}: {
  points: RidePoint[];
  mapType: RideSettings['mapType'];
  plannedRoute?: PlannedRoute | null;
}) {
  const mapRef = useRef<MapView | null>(null);
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [currentCoordinate, setCurrentCoordinate] = useState<LatLng | null>(
    null,
  );
  const hasGoogleMapsApiKey = Boolean(
    Constants.expoConfig?.extra?.hasGoogleMapsApiKey,
  );
  const isExpoGo = Constants.appOwnership === 'expo';
  const needsGoogleMapsKey = Platform.OS === 'android';
  const coordinates = points.map(toCoordinate);
  const plannedCoordinates = plannedRoute?.coordinates;
  const lastPoint = points[points.length - 1];
  const lastLatitude = lastPoint?.latitude;
  const lastLongitude = lastPoint?.longitude;
  const lastCoordinate =
    lastLatitude !== undefined && lastLongitude !== undefined
      ? { latitude: lastLatitude, longitude: lastLongitude }
      : null;
  const mapCenter = lastCoordinate ?? currentCoordinate ?? DEFAULT_COORDINATE;
  const mapHeading = getHeading(points);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentLocation() {
      const permission = await Location.getForegroundPermissionsAsync();

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        return;
      }

      const lastKnownPosition = await Location.getLastKnownPositionAsync();

      if (lastKnownPosition && isMounted) {
        setCurrentCoordinate(toCoordinate(lastKnownPosition.coords));
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      if (isMounted) {
        setCurrentCoordinate(toCoordinate(position.coords));
      }
    }

    loadCurrentLocation().catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (lastLatitude === undefined || lastLongitude === undefined) {
      return;
    }

    mapRef.current?.animateCamera({
      center: { latitude: lastLatitude, longitude: lastLongitude },
      heading: mapHeading,
      pitch: 45,
      zoom: 17,
    });
  }, [lastLatitude, lastLongitude, mapHeading]);

  useEffect(() => {
    if (
      lastLatitude !== undefined ||
      lastLongitude !== undefined ||
      !currentCoordinate
    ) {
      return;
    }

    mapRef.current?.animateCamera({
      center: currentCoordinate,
      pitch: 0,
      zoom: 15,
    });
  }, [currentCoordinate, lastLatitude, lastLongitude]);

  useEffect(() => {
    if (
      coordinates.length > 1 ||
      !plannedCoordinates ||
      plannedCoordinates.length < 2
    ) {
      return;
    }

    mapRef.current?.fitToCoordinates(plannedCoordinates, {
      animated: true,
      edgePadding: { top: 64, right: 48, bottom: 64, left: 48 },
    });
  }, [coordinates.length, plannedCoordinates]);

  function recenterMap() {
    mapRef.current?.animateCamera({
      center: mapCenter,
      heading: mapHeading,
      pitch: lastCoordinate ? 45 : 0,
      zoom: lastCoordinate ? 17 : 15,
    });
  }

  function showWholeRoute() {
    const routeCoordinates =
      coordinates.length > 1 ? coordinates : (plannedCoordinates ?? []);

    if (routeCoordinates.length < 2) {
      recenterMap();
      return;
    }

    mapRef.current?.fitToCoordinates(routeCoordinates, {
      animated: true,
      edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
    });
  }

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
        <Text style={styles.fallbackCopy}>
          If a dev build still shows a blank map with the Google logo, enable
          Maps SDK for Android and add package `com.josh.pelot` plus this debug
          SHA-1 in Google Cloud Console.
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
        customMapStyle={mapType === 'standard' ? NAVIGATION_MAP_STYLE : []}
        showsUserLocation
        followsUserLocation={false}
        showsCompass
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        initialRegion={{
          latitude: mapCenter.latitude,
          longitude: mapCenter.longitude,
          latitudeDelta: 0.004,
          longitudeDelta: 0.004,
        }}
      >
        {plannedCoordinates && plannedCoordinates.length > 1 ? (
          <Polyline
            coordinates={plannedCoordinates}
            strokeColor="#1f6feb"
            strokeWidth={8}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}
        {plannedCoordinates && plannedCoordinates.length > 1 ? (
          <Polyline
            coordinates={plannedCoordinates}
            strokeColor="#ffffff"
            strokeWidth={3}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}
        {coordinates.length > 1 ? (
          <Polyline
            coordinates={coordinates}
            strokeColor="#2ea043"
            strokeWidth={7}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}
      </MapView>
      <View style={styles.mapHud} pointerEvents="box-none">
        <View style={styles.mapActions}>
          <Pressable style={styles.mapActionButton} onPress={recenterMap}>
            <Text style={styles.mapActionText}>Center</Text>
          </Pressable>
          <Pressable style={styles.mapActionButton} onPress={showWholeRoute}>
            <Text style={styles.mapActionText}>Route</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    map: {
      flex: 1,
    },
    mapHud: {
      position: 'absolute',
      top: 14,
      right: 14,
      left: 14,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'flex-end',
      gap: 12,
    },
    mapActions: {
      gap: 8,
    },
    mapActionButton: {
      minWidth: 74,
      alignItems: 'center',
      borderRadius: 999,
      backgroundColor: 'rgba(255, 255, 255, 0.94)',
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    mapActionText: {
      color: '#0d1117',
      fontSize: 13,
      fontWeight: '900',
    },
    fallbackContainer: {
      minHeight: 220,
      justifyContent: 'center',
      backgroundColor: colors.card,
      padding: 20,
    },
    fallbackTitle: {
      color: colors.primaryText,
      fontSize: 22,
      fontWeight: '900',
    },
    fallbackCopy: {
      marginTop: 8,
      color: colors.mutedText,
      fontSize: 15,
      lineHeight: 21,
    },
  });
}
