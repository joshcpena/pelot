import { StatusBar } from 'expo-status-bar';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRideSettings } from '../src/features/settings/settings';
import {
  formatAscent,
  formatDistance,
  formatDuration,
  formatSpeed,
} from '../src/features/ride/metrics';
import { RideMap } from '../src/features/ride/RideMap';
import { useForegroundRideRecorder } from '../src/features/ride/useForegroundRideRecorder';

export default function HomeScreen() {
  const { settings } = useRideSettings();
  const recorder = useForegroundRideRecorder(settings);
  const isRecording = recorder.status === 'recording';
  const isPaused = recorder.status === 'paused';
  const canStart = recorder.status === 'idle' || recorder.status === 'stopped';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Pelot</Text>
          <Text style={styles.title}>Ride Recorder</Text>
        </View>
        <View style={styles.headerLinks}>
          <Link href="/permissions" style={styles.link}>
            Permissions
          </Link>
          <Link href="/settings" style={styles.link}>
            Settings
          </Link>
          <Link href="/history" style={styles.link}>
            History
          </Link>
        </View>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusValue}>{recorder.status.toUpperCase()}</Text>
        {recorder.isAutoPaused ? (
          <Text style={styles.warning}>Auto-paused</Text>
        ) : null}
        {recorder.error ? (
          <Text style={styles.error}>{recorder.error}</Text>
        ) : null}
      </View>

      <RideMap points={recorder.routePoints} mapType={settings.mapType} />

      <View style={styles.speedCard}>
        <Text style={styles.metricLabel}>Current speed</Text>
        <Text style={styles.speedValue}>
          {formatSpeed(recorder.metrics.currentSpeedMps, settings.unitSystem)}
        </Text>
      </View>

      <View style={styles.grid}>
        <MetricCard
          label="Distance"
          value={formatDistance(
            recorder.metrics.distanceMeters,
            settings.unitSystem,
          )}
        />
        <MetricCard
          label="Elapsed"
          value={formatDuration(recorder.metrics.elapsedSeconds)}
        />
        <MetricCard
          label="Moving"
          value={formatDuration(recorder.metrics.movingSeconds)}
        />
        <MetricCard
          label="Average"
          value={formatSpeed(
            recorder.metrics.averageSpeedMps,
            settings.unitSystem,
          )}
        />
        <MetricCard
          label="Max"
          value={formatSpeed(recorder.metrics.maxSpeedMps, settings.unitSystem)}
        />
        <MetricCard
          label="Ascent"
          value={formatAscent(
            recorder.metrics.ascentMeters,
            settings.unitSystem,
          )}
        />
      </View>

      <View style={styles.routeCard}>
        <Text style={styles.metricLabel}>GPS points</Text>
        <Text style={styles.pointCount}>{recorder.pointCount}</Text>
        {recorder.lastPoint ? (
          <Text style={styles.coordinateText}>
            {recorder.lastPoint.latitude.toFixed(5)},{' '}
            {recorder.lastPoint.longitude.toFixed(5)}
          </Text>
        ) : (
          <Text style={styles.coordinateText}>
            Start a ride to collect route points.
          </Text>
        )}
      </View>

      <View style={styles.controls}>
        {canStart ? (
          <Pressable style={styles.primaryButton} onPress={recorder.startRide}>
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
          <Pressable style={styles.primaryButton} onPress={recorder.resumeRide}>
            <Text style={styles.primaryButtonText}>Resume</Text>
          </Pressable>
        ) : null}
        {!canStart ? (
          <Pressable style={styles.stopButton} onPress={recorder.stopRide}>
            <Text style={styles.stopButtonText}>Stop</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.note}>
        Background recording starts when permission is granted. Stop the ride to
        save summary metrics locally.
      </Text>
      <StatusBar style="auto" />
    </ScrollView>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
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
    gap: 16,
    padding: 20,
    paddingTop: 64,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerLinks: {
    alignItems: 'flex-end',
    gap: 8,
  },
  kicker: {
    color: '#7ee787',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
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
  statusCard: {
    borderRadius: 20,
    backgroundColor: '#161b22',
    padding: 18,
  },
  statusLabel: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statusValue: {
    marginTop: 4,
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  warning: {
    marginTop: 8,
    color: '#f2cc60',
    fontWeight: '700',
  },
  error: {
    marginTop: 8,
    color: '#ff7b72',
    fontWeight: '700',
  },
  speedCard: {
    borderRadius: 28,
    backgroundColor: '#f0f6fc',
    padding: 24,
  },
  speedValue: {
    marginTop: 8,
    color: '#0d1117',
    fontSize: 56,
    fontWeight: '900',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    minWidth: '47%',
    flex: 1,
    borderRadius: 20,
    backgroundColor: '#161b22',
    padding: 16,
  },
  metricLabel: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  metricValue: {
    marginTop: 8,
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },
  routeCard: {
    borderRadius: 20,
    backgroundColor: '#161b22',
    padding: 18,
  },
  pointCount: {
    marginTop: 8,
    color: '#fff',
    fontSize: 36,
    fontWeight: '900',
  },
  coordinateText: {
    marginTop: 4,
    color: '#8b949e',
    fontSize: 15,
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: '#238636',
    padding: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 999,
    padding: 16,
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
  },
  stopButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: '#da3633',
    padding: 16,
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
  },
  note: {
    color: '#8b949e',
    fontSize: 14,
    lineHeight: 20,
  },
});
