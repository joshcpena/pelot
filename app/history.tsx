import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  formatAscent,
  formatDistance,
  formatDuration,
  formatSpeed,
} from '../src/features/ride/metrics';
import {
  loadRecentRides,
  loadRideSplits,
  type RideSplit,
  type RideSummary,
} from '../src/features/ride/rideStorage';

export default function HistoryScreen() {
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [splitsByRideId, setSplitsByRideId] = useState<
    Record<string, RideSplit[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
      const recentRides = await loadRecentRides();
      const splitEntries = await Promise.all(
        recentRides.map(
          async (ride) => [ride.id, await loadRideSplits(ride.id)] as const,
        ),
      );

      return { recentRides, splitsByRideId: Object.fromEntries(splitEntries) };
    }

    loadHistory()
      .then((history) => {
        if (isMounted) {
          setRides(history.recentRides);
          setSplitsByRideId(history.splitsByRideId);
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Ride History</Text>
        <Link href="/" style={styles.link}>
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
          <Text style={styles.date}>
            {new Date(ride.startedAt).toLocaleString()}
          </Text>
          <View style={styles.grid}>
            <SummaryMetric
              label="Distance"
              value={formatDistance(ride.distanceMeters, ride.unitPreference)}
            />
            <SummaryMetric
              label="Time"
              value={formatDuration(ride.elapsedSeconds)}
            />
            <SummaryMetric
              label="Average"
              value={formatSpeed(ride.averageSpeedMps, ride.unitPreference)}
            />
            <SummaryMetric
              label="Max"
              value={formatSpeed(ride.maxSpeedMps, ride.unitPreference)}
            />
            <SummaryMetric
              label="Ascent"
              value={formatAscent(ride.ascentMeters, ride.unitPreference)}
            />
            <SummaryMetric
              label="Moving"
              value={formatDuration(ride.movingSeconds)}
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
                  {formatDistance(split.distanceMeters, ride.unitPreference)} ·{' '}
                  {formatDuration(split.durationSeconds)} ·{' '}
                  {formatSpeed(split.averageSpeedMps, ride.unitPreference)}
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

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  content: {
    gap: 18,
    padding: 24,
    paddingTop: 72,
  },
  header: {
    gap: 10,
  },
  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
  },
  link: {
    color: '#58a6ff',
    fontSize: 16,
    fontWeight: '700',
  },
  muted: {
    color: '#8b949e',
    fontSize: 15,
    lineHeight: 21,
  },
  card: {
    gap: 14,
    borderRadius: 22,
    backgroundColor: '#161b22',
    padding: 18,
  },
  date: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
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
    color: '#8b949e',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  splits: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#30363d',
    paddingTop: 12,
  },
  splitsTitle: {
    color: '#fff',
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
    color: '#7ee787',
    fontSize: 14,
    fontWeight: '900',
  },
  splitText: {
    flex: 1,
    color: '#c9d1d9',
    fontSize: 14,
  },
});
