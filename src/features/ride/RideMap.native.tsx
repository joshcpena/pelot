import { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  Polyline,
  type LatLng,
  type MapType,
} from 'react-native-maps';

import {
  type ThemeColors,
  useResolvedTheme,
  useThemeColors,
} from '../settings/settings';
import type {
  DestinationOption,
  PlannedRoute,
  PlannedRouteStep,
  RidePoint,
  RideSettings,
} from './types';

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

const MANEUVER_COMPLETE_DISTANCE_METERS = 35;

function getHeading(points: RidePoint[]) {
  const lastPoint = points[points.length - 1];

  if (typeof lastPoint?.heading === 'number' && lastPoint.heading >= 0) {
    return lastPoint.heading;
  }

  return 0;
}

function distanceBetweenCoordinates(a: LatLng, b: LatLng) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(deltaLongitude / 2) ** 2;

  return (
    earthRadiusMeters *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function formatNavigationDistance(meters: number | null) {
  if (meters == null) {
    return '';
  }

  if (meters >= 1609.344) {
    return `${(meters / 1609.344).toFixed(1)} mi`;
  }

  if (meters >= 100) {
    return `${Math.round(meters / 10) * 10} m`;
  }

  return `${Math.max(5, Math.round(meters / 5) * 5)} m`;
}

function getStepEndCoordinate(step: PlannedRouteStep) {
  return step.coordinates.at(-1) ?? null;
}

function getClosestRouteIndex(coordinate: LatLng, routeCoordinates: LatLng[]) {
  return routeCoordinates.reduce(
    (best, candidate, index) => {
      const distanceMeters = distanceBetweenCoordinates(coordinate, candidate);

      return distanceMeters < best.distanceMeters
        ? { index, distanceMeters }
        : best;
    },
    { index: 0, distanceMeters: Number.POSITIVE_INFINITY },
  ).index;
}

function getStepEndIndexes(
  routeCoordinates: LatLng[],
  steps: PlannedRouteStep[],
) {
  return steps.map((step) => {
    const endCoordinate = getStepEndCoordinate(step);

    return endCoordinate
      ? getClosestRouteIndex(endCoordinate, routeCoordinates)
      : routeCoordinates.length - 1;
  });
}

export function RideMap({
  destinationOptions = [],
  isNavigating = false,
  points,
  mapType,
  plannedRoute,
}: {
  destinationOptions?: DestinationOption[];
  isNavigating?: boolean;
  points: RidePoint[];
  mapType: RideSettings['mapType'];
  plannedRoute?: PlannedRoute | null;
}) {
  const mapRef = useRef<MapView | null>(null);
  const colors = useThemeColors();
  const resolvedTheme = useResolvedTheme();
  const styles = createStyles(colors);
  const isDarkTheme = resolvedTheme === 'dark';
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
  const plannedStepEndIndexes = plannedRoute?.steps.length
    ? getStepEndIndexes(plannedCoordinates ?? [], plannedRoute.steps)
    : [];
  const destinationCoordinates = destinationOptions.map(
    (option) => option.coordinate,
  );
  const lastPoint = points[points.length - 1];
  const lastLatitude = lastPoint?.latitude;
  const lastLongitude = lastPoint?.longitude;
  const lastCoordinate =
    lastLatitude !== undefined && lastLongitude !== undefined
      ? { latitude: lastLatitude, longitude: lastLongitude }
      : null;
  const mapCenter = lastCoordinate ?? currentCoordinate ?? DEFAULT_COORDINATE;
  const mapHeading = getHeading(points);
  const activeNavigationStep =
    isNavigating && plannedRoute && lastCoordinate && plannedCoordinates?.length
      ? getActiveNavigationStep(
          lastCoordinate,
          plannedCoordinates,
          plannedRoute.steps,
          plannedStepEndIndexes,
        )
      : null;

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
      pitch: isNavigating ? 60 : 45,
      zoom: isNavigating ? 18 : 17,
    });
  }, [isNavigating, lastLatitude, lastLongitude, mapHeading]);

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

  useEffect(() => {
    if (
      coordinates.length > 1 ||
      plannedCoordinates ||
      destinationCoordinates.length === 0
    ) {
      return;
    }

    if (destinationCoordinates.length === 1) {
      mapRef.current?.animateCamera({
        center: destinationCoordinates[0],
        pitch: 0,
        zoom: 15,
      });
      return;
    }

    mapRef.current?.fitToCoordinates(destinationCoordinates, {
      animated: true,
      edgePadding: { top: 72, right: 48, bottom: 300, left: 48 },
    });
  }, [coordinates.length, destinationCoordinates, plannedCoordinates]);

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

  function getActiveNavigationStep(
    coordinate: LatLng,
    routeCoordinates: LatLng[],
    steps: PlannedRouteStep[],
    stepEndIndexes: number[],
  ) {
    if (steps.length === 0 || routeCoordinates.length === 0) {
      return null;
    }

    const closestRouteIndex = getClosestRouteIndex(
      coordinate,
      routeCoordinates,
    );
    const currentStepIndex = stepEndIndexes.findIndex(
      (endIndex, index) =>
        endIndex >= closestRouteIndex - 2 || index === steps.length - 1,
    );
    const stepIndex =
      currentStepIndex < 0 ? steps.length - 1 : currentStepIndex;
    const step = steps[stepIndex];
    const endCoordinate = getStepEndCoordinate(step);
    const distanceToManeuver = endCoordinate
      ? distanceBetweenCoordinates(coordinate, endCoordinate)
      : step.distanceMeters;
    const displayStep =
      distanceToManeuver != null &&
      distanceToManeuver < MANEUVER_COMPLETE_DISTANCE_METERS &&
      stepIndex < steps.length - 1
        ? steps[stepIndex + 1]
        : step;
    const displayEndCoordinate = getStepEndCoordinate(displayStep);

    return {
      instruction: displayStep.instruction,
      distanceText: formatNavigationDistance(
        displayEndCoordinate
          ? distanceBetweenCoordinates(coordinate, displayEndCoordinate)
          : displayStep.distanceMeters,
      ),
    };
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
        key={resolvedTheme}
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={getMapType(mapType)}
        userInterfaceStyle={resolvedTheme}
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
        {!plannedRoute
          ? destinationOptions.map((option, index) => (
              <Marker
                key={option.id}
                coordinate={option.coordinate}
                description={option.address ?? undefined}
                title={`${index + 1}. ${option.name}`}
              >
                <View style={styles.destinationMarker}>
                  <Text style={styles.destinationMarkerText}>{index + 1}</Text>
                </View>
              </Marker>
            ))
          : null}
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
      {activeNavigationStep ? (
        <View style={styles.mapHud} pointerEvents="box-none">
          <View
            style={[
              styles.navigationBanner,
              !isDarkTheme && styles.navigationBannerLight,
            ]}
          >
            {activeNavigationStep.distanceText ? (
              <Text style={styles.navigationDistance}>
                {activeNavigationStep.distanceText}
              </Text>
            ) : null}
            <Text
              style={[
                styles.navigationInstruction,
                !isDarkTheme && styles.navigationInstructionLight,
              ]}
            >
              {activeNavigationStep.instruction}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={styles.mapActions} pointerEvents="box-none">
        <Pressable
          accessibilityLabel="Center map"
          hitSlop={8}
          style={({ pressed }) => [
            styles.mapActionButton,
            pressed && styles.mapActionButtonPressed,
          ]}
          onPress={recenterMap}
        >
          <Text style={styles.mapActionIcon}>⌖</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Show whole route"
          hitSlop={8}
          style={({ pressed }) => [
            styles.mapActionButton,
            pressed && styles.mapActionButtonPressed,
          ]}
          onPress={showWholeRoute}
        >
          <Text style={styles.mapActionIcon}>↝</Text>
        </Pressable>
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
    },
    navigationBanner: {
      flex: 1,
      maxWidth: '76%',
      borderRadius: 18,
      backgroundColor: colors.inverseBackground,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    navigationBannerLight: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
      elevation: 6,
    },
    navigationDistance: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '900',
    },
    navigationInstruction: {
      marginTop: 2,
      color: colors.inverseText,
      fontSize: 17,
      fontWeight: '900',
      lineHeight: 22,
    },
    navigationInstructionLight: {
      color: colors.primaryText,
    },
    mapActions: {
      position: 'absolute',
      right: 12,
      bottom: 12,
      gap: 7,
    },
    mapActionButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.18,
      shadowRadius: 7,
      elevation: 4,
    },
    mapActionButtonPressed: {
      opacity: 0.72,
      transform: [{ scale: 0.96 }],
    },
    mapActionIcon: {
      color: colors.primaryText,
      fontSize: 20,
      fontWeight: '900',
      lineHeight: 22,
    },
    destinationMarker: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: '#fff',
      borderRadius: 999,
      backgroundColor: colors.accent,
    },
    destinationMarkerText: {
      color: '#fff',
      fontSize: 15,
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
