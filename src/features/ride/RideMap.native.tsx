import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  type ViewStateChangeEvent,
  Marker,
  UserLocation,
  type LngLat,
  type LngLatBounds,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import type { FeatureCollection, LineString } from 'geojson';

import {
  type ThemeColors,
  useResolvedTheme,
  useThemeColors,
} from '../settings/settings';
import { getRideMapStyle, getRideMapStyleKey } from './mapStyles';
import type {
  DestinationOption,
  PlannedRoute,
  PlannedRouteStep,
  RidePoint,
  RideSettings,
  RouteCoordinate,
} from './types';

const DEFAULT_COORDINATE = {
  latitude: 37.78825,
  longitude: -122.4324,
};

const EMPTY_LINE: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: [],
};

const MANEUVER_COMPLETE_DISTANCE_METERS = 35;
const SEARCH_RESULTS_FIT_RADIUS_METERS = 5000;
const NAVIGATION_CAMERA_PADDING = { top: 118, right: 0, bottom: 0, left: 0 };
const COMPASS_NEEDLE_ICON = require('../../../assets/compass-needle.png');

function toCoordinate(point: { latitude: number; longitude: number }) {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function toLngLat(point: RouteCoordinate): LngLat {
  return [point.longitude, point.latitude];
}

function getHeading(points: RidePoint[]) {
  const lastPoint = points[points.length - 1];

  if (typeof lastPoint?.heading === 'number' && lastPoint.heading >= 0) {
    return lastPoint.heading;
  }

  return 0;
}

function distanceBetweenCoordinates(a: RouteCoordinate, b: RouteCoordinate) {
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

function formatNavigationDistance(
  meters: number | null,
  unitSystem: RideSettings['unitSystem'],
) {
  if (meters == null) {
    return '';
  }

  if (unitSystem === 'imperial') {
    const feet = meters * 3.280839895;

    if (feet >= 5280) {
      return `${(feet / 5280).toFixed(1)} mi`;
    }

    if (feet >= 100) {
      return `${Math.round(feet / 10) * 10} ft`;
    }

    return `${Math.max(10, Math.round(feet / 5) * 5)} ft`;
  }

  if (meters >= 1609.344) {
    return `${(meters / 1000).toFixed(1)} km`;
  }

  if (meters >= 100) {
    return `${Math.round(meters / 10) * 10} m`;
  }

  return `${Math.max(5, Math.round(meters / 5) * 5)} m`;
}

function getNavigationGlyph(instruction: string) {
  const normalized = instruction.toLowerCase();

  if (normalized.includes('arrive') || normalized.includes('destination')) {
    return '◎';
  }

  if (normalized.includes('u-turn')) {
    return '↶';
  }

  if (normalized.includes('sharp left')) {
    return '↰';
  }

  if (normalized.includes('sharp right')) {
    return '↱';
  }

  if (normalized.includes('left')) {
    return '↰';
  }

  if (normalized.includes('right')) {
    return '↱';
  }

  if (normalized.includes('roundabout')) {
    return '↻';
  }

  return '↑';
}

function getInstructionStreetName(step: PlannedRouteStep) {
  if (step.streetName === '-') {
    return step.instruction;
  }

  if (step.streetName) {
    return step.streetName;
  }

  const match = step.instruction.match(
    /(?:onto|on|toward|continue on|turn (?:left|right) onto|head (?:north|south|east|west)?\s*(?:on|onto))\s+(.+)$/i,
  );
  const streetName = match?.[1]
    ?.replace(/\s+and continue.*$/i, '')
    .replace(/\s+for\s+.+$/i, '')
    .trim();

  if (streetName && streetName !== '-') {
    return streetName;
  }

  return step.instruction;
}

function getStepEndCoordinate(step: PlannedRouteStep) {
  return step.coordinates.at(-1) ?? null;
}

function getClosestRouteIndex(
  coordinate: RouteCoordinate,
  routeCoordinates: RouteCoordinate[],
) {
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
  routeCoordinates: RouteCoordinate[],
  steps: PlannedRouteStep[],
) {
  return steps.map((step) => {
    const endCoordinate = getStepEndCoordinate(step);

    return endCoordinate
      ? getClosestRouteIndex(endCoordinate, routeCoordinates)
      : routeCoordinates.length - 1;
  });
}

function getBounds(coordinates: RouteCoordinate[]): LngLatBounds | null {
  if (coordinates.length === 0) {
    return null;
  }

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);

  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

function getSearchResultFitCoordinates(coordinates: RouteCoordinate[]) {
  const anchor = coordinates[0];

  if (!anchor) {
    return [];
  }

  return coordinates.filter(
    (coordinate) =>
      distanceBetweenCoordinates(anchor, coordinate) <=
      SEARCH_RESULTS_FIT_RADIUS_METERS,
  );
}

function lineFeature(
  id: string,
  coordinates: RouteCoordinate[],
): FeatureCollection<LineString> {
  if (coordinates.length < 2) {
    return EMPTY_LINE;
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id,
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: coordinates.map(toLngLat),
        },
      },
    ],
  };
}

export function RideMap({
  destinationOptions = [],
  isNavigating = false,
  onCancelNavigation,
  points,
  mapType,
  plannedRoute,
  unitSystem,
}: {
  destinationOptions?: DestinationOption[];
  isNavigating?: boolean;
  onCancelNavigation?: () => void;
  points: RidePoint[];
  mapType: RideSettings['mapType'];
  plannedRoute?: PlannedRoute | null;
  unitSystem: RideSettings['unitSystem'];
}) {
  const cameraRef = useRef<CameraRef | null>(null);
  const fittedDestinationKeyRef = useRef<string | null>(null);
  const isProgrammaticCameraMoveRef = useRef(false);
  const colors = useThemeColors();
  const resolvedTheme = useResolvedTheme();
  const styles = createStyles(colors);
  const [loadedMapStyle, setLoadedMapStyle] = useState<string | null>(null);
  const [isCameraCentered, setIsCameraCentered] = useState(true);
  const [isTopDownView, setIsTopDownView] = useState(false);
  const [currentCoordinate, setCurrentCoordinate] = useState<RouteCoordinate | null>(
    null,
  );
  const coordinates = points.map(toCoordinate);
  const plannedCoordinates = plannedRoute?.coordinates;
  const plannedStepEndIndexes = plannedRoute?.steps.length
    ? getStepEndIndexes(plannedCoordinates ?? [], plannedRoute.steps)
    : [];
  const destinationCoordinates = destinationOptions.map(
    (option) => option.coordinate,
  );
  const destinationFitKey = destinationOptions
    .map(
      (option) =>
        `${option.id}:${option.coordinate.latitude},${option.coordinate.longitude}`,
    )
    .join('|');
  const lastPoint = points[points.length - 1];
  const lastLatitude = lastPoint?.latitude;
  const lastLongitude = lastPoint?.longitude;
  const lastCoordinate =
    lastLatitude !== undefined && lastLongitude !== undefined
      ? { latitude: lastLatitude, longitude: lastLongitude }
      : null;
  const mapCenter = lastCoordinate ?? currentCoordinate ?? DEFAULT_COORDINATE;
  const mapHeading = getHeading(points);
  const mapStyle = useMemo(
    () => getRideMapStyle(mapType, resolvedTheme),
    [mapType, resolvedTheme],
  );
  const mapStyleKey = useMemo(
    () => getRideMapStyleKey(mapType, resolvedTheme),
    [mapType, resolvedTheme],
  );
  const isStyleLoaded = loadedMapStyle === mapStyleKey;
  const recordedRouteFeature = useMemo(
    () => lineFeature('recorded-route', coordinates),
    [coordinates],
  );
  const plannedRouteFeature = useMemo(
    () => lineFeature('planned-route', plannedCoordinates ?? []),
    [plannedCoordinates],
  );
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
    if (
      !isCameraCentered ||
      !isStyleLoaded ||
      lastLatitude === undefined ||
      lastLongitude === undefined
    ) {
      return;
    }

    isProgrammaticCameraMoveRef.current = true;
    cameraRef.current?.setStop({
      center: [lastLongitude, lastLatitude],
      bearing: isTopDownView ? 0 : mapHeading,
      pitch: isTopDownView ? 0 : isNavigating ? 60 : 45,
      padding: isNavigating ? NAVIGATION_CAMERA_PADDING : undefined,
      zoom: isNavigating ? 18 : 17,
      duration: 500,
      easing: 'ease',
    });
    setTimeout(() => {
      isProgrammaticCameraMoveRef.current = false;
    }, 550);
  }, [
    isCameraCentered,
    isNavigating,
    isStyleLoaded,
    isTopDownView,
    lastLatitude,
    lastLongitude,
    mapHeading,
  ]);

  useEffect(() => {
    if (
      !isStyleLoaded ||
      lastLatitude !== undefined ||
      lastLongitude !== undefined ||
      !currentCoordinate
    ) {
      return;
    }

    cameraRef.current?.easeTo({
      center: toLngLat(currentCoordinate),
      pitch: 0,
      zoom: 15,
      duration: 500,
    });
  }, [currentCoordinate, isStyleLoaded, lastLatitude, lastLongitude]);

  useEffect(() => {
    if (
      !isStyleLoaded ||
      coordinates.length > 1 ||
      !plannedCoordinates ||
      plannedCoordinates.length < 2
    ) {
      return;
    }

    const bounds = getBounds(plannedCoordinates);

    if (bounds) {
      cameraRef.current?.fitBounds(bounds, {
        padding: { top: 64, right: 48, bottom: 64, left: 48 },
        duration: 500,
      });
    }
  }, [coordinates.length, isStyleLoaded, plannedCoordinates]);

  useEffect(() => {
    if (destinationCoordinates.length === 0 || plannedCoordinates) {
      fittedDestinationKeyRef.current = null;
      return;
    }

    if (
      !isStyleLoaded ||
      coordinates.length > 1 ||
      fittedDestinationKeyRef.current === destinationFitKey
    ) {
      return;
    }

    fittedDestinationKeyRef.current = destinationFitKey;

    const fitCoordinates = getSearchResultFitCoordinates(destinationCoordinates);

    if (fitCoordinates.length < 2) {
      cameraRef.current?.easeTo({
        center: toLngLat(destinationCoordinates[0]),
        pitch: 0,
        zoom: 17,
        duration: 500,
      });
      return;
    }

    const bounds = getBounds(fitCoordinates);

    if (bounds) {
      cameraRef.current?.fitBounds(bounds, {
        padding: { top: 12, right: 12, bottom: 12, left: 12 },
        duration: 500,
      });
    }
  }, [
    coordinates.length,
    destinationCoordinates,
    destinationFitKey,
    isStyleLoaded,
    plannedCoordinates,
  ]);

  function setMapCameraCentered(topDownView = isTopDownView) {
    isProgrammaticCameraMoveRef.current = true;
    cameraRef.current?.setStop({
      center: toLngLat(mapCenter),
      bearing: topDownView ? 0 : mapHeading,
      pitch: topDownView ? 0 : lastCoordinate ? (isNavigating ? 60 : 45) : 0,
      padding: isNavigating ? NAVIGATION_CAMERA_PADDING : undefined,
      zoom: lastCoordinate ? 17 : 15,
      duration: 500,
      easing: 'ease',
    });
    setIsCameraCentered(true);
    setTimeout(() => {
      isProgrammaticCameraMoveRef.current = false;
    }, 550);
  }

  function handleMapCenterAction() {
    if (!isCameraCentered) {
      setMapCameraCentered();
      return;
    }

    const nextTopDownView = !isTopDownView;
    setIsTopDownView(nextTopDownView);
    setMapCameraCentered(nextTopDownView);
  }

  function handleRegionWillChange(
    event: NativeSyntheticEvent<ViewStateChangeEvent>,
  ) {
    if (event.nativeEvent.userInteraction && !isProgrammaticCameraMoveRef.current) {
      setIsCameraCentered(false);
    }
  }

  function showWholeRoute() {
    const routeCoordinates =
      coordinates.length > 1 ? coordinates : (plannedCoordinates ?? []);

    if (routeCoordinates.length < 2) {
      setMapCameraCentered();
      return;
    }

    const bounds = getBounds(routeCoordinates);

    if (bounds) {
      cameraRef.current?.fitBounds(bounds, {
        padding: isNavigating
          ? { top: 140, right: 48, bottom: 48, left: 48 }
          : { top: 48, right: 48, bottom: 48, left: 48 },
        duration: 500,
      });
      setIsCameraCentered(false);
    }
  }

  function getActiveNavigationStep(
    coordinate: RouteCoordinate,
    routeCoordinates: RouteCoordinate[],
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
      glyph: getNavigationGlyph(displayStep.instruction),
      streetName: getInstructionStreetName(displayStep),
      distanceText: formatNavigationDistance(
        displayEndCoordinate
          ? distanceBetweenCoordinates(coordinate, displayEndCoordinate)
          : displayStep.distanceMeters,
        unitSystem,
      ),
    };
  }

  return (
    <View style={styles.container}>
      <Map
        key={mapStyleKey}
        androidView="texture"
        style={styles.map}
        mapStyle={mapStyle}
        attribution={false}
        compass
        logo={false}
        onRegionWillChange={handleRegionWillChange}
        onDidFinishLoadingStyle={() => setLoadedMapStyle(mapStyleKey)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: toLngLat(mapCenter),
            pitch: lastCoordinate ? 45 : 0,
            padding: isNavigating ? NAVIGATION_CAMERA_PADDING : undefined,
            zoom: lastCoordinate ? 17 : 15,
          }}
        />
        <UserLocation accuracy animated heading />
        {!plannedRoute
          ? destinationOptions.map((option, index) => (
              <Marker
                key={option.id}
                id={option.id}
                anchor="center"
                lngLat={toLngLat(option.coordinate)}
              >
                <View style={styles.destinationMarker}>
                  <Text style={styles.destinationMarkerText}>{index + 1}</Text>
                </View>
              </Marker>
            ))
          : null}
        <GeoJSONSource id="planned-route-source" data={plannedRouteFeature}>
          <Layer
            id="planned-route-outer"
            type="line"
            paint={{
              'line-color': '#1f6feb',
              'line-width': 8,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
          <Layer
            id="planned-route-inner"
            type="line"
            paint={{
              'line-color': '#ffffff',
              'line-width': 3,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="recorded-route-source" data={recordedRouteFeature}>
          <Layer
            id="recorded-route"
            type="line"
            paint={{
              'line-color': '#2ea043',
              'line-width': 7,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
        </GeoJSONSource>
      </Map>
      {activeNavigationStep ? (
        <View style={styles.mapHud} pointerEvents="box-none">
          <View style={styles.navigationBanner}>
            <Text style={styles.navigationGlyph}>{activeNavigationStep.glyph}</Text>
            <View style={styles.navigationCopy}>
              {activeNavigationStep.distanceText ? (
                <Text style={styles.navigationDistance}>
                  {activeNavigationStep.distanceText}
                </Text>
              ) : null}
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.35}
                numberOfLines={1}
                style={styles.navigationStreet}
              >
                {activeNavigationStep.streetName}
              </Text>
            </View>
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
          onPress={handleMapCenterAction}
        >
          {isCameraCentered ? (
            <Image
              source={COMPASS_NEEDLE_ICON}
              style={styles.mapActionImageIcon}
            />
          ) : (
            <Text style={styles.mapActionIcon}>⌖</Text>
          )}
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
          <Text style={styles.mapActionIcon}>⛶</Text>
        </Pressable>
        {isNavigating && onCancelNavigation ? (
          <Pressable
            accessibilityLabel="Cancel navigation"
            hitSlop={8}
            style={({ pressed }) => [
              styles.mapActionButton,
              styles.mapActionButtonDanger,
              pressed && styles.mapActionButtonPressed,
            ]}
            onPress={onCancelNavigation}
          >
            <Text style={styles.mapActionIconDanger}>×</Text>
          </Pressable>
        ) : null}
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
      top: 8,
      left: 8,
      right: 8,
    },
    navigationBanner: {
      minHeight: 92,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderRadius: 28,
      backgroundColor: '#006d66',
      paddingHorizontal: 14,
      paddingVertical: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 0.24,
      shadowRadius: 14,
      elevation: 8,
    },
    navigationGlyph: {
      minWidth: 66,
      color: '#ffffff',
      fontSize: 72,
      fontWeight: '700',
      lineHeight: 78,
      textAlign: 'center',
    },
    navigationCopy: {
      flex: 1,
      minWidth: 0,
    },
    navigationDistance: {
      color: '#ffffff',
      fontSize: 30,
      fontWeight: '400',
      lineHeight: 36,
    },
    navigationStreet: {
      marginTop: 8,
      color: '#ffffff',
      fontSize: 36,
      fontWeight: '800',
      lineHeight: 40,
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
    mapActionButtonDanger: {
      borderColor: colors.danger,
      backgroundColor: colors.danger,
    },
    mapActionIcon: {
      color: colors.primaryText,
      fontSize: 20,
      fontWeight: '900',
      lineHeight: 22,
    },
    mapActionImageIcon: {
      width: 24,
      height: 24,
    },
    mapActionIconDanger: {
      color: '#fff',
      fontSize: 24,
      fontWeight: '900',
      lineHeight: 26,
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
  });
}
