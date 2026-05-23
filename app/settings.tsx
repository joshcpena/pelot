import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { useRideSettings } from '../src/features/settings/settings';
import type { RideSettings } from '../src/features/ride/types';

function OptionButton<T extends string>({
  label,
  value,
  selectedValue,
  onSelect,
}: {
  label: string;
  value: T;
  selectedValue: T;
  onSelect: (value: T) => void;
}) {
  const isSelected = value === selectedValue;

  return (
    <Pressable
      style={[styles.optionButton, isSelected && styles.optionButtonSelected]}
      onPress={() => onSelect(value)}
    >
      <Text
        style={[
          styles.optionButtonText,
          isSelected && styles.optionButtonTextSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const { settings, isLoading, updateSetting } = useRideSettings();

  function update<K extends keyof RideSettings>(
    key: K,
    value: RideSettings[K],
  ) {
    updateSetting(key, value).catch(() => {});
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>
      {isLoading ? (
        <Text style={styles.muted}>Loading saved preferences...</Text>
      ) : null}

      <Section title="Units">
        <View style={styles.rowWrap}>
          <OptionButton
            label="Imperial"
            value="imperial"
            selectedValue={settings.unitSystem}
            onSelect={(value) => update('unitSystem', value)}
          />
          <OptionButton
            label="Metric"
            value="metric"
            selectedValue={settings.unitSystem}
            onSelect={(value) => update('unitSystem', value)}
          />
        </View>
      </Section>

      <Section title="Ride Behavior">
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Keep screen awake</Text>
            <Text style={styles.muted}>
              Prevent sleep while actively recording.
            </Text>
          </View>
          <Switch
            value={settings.keepAwakeDuringRide}
            onValueChange={(value) => update('keepAwakeDuringRide', value)}
          />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Auto-pause</Text>
            <Text style={styles.muted}>
              Ignore stopped GPS points while recording.
            </Text>
          </View>
          <Switch
            value={settings.autoPause}
            onValueChange={(value) => update('autoPause', value)}
          />
        </View>
      </Section>

      <Section title="Ascent Source">
        <View style={styles.rowWrap}>
          <OptionButton
            label="Prefer sensors"
            value="barometer-preferred"
            selectedValue={settings.ascentSource}
            onSelect={(value) => update('ascentSource', value)}
          />
          <OptionButton
            label="GPS only"
            value="gps-only"
            selectedValue={settings.ascentSource}
            onSelect={(value) => update('ascentSource', value)}
          />
        </View>
      </Section>

      <Section title="GPS">
        <View style={styles.rowWrap}>
          <OptionButton
            label="Best"
            value="best"
            selectedValue={settings.gpsAccuracy}
            onSelect={(value) => update('gpsAccuracy', value)}
          />
          <OptionButton
            label="Balanced"
            value="balanced"
            selectedValue={settings.gpsAccuracy}
            onSelect={(value) => update('gpsAccuracy', value)}
          />
        </View>
      </Section>

      <Section title="Splits">
        <View style={styles.rowWrap}>
          <OptionButton
            label="Distance"
            value="distance"
            selectedValue={settings.splitType}
            onSelect={(value) => update('splitType', value)}
          />
          <OptionButton
            label="Time"
            value="time"
            selectedValue={settings.splitType}
            onSelect={(value) => update('splitType', value)}
          />
        </View>
        <Text style={styles.muted}>
          Defaults: 1 mi / 1 km equivalent or 5 minutes.
        </Text>
      </Section>

      <Section title="Display">
        <View style={styles.rowWrap}>
          <OptionButton
            label="System"
            value="system"
            selectedValue={settings.theme}
            onSelect={(value) => update('theme', value)}
          />
          <OptionButton
            label="Light"
            value="light"
            selectedValue={settings.theme}
            onSelect={(value) => update('theme', value)}
          />
          <OptionButton
            label="Dark"
            value="dark"
            selectedValue={settings.theme}
            onSelect={(value) => update('theme', value)}
          />
        </View>
        <View style={styles.rowWrap}>
          <OptionButton
            label="Map"
            value="standard"
            selectedValue={settings.mapType}
            onSelect={(value) => update('mapType', value)}
          />
          <OptionButton
            label="Satellite"
            value="satellite"
            selectedValue={settings.mapType}
            onSelect={(value) => update('mapType', value)}
          />
          <OptionButton
            label="Hybrid"
            value="hybrid"
            selectedValue={settings.mapType}
            onSelect={(value) => update('mapType', value)}
          />
        </View>
      </Section>

      <Link href="/" style={styles.link}>
        Back to ride
      </Link>
    </ScrollView>
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
  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
  },
  section: {
    gap: 12,
    borderRadius: 18,
    backgroundColor: '#161b22',
    padding: 18,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  switchCopy: {
    flex: 1,
    gap: 3,
  },
  label: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  muted: {
    color: '#8b949e',
    fontSize: 14,
    lineHeight: 20,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionButtonSelected: {
    borderColor: '#2f81f7',
    backgroundColor: '#1f6feb',
  },
  optionButtonText: {
    color: '#c9d1d9',
    fontWeight: '700',
  },
  optionButtonTextSelected: {
    color: '#fff',
  },
  link: {
    color: '#58a6ff',
    fontSize: 16,
    fontWeight: '700',
    paddingBottom: 36,
  },
});
