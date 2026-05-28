import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import * as Brightness from 'expo-brightness';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  type ThemeColors,
  useRideSettings,
  useThemeColors,
} from '../src/features/settings/settings';
import {
  DASHBOARD_COLUMNS,
  DASHBOARD_MAX_ROWS,
  canAddDashboardMetric,
  createDashboardCard,
  createDashboardScreen,
  dashboardLayoutFits,
  dashboardMetricById,
  dashboardMetricCatalog,
  dashboardSpans,
  getDashboardLayoutRows,
  getDashboardSpanDimensions,
  type DashboardValueContext,
  type DashboardMetricCategory,
} from '../src/features/ride/dashboard';
import { DashboardGrid } from '../src/features/ride/DashboardGrid';
import { RideMap } from '../src/features/ride/RideMap';
import {
  getUpdatedRecentRouteDestinations,
  loadRecentRouteDestinations,
  planBikeRoute,
  saveRecentRouteDestinations,
  searchBikeDestinations,
} from '../src/features/ride/routePlanning';
import {
  deleteRide,
  updateRideDetails,
  type FinishedRideSummary,
} from '../src/features/ride/rideStorage';
import {
  FinishedRideSummarySheet,
  type HeartRateSample,
} from '../src/features/ride/FinishedRideSummarySheet';
import type {
  DashboardCard,
  DashboardCardSpan,
  DashboardMetricId,
  DashboardScreen,
  DestinationOption,
  PlannedRoute,
  RidePoint,
  RideSettings,
  RideStatus,
  RouteCoordinate,
} from '../src/features/ride/types';
import { useForegroundRideRecorder } from '../src/features/ride/useForegroundRideRecorder';
import {
  requestHeartRateBluetoothAccess,
  useHeartRateMonitor,
  type BluetoothAccessState,
} from '../src/features/devices/heartRateMonitor';
import { useDeviceBatteryLevel } from '../src/features/devices/battery';
import { useRideWeatherSamples } from '../src/features/ride/weather';

const metricCategories: DashboardMetricCategory[] = [
  'Calories',
  'Device',
  'Health',
  'Distance',
  'Elevation',
  'Lap',
  'Maps & Navigation',
  'Speed & Pace',
  'Time',
  'Weather',
];

const navigationItems = [
  {
    href: '/settings',
    title: 'Settings',
    eyebrow: 'Ride setup',
    description: 'Units, recording behavior, profile, splits, and map display.',
  },
  {
    href: '/permissions',
    title: 'Permissions',
    eyebrow: 'Access',
    description: 'Location and Bluetooth permissions for reliable recording.',
  },
  {
    href: '/history',
    title: 'History',
    eyebrow: 'Archive',
    description: 'Saved rides, route previews, summaries, and splits.',
  },
] as const;

const OFF_ROUTE_DISTANCE_METERS = 75;
const REROUTE_COOLDOWN_MS = 30_000;
const AUTO_DIM_DELAY_MS = 30_000;
const AUTO_DIM_BRIGHTNESS = 0.08;
const STOP_HOLD_MS = 1000;
const DASHBOARD_SWIPE_START_PX = 24;
const DASHBOARD_SWIPE_RELEASE_PX = 58;
const clockMetricIds = new Set<DashboardMetricId>([
  'timeOfDay',
  'sunrise',
  'sunset',
]);
const weatherMetricIds = new Set<DashboardMetricId>([
  'temperatureCurrent',
  'temperatureAverage',
  'temperatureLapAverage',
  'temperatureMax',
  'temperatureLapMax',
  'temperatureMin',
  'temperatureLapMin',
  'windCurrent',
  'windAverage',
  'windLapAverage',
  'windMax',
  'windLapMax',
  'windMin',
  'windLapMin',
]);
const heartRateMetricIds = new Set<DashboardMetricId>([
  'heartRateCurrent',
  'heartRateZoneBar',
  'heartRateZoneGauge',
]);

type DashboardMapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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

function distanceToRouteMeters(
  coordinate: RouteCoordinate,
  routeCoordinates: RouteCoordinate[],
) {
  if (routeCoordinates.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (routeCoordinates.length === 1) {
    return distanceBetweenCoordinates(coordinate, routeCoordinates[0]);
  }

  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude =
    metersPerDegreeLatitude * Math.cos((coordinate.latitude * Math.PI) / 180);

  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const start = routeCoordinates[index];
    const end = routeCoordinates[index + 1];
    const startX =
      (start.longitude - coordinate.longitude) * metersPerDegreeLongitude;
    const startY =
      (start.latitude - coordinate.latitude) * metersPerDegreeLatitude;
    const endX =
      (end.longitude - coordinate.longitude) * metersPerDegreeLongitude;
    const endY = (end.latitude - coordinate.latitude) * metersPerDegreeLatitude;
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const projection =
      segmentLengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              -(startX * segmentX + startY * segmentY) / segmentLengthSquared,
            ),
          );
    const closestX = startX + segmentX * projection;
    const closestY = startY + segmentY * projection;
    const distance = Math.hypot(closestX, closestY);

    bestDistance = Math.min(bestDistance, distance);
  }

  return bestDistance;
}

function clampDashboardScreenIndex(index: number, screenCount: number) {
  return Math.min(Math.max(index, 0), Math.max(screenCount - 1, 0));
}

function isDashboardScreenSwipe(dx: number, dy: number) {
  const absoluteX = Math.abs(dx);
  const absoluteY = Math.abs(dy);

  return absoluteX > DASHBOARD_SWIPE_START_PX && absoluteX > absoluteY * 1.35;
}

function getPrimaryDashboardMapCard(layout: DashboardCard[]) {
  return layout.find((card) => card.metricId === 'map') ?? null;
}

function getDashboardCardRect(
  layout: DashboardCard[],
  cardId: string,
  pageWidth: number,
  rowHeight: number,
): DashboardMapRect | null {
  let totalRows = 0;
  let lineColumns = 0;
  let lineRows = 0;

  for (const card of layout) {
    const { columns, rows } = getDashboardSpanDimensions(card.span);

    if (lineColumns > 0 && lineColumns + columns > DASHBOARD_COLUMNS + 0.001) {
      totalRows += lineRows;
      lineColumns = 0;
      lineRows = 0;
    }

    if (card.id === cardId) {
      return {
        x: (lineColumns / DASHBOARD_COLUMNS) * pageWidth,
        y: totalRows * rowHeight,
        width: (columns / DASHBOARD_COLUMNS) * pageWidth,
        height: rows * rowHeight,
      };
    }

    lineColumns += columns;
    lineRows = Math.max(lineRows, rows);
  }

  return null;
}

function getDashboardMetricValues(
  layout: DashboardCard[],
  context: DashboardValueContext,
) {
  const values = new Map<DashboardMetricId, string>();

  for (const card of layout) {
    if (values.has(card.metricId)) {
      continue;
    }

    const metric = dashboardMetricById.get(card.metricId);

    if (metric) {
      values.set(card.metricId, metric.getValue(context));
    }
  }

  return values;
}

function getSharedMapTransitionProgress(
  dashboardSlide: Animated.Value,
  dashboardPageWidth: number,
  dashboardSwipeDirection: number,
) {
  return dashboardSlide.interpolate({
    inputRange: [-dashboardPageWidth, 0, dashboardPageWidth],
    outputRange: dashboardSwipeDirection > 0 ? [1, 0, 0] : [0, 0, 1],
    extrapolate: 'clamp',
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const {
    settings,
    isLoading: isLoadingSettings,
    updateSetting,
  } = useRideSettings();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const dashboardPageWidth = Math.max(windowWidth, 1);
  const routePlannerMaxHeight = Math.max(windowHeight * 0.8, 1);
  const recorder = useForegroundRideRecorder(settings);
  const lastRouteOriginRef = useRef<RouteCoordinate | null>(null);
  const rerouteInFlightRef = useRef(false);
  const lastRerouteAtRef = useRef(0);
  const autoDimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brightnessBeforeDimRef = useRef<number | null>(null);
  const shouldAutoDimRideScreenRef = useRef(false);
  const stopHoldCompletedRef = useRef(false);
  const destinationInputRef = useRef<TextInput | null>(null);
  const heartRateSamplesRef = useRef<HeartRateSample[]>([]);
  const lastHeartRateSampleRef = useRef<HeartRateSample | null>(null);
  const [isRoutePlannerOpen, setIsRoutePlannerOpen] = useState(false);
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [destinationInput, setDestinationInput] = useState('');
  const [destinationOptions, setDestinationOptions] = useState<
    DestinationOption[]
  >([]);
  const [recentRouteDestinations, setRecentRouteDestinations] = useState<
    DestinationOption[]
  >([]);
  const [routeSearchOrigin, setRouteSearchOrigin] =
    useState<RouteCoordinate | null>(null);
  const [plannedRoute, setPlannedRoute] = useState<PlannedRoute | null>(null);
  const [selectedDestination, setSelectedDestination] =
    useState<DestinationOption | null>(null);
  const [isSearchingDestinations, setIsSearchingDestinations] = useState(false);
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [isScreenDimmed, setIsScreenDimmed] = useState(false);
  const [routePlannerKeyboardHeight, setRoutePlannerKeyboardHeight] =
    useState(0);
  const [routePlanError, setRoutePlanError] = useState<string | null>(null);
  const [finishedRide, setFinishedRide] = useState<FinishedRideSummary | null>(
    null,
  );
  const [finishedRideHeartRateSamples, setFinishedRideHeartRateSamples] =
    useState<HeartRateSample[]>([]);
  const [isSavingFinishedRide, setIsSavingFinishedRide] = useState(false);
  const [navigationPanelProgress] = useState(() => new Animated.Value(0));
  const [now, setNow] = useState<number | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );
  const [stopFill] = useState(() => new Animated.Value(0));
  const [isEditingDashboard, setIsEditingDashboard] = useState(false);
  const [dashboardScreenDrafts, setDashboardScreenDrafts] = useState<
    DashboardScreen[]
  >(settings.dashboardScreens);
  const [activeDashboardScreenIndex, setActiveDashboardScreenIndex] =
    useState(0);
  const [dashboardSlide] = useState(() => new Animated.Value(0));
  const [dashboardSwipeTargetIndex, setDashboardSwipeTargetIndex] = useState<
    number | null
  >(null);
  const [dashboardSwipeDirection, setDashboardSwipeDirection] = useState(0);
  const [dashboardHeight, setDashboardHeight] = useState(0);
  const [welcomeStep, setWelcomeStep] = useState(0);
  const [isPromptingWelcomePermissions, setIsPromptingWelcomePermissions] =
    useState(false);
  const [welcomePermissionMessage, setWelcomePermissionMessage] = useState<
    string | null
  >(null);
  const [metricPickerCardId, setMetricPickerCardId] = useState<string | null>(
    null,
  );
  const [sizePickerCardId, setSizePickerCardId] = useState<string | null>(null);
  const dashboardScreenCountRef = useRef(settings.dashboardScreens.length);
  const dashboardSwipeTargetIndexRef = useRef<number | null>(null);
  const dashboardSwipeDirectionRef = useRef(0);
  const dashboardWidthRef = useRef(dashboardPageWidth);
  const isEditingDashboardRef = useRef(false);
  const visibleDashboardScreenIndexRef = useRef(0);
  const isRecording = recorder.status === 'recording';
  const isPaused = recorder.status === 'paused';
  const shouldApplyRideScreenControls =
    appState === 'active' && (isRecording || isPaused);
  const shouldAutoDimRideScreen =
    settings.autoDimScreen && shouldApplyRideScreenControls;
  const canStart = recorder.status === 'idle' || recorder.status === 'stopped';
  const dashboardRowHeight = dashboardHeight > 0 ? dashboardHeight / 10 : 66;
  const displayedDashboardScreens = isEditingDashboard
    ? dashboardScreenDrafts
    : settings.dashboardScreens;
  const dashboardScreenCount = displayedDashboardScreens.length;
  const visibleDashboardScreenIndex = clampDashboardScreenIndex(
    activeDashboardScreenIndex,
    dashboardScreenCount,
  );
  const activeDashboardScreen =
    displayedDashboardScreens[visibleDashboardScreenIndex] ??
    displayedDashboardScreens[0];
  const displayedLayout = activeDashboardScreen?.layout ?? [];
  const layoutDraftRows = getDashboardLayoutRows(displayedLayout);
  const layoutDraftFits = dashboardLayoutFits(displayedLayout);
  const canAddDashboardCard = dashboardMetricCatalog.some((metric) =>
    canAddDashboardMetric(displayedLayout, metric.id),
  );
  const dashboardSwipeTargetScreen =
    dashboardSwipeTargetIndex == null
      ? null
      : displayedDashboardScreens[dashboardSwipeTargetIndex];
  const dashboardRuntimeLayout = dashboardSwipeTargetScreen
    ? [...displayedLayout, ...dashboardSwipeTargetScreen.layout]
    : displayedLayout;
  const hasConfiguredHeartRateDevice =
    settings.connectedHeartRateDevice != null;
  const shouldConnectHeartRate =
    hasConfiguredHeartRateDevice &&
    (dashboardRuntimeLayout.some((card) =>
      heartRateMetricIds.has(card.metricId),
    ) ||
      isRecording ||
      isPaused);
  const shouldReadDeviceBattery = dashboardRuntimeLayout.some(
    (card) => card.metricId === 'deviceBatteryLevel',
  );
  const shouldCollectWeather = dashboardRuntimeLayout.some((card) =>
    weatherMetricIds.has(card.metricId),
  );
  const shouldRunClock = dashboardRuntimeLayout.some((card) =>
    clockMetricIds.has(card.metricId),
  );
  const heartRate = useHeartRateMonitor(
    settings.connectedHeartRateDevice,
    shouldConnectHeartRate,
  );
  const deviceBatteryLevel = useDeviceBatteryLevel(shouldReadDeviceBattery);
  const weather = useRideWeatherSamples(
    recorder.routePoints,
    recorder.status,
    shouldCollectWeather,
  );
  const dashboardTargetTranslateX =
    dashboardSwipeDirection === 0
      ? dashboardSlide
      : dashboardSlide.interpolate({
          inputRange: [-dashboardPageWidth, 0, dashboardPageWidth],
          outputRange: [
            dashboardSwipeDirection * dashboardPageWidth - dashboardPageWidth,
            dashboardSwipeDirection * dashboardPageWidth,
            dashboardSwipeDirection * dashboardPageWidth + dashboardPageWidth,
          ],
        });
  const dashboardContext = {
    metrics: recorder.metrics,
    settings,
    routePoints: recorder.routePoints,
    currentCoordinate: recorder.currentCoordinate,
    plannedRoute,
    destinationOptions,
    isNavigating: recorder.status === 'recording' && plannedRoute != null,
    rideStatus: recorder.status,
    now,
    heartRateBpm: heartRate.heartRateBpm,
    heartRateStatus: heartRate.status,
    heartRateError: heartRate.error,
    deviceBatteryLevel,
    currentWeather: weather.currentWeather,
    weatherSamples: weather.weatherSamples,
  };
  const dashboardMetricValues = getDashboardMetricValues(
    dashboardRuntimeLayout,
    dashboardContext,
  );
  const activeDashboardMapCard = getPrimaryDashboardMapCard(displayedLayout);
  const targetDashboardMapCard = dashboardSwipeTargetScreen
    ? getPrimaryDashboardMapCard(dashboardSwipeTargetScreen.layout)
    : null;
  const activeDashboardMapRect =
    !isEditingDashboard && activeDashboardMapCard
      ? getDashboardCardRect(
          displayedLayout,
          activeDashboardMapCard.id,
          dashboardPageWidth,
          dashboardRowHeight,
        )
      : null;
  const targetDashboardMapRect =
    !isEditingDashboard && dashboardSwipeTargetScreen && targetDashboardMapCard
      ? getDashboardCardRect(
          dashboardSwipeTargetScreen.layout,
          targetDashboardMapCard.id,
          dashboardPageWidth,
          dashboardRowHeight,
        )
      : null;
  const visibleRecentRouteDestinations =
    destinationOptions.length === 0 && !isSearchingDestinations
      ? recentRouteDestinations
      : [];
  const hasRoutePlannerOptionList =
    visibleRecentRouteDestinations.length > 0 || destinationOptions.length > 0;
  shouldAutoDimRideScreenRef.current = shouldAutoDimRideScreen;
  const [dashboardSwipeResponder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        !isEditingDashboardRef.current &&
        dashboardScreenCountRef.current > 1 &&
        isDashboardScreenSwipe(gesture.dx, gesture.dy),
      onPanResponderGrant: () => {
        dashboardSlide.stopAnimation();
        dashboardSlide.setValue(0);
        updateDashboardSwipeTarget(null);
      },
      onPanResponderMove: (_, gesture) => {
        updateDashboardSwipeDrag(gesture.dx);
      },
      onPanResponderRelease: (_, gesture) => {
        const shouldChangeScreen =
          Math.abs(gesture.dx) > DASHBOARD_SWIPE_RELEASE_PX ||
          Math.abs(gesture.vx) > 0.45;
        const currentIndex = visibleDashboardScreenIndexRef.current;
        const targetIndex = getDashboardSwipeTargetIndex(gesture.dx);

        if (!shouldChangeScreen || targetIndex === currentIndex) {
          animateDashboardSwipeReset();
          return;
        }

        animateDashboardScreenChange(targetIndex);
      },
      onPanResponderTerminate: () => animateDashboardSwipeReset(),
      onPanResponderTerminationRequest: () => true,
    }),
  );

  useEffect(() => {
    dashboardScreenCountRef.current = dashboardScreenCount;
    dashboardWidthRef.current = dashboardPageWidth;
    isEditingDashboardRef.current = isEditingDashboard;
    visibleDashboardScreenIndexRef.current = visibleDashboardScreenIndex;
  }, [
    dashboardPageWidth,
    dashboardScreenCount,
    isEditingDashboard,
    visibleDashboardScreenIndex,
  ]);

  useEffect(() => {
    if (!shouldRunClock) {
      const resetTimeout = setTimeout(() => setNow(null), 0);
      return () => clearTimeout(resetTimeout);
    }

    const initialTimeout = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [shouldRunClock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isPaused) {
      stopFill.stopAnimation();
      stopFill.setValue(0);
    }
  }, [isPaused, stopFill]);

  function clearAutoDimTimer() {
    if (autoDimTimerRef.current) {
      clearTimeout(autoDimTimerRef.current);
      autoDimTimerRef.current = null;
    }
  }

  async function dimScreenForRide() {
    if (!shouldAutoDimRideScreenRef.current) {
      return;
    }

    let brightnessBeforeDim = brightnessBeforeDimRef.current;

    if (brightnessBeforeDim == null) {
      brightnessBeforeDim = await Brightness.getBrightnessAsync();

      if (!shouldAutoDimRideScreenRef.current) {
        return;
      }

      brightnessBeforeDimRef.current = brightnessBeforeDim;
    }

    await Brightness.setBrightnessAsync(AUTO_DIM_BRIGHTNESS);

    if (!shouldAutoDimRideScreenRef.current) {
      await Brightness.setBrightnessAsync(brightnessBeforeDim);
      brightnessBeforeDimRef.current = null;
      setIsScreenDimmed(false);
      return;
    }

    setIsScreenDimmed(true);
  }

  function scheduleAutoDim() {
    clearAutoDimTimer();

    if (!shouldAutoDimRideScreenRef.current) {
      return;
    }

    autoDimTimerRef.current = setTimeout(() => {
      dimScreenForRide().catch(() => undefined);
    }, AUTO_DIM_DELAY_MS);
  }

  async function restoreScreenBrightness() {
    clearAutoDimTimer();

    if (brightnessBeforeDimRef.current != null) {
      await Brightness.setBrightnessAsync(brightnessBeforeDimRef.current);
      brightnessBeforeDimRef.current = null;
    }

    setIsScreenDimmed(false);
    scheduleAutoDim();
  }

  function handleRideScreenTouch() {
    if (isScreenDimmed) {
      restoreScreenBrightness().catch(() => undefined);
      return;
    }

    scheduleAutoDim();
  }

  function resetRideSummaryDraft() {
    heartRateSamplesRef.current = [];
    lastHeartRateSampleRef.current = null;
    setFinishedRide(null);
    setFinishedRideHeartRateSamples([]);
  }

  const recordHeartRateSample = useCallback((bpm: number) => {
    const recordedAt = Date.now();
    const lastSample = lastHeartRateSampleRef.current;

    if (
      lastSample &&
      lastSample.bpm === bpm &&
      recordedAt - lastSample.recordedAt < 4500
    ) {
      return;
    }

    const sample = { recordedAt, bpm };
    heartRateSamplesRef.current = [...heartRateSamplesRef.current, sample];
    lastHeartRateSampleRef.current = sample;
  }, []);

  useEffect(() => {
    if (!isRecording || heartRate.heartRateBpm == null) {
      return;
    }

    recordHeartRateSample(heartRate.heartRateBpm);

    const interval = setInterval(() => {
      if (heartRate.heartRateBpm != null) {
        recordHeartRateSample(heartRate.heartRateBpm);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [heartRate.heartRateBpm, isRecording, recordHeartRateSample]);

  function startRide() {
    resetRideSummaryDraft();
    recorder.startRide().catch(() => {
      Alert.alert('Could not start ride', 'Please try again.');
    });
  }

  async function finishRideSummary(details: {
    title: string | null;
    feelingRating: number | null;
  }) {
    if (!finishedRide) {
      return;
    }

    setIsSavingFinishedRide(true);

    try {
      await updateRideDetails(finishedRide.summary.id, details);
      setFinishedRide(null);
      setFinishedRideHeartRateSamples([]);
    } catch {
      Alert.alert('Could not save ride', 'Please try again.');
    } finally {
      setIsSavingFinishedRide(false);
    }
  }

  function discardFinishedRide() {
    if (!finishedRide) {
      return;
    }

    Alert.alert('Discard ride?', 'This deletes the ride from your history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setIsSavingFinishedRide(true);
          deleteRide(finishedRide.summary.id)
            .then(() => {
              setFinishedRide(null);
              setFinishedRideHeartRateSamples([]);
            })
            .catch(() => {
              Alert.alert('Could not discard ride', 'Please try again.');
            })
            .finally(() => setIsSavingFinishedRide(false));
        },
      },
    ]);
  }

  useEffect(() => {
    clearAutoDimTimer();

    if (!shouldAutoDimRideScreen) {
      const brightnessBeforeDim = brightnessBeforeDimRef.current;

      if (brightnessBeforeDim != null) {
        Brightness.setBrightnessAsync(brightnessBeforeDim)
          .then(() => {
            brightnessBeforeDimRef.current = null;
            setIsScreenDimmed(false);
          })
          .catch(() => undefined);
      } else {
        setIsScreenDimmed(false);
      }

      return () => clearAutoDimTimer();
    }

    autoDimTimerRef.current = setTimeout(() => {
      dimScreenForRide().catch(() => undefined);
    }, AUTO_DIM_DELAY_MS);

    return () => clearAutoDimTimer();
  }, [shouldAutoDimRideScreen]);

  useEffect(() => {
    return () => {
      clearAutoDimTimer();
      if (brightnessBeforeDimRef.current != null) {
        Brightness.setBrightnessAsync(brightnessBeforeDimRef.current).catch(
          () => undefined,
        );
      }
    };
  }, []);

  useEffect(() => {
    if (!isRoutePlannerOpen) {
      return;
    }

    const showSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => setRoutePlannerKeyboardHeight(event.endCoordinates.height),
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setRoutePlannerKeyboardHeight(0),
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [isRoutePlannerOpen]);

  useEffect(() => {
    if (!isRoutePlannerOpen) {
      return;
    }

    let isMounted = true;

    loadRecentRouteDestinations()
      .then((destinations) => {
        if (isMounted) {
          setRecentRouteDestinations(destinations);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [isRoutePlannerOpen]);

  useEffect(() => {
    if (
      recorder.status !== 'recording' ||
      !plannedRoute ||
      !selectedDestination
    ) {
      return;
    }

    const latestPoint = recorder.routePoints.at(-1);
    const currentCoordinate =
      recorder.currentCoordinate ??
      (latestPoint
        ? {
            latitude: latestPoint.latitude,
            longitude: latestPoint.longitude,
          }
        : null);

    if (!currentCoordinate || plannedRoute.coordinates.length < 2) {
      return;
    }

    const distanceFromRoute = distanceToRouteMeters(
      currentCoordinate,
      plannedRoute.coordinates,
    );

    if (distanceFromRoute < OFF_ROUTE_DISTANCE_METERS) {
      return;
    }

    const nowMs = Date.now();

    if (
      rerouteInFlightRef.current ||
      nowMs - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS
    ) {
      return;
    }

    rerouteInFlightRef.current = true;
    lastRerouteAtRef.current = nowMs;

    planBikeRoute({
      destination: selectedDestination,
      origin: currentCoordinate,
      routeProfile: settings.routeProfile,
    })
      .then((route) => {
        setPlannedRoute(route);
        setRoutePlanError(null);
      })
      .catch((error) => {
        setRoutePlanError(
          error instanceof Error ? error.message : 'Could not reroute.',
        );
      })
      .finally(() => {
        rerouteInFlightRef.current = false;
      });
  }, [
    plannedRoute,
    recorder.currentCoordinate,
    recorder.routePoints,
    recorder.status,
    selectedDestination,
    settings.routeProfile,
  ]);

  function updateDashboardSwipeTarget(
    nextIndex: number | null,
    nextDirection = 0,
  ) {
    if (dashboardSwipeTargetIndexRef.current !== nextIndex) {
      dashboardSwipeTargetIndexRef.current = nextIndex;
      setDashboardSwipeTargetIndex(nextIndex);
    }

    if (dashboardSwipeDirectionRef.current !== nextDirection) {
      dashboardSwipeDirectionRef.current = nextDirection;
      setDashboardSwipeDirection(nextDirection);
    }
  }

  function getDashboardSwipeTargetIndex(dx: number) {
    const currentIndex = visibleDashboardScreenIndexRef.current;

    if (Math.abs(dx) < 1) {
      return currentIndex;
    }

    return clampDashboardScreenIndex(
      currentIndex + (dx < 0 ? 1 : -1),
      dashboardScreenCountRef.current,
    );
  }

  function updateDashboardSwipeDrag(dx: number) {
    const targetIndex = getDashboardSwipeTargetIndex(dx);
    const currentIndex = visibleDashboardScreenIndexRef.current;
    const width = dashboardWidthRef.current;
    const direction = Math.sign(targetIndex - currentIndex);

    if (targetIndex === currentIndex) {
      updateDashboardSwipeTarget(null);
      dashboardSlide.setValue(dx * 0.18);
      return;
    }

    updateDashboardSwipeTarget(targetIndex, direction);
    dashboardSlide.setValue(Math.max(-width, Math.min(width, dx)));
  }

  function animateDashboardSwipeReset() {
    dashboardSlide.stopAnimation();
    Animated.timing(dashboardSlide, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) {
        updateDashboardSwipeTarget(null);
      }
    });
  }

  function animateDashboardScreenChange(targetIndex: number) {
    const currentIndex = visibleDashboardScreenIndexRef.current;
    const direction = Math.sign(targetIndex - currentIndex);

    if (direction === 0) {
      animateDashboardSwipeReset();
      return;
    }

    updateDashboardSwipeTarget(targetIndex, direction);
    dashboardSlide.stopAnimation();
    Animated.timing(dashboardSlide, {
      toValue: -direction * dashboardWidthRef.current,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (!finished) {
        return;
      }

      setActiveDashboardScreenIndex(targetIndex);
      visibleDashboardScreenIndexRef.current = targetIndex;

      requestAnimationFrame(() => {
        dashboardSlide.setValue(0);
        updateDashboardSwipeTarget(null);
      });
    });
  }

  function setDashboardLayoutDraft(nextLayout: DashboardCard[]) {
    setDashboardScreenDrafts((currentScreens) =>
      currentScreens.map((screen, index) =>
        index === visibleDashboardScreenIndex
          ? { ...screen, layout: nextLayout }
          : screen,
      ),
    );
  }

  function saveDashboardLayout() {
    if (!layoutDraftFits) {
      return;
    }

    updateSetting('dashboardScreens', dashboardScreenDrafts).catch(() => {});
    updateSetting(
      'dashboardLayout',
      dashboardScreenDrafts[0]?.layout ?? [],
    ).catch(() => {});
    setIsEditingDashboard(false);
  }

  function addDashboardScreen() {
    const nextScreens = [...dashboardScreenDrafts, createDashboardScreen()];

    setDashboardScreenDrafts(nextScreens);
    setActiveDashboardScreenIndex(nextScreens.length - 1);
  }

  function removeActiveDashboardScreen() {
    if (dashboardScreenDrafts.length <= 1) {
      return;
    }

    const nextScreens = dashboardScreenDrafts.filter(
      (_, index) => index !== visibleDashboardScreenIndex,
    );

    setDashboardScreenDrafts(nextScreens);
    setActiveDashboardScreenIndex((currentIndex) =>
      clampDashboardScreenIndex(currentIndex, nextScreens.length),
    );
  }

  function moveDashboardScreen(direction: -1 | 1) {
    const targetIndex = clampDashboardScreenIndex(
      visibleDashboardScreenIndex + direction,
      dashboardScreenCount,
    );

    animateDashboardScreenChange(targetIndex);
  }

  function updateDashboardCard(cardId: string, patch: Partial<DashboardCard>) {
    setDashboardLayoutDraft(
      displayedLayout.map((card) =>
        card.id === cardId ? { ...card, ...patch } : card,
      ),
    );
  }

  function removeDashboardCard(cardId: string) {
    setDashboardLayoutDraft(
      displayedLayout.filter((card) => card.id !== cardId),
    );
  }

  function moveDashboardCard(draggedCardId: string, targetCardId: string) {
    if (draggedCardId === targetCardId) {
      return;
    }

    const from = displayedLayout.findIndex((card) => card.id === draggedCardId);
    const to = displayedLayout.findIndex((card) => card.id === targetCardId);

    if (from < 0 || to < 0) {
      return;
    }

    const next = [...displayedLayout];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    if (dashboardLayoutFits(next)) {
      setDashboardLayoutDraft(next);
    }
  }

  function chooseDashboardMetric(metricId: DashboardMetricId) {
    if (metricPickerCardId === 'new') {
      const nextLayout = [...displayedLayout, createDashboardCard(metricId)];

      if (dashboardLayoutFits(nextLayout)) {
        setDashboardLayoutDraft(nextLayout);
      }
    } else if (metricPickerCardId) {
      updateDashboardCard(metricPickerCardId, { metricId });
    }

    setMetricPickerCardId(null);
  }

  function chooseDashboardSpan(span: DashboardCardSpan) {
    if (sizePickerCardId) {
      const nextLayout = displayedLayout.map((card) =>
        card.id === sizePickerCardId ? { ...card, span } : card,
      );

      if (dashboardLayoutFits(nextLayout)) {
        setDashboardLayoutDraft(nextLayout);
      }
    }

    setSizePickerCardId(null);
  }

  function enterDashboardEditMode() {
    if (canStart) {
      setDashboardScreenDrafts(settings.dashboardScreens);
      setIsEditingDashboard(true);
    }
  }

  function getBluetoothWelcomeMessage(accessState: BluetoothAccessState) {
    switch (accessState) {
      case 'granted':
        return null;
      case 'denied':
        return 'Bluetooth permission was not enabled. You can enable it later from Permissions.';
      case 'powered-off':
        return 'Bluetooth is turned off. Turn it on when you want to connect fitness devices.';
      case 'unavailable':
        return 'Bluetooth is not available right now. You can try again later from Permissions.';
    }
  }

  async function promptForWelcomePermissions() {
    setWelcomePermissionMessage(null);
    setIsPromptingWelcomePermissions(true);

    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      const background =
        foreground.status === Location.PermissionStatus.GRANTED
          ? await Location.requestBackgroundPermissionsAsync()
          : null;
      const bluetooth = await requestHeartRateBluetoothAccess();
      const messages: string[] = [];

      if (foreground.status !== Location.PermissionStatus.GRANTED) {
        messages.push(
          'Location permission was not enabled. Pelot needs it to track rides.',
        );
      } else if (
        background &&
        background.status !== Location.PermissionStatus.GRANTED
      ) {
        messages.push(
          'Location is enabled for active rides. Enable background location later to keep recording when Pelot is not open.',
        );
      }

      const bluetoothMessage = getBluetoothWelcomeMessage(bluetooth);

      if (bluetoothMessage) {
        messages.push(bluetoothMessage);
      }

      setWelcomePermissionMessage(
        messages.length > 0
          ? messages.join(' ')
          : 'Permissions are ready. You can track rides and connect fitness devices.',
      );
    } catch {
      setWelcomePermissionMessage(
        'Could not finish permission setup. You can try again from Permissions.',
      );
    } finally {
      setIsPromptingWelcomePermissions(false);
    }
  }

  function completeWelcome() {
    updateSetting('hasCompletedWelcome', true).catch(() => {});
  }

  async function getRouteOrigin() {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== Location.PermissionStatus.GRANTED) {
      throw new Error('Location permission is required to plan a route.');
    }

    const shouldUseLastRidePoint =
      recorder.status === 'recording' || recorder.status === 'paused';
    const lastRidePoint = shouldUseLastRidePoint
      ? recorder.routePoints.at(-1)
      : null;

    if (shouldUseLastRidePoint && recorder.currentCoordinate) {
      lastRouteOriginRef.current = recorder.currentCoordinate;
      return recorder.currentCoordinate;
    }

    if (lastRidePoint) {
      const origin = {
        latitude: lastRidePoint.latitude,
        longitude: lastRidePoint.longitude,
      };
      lastRouteOriginRef.current = origin;
      return origin;
    }

    const lastKnownPosition = await Location.getLastKnownPositionAsync({
      maxAge: 5 * 60 * 1000,
      requiredAccuracy: 2000,
    });

    if (lastKnownPosition) {
      const origin = {
        latitude: lastKnownPosition.coords.latitude,
        longitude: lastKnownPosition.coords.longitude,
      };
      lastRouteOriginRef.current = origin;
      return origin;
    }

    if (lastRouteOriginRef.current) {
      return lastRouteOriginRef.current;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const origin = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    lastRouteOriginRef.current = origin;
    return origin;
  }

  async function handleSearchDestinations() {
    const query = destinationInput.trim();

    if (!query) {
      setRoutePlanError('Enter a destination first.');
      return;
    }

    Keyboard.dismiss();
    setRoutePlanError(null);
    setIsSearchingDestinations(true);
    setPlannedRoute(null);
    setSelectedDestination(null);

    try {
      const origin = await getRouteOrigin();
      const options = await searchBikeDestinations({
        query,
        origin,
      });

      setRouteSearchOrigin(origin);
      setDestinationOptions(options);
    } catch (error) {
      setRoutePlanError(
        error instanceof Error
          ? error.message
          : 'Could not search destinations.',
      );
    } finally {
      setIsSearchingDestinations(false);
    }
  }

  function clearDestinationInput() {
    setDestinationInput('');
    setDestinationOptions([]);
    setRouteSearchOrigin(null);
    setRoutePlanError(null);
    destinationInputRef.current?.focus();
  }

  async function handleSelectDestination(destination: DestinationOption) {
    Keyboard.dismiss();
    setDestinationInput(destination.name);
    setRoutePlanError(null);
    setIsPlanningRoute(true);

    try {
      const origin = routeSearchOrigin ?? (await getRouteOrigin());
      const route = await planBikeRoute({
        destination,
        origin,
        routeProfile: settings.routeProfile,
      });

      setPlannedRoute(route);
      setSelectedDestination(destination);
      setDestinationOptions([]);
      setRouteSearchOrigin(null);
      rememberRecentRouteDestination(destination);
      closeRoutePlanner();
    } catch (error) {
      setRoutePlanError(
        error instanceof Error ? error.message : 'Could not plan bike route.',
      );
    } finally {
      setIsPlanningRoute(false);
    }
  }

  function closeRoutePlanner() {
    Keyboard.dismiss();
    setRoutePlannerKeyboardHeight(0);
    setIsRoutePlannerOpen(false);
  }

  function rememberRecentRouteDestination(destination: DestinationOption) {
    setRecentRouteDestinations((currentDestinations) => {
      const updatedDestinations = getUpdatedRecentRouteDestinations(
        destination,
        currentDestinations,
      );

      saveRecentRouteDestinations(updatedDestinations).catch(() => undefined);
      return updatedDestinations;
    });
  }

  function cancelNavigation() {
    setPlannedRoute(null);
    setSelectedDestination(null);
    setRouteSearchOrigin(null);
    setDestinationOptions([]);
    setRoutePlanError(null);
  }

  function startStopHold() {
    stopHoldCompletedRef.current = false;
    stopFill.stopAnimation();
    stopFill.setValue(0);
    Animated.timing(stopFill, {
      toValue: 1,
      duration: STOP_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }

  function completeStopHold() {
    stopHoldCompletedRef.current = true;
    stopFill.stopAnimation();
    stopFill.setValue(0);
    recorder
      .stopRide()
      .then((ride) => {
        if (!ride) {
          return;
        }

        setFinishedRide(ride);
        setFinishedRideHeartRateSamples(heartRateSamplesRef.current);
      })
      .catch(() => {
        Alert.alert('Could not stop ride', 'Please try again.');
      });
  }

  function cancelStopHold() {
    if (stopHoldCompletedRef.current) {
      stopHoldCompletedRef.current = false;
      stopFill.stopAnimation();
      stopFill.setValue(0);
      return;
    }

    stopFill.stopAnimation((value) => {
      stopFill.setValue(value);
      Animated.timing(stopFill, {
        toValue: 0,
        duration: 110,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    });
  }

  function openNavigationPanel() {
    navigationPanelProgress.stopAnimation();
    navigationPanelProgress.setValue(1);
    setIsNavigationOpen(true);
  }

  function closeNavigationPanel() {
    navigationPanelProgress.stopAnimation();
    Animated.timing(navigationPanelProgress, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsNavigationOpen(false);
      }
    });
  }

  function navigateFromNavigationPanel(
    href: (typeof navigationItems)[number]['href'],
  ) {
    router.push(href);

    setTimeout(() => {
      navigationPanelProgress.stopAnimation();
      navigationPanelProgress.setValue(0);
      setIsNavigationOpen(false);
    }, 250);
  }

  const routePlannerSheet = isRoutePlannerOpen ? (
    <View
      pointerEvents={destinationOptions.length > 0 ? 'box-none' : 'auto'}
      style={[
        styles.routePlannerOverlay,
        styles.modalBackdrop,
        destinationOptions.length > 0 && styles.routeSelectionBackdrop,
        destinationOptions.length === 0 && {
          paddingBottom: routePlannerKeyboardHeight,
        },
      ]}
    >
      <View style={[styles.modalCard, { maxHeight: routePlannerMaxHeight }]}>
        <Text style={styles.modalTitle}>Plan bike route</Text>
        <Text style={styles.modalCopy}>
          Enter a destination, pick the correct result on the map or list, then
          Pelot will draw the bike route here.
        </Text>
        {routePlanError ? (
          <Text style={styles.error}>{routePlanError}</Text>
        ) : null}
        <View style={styles.destinationInputWrapper}>
          <TextInput
            ref={destinationInputRef}
            autoCapitalize="words"
            autoCorrect={false}
            onChangeText={(value) => {
              setDestinationInput(value);
              setDestinationOptions([]);
              setRoutePlanError(null);
            }}
            editable={!isSearchingDestinations && !isPlanningRoute}
            onSubmitEditing={handleSearchDestinations}
            placeholder="e.g. Gravelly Point"
            placeholderTextColor="#6e7681"
            returnKeyType="search"
            style={styles.destinationInput}
            value={destinationInput}
          />
          {destinationInput.length > 0 ? (
            <Pressable
              accessibilityLabel="Clear destination"
              accessibilityRole="button"
              disabled={isSearchingDestinations || isPlanningRoute}
              hitSlop={8}
              style={({ pressed }) => [
                styles.destinationInputClearButton,
                pressed && styles.subtleButtonPressed,
                (isSearchingDestinations || isPlanningRoute) &&
                  styles.disabledButton,
              ]}
              onPress={clearDestinationInput}
            >
              <Text style={styles.destinationInputClearButtonText}>x</Text>
            </Pressable>
          ) : null}
        </View>
        {hasRoutePlannerOptionList ? (
          <ScrollView
            contentContainerStyle={styles.routePlannerOptions}
            keyboardShouldPersistTaps="handled"
            style={styles.routePlannerOptionsScroller}
          >
            {visibleRecentRouteDestinations.length > 0 ? (
              <View style={styles.destinationSection}>
                <Text style={styles.destinationSectionTitle}>
                  Recent destinations
                </Text>
                {visibleRecentRouteDestinations.map((option, index) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isPlanningRoute }}
                    key={option.id}
                    disabled={isPlanningRoute}
                    style={({ pressed }) => [
                      styles.destinationOption,
                      pressed && styles.listButtonPressed,
                      isPlanningRoute && styles.disabledButton,
                    ]}
                    onPress={() => handleSelectDestination(option)}
                  >
                    <Text style={styles.destinationOptionIndex}>
                      {index + 1}
                    </Text>
                    <View style={styles.destinationOptionCopy}>
                      <Text style={styles.destinationOptionName}>
                        {option.name}
                      </Text>
                      {option.address ? (
                        <Text style={styles.destinationOptionAddress}>
                          {option.address}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {destinationOptions.length > 0 ? (
              <View style={styles.destinationSection}>
                <Text style={styles.destinationSectionTitle}>
                  Search results
                </Text>
                {destinationOptions.map((option, index) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isPlanningRoute }}
                    key={option.id}
                    disabled={isPlanningRoute}
                    style={({ pressed }) => [
                      styles.destinationOption,
                      pressed && styles.listButtonPressed,
                      isPlanningRoute && styles.disabledButton,
                    ]}
                    onPress={() => handleSelectDestination(option)}
                  >
                    <Text style={styles.destinationOptionIndex}>
                      {index + 1}
                    </Text>
                    <View style={styles.destinationOptionCopy}>
                      <Text style={styles.destinationOptionName}>
                        {option.name}
                      </Text>
                      {option.address ? (
                        <Text style={styles.destinationOptionAddress}>
                          {option.address}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        ) : null}
        <View style={styles.modalActions}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.modalSecondaryButton,
              pressed && styles.subtleButtonPressed,
            ]}
            onPress={closeRoutePlanner}
          >
            <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: isSearchingDestinations || isPlanningRoute,
            }}
            disabled={isSearchingDestinations || isPlanningRoute}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed &&
                !isSearchingDestinations &&
                !isPlanningRoute &&
                styles.primaryButtonPressed,
              isSearchingDestinations || isPlanningRoute
                ? styles.disabledButton
                : null,
            ]}
            onPress={handleSearchDestinations}
          >
            <Text style={styles.primaryButtonText}>
              {isPlanningRoute
                ? 'Planning...'
                : isSearchingDestinations
                  ? 'Searching...'
                  : 'Search'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  ) : null;

  const navigationPanel = isNavigationOpen ? (
    <View style={styles.navigationOverlay}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.navigationDim,
          {
            opacity: navigationPanelProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1],
            }),
          },
        ]}
      />
      <Pressable
        accessibilityLabel="Close menu"
        accessibilityRole="button"
        style={styles.navigationDismissArea}
        onPress={closeNavigationPanel}
      />
      <Animated.View
        style={[
          styles.navigationPanel,
          {
            paddingTop: Math.max(insets.top + 22, 46),
            paddingBottom: Math.max(insets.bottom + 22, 34),
            transform: [
              {
                translateX: navigationPanelProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [380, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.navigationHeader}>
          <View>
            <Text style={styles.navigationEyebrow}>Pelot</Text>
            <Text style={styles.navigationTitle}>Menu</Text>
          </View>
          <Pressable
            accessibilityLabel="Close menu"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.navigationCloseButton,
              pressed && styles.subtleButtonPressed,
            ]}
            onPress={closeNavigationPanel}
          >
            <Text style={styles.navigationCloseText}>Close</Text>
          </Pressable>
        </View>

        <View style={styles.navigationList}>
          {navigationItems.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.href}
              style={({ pressed }) => [
                styles.navigationItem,
                pressed ? styles.navigationItemPressed : null,
              ]}
              onPress={() => navigateFromNavigationPanel(item.href)}
            >
              <Text style={styles.navigationItemEyebrow}>{item.eyebrow}</Text>
              <Text style={styles.navigationItemTitle}>{item.title}</Text>
              <Text style={styles.navigationItemDescription}>
                {item.description}
              </Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </View>
  ) : null;

  const welcomeModalVisible =
    !isLoadingSettings && !settings.hasCompletedWelcome;

  return (
    <>
      <View style={styles.container} onTouchStart={handleRideScreenTouch}>
        {!isEditingDashboard ? (
          <Pressable
            accessibilityLabel="Open menu"
            style={({ pressed }) => [
              styles.menuButton,
              { top: Math.max(insets.top + 4, 12) },
              pressed && styles.menuButtonPressed,
            ]}
            onPress={openNavigationPanel}
          >
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
          </Pressable>
        ) : null}

        {isEditingDashboard ? (
          <View
            pointerEvents="none"
            style={[
              styles.editModeStatusAnchor,
              { top: Math.max(insets.top + 4, 12) },
            ]}
          >
            <View style={styles.editModeStatus}>
              <Text style={styles.editModeStatusTitle}>
                Screen {visibleDashboardScreenIndex + 1}/{dashboardScreenCount}
              </Text>
              <Text style={styles.editModeStatusDetail}>
                {layoutDraftRows}/{DASHBOARD_MAX_ROWS} rows used
              </Text>
            </View>
          </View>
        ) : null}

        <View
          style={[styles.dashboardArea, { paddingTop: insets.top }]}
          onLayout={(event) => {
            setDashboardHeight(event.nativeEvent.layout.height - insets.top);
          }}
        >
          <View
            {...dashboardSwipeResponder.panHandlers}
            style={styles.dashboardPager}
          >
            <View style={styles.dashboardSlideViewport}>
              <Animated.View
                style={[
                  styles.dashboardSlidePage,
                  { transform: [{ translateX: dashboardSlide }] },
                ]}
              >
                <ScrollView
                  style={styles.dashboardScroller}
                  scrollEnabled={false}
                >
                  <DashboardGrid
                    canAddCard={canAddDashboardCard}
                    colors={colors}
                    context={dashboardContext}
                    isEditing={isEditingDashboard}
                    layout={displayedLayout}
                    mapTileMode={isEditingDashboard ? 'live' : 'slot'}
                    metricValues={dashboardMetricValues}
                    rowHeight={dashboardRowHeight}
                    settings={settings}
                    onAddCard={() => setMetricPickerCardId('new')}
                    onCancelNavigation={cancelNavigation}
                    onLongPressEmpty={
                      canStart ? enterDashboardEditMode : undefined
                    }
                    onLongPressCard={
                      canStart ? enterDashboardEditMode : undefined
                    }
                    onMoveCard={moveDashboardCard}
                    onPressCard={(card) => setSizePickerCardId(card.id)}
                    onRemoveCard={removeDashboardCard}
                  />
                </ScrollView>
              </Animated.View>
              {dashboardSwipeTargetScreen ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.dashboardSlidePage,
                    styles.dashboardSlidePageOverlay,
                    {
                      transform: [{ translateX: dashboardTargetTranslateX }],
                    },
                  ]}
                >
                  <ScrollView
                    style={styles.dashboardScroller}
                    scrollEnabled={false}
                  >
                    <DashboardGrid
                      canAddCard={dashboardMetricCatalog.some((metric) =>
                        canAddDashboardMetric(
                          dashboardSwipeTargetScreen.layout,
                          metric.id,
                        ),
                      )}
                      colors={colors}
                      context={dashboardContext}
                      isEditing={isEditingDashboard}
                      layout={dashboardSwipeTargetScreen.layout}
                      mapTileMode={isEditingDashboard ? 'live' : 'slot'}
                      metricValues={dashboardMetricValues}
                      rowHeight={dashboardRowHeight}
                      settings={settings}
                      onAddCard={() => setMetricPickerCardId('new')}
                      onCancelNavigation={cancelNavigation}
                      onLongPressEmpty={
                        canStart ? enterDashboardEditMode : undefined
                      }
                      onLongPressCard={
                        canStart ? enterDashboardEditMode : undefined
                      }
                      onMoveCard={moveDashboardCard}
                      onPressCard={(card) => setSizePickerCardId(card.id)}
                      onRemoveCard={removeDashboardCard}
                    />
                  </ScrollView>
                </Animated.View>
              ) : null}
              {!isEditingDashboard &&
              (activeDashboardMapRect || targetDashboardMapRect) ? (
                <SharedDashboardMapLayer
                  activeRect={activeDashboardMapRect}
                  colors={colors}
                  dashboardPageWidth={dashboardPageWidth}
                  dashboardSlide={dashboardSlide}
                  dashboardSwipeDirection={dashboardSwipeDirection}
                  dashboardTargetTranslateX={dashboardTargetTranslateX}
                  destinationOptions={destinationOptions}
                  isNavigating={dashboardContext.isNavigating}
                  mapType={settings.mapType}
                  onCancelNavigation={cancelNavigation}
                  onLongPress={
                    canStart && activeDashboardMapCard
                      ? enterDashboardEditMode
                      : undefined
                  }
                  plannedRoute={plannedRoute}
                  points={recorder.routePoints}
                  liveRideCoordinate={recorder.currentCoordinate}
                  rideStatus={recorder.status}
                  targetRect={targetDashboardMapRect}
                  unitSystem={settings.unitSystem}
                />
              ) : null}
            </View>
            {dashboardScreenCount > 1 ? (
              <View pointerEvents="none" style={styles.dashboardPageDots}>
                {displayedDashboardScreens.map((screen, index) => (
                  <View
                    key={screen.id}
                    style={[
                      styles.dashboardPageDot,
                      index === visibleDashboardScreenIndex &&
                        styles.dashboardPageDotActive,
                    ]}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </View>

        {recorder.isAutoPaused ? (
          <Text style={styles.warning}>Auto-paused</Text>
        ) : null}
        {recorder.error ? (
          <Text style={styles.error}>{recorder.error}</Text>
        ) : null}
        {routePlanError ? (
          <Text style={styles.error}>{routePlanError}</Text>
        ) : null}

        {plannedRoute && recorder.status !== 'recording' ? (
          <View style={styles.destinationCard}>
            <Text style={styles.metricLabel}>Planned bike route</Text>
            <Text style={styles.destinationValue}>
              {plannedRoute.destination}
            </Text>
            <Text style={styles.coordinateText}>
              {plannedRoute.distanceText} · {plannedRoute.durationText}. Review
              the route, then start recording.
            </Text>
          </View>
        ) : null}

        {isEditingDashboard ? (
          <View
            style={[
              styles.editModeControls,
              { paddingBottom: Math.max(insets.bottom, 10) },
            ]}
          >
            <View style={styles.editModeScreenControls}>
              {dashboardScreenCount > 1 ? (
                <>
                  <Pressable
                    accessibilityLabel="Previous dashboard screen"
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: visibleDashboardScreenIndex === 0,
                    }}
                    disabled={visibleDashboardScreenIndex === 0}
                    style={({ pressed }) => [
                      styles.editModeButton,
                      styles.editModeArrowButton,
                      visibleDashboardScreenIndex === 0 &&
                        styles.disabledButton,
                      pressed &&
                        visibleDashboardScreenIndex > 0 &&
                        styles.subtleButtonPressed,
                    ]}
                    onPress={() => moveDashboardScreen(-1)}
                  >
                    <Text
                      style={[
                        styles.editModeButtonText,
                        styles.editModeArrowText,
                      ]}
                    >
                      ‹
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Next dashboard screen"
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled:
                        visibleDashboardScreenIndex >= dashboardScreenCount - 1,
                    }}
                    disabled={
                      visibleDashboardScreenIndex >= dashboardScreenCount - 1
                    }
                    style={({ pressed }) => [
                      styles.editModeButton,
                      styles.editModeArrowButton,
                      visibleDashboardScreenIndex >= dashboardScreenCount - 1 &&
                        styles.disabledButton,
                      pressed &&
                        visibleDashboardScreenIndex <
                          dashboardScreenCount - 1 &&
                        styles.subtleButtonPressed,
                    ]}
                    onPress={() => moveDashboardScreen(1)}
                  >
                    <Text
                      style={[
                        styles.editModeButtonText,
                        styles.editModeArrowText,
                      ]}
                    >
                      ›
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
            {dashboardScreenDrafts.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove dashboard screen"
                style={({ pressed }) => [
                  styles.editModeButton,
                  styles.editModeActionButton,
                  styles.editModeRemoveButton,
                  pressed && styles.dangerSoftButtonPressed,
                ]}
                onPress={removeActiveDashboardScreen}
              >
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  numberOfLines={1}
                  style={styles.editModeRemoveButtonText}
                >
                  Remove
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.editModeButton,
                styles.editModeActionButton,
                pressed && styles.subtleButtonPressed,
              ]}
              onPress={addDashboardScreen}
            >
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                numberOfLines={1}
                style={styles.editModeButtonText}
              >
                Add screen
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset dashboard changes"
              style={({ pressed }) => [
                styles.editModeButton,
                styles.editModeActionButton,
                pressed && styles.subtleButtonPressed,
              ]}
              onPress={() => {
                setDashboardScreenDrafts(settings.dashboardScreens);
                setActiveDashboardScreenIndex((currentIndex) =>
                  clampDashboardScreenIndex(
                    currentIndex,
                    settings.dashboardScreens.length,
                  ),
                );
              }}
            >
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                numberOfLines={1}
                style={styles.editModeButtonText}
              >
                Reset
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !layoutDraftFits }}
              disabled={!layoutDraftFits}
              style={({ pressed }) => [
                styles.editModeDoneButton,
                styles.editModeActionButton,
                !layoutDraftFits && styles.disabledButton,
                pressed && layoutDraftFits && styles.primaryButtonPressed,
              ]}
              onPress={saveDashboardLayout}
            >
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                numberOfLines={1}
                style={styles.editModeDoneButtonText}
              >
                Done
              </Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={[
              styles.controls,
              { paddingBottom: Math.max(insets.bottom, 10) },
            ]}
          >
            {canStart ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.routeButton,
                  pressed && styles.routeButtonPressed,
                ]}
                onPress={() => setIsRoutePlannerOpen(true)}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.routeButtonText,
                      pressed && styles.routeButtonTextPressed,
                    ]}
                  >
                    Plan route
                  </Text>
                )}
              </Pressable>
            ) : null}
            {isRecording ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.routeButton,
                  pressed && styles.routeButtonPressed,
                ]}
                onPress={recorder.markLap}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.routeButtonText,
                      pressed && styles.routeButtonTextPressed,
                    ]}
                  >
                    Lap
                  </Text>
                )}
              </Pressable>
            ) : null}
            {canStart ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
                onPress={startRide}
              >
                <Text style={styles.primaryButtonText}>Start ride</Text>
              </Pressable>
            ) : null}
            {isRecording ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.dangerSoftButtonPressed,
                ]}
                onPress={recorder.pauseRide}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      pressed && styles.dangerSoftButtonTextPressed,
                    ]}
                  >
                    Pause
                  </Text>
                )}
              </Pressable>
            ) : null}
            {isPaused ? (
              <Pressable
                accessibilityHint="Press and hold to finish and save the ride."
                accessibilityRole="button"
                style={styles.holdStopButton}
                delayLongPress={STOP_HOLD_MS}
                onLongPress={completeStopHold}
                onPressIn={startStopHold}
                onPressOut={cancelStopHold}
              >
                <Animated.View
                  style={[
                    styles.holdStopFill,
                    {
                      width: stopFill.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
                <Animated.Text
                  style={[
                    styles.stopButtonText,
                    {
                      color: stopFill.interpolate({
                        inputRange: [0, 0.65, 1],
                        outputRange: [colors.danger, colors.danger, '#fff'],
                      }),
                    },
                  ]}
                >
                  Hold to stop
                </Animated.Text>
              </Pressable>
            ) : null}
            {isPaused ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
                onPress={recorder.resumeRide}
              >
                <Text style={styles.primaryButtonText}>Resume</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {routePlannerSheet}
        {navigationPanel}

        <StatusBar style={settings.theme === 'light' ? 'dark' : 'light'} />
        {isScreenDimmed ? (
          <Pressable
            accessibilityLabel="Restore screen brightness"
            accessibilityRole="button"
            style={styles.dimWakeOverlay}
            onPress={() => restoreScreenBrightness().catch(() => undefined)}
          >
            <Text style={styles.dimWakeText}>Tap to brighten</Text>
          </Pressable>
        ) : null}
      </View>

      <DashboardMetricPickerModal
        colors={colors}
        canSelectMetric={(metricId) =>
          metricPickerCardId !== 'new' ||
          canAddDashboardMetric(displayedLayout, metricId)
        }
        visible={metricPickerCardId != null}
        onClose={() => setMetricPickerCardId(null)}
        onSelect={chooseDashboardMetric}
      />
      <DashboardSizePickerModal
        colors={colors}
        card={
          displayedLayout.find((card) => card.id === sizePickerCardId) ?? null
        }
        visible={sizePickerCardId != null}
        onClose={() => setSizePickerCardId(null)}
        onChangeMetric={(cardId) => {
          setSizePickerCardId(null);
          setMetricPickerCardId(cardId);
        }}
        canSelectSpan={(span) =>
          sizePickerCardId != null &&
          dashboardLayoutFits(
            displayedLayout.map((card) =>
              card.id === sizePickerCardId ? { ...card, span } : card,
            ),
          )
        }
        onSelect={chooseDashboardSpan}
      />
      <FinishedRideSummarySheet
        visible={finishedRide != null}
        ride={finishedRide}
        heartRateSamples={finishedRideHeartRateSamples}
        showHeartRate={
          hasConfiguredHeartRateDevice ||
          finishedRideHeartRateSamples.length > 0
        }
        isSaving={isSavingFinishedRide}
        onDiscard={discardFinishedRide}
        onFinish={(details) => {
          finishRideSummary(details).catch(() => undefined);
        }}
      />
      <Modal
        animationType="slide"
        transparent
        visible={welcomeModalVisible}
        onRequestClose={completeWelcome}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.welcomeCard}>
            <View style={styles.welcomeStepIndicator}>
              <View
                style={[
                  styles.welcomeStepDot,
                  welcomeStep === 0 && styles.welcomeStepDotActive,
                ]}
              />
              <View
                style={[
                  styles.welcomeStepDot,
                  welcomeStep === 1 && styles.welcomeStepDotActive,
                ]}
              />
            </View>

            {welcomeStep === 0 ? (
              <>
                <Text style={styles.modalTitle}>Welcome to Pelot</Text>
                <Text style={styles.modalCopy}>
                  Enable location permissions and Bluetooth to track your ride
                  and connect to your fitness devices.
                </Text>
                {welcomePermissionMessage ? (
                  <Text style={styles.welcomeStatus}>
                    {welcomePermissionMessage}
                  </Text>
                ) : null}
                <View style={styles.modalActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: isPromptingWelcomePermissions,
                    }}
                    disabled={isPromptingWelcomePermissions}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed &&
                        !isPromptingWelcomePermissions &&
                        styles.primaryButtonPressed,
                      isPromptingWelcomePermissions && styles.disabledButton,
                    ]}
                    onPress={promptForWelcomePermissions}
                  >
                    <Text style={styles.primaryButtonText}>
                      {isPromptingWelcomePermissions
                        ? 'Requesting...'
                        : 'Allow access'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.modalSecondaryButton,
                      pressed && styles.subtleButtonPressed,
                    ]}
                    onPress={() => setWelcomeStep(1)}
                  >
                    <Text style={styles.modalSecondaryButtonText}>Next</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Edit your dashboard</Text>
                <Text style={styles.modalCopy}>
                  Press and hold any metric tile to edit your ride dashboard.
                  Drag and drop tiles to your desired location, add metrics or
                  screens, or tap a tile again to customize the metric and its
                  size.
                </Text>
                <View style={styles.modalActions}>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.modalSecondaryButton,
                      pressed && styles.subtleButtonPressed,
                    ]}
                    onPress={() => setWelcomeStep(0)}
                  >
                    <Text style={styles.modalSecondaryButtonText}>Back</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed && styles.primaryButtonPressed,
                    ]}
                    onPress={completeWelcome}
                  >
                    <Text style={styles.primaryButtonText}>Get started</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function SharedDashboardMapLayer({
  activeRect,
  colors,
  dashboardPageWidth,
  dashboardSlide,
  dashboardSwipeDirection,
  dashboardTargetTranslateX,
  destinationOptions,
  isNavigating,
  mapType,
  onCancelNavigation,
  onLongPress,
  plannedRoute,
  points,
  liveRideCoordinate,
  rideStatus,
  targetRect,
  unitSystem,
}: {
  activeRect: DashboardMapRect | null;
  colors: ThemeColors;
  dashboardPageWidth: number;
  dashboardSlide: Animated.Value;
  dashboardSwipeDirection: number;
  dashboardTargetTranslateX:
    | Animated.Value
    | Animated.AnimatedInterpolation<number>;
  destinationOptions: DestinationOption[];
  isNavigating: boolean;
  mapType: RideSettings['mapType'];
  onCancelNavigation: () => void;
  onLongPress?: () => void;
  plannedRoute: PlannedRoute | null;
  points: RidePoint[];
  liveRideCoordinate: RouteCoordinate | null;
  rideStatus: RideStatus;
  targetRect: DashboardMapRect | null;
  unitSystem: RideSettings['unitSystem'];
}) {
  const styles = createStyles(colors);
  const baseRect = activeRect ?? targetRect;
  const hasMapRect = baseRect != null;
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [mapOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(mapOpacity, {
      toValue: isMapLoaded && hasMapRect ? 1 : 0,
      duration: isMapLoaded ? 180 : 80,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hasMapRect, isMapLoaded, mapOpacity]);

  if (!baseRect) {
    return null;
  }

  const sharedMapTransform =
    activeRect && targetRect && dashboardSwipeDirection !== 0
      ? getSharedMapTransform({
          activeRect,
          dashboardPageWidth,
          dashboardSlide,
          dashboardSwipeDirection,
          targetRect,
        })
      : activeRect && dashboardSwipeDirection !== 0
        ? [{ translateX: dashboardSlide }]
        : !activeRect && targetRect && dashboardSwipeDirection !== 0
          ? [{ translateX: dashboardTargetTranslateX }]
          : [];

  return (
    <Animated.View
      pointerEvents={isMapLoaded ? 'auto' : 'none'}
      style={[
        styles.sharedDashboardMap,
        {
          top: baseRect.y,
          left: baseRect.x,
          width: baseRect.width,
          height: baseRect.height,
          opacity: mapOpacity,
          transform: sharedMapTransform,
        },
      ]}
    >
      <RideMap
        destinationOptions={destinationOptions}
        isNavigating={isNavigating}
        mapType={mapType}
        onCancelNavigation={onCancelNavigation}
        onLoadStateChange={setIsMapLoaded}
        onLongPress={onLongPress}
        plannedRoute={plannedRoute}
        points={points}
        liveRideCoordinate={liveRideCoordinate}
        rideStatus={rideStatus}
        unitSystem={unitSystem}
      />
    </Animated.View>
  );
}

function getSharedMapTransform({
  activeRect,
  dashboardPageWidth,
  dashboardSlide,
  dashboardSwipeDirection,
  targetRect,
}: {
  activeRect: DashboardMapRect;
  dashboardPageWidth: number;
  dashboardSlide: Animated.Value;
  dashboardSwipeDirection: number;
  targetRect: DashboardMapRect;
}) {
  const progress = getSharedMapTransitionProgress(
    dashboardSlide,
    dashboardPageWidth,
    dashboardSwipeDirection,
  );
  const activeCenterX = activeRect.x + activeRect.width / 2;
  const activeCenterY = activeRect.y + activeRect.height / 2;
  const targetCenterX = targetRect.x + targetRect.width / 2;
  const targetCenterY = targetRect.y + targetRect.height / 2;
  const scaleX = targetRect.width / activeRect.width;
  const scaleY = targetRect.height / activeRect.height;

  return [
    {
      translateX: Animated.multiply(progress, targetCenterX - activeCenterX),
    },
    {
      translateY: Animated.multiply(progress, targetCenterY - activeCenterY),
    },
    {
      scaleX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, scaleX],
      }),
    },
    {
      scaleY: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, scaleY],
      }),
    },
  ];
}

function DashboardMetricPickerModal({
  colors,
  canSelectMetric,
  visible,
  onClose,
  onSelect,
}: {
  colors: ThemeColors;
  canSelectMetric: (metricId: DashboardMetricId) => boolean;
  visible: boolean;
  onClose: () => void;
  onSelect: (metricId: DashboardMetricId) => void;
}) {
  const styles = createStyles(colors);

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <ScrollView style={styles.modal} contentContainerStyle={styles.modalBody}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Choose Metric</Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.linkButtonPressed}
            onPress={onClose}
          >
            <Text style={styles.modalCloseLink}>Close</Text>
          </Pressable>
        </View>
        {metricCategories.map((category) => (
          <View key={category} style={styles.pickerSection}>
            <Text style={styles.pickerSectionTitle}>{category}</Text>
            {dashboardMetricCatalog
              .filter((metric) => metric.category === category)
              .map((metric, index, metrics) => {
                const canSelect = canSelectMetric(metric.id);

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canSelect }}
                    key={metric.id}
                    disabled={!canSelect}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      index === metrics.length - 1 && styles.pickerRowLast,
                      !canSelect && styles.pickerRowDisabled,
                      pressed && styles.listButtonPressed,
                    ]}
                    onPress={() => onSelect(metric.id)}
                  >
                    <Text
                      style={[
                        styles.pickerLabel,
                        !canSelect && styles.pickerLabelDisabled,
                      ]}
                    >
                      {metric.label}
                    </Text>
                    <Text
                      style={[
                        styles.pickerChevron,
                        !canSelect && styles.pickerLabelDisabled,
                      ]}
                    >
                      ›
                    </Text>
                  </Pressable>
                );
              })}
          </View>
        ))}
      </ScrollView>
    </Modal>
  );
}

function DashboardSizePickerModal({
  colors,
  card,
  visible,
  onClose,
  onChangeMetric,
  canSelectSpan,
  onSelect,
}: {
  colors: ThemeColors;
  card: DashboardCard | null;
  visible: boolean;
  onClose: () => void;
  onChangeMetric: (cardId: string) => void;
  canSelectSpan: (span: DashboardCardSpan) => boolean;
  onSelect: (span: DashboardCardSpan) => void;
}) {
  const styles = createStyles(colors);
  const metric = card ? dashboardMetricById.get(card.metricId) : null;
  const spans = metric?.supportedSpans ?? dashboardSpans;
  const spanHeights = Array.from(
    new Set(spans.map((span) => getDashboardSpanDimensions(span).rows)),
  ).sort((a, b) => a - b);

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.sizeModalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Customize</Text>
            <Pressable
              accessibilityLabel="Close customize"
              style={({ pressed }) => [
                styles.navigationCloseButton,
                pressed && styles.subtleButtonPressed,
              ]}
              onPress={onClose}
            >
              <Text style={styles.navigationCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.sizeOptionsScroller}
            contentContainerStyle={styles.sizeOptions}
          >
            {card ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.metricChangeButton,
                  pressed && styles.routeButtonPressed,
                ]}
                onPress={() => onChangeMetric(card.id)}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.metricChangeButtonText,
                      pressed && styles.routeButtonTextPressed,
                    ]}
                  >
                    Change metric
                  </Text>
                )}
              </Pressable>
            ) : null}
            {spanHeights.map((height) => {
              const groupedSpans = spans.filter(
                (span) => getDashboardSpanDimensions(span).rows === height,
              );

              if (groupedSpans.length === 0) {
                return null;
              }

              return (
                <View key={height} style={styles.sizeGroup}>
                  <Text style={styles.sizeGroupTitle}>
                    {height} Tile{height === 1 ? '' : 's'} Tall
                  </Text>
                  <View style={styles.sizeGroupOptions}>
                    {groupedSpans.map((span) => {
                      const canSelect = canSelectSpan(span);

                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{
                            disabled: !canSelect,
                            selected: card?.span === span,
                          }}
                          key={span}
                          disabled={!canSelect}
                          style={({ pressed }) => [
                            styles.spanButton,
                            card?.span === span && styles.spanButtonSelected,
                            !canSelect && styles.spanButtonDisabled,
                            pressed && styles.subtleButtonPressed,
                            pressed &&
                              card?.span === span &&
                              styles.selectedButtonPressed,
                          ]}
                          onPress={() => onSelect(span)}
                        >
                          <Text
                            style={[
                              styles.spanButtonText,
                              card?.span === span &&
                                styles.spanButtonTextSelected,
                              !canSelect && styles.spanButtonTextDisabled,
                            ]}
                          >
                            {span}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    dimWakeOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.08)',
      zIndex: 50,
    },
    dimWakeText: {
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: 'rgba(0, 0, 0, 0.52)',
      color: '#fff',
      fontSize: 14,
      fontWeight: '900',
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    dashboardArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    dashboardPager: {
      flex: 1,
    },
    dashboardSlideViewport: {
      flex: 1,
      overflow: 'hidden',
    },
    sharedDashboardMap: {
      position: 'absolute',
      zIndex: 4,
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    dashboardSlidePage: {
      flex: 1,
    },
    dashboardSlidePageOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    dashboardScroller: {
      flex: 1,
    },
    dashboardPageDots: {
      position: 'absolute',
      right: 0,
      bottom: 8,
      left: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
    },
    dashboardPageDot: {
      width: 6,
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    dashboardPageDotActive: {
      width: 18,
      backgroundColor: colors.accent,
    },
    editModeStatusAnchor: {
      position: 'absolute',
      right: 0,
      left: 0,
      zIndex: 12,
      alignItems: 'center',
    },
    editModeStatus: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
      paddingVertical: 6,
      boxShadow: '0 4px 10px rgba(0, 0, 0, 0.14)',
    },
    editModeStatusTitle: {
      color: colors.primaryText,
      fontSize: 13,
      fontWeight: '900',
      lineHeight: 16,
      textAlign: 'center',
    },
    editModeStatusDetail: {
      marginTop: 2,
      color: colors.mutedText,
      fontSize: 11,
      fontWeight: '800',
      lineHeight: 14,
      textAlign: 'center',
    },
    editModeControls: {
      flexDirection: 'row',
      flexWrap: 'nowrap',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 6,
      backgroundColor: colors.card,
      paddingHorizontal: 6,
      paddingTop: 8,
      paddingBottom: 10,
    },
    editModeScreenControls: {
      width: 104,
      flexDirection: 'row',
      flexShrink: 0,
      gap: 6,
    },
    editModeButton: {
      minWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },
    editModeArrowButton: {
      flex: 1,
      paddingHorizontal: 0,
    },
    editModeActionButton: {
      flexShrink: 1,
      minWidth: 54,
    },
    editModeRemoveButton: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    editModeButtonText: {
      color: colors.primaryText,
      fontSize: 12,
      fontWeight: '900',
      textAlign: 'center',
    },
    editModeRemoveButtonText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '900',
      textAlign: 'center',
    },
    editModeArrowText: {
      fontSize: 14,
      lineHeight: 18,
    },
    editModeDoneButton: {
      minWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: colors.success,
      paddingHorizontal: 11,
      paddingVertical: 9,
    },
    primaryButtonPressed: {
      opacity: 0.78,
      transform: [{ scale: 0.97 }],
    },
    subtleButtonPressed: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      opacity: 0.82,
      transform: [{ scale: 0.98 }],
    },
    selectedButtonPressed: {
      opacity: 0.82,
      transform: [{ scale: 0.98 }],
    },
    listButtonPressed: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      transform: [{ scale: 0.99 }],
    },
    linkButtonPressed: {
      opacity: 0.6,
    },
    editModeDoneButtonText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '900',
      textAlign: 'center',
    },
    menuButton: {
      position: 'absolute',
      right: 10,
      zIndex: 10,
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.card,
    },
    menuButtonPressed: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      transform: [{ scale: 0.94 }],
    },
    menuLine: {
      width: 22,
      height: 2,
      borderRadius: 999,
      backgroundColor: colors.inverseBackground,
    },
    navigationOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 60,
      alignItems: 'flex-end',
    },
    navigationDim: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.52)',
    },
    navigationDismissArea: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    navigationPanel: {
      width: '84%',
      maxWidth: 380,
      height: '100%',
      gap: 24,
      borderLeftWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 18,
      boxShadow: '-12px 0 24px rgba(0, 0, 0, 0.22)',
    },
    navigationHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    navigationEyebrow: {
      color: colors.success,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    navigationTitle: {
      color: colors.primaryText,
      fontSize: 30,
      fontWeight: '900',
      letterSpacing: -0.6,
    },
    navigationCloseButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    navigationCloseText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '900',
    },
    navigationList: {
      gap: 12,
    },
    navigationItem: {
      borderWidth: 2,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.elevatedCard,
      padding: 16,
    },
    navigationItemPressed: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      opacity: 0.88,
      transform: [{ scale: 0.99 }],
    },
    navigationItemEyebrow: {
      color: colors.success,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    navigationItemTitle: {
      color: colors.primaryText,
      fontSize: 20,
      fontWeight: '900',
      letterSpacing: -0.2,
      lineHeight: 24,
    },
    navigationItemDescription: {
      marginTop: 5,
      color: colors.mutedText,
      fontSize: 14,
      lineHeight: 19,
    },
    warning: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      color: colors.warning,
      fontWeight: '700',
    },
    error: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      color: colors.danger,
      fontWeight: '700',
    },
    metricLabel: {
      color: colors.mutedText,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    destinationCard: {
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.elevatedCard,
      padding: 8,
    },
    destinationValue: {
      marginTop: 2,
      color: colors.primaryText,
      fontSize: 18,
      fontWeight: '900',
    },
    coordinateText: {
      marginTop: 2,
      color: colors.mutedText,
      fontSize: 13,
    },
    controls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 8,
      paddingBottom: 10,
    },
    primaryButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: colors.success,
      padding: 12,
    },
    disabledButton: {
      opacity: 0.55,
    },
    routeButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 999,
      backgroundColor: colors.accentSoft,
      padding: 12,
    },
    routeButtonPressed: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    routeButtonText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '900',
    },
    routeButtonTextPressed: {
      color: '#fff',
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '900',
      textAlign: 'center',
    },
    secondaryButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 999,
      backgroundColor: colors.dangerSoft,
      padding: 12,
    },
    dangerSoftButtonPressed: {
      borderColor: colors.danger,
      backgroundColor: colors.danger,
      transform: [{ scale: 0.97 }],
    },
    secondaryButtonText: {
      color: colors.danger,
      fontSize: 15,
      fontWeight: '900',
    },
    dangerSoftButtonTextPressed: {
      color: '#fff',
    },
    stopButton: {
      flex: 1,
      alignItems: 'center',
      borderRadius: 999,
      backgroundColor: colors.danger,
      padding: 12,
    },
    holdStopButton: {
      flex: 1,
      alignItems: 'center',
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.dangerSoft,
      padding: 12,
    },
    holdStopFill: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.danger,
    },
    stopButtonText: {
      color: colors.danger,
      fontSize: 15,
      fontWeight: '900',
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    routePlannerOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 50,
    },
    routeSelectionBackdrop: {
      backgroundColor: 'transparent',
    },
    modal: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalBody: {
      gap: 12,
      paddingTop: 56,
      paddingBottom: 32,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    modalCloseLink: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: '800',
    },
    pickerSection: {
      overflow: 'hidden',
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    pickerSectionTitle: {
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.elevatedCard,
      color: colors.secondaryText,
      fontSize: 15,
      fontWeight: '900',
      letterSpacing: 1,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 10,
      textTransform: 'uppercase',
    },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    pickerRowLast: {
      borderBottomWidth: 0,
    },
    pickerRowDisabled: {
      opacity: 0.45,
    },
    pickerLabel: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '700',
    },
    pickerLabelDisabled: {
      color: colors.mutedText,
    },
    pickerChevron: {
      color: colors.accent,
      fontSize: 28,
    },
    sizeModalCard: {
      maxHeight: '80%',
      backgroundColor: colors.card,
      paddingTop: 20,
      paddingBottom: 36,
    },
    sizeOptionsScroller: {
      flexShrink: 1,
    },
    sizeOptions: {
      gap: 8,
      paddingHorizontal: 16,
    },
    sizeGroup: {
      gap: 6,
      paddingTop: 4,
    },
    sizeGroupTitle: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    sizeGroupOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metricChangeButton: {
      width: '100%',
      alignItems: 'center',
      borderRadius: 999,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    metricChangeButtonText: {
      color: colors.accent,
      fontWeight: '900',
    },
    spanButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    spanButtonSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    spanButtonDisabled: {
      opacity: 0.45,
    },
    spanButtonText: {
      color: colors.primaryText,
      fontWeight: '900',
    },
    spanButtonTextSelected: {
      color: '#fff',
    },
    spanButtonTextDisabled: {
      color: colors.mutedText,
    },
    modalCard: {
      gap: 14,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.card,
      padding: 20,
      paddingBottom: 36,
    },
    welcomeCard: {
      gap: 16,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.card,
      padding: 20,
      paddingBottom: 36,
    },
    welcomeStepIndicator: {
      flexDirection: 'row',
      gap: 8,
    },
    welcomeStepDot: {
      width: 28,
      height: 4,
      borderRadius: 999,
      backgroundColor: colors.border,
    },
    welcomeStepDotActive: {
      backgroundColor: colors.accent,
    },
    welcomeStatus: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.background,
      color: colors.secondaryText,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20,
      padding: 12,
    },
    modalTitle: {
      color: colors.primaryText,
      fontSize: 28,
      fontWeight: '900',
    },
    modalCopy: {
      color: colors.mutedText,
      fontSize: 15,
      lineHeight: 21,
    },
    destinationInputWrapper: {
      position: 'relative',
    },
    destinationInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.background,
      color: colors.primaryText,
      fontSize: 18,
      paddingLeft: 16,
      paddingRight: 52,
      paddingVertical: 14,
    },
    destinationInputClearButton: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: colors.elevatedCard,
    },
    destinationInputClearButtonText: {
      color: colors.mutedText,
      fontSize: 18,
      fontWeight: '900',
      lineHeight: 22,
      textAlign: 'center',
    },
    routePlannerOptionsScroller: {
      flexShrink: 1,
    },
    routePlannerOptions: {
      gap: 12,
    },
    destinationSection: {
      gap: 8,
    },
    destinationSectionTitle: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    destinationOption: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.background,
      marginBottom: 8,
      padding: 12,
    },
    destinationOptionIndex: {
      width: 26,
      height: 26,
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: colors.accent,
      color: '#fff',
      fontSize: 13,
      fontWeight: '900',
      lineHeight: 26,
      textAlign: 'center',
    },
    destinationOptionCopy: {
      flex: 1,
      gap: 3,
    },
    destinationOptionName: {
      color: colors.primaryText,
      fontSize: 15,
      fontWeight: '900',
    },
    destinationOptionAddress: {
      color: colors.mutedText,
      fontSize: 12,
      lineHeight: 17,
    },
    modalActions: {
      flexDirection: 'row',
      gap: 12,
    },
    modalSecondaryButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      padding: 16,
    },
    modalSecondaryButtonText: {
      color: colors.primaryText,
      fontSize: 15,
      fontWeight: '900',
      textAlign: 'center',
    },
  });
}
