import ExpoSlider from '@expo/ui/community/slider';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type DimensionValue,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type ThemeColors, useThemeColors } from '../settings/settings';
import {
  formatAscent,
  formatCalories,
  formatDistance,
  formatDuration,
  formatSpeed,
} from './metrics';
import type { FinishedRideSummary } from './rideStorage';
import { HistoryRouteMap } from './HistoryRouteMap';

export type HeartRateSample = {
  recordedAt: number;
  bpm: number;
};

type FinishDetails = {
  title: string | null;
  feelingRating: number | null;
};

type FinishedRideSummarySheetProps = {
  visible: boolean;
  ride: FinishedRideSummary | null;
  heartRateSamples: HeartRateSample[];
  showHeartRate: boolean;
  isSaving: boolean;
  onDiscard: () => void;
  onFinish: (details: FinishDetails) => void;
};

function getDefaultRideTitle(startedAt: number) {
  return `Ride ${new Date(startedAt).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })}`;
}

function getAverageHeartRate(samples: HeartRateSample[]) {
  if (samples.length === 0) {
    return null;
  }

  const total = samples.reduce((sum, sample) => sum + sample.bpm, 0);
  return Math.round(total / samples.length);
}

function getMaxHeartRate(samples: HeartRateSample[]) {
  if (samples.length === 0) {
    return null;
  }

  return Math.max(...samples.map((sample) => sample.bpm));
}

export function FinishedRideSummarySheet({
  visible,
  ride,
  heartRateSamples,
  showHeartRate,
  isSaving,
  onDiscard,
  onFinish,
}: FinishedRideSummarySheetProps) {
  if (!ride) {
    return null;
  }

  return (
    <FinishedRideSummarySheetContent
      key={ride.summary.id}
      visible={visible}
      ride={ride}
      heartRateSamples={heartRateSamples}
      showHeartRate={showHeartRate}
      isSaving={isSaving}
      onDiscard={onDiscard}
      onFinish={onFinish}
    />
  );
}

function FinishedRideSummarySheetContent({
  visible,
  ride,
  heartRateSamples,
  showHeartRate,
  isSaving,
  onDiscard,
  onFinish,
}: Omit<FinishedRideSummarySheetProps, 'ride'> & {
  ride: FinishedRideSummary;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const styles = createStyles(colors);
  const [titleInput, setTitleInput] = useState(ride.summary.title ?? '');
  const [isRenaming, setIsRenaming] = useState(false);
  const [feelingRating, setFeelingRating] = useState<number | null>(
    ride.summary.feelingRating ?? 5,
  );

  const title =
    titleInput.trim() || getDefaultRideTitle(ride.summary.startedAt);
  const averageHeartRate = showHeartRate
    ? getAverageHeartRate(heartRateSamples)
    : null;
  const maxHeartRate = showHeartRate ? getMaxHeartRate(heartRateSamples) : null;

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={() =>
        onFinish({
          title: titleInput.trim() || null,
          feelingRating,
        })
      }
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View
          style={[
            styles.sheet,
            {
              maxHeight: Math.max(1, height - Math.max(insets.top, 12)),
              paddingBottom: Math.max(insets.bottom, 14),
            },
          ]}
        >
          <View style={styles.handle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.eyebrow}>Ride complete</Text>
                {isRenaming ? (
                  <TextInput
                    accessibilityLabel="Ride title"
                    autoFocus
                    placeholder={getDefaultRideTitle(ride.summary.startedAt)}
                    placeholderTextColor={colors.mutedText}
                    style={styles.titleInput}
                    value={titleInput}
                    onChangeText={setTitleInput}
                  />
                ) : (
                  <Text style={styles.title}>{title}</Text>
                )}
                <Text style={styles.startedAt}>
                  {new Date(ride.summary.startedAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                style={({ pressed }) => [
                  styles.renameButton,
                  pressed && styles.subtleButtonPressed,
                  isSaving && styles.disabled,
                ]}
                onPress={() => setIsRenaming((current) => !current)}
              >
                <Text style={styles.renameButtonText}>
                  {isRenaming ? 'Save name' : 'Rename'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.mapPreview}>
              <HistoryRouteMap points={ride.points} />
            </View>

            <View style={styles.heroMetrics}>
              <SummaryMetric
                label="Distance"
                value={formatDistance(
                  ride.summary.distanceMeters,
                  ride.summary.unitPreference,
                )}
                tone="accent"
              />
              <SummaryMetric
                label="Time"
                value={formatDuration(ride.summary.elapsedSeconds)}
                tone="primary"
              />
              <SummaryMetric
                label="Average"
                value={formatSpeed(
                  ride.summary.averageSpeedMps,
                  ride.summary.unitPreference,
                )}
                tone="success"
              />
            </View>

            <View style={styles.secondaryMetrics}>
              <SmallMetric
                label="Max speed"
                value={formatSpeed(
                  ride.summary.maxSpeedMps,
                  ride.summary.unitPreference,
                )}
              />
              <SmallMetric
                label="Elevation"
                value={formatAscent(
                  ride.summary.ascentMeters,
                  ride.summary.unitPreference,
                )}
              />
              <SmallMetric
                label="Calories"
                value={formatCalories(ride.summary.activeCaloriesKcal)}
              />
              {showHeartRate ? (
                <SmallMetric
                  label="Heart rate"
                  value={
                    averageHeartRate == null ? '--' : `${averageHeartRate} bpm`
                  }
                  detail={
                    maxHeartRate == null ? undefined : `Max ${maxHeartRate}`
                  }
                />
              ) : null}
            </View>

            {showHeartRate ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Heart rate</Text>
                  <Text style={styles.sectionDetail}>
                    {heartRateSamples.length > 0
                      ? `${heartRateSamples.length} samples`
                      : 'No samples'}
                  </Text>
                </View>
                <HeartRateChart samples={heartRateSamples} colors={colors} />
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Feeling</Text>
              </View>
              <FeelingSlider
                value={feelingRating}
                onChange={setFeelingRating}
                colors={colors}
              />
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              style={({ pressed }) => [
                styles.discardButton,
                pressed && styles.discardButtonPressed,
                isSaving && styles.disabled,
              ]}
              onPress={onDiscard}
            >
              <Text style={styles.discardButtonText}>Discard</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              style={({ pressed }) => [
                styles.finishButton,
                pressed && styles.finishButtonPressed,
                isSaving && styles.disabled,
              ]}
              onPress={() =>
                onFinish({
                  title: titleInput.trim() || null,
                  feelingRating,
                })
              }
            >
              <Text style={styles.finishButtonText}>
                {isSaving ? 'Saving...' : 'Finish'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'accent' | 'primary' | 'success';
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const toneStyle =
    tone === 'accent'
      ? styles.heroMetricAccent
      : tone === 'success'
        ? styles.heroMetricSuccess
        : styles.heroMetricPrimary;

  return (
    <View style={styles.heroMetric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.heroValue, toneStyle]}
      >
        {value}
      </Text>
    </View>
  );
}

function SmallMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.smallMetric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={styles.smallMetricValue}
      >
        {value}
      </Text>
      {detail ? <Text style={styles.smallMetricDetail}>{detail}</Text> : null}
    </View>
  );
}

function HeartRateChart({
  samples,
  colors,
}: {
  samples: HeartRateSample[];
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);
  const chart = useMemo(() => {
    if (samples.length < 2) {
      return null;
    }

    const sortedSamples = [...samples].sort(
      (first, second) => first.recordedAt - second.recordedAt,
    );
    const minBpm = Math.min(...sortedSamples.map((sample) => sample.bpm));
    const maxBpm = Math.max(...sortedSamples.map((sample) => sample.bpm));
    const firstTime = sortedSamples[0].recordedAt;
    const lastTime = sortedSamples[sortedSamples.length - 1].recordedAt;
    const timeRange = Math.max(1, lastTime - firstTime);
    const bpmRange = Math.max(1, maxBpm - minBpm);
    const points = sortedSamples
      .map((sample) => {
        const x = ((sample.recordedAt - firstTime) / timeRange) * 100;
        const y = 72 - ((sample.bpm - minBpm) / bpmRange) * 56;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

    return { points, minBpm, maxBpm };
  }, [samples]);

  if (!chart) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>
          No heart rate samples recorded for this ride.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.chart}>
      <Svg width="100%" height="100%" viewBox="0 0 100 80">
        <Line
          x1="0"
          y1="72"
          x2="100"
          y2="72"
          stroke={colors.border}
          strokeWidth="1"
        />
        <Line
          x1="0"
          y1="16"
          x2="100"
          y2="16"
          stroke={colors.border}
          strokeWidth="1"
        />
        <Polyline
          points={chart.points}
          fill="none"
          stroke={colors.danger}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
        />
        <Circle
          cx={chart.points.split(' ')[0]?.split(',')[0] ?? 0}
          cy={chart.points.split(' ')[0]?.split(',')[1] ?? 72}
          r="2.6"
          fill={colors.danger}
        />
      </Svg>
      <View style={styles.chartLegend}>
        <Text style={styles.chartLegendText}>{chart.minBpm} bpm</Text>
        <Text style={styles.chartLegendText}>{chart.maxBpm} bpm</Text>
      </View>
    </View>
  );
}

const FEELING_STEPS = Array.from({ length: 11 }, (_, index) => index);

function getFeelingDescriptor(value: number | null) {
  if (value == null) {
    return 'Not rated';
  }

  if (value <= 2) {
    return 'Rough';
  }

  if (value <= 4) {
    return 'Tough';
  }

  if (value <= 6) {
    return 'Steady';
  }

  if (value <= 8) {
    return 'Strong';
  }

  return 'Outstanding';
}

function getFeelingColor(value: number | null, colors: ThemeColors) {
  if (value == null) {
    return colors.mutedText;
  }

  if (value <= 2) {
    return colors.danger;
  }

  if (value <= 5) {
    return colors.warning;
  }

  if (value <= 8) {
    return colors.accent;
  }

  return colors.success;
}

function FeelingSlider({
  value,
  onChange,
  colors,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);
  const sliderValue = value ?? 0;
  const feelingColor = getFeelingColor(value, colors);
  const feelingDescriptor = getFeelingDescriptor(value);
  const thumbOffset = `${(sliderValue / 10) * 100}%` as DimensionValue;

  return (
    <View style={styles.feeling}>
      <View style={styles.feelingCard}>
        <View style={styles.feelingCardHeader}>
          <View style={styles.feelingMood}>
            <Text style={[styles.feelingMoodLabel, { color: feelingColor }]}>
              {feelingDescriptor}
            </Text>
          </View>
        </View>

        <View style={styles.feelingTrackControl}>
          <View pointerEvents="none" style={styles.feelingTrack}>
            {FEELING_STEPS.map((step) => {
              const isActive = value != null && step <= sliderValue;

              return (
                <View
                  key={step}
                  style={[
                    styles.feelingTrackSegment,
                    isActive && { backgroundColor: feelingColor },
                  ]}
                />
              );
            })}
          </View>
          {value == null ? null : (
            <View
              pointerEvents="none"
              style={[
                styles.feelingThumb,
                { backgroundColor: feelingColor, left: thumbOffset },
              ]}
            />
          )}
          <ExpoSlider
            maximumTrackTintColor={colors.border}
            maximumValue={10}
            minimumTrackTintColor={feelingColor}
            minimumValue={0}
            step={1}
            style={styles.slider}
            thumbTintColor={feelingColor}
            value={sliderValue}
            onValueChange={(nextValue) => onChange(Math.round(nextValue))}
          />
        </View>

        <View style={styles.feelingScale}>
          <View style={styles.feelingEndpointGroup}>
            <View
              style={[
                styles.feelingEndpointDot,
                { backgroundColor: colors.danger },
              ]}
            />
            <Text style={styles.feelingEndpoint}>Awful</Text>
          </View>
          <View style={styles.feelingEndpointGroup}>
            <Text style={styles.feelingEndpoint}>Outstanding</Text>
            <View
              style={[
                styles.feelingEndpointDot,
                { backgroundColor: colors.success },
              ]}
            />
          </View>
        </View>
      </View>
      {value == null ? (
        <Text style={styles.feelingHint}>No feeling rating selected</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.clearFeelingButton,
            pressed && styles.clearFeelingButtonPressed,
          ]}
          onPress={() => onChange(null)}
        >
          <Text style={styles.clearFeelingText}>Clear rating</Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
    },
    sheet: {
      overflow: 'hidden',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.card,
      boxShadow: '0 -12px 24px rgba(0, 0, 0, 0.22)',
    },
    handle: {
      alignSelf: 'center',
      width: 46,
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.border,
      marginTop: 10,
      marginBottom: 4,
    },
    content: {
      gap: 16,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 18,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    eyebrow: {
      color: colors.success,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.primaryText,
      fontSize: 30,
      fontWeight: '900',
      lineHeight: 35,
    },
    startedAt: {
      marginTop: 4,
      color: colors.mutedText,
      fontSize: 13,
      fontWeight: '700',
    },
    titleInput: {
      borderBottomWidth: 1,
      borderColor: colors.accent,
      color: colors.primaryText,
      fontSize: 28,
      fontWeight: '900',
      lineHeight: 34,
      paddingVertical: 2,
    },
    renameButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 13,
      paddingVertical: 8,
    },
    renameButtonText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '900',
    },
    subtleButtonPressed: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      transform: [{ scale: 0.98 }],
    },
    mapPreview: {
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: colors.background,
    },
    heroMetrics: {
      flexDirection: 'row',
      gap: 10,
    },
    heroMetric: {
      flex: 1,
      minWidth: 0,
      gap: 5,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.elevatedCard,
      padding: 12,
    },
    metricLabel: {
      color: colors.mutedText,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    heroValue: {
      fontSize: 24,
      fontWeight: '900',
      lineHeight: 29,
    },
    heroMetricAccent: {
      color: colors.accent,
    },
    heroMetricPrimary: {
      color: colors.primaryText,
    },
    heroMetricSuccess: {
      color: colors.success,
    },
    secondaryMetrics: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    smallMetric: {
      flexGrow: 1,
      flexBasis: '47%',
      minWidth: 0,
      gap: 4,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
    },
    smallMetricValue: {
      color: colors.primaryText,
      fontSize: 20,
      fontWeight: '900',
    },
    smallMetricDetail: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '800',
    },
    section: {
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 14,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionTitle: {
      color: colors.primaryText,
      fontSize: 17,
      fontWeight: '900',
    },
    sectionDetail: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    chart: {
      height: 126,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.background,
      padding: 10,
    },
    chartLegend: {
      position: 'absolute',
      right: 10,
      left: 10,
      bottom: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    chartLegendText: {
      color: colors.mutedText,
      fontSize: 11,
      fontWeight: '800',
    },
    chartEmpty: {
      minHeight: 96,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
    },
    chartEmptyText: {
      color: colors.mutedText,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18,
      textAlign: 'center',
    },
    feeling: {
      gap: 10,
    },
    feelingCard: {
      gap: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.background,
      padding: 13,
      boxShadow: '0 8px 18px rgba(9, 105, 218, 0.08)',
    },
    feelingCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    feelingMood: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    feelingMoodLabel: {
      fontSize: 22,
      fontWeight: '900',
      lineHeight: 27,
    },
    feelingTrackControl: {
      position: 'relative',
      justifyContent: 'center',
      minHeight: 52,
      paddingHorizontal: 4,
    },
    feelingTrack: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 16,
    },
    feelingTrackSegment: {
      flex: 1,
      height: 10,
      borderRadius: 999,
      backgroundColor: colors.border,
      opacity: 0.92,
    },
    feelingThumb: {
      position: 'absolute',
      top: 12,
      width: 28,
      height: 28,
      borderWidth: 3,
      borderColor: colors.card,
      borderRadius: 999,
      marginLeft: -14,
      boxShadow: '0 5px 12px rgba(0, 0, 0, 0.24)',
    },
    feelingScale: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    feelingEndpointGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    feelingEndpointDot: {
      width: 7,
      height: 7,
      borderRadius: 999,
    },
    feelingEndpoint: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    slider: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      height: 52,
      opacity: 0.01,
      width: '100%',
    },
    feelingHint: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '700',
    },
    clearFeelingButton: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      backgroundColor: colors.background,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    clearFeelingButtonPressed: {
      opacity: 0.6,
    },
    clearFeelingText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '900',
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: 18,
      paddingTop: 12,
    },
    discardButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 999,
      backgroundColor: colors.dangerSoft,
      paddingVertical: 13,
    },
    discardButtonPressed: {
      backgroundColor: colors.danger,
      transform: [{ scale: 0.98 }],
    },
    discardButtonText: {
      color: colors.danger,
      fontSize: 15,
      fontWeight: '900',
    },
    finishButton: {
      flex: 1.4,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: colors.success,
      paddingVertical: 14,
    },
    finishButtonPressed: {
      opacity: 0.82,
      transform: [{ scale: 0.98 }],
    },
    finishButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '900',
    },
    disabled: {
      opacity: 0.55,
    },
  });
}
