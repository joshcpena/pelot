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

import {
  type ThemeColors,
  useRideSettings,
  useThemeColors,
} from '../src/features/settings/settings';
import type { RideSettings } from '../src/features/ride/types';

function OptionButton<T extends string>({
  label,
  value,
  selectedValue,
  onSelect,
  styles,
}: {
  label: string;
  value: T;
  selectedValue: T;
  onSelect: (value: T) => void;
  styles: ReturnType<typeof createStyles>;
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

function ValueButton({
  label,
  selected,
  onPress,
  styles,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      style={[styles.optionButton, selected && styles.optionButtonSelected]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.optionButtonText,
          selected && styles.optionButtonTextSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: ReactNode;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const { settings, isLoading, updateSetting } = useRideSettings();
  const colors = useThemeColors();
  const styles = createStyles(colors);

  function update<K extends keyof RideSettings>(
    key: K,
    value: RideSettings[K],
  ) {
    updateSetting(key, value).catch(() => {});
  }

  function updateUnitSystem(unitSystem: RideSettings['unitSystem']) {
    update('unitSystem', unitSystem);
    update('splitDistanceMeters', unitSystem === 'metric' ? 1000 : 1609.344);
  }

  const distancePresets =
    settings.unitSystem === 'metric'
      ? [
          { label: '1 km', value: 1000 },
          { label: '5 km', value: 5000 },
          { label: '10 km', value: 10000 },
        ]
      : [
          { label: '1 mi', value: 1609.344 },
          { label: '5 mi', value: 8046.72 },
          { label: '10 mi', value: 16093.44 },
        ];
  const timePresets = [
    { label: '5 min', value: 300 },
    { label: '10 min', value: 600 },
    { label: '20 min', value: 1200 },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>
      {isLoading ? (
        <Text style={styles.muted}>Loading saved preferences...</Text>
      ) : null}

      <Section title="Units" styles={styles}>
        <View style={styles.rowWrap}>
          <OptionButton
            styles={styles}
            label="Imperial"
            value="imperial"
            selectedValue={settings.unitSystem}
            onSelect={updateUnitSystem}
          />
          <OptionButton
            styles={styles}
            label="Metric"
            value="metric"
            selectedValue={settings.unitSystem}
            onSelect={updateUnitSystem}
          />
        </View>
      </Section>

      <Section title="Ride Behavior" styles={styles}>
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
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Auto-lap</Text>
            <Text style={styles.muted}>
              Start a new lap automatically by split distance or time.
            </Text>
          </View>
          <Switch
            value={settings.autoLap}
            onValueChange={(value) => update('autoLap', value)}
          />
        </View>
      </Section>

      <Section title="Ascent Source" styles={styles}>
        <View style={styles.rowWrap}>
          <OptionButton
            styles={styles}
            label="Prefer sensors"
            value="barometer-preferred"
            selectedValue={settings.ascentSource}
            onSelect={(value) => update('ascentSource', value)}
          />
          <OptionButton
            styles={styles}
            label="GPS only"
            value="gps-only"
            selectedValue={settings.ascentSource}
            onSelect={(value) => update('ascentSource', value)}
          />
        </View>
      </Section>

      <Section title="GPS" styles={styles}>
        <View style={styles.rowWrap}>
          <OptionButton
            styles={styles}
            label="Best"
            value="best"
            selectedValue={settings.gpsAccuracy}
            onSelect={(value) => update('gpsAccuracy', value)}
          />
          <OptionButton
            styles={styles}
            label="Balanced"
            value="balanced"
            selectedValue={settings.gpsAccuracy}
            onSelect={(value) => update('gpsAccuracy', value)}
          />
        </View>
      </Section>

      <Section title="Splits" styles={styles}>
        <View style={styles.rowWrap}>
          <OptionButton
            styles={styles}
            label="Distance"
            value="distance"
            selectedValue={settings.splitType}
            onSelect={(value) => update('splitType', value)}
          />
          <OptionButton
            styles={styles}
            label="Time"
            value="time"
            selectedValue={settings.splitType}
            onSelect={(value) => update('splitType', value)}
          />
        </View>
        <View style={styles.rowWrap}>
          {(settings.splitType === 'distance'
            ? distancePresets
            : timePresets
          ).map((preset) => (
            <ValueButton
              key={preset.label}
              styles={styles}
              label={preset.label}
              selected={
                settings.splitType === 'distance'
                  ? settings.splitDistanceMeters === preset.value
                  : settings.splitDurationSeconds === preset.value
              }
              onPress={() =>
                update(
                  settings.splitType === 'distance'
                    ? 'splitDistanceMeters'
                    : 'splitDurationSeconds',
                  preset.value,
                )
              }
            />
          ))}
        </View>
        <Text style={styles.muted}>
          Defaults: 1 mi / 1 km equivalent or 10 minutes.
        </Text>
      </Section>

      <Section title="Display" styles={styles}>
        <View style={styles.rowWrap}>
          <OptionButton
            styles={styles}
            label="System"
            value="system"
            selectedValue={settings.theme}
            onSelect={(value) => update('theme', value)}
          />
          <OptionButton
            styles={styles}
            label="Light"
            value="light"
            selectedValue={settings.theme}
            onSelect={(value) => update('theme', value)}
          />
          <OptionButton
            styles={styles}
            label="Dark"
            value="dark"
            selectedValue={settings.theme}
            onSelect={(value) => update('theme', value)}
          />
        </View>
        <View style={styles.rowWrap}>
          <OptionButton
            styles={styles}
            label="Map"
            value="standard"
            selectedValue={settings.mapType}
            onSelect={(value) => update('mapType', value)}
          />
          <OptionButton
            styles={styles}
            label="Satellite"
            value="satellite"
            selectedValue={settings.mapType}
            onSelect={(value) => update('mapType', value)}
          />
          <OptionButton
            styles={styles}
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      gap: 0,
      paddingTop: 48,
      paddingBottom: 24,
    },
    title: {
      color: colors.primaryText,
      fontSize: 30,
      fontWeight: '800',
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    section: {
      gap: 8,
      backgroundColor: colors.card,
      padding: 12,
    },
    sectionTitle: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '800',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    rowWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    switchCopy: {
      flex: 1,
      gap: 3,
    },
    label: {
      color: colors.primaryText,
      fontSize: 15,
      fontWeight: '700',
    },
    muted: {
      color: colors.mutedText,
      fontSize: 12,
      lineHeight: 17,
    },
    optionButton: {
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    optionButtonSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    optionButtonText: {
      color: colors.secondaryText,
      fontWeight: '700',
    },
    optionButtonTextSelected: {
      color: '#fff',
    },
    link: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '700',
      paddingHorizontal: 12,
      paddingTop: 14,
      paddingBottom: 24,
    },
  });
}
