import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Link } from 'expo-router';
import * as Location from 'expo-location';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  type ThemeColors,
  useRideSettings,
  useThemeColors,
} from '../src/features/settings/settings';
import { DashboardGrid } from '../src/features/ride/DashboardGrid';
import { planBikeRoute } from '../src/features/ride/routePlanning';
import type { PlannedRoute } from '../src/features/ride/types';
import { useForegroundRideRecorder } from '../src/features/ride/useForegroundRideRecorder';

export default function HomeScreen() {
  const { settings } = useRideSettings();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const recorder = useForegroundRideRecorder(settings);
  const [isRoutePlannerOpen, setIsRoutePlannerOpen] = useState(false);
  const [destinationInput, setDestinationInput] = useState('');
  const [plannedRoute, setPlannedRoute] = useState<PlannedRoute | null>(null);
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [routePlanError, setRoutePlanError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [stopFill] = useState(() => new Animated.Value(0));
  const isRecording = recorder.status === 'recording';
  const isPaused = recorder.status === 'paused';
  const canStart = recorder.status === 'idle' || recorder.status === 'stopped';

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(interval);
  }, []);

  async function handlePlanRoute() {
    const destination = destinationInput.trim();

    if (!destination) {
      setRoutePlanError('Enter a destination first.');
      return;
    }

    setRoutePlanError(null);
    setIsPlanningRoute(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setRoutePlanError('Location permission is required to plan a route.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const route = await planBikeRoute({
        destination,
        origin: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
      });

      setPlannedRoute(route);
      setIsRoutePlannerOpen(false);
    } catch (error) {
      setRoutePlanError(
        error instanceof Error ? error.message : 'Could not plan bike route.',
      );
    } finally {
      setIsPlanningRoute(false);
    }
  }

  function startStopHold() {
    stopFill.setValue(0);
    Animated.timing(stopFill, {
      toValue: 1,
      duration: 2500,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        recorder.stopRide();
      }
    });
  }

  function cancelStopHold() {
    stopFill.stopAnimation();
    stopFill.setValue(0);
  }

  return (
    <>
      <View style={styles.container}>
        <Link href="/menu" asChild>
          <Pressable accessibilityLabel="Open menu" style={styles.menuButton}>
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
          </Pressable>
        </Link>

        <ScrollView style={styles.dashboardScroller}>
          <DashboardGrid
            colors={colors}
            context={{
              metrics: recorder.metrics,
              settings,
              routePoints: recorder.routePoints,
              plannedRoute,
              now,
            }}
            layout={settings.dashboardLayout}
            settings={settings}
          />
        </ScrollView>

        {recorder.isAutoPaused ? (
          <Text style={styles.warning}>Auto-paused</Text>
        ) : null}
        {recorder.error ? (
          <Text style={styles.error}>{recorder.error}</Text>
        ) : null}
        {routePlanError ? (
          <Text style={styles.error}>{routePlanError}</Text>
        ) : null}

        {plannedRoute ? (
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

        <View style={styles.controls}>
          {canStart ? (
            <Pressable
              style={styles.routeButton}
              onPress={() => setIsRoutePlannerOpen(true)}
            >
              <Text style={styles.routeButtonText}>Plan route</Text>
            </Pressable>
          ) : null}
          {isRecording ? (
            <Pressable style={styles.routeButton} onPress={recorder.markLap}>
              <Text style={styles.routeButtonText}>Lap</Text>
            </Pressable>
          ) : null}
          {canStart ? (
            <Pressable
              style={styles.primaryButton}
              onPress={recorder.startRide}
            >
              <Text style={styles.primaryButtonText}>Start ride</Text>
            </Pressable>
          ) : null}
          {isRecording ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={recorder.pauseRide}
            >
              <Text style={styles.secondaryButtonText}>Pause</Text>
            </Pressable>
          ) : null}
          {isPaused ? (
            <Pressable
              style={styles.holdStopButton}
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
              <Text style={styles.stopButtonText}>Hold to stop</Text>
            </Pressable>
          ) : null}
          {isPaused ? (
            <Pressable
              style={styles.primaryButton}
              onPress={recorder.resumeRide}
            >
              <Text style={styles.primaryButtonText}>Resume</Text>
            </Pressable>
          ) : null}
        </View>

        <StatusBar style={settings.theme === 'light' ? 'dark' : 'light'} />
      </View>

      <Modal
        animationType="slide"
        transparent
        visible={isRoutePlannerOpen}
        onRequestClose={() => setIsRoutePlannerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Plan bike route</Text>
            <Text style={styles.modalCopy}>
              Enter a destination. Pelot will request Google bicycling
              directions and draw the route here.
            </Text>
            {routePlanError ? (
              <Text style={styles.error}>{routePlanError}</Text>
            ) : null}
            <TextInput
              autoCapitalize="words"
              autoCorrect={false}
              onChangeText={setDestinationInput}
              editable={!isPlanningRoute}
              onSubmitEditing={handlePlanRoute}
              placeholder="e.g. Gravelly Point"
              placeholderTextColor="#6e7681"
              returnKeyType="go"
              style={styles.destinationInput}
              value={destinationInput}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalSecondaryButton}
                onPress={() => setIsRoutePlannerOpen(false)}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={isPlanningRoute}
                style={[
                  styles.primaryButton,
                  isPlanningRoute ? styles.disabledButton : null,
                ]}
                onPress={handlePlanRoute}
              >
                <Text style={styles.primaryButtonText}>
                  {isPlanningRoute ? 'Planning...' : 'Plan route'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    dashboardScroller: {
      flex: 1,
    },
    menuButton: {
      position: 'absolute',
      top: 44,
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
    menuLine: {
      width: 22,
      height: 2,
      borderRadius: 999,
      backgroundColor: colors.inverseBackground,
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
    routeButtonText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '900',
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '900',
    },
    secondaryButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      padding: 12,
    },
    secondaryButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '900',
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
      backgroundColor: colors.card,
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
      color: '#fff',
      fontSize: 15,
      fontWeight: '900',
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    modalCard: {
      gap: 14,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.card,
      padding: 20,
      paddingBottom: 36,
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
    destinationInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.background,
      color: colors.primaryText,
      fontSize: 18,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    modalActions: {
      flexDirection: 'row',
      gap: 12,
    },
    modalSecondaryButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      padding: 16,
    },
  });
}
