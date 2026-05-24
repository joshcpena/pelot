import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  formatAscent,
  formatCalories,
  formatDistance,
  formatDuration,
  formatSpeed,
} from '../src/features/ride/metrics';
import {
  type ThemeColors,
  useRideSettings,
  useThemeColors,
} from '../src/features/settings/settings';
import {
  deleteRide,
  loadRecentRides,
  loadRidePoints,
  loadRideSplits,
  type RideSplit,
  type RideSummary,
} from '../src/features/ride/rideStorage';
import { HistoryRouteMap } from '../src/features/ride/HistoryRouteMap';
import type { RidePoint } from '../src/features/ride/types';

export default function HistoryScreen() {
  const { settings } = useRideSettings();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [splitsByRideId, setSplitsByRideId] = useState<
    Record<string, RideSplit[]>
  >({});
  const [pointsByRideId, setPointsByRideId] = useState<
    Record<string, RidePoint[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [deletingRideId, setDeletingRideId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
      const recentRides = await loadRecentRides();
      const splitEntries = await Promise.all(
        recentRides.map(
          async (ride) => [ride.id, await loadRideSplits(ride.id)] as const,
        ),
      );
      const pointEntries = await Promise.all(
        recentRides.map(
          async (ride) => [ride.id, await loadRidePoints(ride.id)] as const,
        ),
      );

      return {
        recentRides,
        splitsByRideId: Object.fromEntries(splitEntries),
        pointsByRideId: Object.fromEntries(pointEntries),
      };
    }

    loadHistory()
      .then((history) => {
        if (isMounted) {
          setRides(history.recentRides);
          setSplitsByRideId(history.splitsByRideId);
          setPointsByRideId(history.pointsByRideId);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function removeRide(rideId: string) {
    setDeletingRideId(rideId);

    try {
      await deleteRide(rideId);
      setRides((currentRides) =>
        currentRides.filter((ride) => ride.id !== rideId),
      );
      setSplitsByRideId((currentSplits) => {
        const nextSplits = { ...currentSplits };
        delete nextSplits[rideId];
        return nextSplits;
      });
      setPointsByRideId((currentPoints) => {
        const nextPoints = { ...currentPoints };
        delete nextPoints[rideId];
        return nextPoints;
      });
    } finally {
      setDeletingRideId(null);
    }
  }

  function confirmDeleteRide(ride: RideSummary) {
    Alert.alert(
      'Delete ride?',
      `Delete the ride from ${new Date(ride.startedAt).toLocaleString()}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            removeRide(ride.id).catch(() => {
              Alert.alert('Could not delete ride', 'Please try again.');
            });
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Ride History</Text>
        <Link dismissTo href="/" style={styles.link}>
          Back to ride
        </Link>
      </View>

      {isLoading ? (
        <Text style={styles.muted}>Loading saved rides...</Text>
      ) : null}
      {!isLoading && rides.length === 0 ? (
        <Text style={styles.muted}>
          No saved rides yet. Stop a ride to save it here.
        </Text>
      ) : null}

      {rides.map((ride) => (
        <View key={ride.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.date}>
              {new Date(ride.startedAt).toLocaleString()}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete ride"
              disabled={deletingRideId === ride.id}
              onPress={() => confirmDeleteRide(ride)}
              style={({ pressed }) => [
                styles.deleteButton,
                pressed ? styles.deleteButtonPressed : null,
              ]}
            >
              <Text style={styles.deleteButtonText}>
                {deletingRideId === ride.id ? 'Deleting...' : 'Delete'}
              </Text>
            </Pressable>
          </View>
          <HistoryRouteMap points={pointsByRideId[ride.id] ?? []} />
          <View style={styles.grid}>
            <SummaryMetric
              styles={styles}
              label="Distance"
              value={formatDistance(ride.distanceMeters, settings.unitSystem)}
            />
            <SummaryMetric
              styles={styles}
              label="Time"
              value={formatDuration(ride.elapsedSeconds)}
            />
            <SummaryMetric
              styles={styles}
              label="Average"
              value={formatSpeed(ride.averageSpeedMps, settings.unitSystem)}
            />
            <SummaryMetric
              styles={styles}
              label="Max"
              value={formatSpeed(ride.maxSpeedMps, settings.unitSystem)}
            />
            <SummaryMetric
              styles={styles}
              label="Ascent"
              value={formatAscent(ride.ascentMeters, settings.unitSystem)}
            />
            <SummaryMetric
              styles={styles}
              label="Moving"
              value={formatDuration(ride.movingSeconds)}
            />
            <SummaryMetric
              styles={styles}
              label="Calories"
              value={formatCalories(ride.activeCaloriesKcal)}
            />
          </View>
          <View style={styles.splits}>
            <Text style={styles.splitsTitle}>Splits</Text>
            {(splitsByRideId[ride.id] ?? []).slice(0, 6).map((split) => (
              <View
                key={`${ride.id}-${split.splitIndex}`}
                style={styles.splitRow}
              >
                <Text style={styles.splitIndex}>{split.splitIndex}</Text>
                <Text style={styles.splitText}>
                  {formatDistance(split.distanceMeters, settings.unitSystem)} ·{' '}
                  {formatDuration(split.durationSeconds)} ·{' '}
                  {formatSpeed(split.averageSpeedMps, settings.unitSystem)}
                </Text>
              </View>
            ))}
            {(splitsByRideId[ride.id] ?? []).length === 0 ? (
              <Text style={styles.muted}>No splits saved for this ride.</Text>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function SummaryMetric({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      gap: 18,
      paddingHorizontal: 20,
      paddingTop: 58,
      paddingBottom: 24,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
    },
    title: {
      flex: 1,
      color: colors.primaryText,
      fontSize: 34,
      fontWeight: '900',
    },
    link: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: '900',
      paddingTop: 5,
    },
    muted: {
      color: colors.mutedText,
      fontSize: 15,
      lineHeight: 21,
    },
    card: {
      gap: 14,
      borderRadius: 22,
      backgroundColor: colors.card,
      padding: 18,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    date: {
      flex: 1,
      color: colors.primaryText,
      fontSize: 18,
      fontWeight: '800',
    },
    deleteButton: {
      borderRadius: 999,
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    deleteButtonPressed: {
      opacity: 0.72,
    },
    deleteButtonText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '900',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    metric: {
      minWidth: '47%',
      flex: 1,
      gap: 4,
    },
    metricLabel: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
    },
    metricValue: {
      color: colors.primaryText,
      fontSize: 20,
      fontWeight: '900',
    },
    splits: {
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
    },
    splitsTitle: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '900',
    },
    splitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    splitIndex: {
      width: 26,
      color: colors.success,
      fontSize: 14,
      fontWeight: '900',
    },
    splitText: {
      flex: 1,
      color: colors.secondaryText,
      fontSize: 14,
    },
  });
}
