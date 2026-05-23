import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Link } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import {
  createDashboardCard,
  dashboardMetricById,
  dashboardMetricCatalog,
  dashboardSpans,
  type DashboardMetricCategory,
} from '../src/features/ride/dashboard';
import { DashboardGrid } from '../src/features/ride/DashboardGrid';
import { planBikeRoute } from '../src/features/ride/routePlanning';
import type {
  DashboardCard,
  DashboardCardSpan,
  DashboardMetricId,
  PlannedRoute,
} from '../src/features/ride/types';
import { useForegroundRideRecorder } from '../src/features/ride/useForegroundRideRecorder';

const metricCategories: DashboardMetricCategory[] = [
  'Calories',
  'Device',
  'Distance',
  'Elevation',
  'Lap',
  'Maps & Navigation',
  'Speed & Pace',
  'Time',
  'Weather',
];

export default function HomeScreen() {
  const { settings, updateSetting } = useRideSettings();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);
  const recorder = useForegroundRideRecorder(settings);
  const [isRoutePlannerOpen, setIsRoutePlannerOpen] = useState(false);
  const [destinationInput, setDestinationInput] = useState('');
  const [plannedRoute, setPlannedRoute] = useState<PlannedRoute | null>(null);
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [routePlanError, setRoutePlanError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [stopFill] = useState(() => new Animated.Value(0));
  const [isEditingDashboard, setIsEditingDashboard] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState(settings.dashboardLayout);
  const [metricPickerCardId, setMetricPickerCardId] = useState<string | null>(
    null,
  );
  const [sizePickerCardId, setSizePickerCardId] = useState<string | null>(null);
  const isRecording = recorder.status === 'recording';
  const isPaused = recorder.status === 'paused';
  const canStart = recorder.status === 'idle' || recorder.status === 'stopped';

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(interval);
  }, []);

  function setDashboardLayoutDraft(nextLayout: DashboardCard[]) {
    setLayoutDraft(nextLayout);
  }

  function saveDashboardLayout() {
    updateSetting('dashboardLayout', layoutDraft).catch(() => {});
    setIsEditingDashboard(false);
  }

  function updateDashboardCard(cardId: string, patch: Partial<DashboardCard>) {
    setDashboardLayoutDraft(
      layoutDraft.map((card) =>
        card.id === cardId ? { ...card, ...patch } : card,
      ),
    );
  }

  function removeDashboardCard(cardId: string) {
    setDashboardLayoutDraft(layoutDraft.filter((card) => card.id !== cardId));
  }

  function moveDashboardCard(draggedCardId: string, targetCardId: string) {
    if (draggedCardId === targetCardId) {
      return;
    }

    const from = layoutDraft.findIndex((card) => card.id === draggedCardId);
    const to = layoutDraft.findIndex((card) => card.id === targetCardId);

    if (from < 0 || to < 0) {
      return;
    }

    const next = [...layoutDraft];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDashboardLayoutDraft(next);
  }

  function chooseDashboardMetric(metricId: DashboardMetricId) {
    if (metricPickerCardId === 'new') {
      setDashboardLayoutDraft([...layoutDraft, createDashboardCard(metricId)]);
    } else if (metricPickerCardId) {
      updateDashboardCard(metricPickerCardId, { metricId });
    }

    setMetricPickerCardId(null);
  }

  function chooseDashboardSpan(span: DashboardCardSpan) {
    if (sizePickerCardId) {
      updateDashboardCard(sizePickerCardId, { span });
    }

    setSizePickerCardId(null);
  }

  function enterDashboardEditMode() {
    if (canStart) {
      setLayoutDraft(settings.dashboardLayout);
      setIsEditingDashboard(true);
    }
  }

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
          {isEditingDashboard ? (
            <View
              style={[
                styles.editModeHeader,
                { paddingTop: Math.max(insets.top + 8, 24) },
              ]}
            >
              <Text style={styles.editModeText}>
                Drag cards to reorder. Tap a card to change metric or size.
              </Text>
              <Pressable
                style={styles.editModeButton}
                onPress={() =>
                  setDashboardLayoutDraft(settings.dashboardLayout)
                }
              >
                <Text style={styles.editModeButtonText}>Reset</Text>
              </Pressable>
              <Pressable
                style={styles.editModeDoneButton}
                onPress={saveDashboardLayout}
              >
                <Text style={styles.editModeDoneButtonText}>Done</Text>
              </Pressable>
            </View>
          ) : null}
          <DashboardGrid
            colors={colors}
            context={{
              metrics: recorder.metrics,
              settings,
              routePoints: recorder.routePoints,
              plannedRoute,
              now,
            }}
            isEditing={isEditingDashboard}
            layout={isEditingDashboard ? layoutDraft : settings.dashboardLayout}
            settings={settings}
            onAddCard={() => setMetricPickerCardId('new')}
            onLongPressCard={canStart ? enterDashboardEditMode : undefined}
            onMoveCard={moveDashboardCard}
            onPressCard={(card) => setSizePickerCardId(card.id)}
            onRemoveCard={removeDashboardCard}
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

        {!isEditingDashboard ? (
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
        ) : null}

        <StatusBar style={settings.theme === 'light' ? 'dark' : 'light'} />
      </View>

      <DashboardMetricPickerModal
        colors={colors}
        visible={metricPickerCardId != null}
        onClose={() => setMetricPickerCardId(null)}
        onSelect={chooseDashboardMetric}
      />
      <DashboardSizePickerModal
        colors={colors}
        card={layoutDraft.find((card) => card.id === sizePickerCardId) ?? null}
        visible={sizePickerCardId != null}
        onClose={() => setSizePickerCardId(null)}
        onChangeMetric={(cardId) => {
          setSizePickerCardId(null);
          setMetricPickerCardId(cardId);
        }}
        onSelect={chooseDashboardSpan}
      />

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

function DashboardMetricPickerModal({
  colors,
  visible,
  onClose,
  onSelect,
}: {
  colors: ThemeColors;
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
          <Pressable onPress={onClose}>
            <Text style={styles.modalCloseLink}>Close</Text>
          </Pressable>
        </View>
        {metricCategories.map((category) => (
          <View key={category} style={styles.pickerSection}>
            <Text style={styles.pickerSectionTitle}>{category}</Text>
            {dashboardMetricCatalog
              .filter((metric) => metric.category === category)
              .map((metric) => (
                <Pressable
                  key={metric.id}
                  style={styles.pickerRow}
                  onPress={() => onSelect(metric.id)}
                >
                  <Text style={styles.pickerLabel}>{metric.label}</Text>
                  <Text style={styles.pickerChevron}>›</Text>
                </Pressable>
              ))}
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
  onSelect,
}: {
  colors: ThemeColors;
  card: DashboardCard | null;
  visible: boolean;
  onClose: () => void;
  onChangeMetric: (cardId: string) => void;
  onSelect: (span: DashboardCardSpan) => void;
}) {
  const styles = createStyles(colors);
  const metric = card ? dashboardMetricById.get(card.metricId) : null;
  const spans = metric?.supportedSpans ?? dashboardSpans;
  const spanHeights = ['1', '2', '3', '4', '5'];

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
            <Pressable onPress={onClose}>
              <Text style={styles.modalCloseLink}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.sizeOptions}>
            {card ? (
              <Pressable
                style={styles.metricChangeButton}
                onPress={() => onChangeMetric(card.id)}
              >
                <Text style={styles.metricChangeButtonText}>Change metric</Text>
              </Pressable>
            ) : null}
            {spanHeights.map((height) => {
              const groupedSpans = spans.filter((span) =>
                span.endsWith(`x${height}`),
              );

              if (groupedSpans.length === 0) {
                return null;
              }

              return (
                <View key={height} style={styles.sizeGroup}>
                  <Text style={styles.sizeGroupTitle}>
                    {height} Tile{height === '1' ? '' : 's'} Tall
                  </Text>
                  <View style={styles.sizeGroupOptions}>
                    {groupedSpans.map((span) => (
                      <Pressable
                        key={span}
                        style={[
                          styles.spanButton,
                          card?.span === span && styles.spanButtonSelected,
                        ]}
                        onPress={() => onSelect(span)}
                      >
                        <Text
                          style={[
                            styles.spanButtonText,
                            card?.span === span &&
                              styles.spanButtonTextSelected,
                          ]}
                        >
                          {span}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
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
    dashboardScroller: {
      flex: 1,
    },
    editModeHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.card,
      padding: 8,
      paddingRight: 58,
    },
    editModeText: {
      flex: 1,
      color: colors.primaryText,
      fontSize: 12,
      fontWeight: '800',
    },
    editModeButton: {
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    editModeButtonText: {
      color: colors.primaryText,
      fontSize: 12,
      fontWeight: '900',
    },
    editModeDoneButton: {
      backgroundColor: colors.success,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    editModeDoneButtonText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '900',
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
      borderColor: colors.danger,
      borderRadius: 999,
      backgroundColor: colors.dangerSoft,
      padding: 12,
    },
    secondaryButtonText: {
      color: colors.danger,
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
    modal: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalBody: {
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
      backgroundColor: colors.card,
      paddingVertical: 8,
    },
    pickerSectionTitle: {
      color: colors.primaryText,
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 0.8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      textTransform: 'uppercase',
    },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    pickerLabel: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '700',
    },
    pickerChevron: {
      color: colors.accent,
      fontSize: 28,
    },
    sizeModalCard: {
      backgroundColor: colors.card,
      paddingTop: 20,
      paddingBottom: 36,
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
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    spanButtonSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    spanButtonText: {
      color: colors.primaryText,
      fontWeight: '900',
    },
    spanButtonTextSelected: {
      color: '#fff',
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
