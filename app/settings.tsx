import { Link } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  type ThemeColors,
  useRideSettings,
  useThemeColors,
} from '../src/features/settings/settings';
import type { RideSettings } from '../src/features/ride/types';
import {
  scanHeartRateDevices,
  type ScannedHeartRateDevice,
} from '../src/features/devices/heartRateMonitor';

function OptionButton<T extends string>({
  label,
  value,
  selectedValue,
  onSelect,
  styles,
}: {
  label: string;
  value: T;
  selectedValue: T | null;
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
  subtitle,
  children,
  styles,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function formatProfileNumber(value: number | null) {
  if (value == null) {
    return '';
  }

  return Number(value.toFixed(1)).toString();
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function SettingsScreen() {
  const { settings, isLoading, updateSetting } = useRideSettings();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [heartRateDevices, setHeartRateDevices] = useState<
    ScannedHeartRateDevice[]
  >([]);

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

  function updateWeight(value: string) {
    const parsed = parsePositiveNumber(value);

    update(
      'riderWeightKg',
      parsed == null
        ? null
        : settings.unitSystem === 'imperial'
          ? parsed / 2.2046226218
          : parsed,
    );
  }

  function updateHeight(value: string) {
    const parsed = parsePositiveNumber(value);

    update(
      'riderHeightCm',
      parsed == null
        ? null
        : settings.unitSystem === 'imperial'
          ? parsed * 2.54
          : parsed,
    );
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

  async function scanForHeartRateDevices() {
    setScanError(null);
    setIsScanning(true);

    try {
      setHeartRateDevices(await scanHeartRateDevices());
    } catch (error) {
      setScanError(
        error instanceof Error
          ? error.message
          : 'Could not scan for heart rate devices.',
      );
    } finally {
      setIsScanning(false);
    }
  }

  function openDeviceModal() {
    setIsDeviceModalOpen(true);
    scanForHeartRateDevices().catch(() => {});
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>Preferences</Text>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>
            Keep the ride screen focused and tune everything else here.
          </Text>
        </View>
        <Link dismissTo href="/" style={styles.headerLink}>
          Back to ride
        </Link>
      </View>
      {isLoading ? (
        <Text style={styles.muted}>Loading saved preferences...</Text>
      ) : null}

      <View style={styles.statusCard}>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Units</Text>
          <Text style={styles.statusValue}>
            {settings.unitSystem === 'imperial' ? 'Miles' : 'Kilometers'}
          </Text>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Splits</Text>
          <Text style={styles.statusValue}>
            {settings.splitType === 'distance' ? 'Distance' : 'Time'}
          </Text>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Map</Text>
          <Text style={styles.statusValue}>{settings.mapType}</Text>
        </View>
      </View>

      <Section
        title="Essentials"
        subtitle="The choices you are most likely to change."
        styles={styles}
      >
        <Text style={styles.label}>Units</Text>
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
        <View style={styles.divider} />
        <Text style={styles.label}>Theme</Text>
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
      </Section>

      <Section
        title="Rider Profile"
        subtitle="Optional details improve calorie estimates."
        styles={styles}
      >
        <Text style={styles.muted}>
          Used for active calorie estimates with cycling MET intensity and
          Mifflin-St Jeor resting metabolic rate.
        </Text>
        <View style={styles.rowWrap}>
          <OptionButton
            styles={styles}
            label="Female"
            value="female"
            selectedValue={settings.riderSex}
            onSelect={(value) => update('riderSex', value)}
          />
          <OptionButton
            styles={styles}
            label="Male"
            value="male"
            selectedValue={settings.riderSex}
            onSelect={(value) => update('riderSex', value)}
          />
        </View>
        <View style={styles.profileGrid}>
          <View style={styles.profileField}>
            <Text style={styles.label}>
              Weight ({settings.unitSystem === 'imperial' ? 'lb' : 'kg'})
            </Text>
            <TextInput
              keyboardType="decimal-pad"
              placeholder={settings.unitSystem === 'imperial' ? '175' : '79'}
              placeholderTextColor={colors.mutedText}
              style={styles.input}
              value={formatProfileNumber(
                settings.riderWeightKg == null
                  ? null
                  : settings.unitSystem === 'imperial'
                    ? settings.riderWeightKg * 2.2046226218
                    : settings.riderWeightKg,
              )}
              onChangeText={updateWeight}
            />
          </View>
          <View style={styles.profileField}>
            <Text style={styles.label}>
              Height ({settings.unitSystem === 'imperial' ? 'in' : 'cm'})
            </Text>
            <TextInput
              keyboardType="decimal-pad"
              placeholder={settings.unitSystem === 'imperial' ? '70' : '178'}
              placeholderTextColor={colors.mutedText}
              style={styles.input}
              value={formatProfileNumber(
                settings.riderHeightCm == null
                  ? null
                  : settings.unitSystem === 'imperial'
                    ? settings.riderHeightCm / 2.54
                    : settings.riderHeightCm,
              )}
              onChangeText={updateHeight}
            />
          </View>
          <View style={styles.profileField}>
            <Text style={styles.label}>Age</Text>
            <TextInput
              keyboardType="number-pad"
              placeholder="35"
              placeholderTextColor={colors.mutedText}
              style={styles.input}
              value={settings.riderAgeYears?.toString() ?? ''}
              onChangeText={(value) =>
                update('riderAgeYears', parsePositiveNumber(value))
              }
            />
          </View>
        </View>
      </Section>

      <Section
        title="Ride Behavior"
        subtitle="Recording defaults for every ride."
        styles={styles}
      >
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

      <Section
        title="Devices"
        subtitle="Connect sensors that can enrich the dashboard."
        styles={styles}
      >
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Heart rate device</Text>
            <Text style={styles.muted}>
              {settings.connectedHeartRateDevice
                ? settings.connectedHeartRateDevice.name
                : 'No device connected. Enable Broadcast Heart Rate on your Garmin watch first.'}
            </Text>
          </View>
          <Pressable style={styles.deviceButton} onPress={openDeviceModal}>
            <Text style={styles.deviceButtonText}>Add device</Text>
          </Pressable>
        </View>
        {settings.connectedHeartRateDevice ? (
          <Pressable
            style={styles.clearDeviceButton}
            onPress={() => update('connectedHeartRateDevice', null)}
          >
            <Text style={styles.clearDeviceButtonText}>
              Remove heart rate device
            </Text>
          </Pressable>
        ) : null}
      </Section>

      <Section
        title="GPS & Elevation"
        subtitle="Favor precision or battery life as needed."
        styles={styles}
      >
        <Text style={styles.label}>Ascent source</Text>
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
        <View style={styles.divider} />
        <Text style={styles.label}>GPS accuracy</Text>
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

      <Section
        title="Splits"
        subtitle="Choose automatic lap markers."
        styles={styles}
      >
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

      <Section
        title="Map Display"
        subtitle="Pick the base map used while riding."
        styles={styles}
      >
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

      <Modal
        animationType="slide"
        visible={isDeviceModalOpen}
        onRequestClose={() => setIsDeviceModalOpen(false)}
      >
        <ScrollView
          style={styles.modal}
          contentContainerStyle={styles.modalBody}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Heart Rate Device</Text>
            <Pressable onPress={() => setIsDeviceModalOpen(false)}>
              <Text style={styles.modalClose}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.modalCopy}>
            On Garmin, enable Broadcast Heart Rate, then scan here. Pelot uses
            the standard Bluetooth Heart Rate Service.
          </Text>
          <Pressable
            disabled={isScanning}
            style={[styles.deviceButton, isScanning && styles.disabledButton]}
            onPress={scanForHeartRateDevices}
          >
            <Text style={styles.deviceButtonText}>
              {isScanning ? 'Scanning...' : 'Scan again'}
            </Text>
          </Pressable>
          {scanError ? <Text style={styles.error}>{scanError}</Text> : null}
          {heartRateDevices.map((device) => (
            <Pressable
              key={device.id}
              style={styles.deviceRow}
              onPress={() => {
                update('connectedHeartRateDevice', device);
                setIsDeviceModalOpen(false);
              }}
            >
              <View style={styles.switchCopy}>
                <Text style={styles.label}>{device.name}</Text>
                <Text style={styles.muted}>{device.id}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
          {!isScanning && heartRateDevices.length === 0 ? (
            <Text style={styles.muted}>No heart rate devices found yet.</Text>
          ) : null}
        </ScrollView>
      </Modal>
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
      gap: 16,
      paddingHorizontal: 16,
      paddingTop: 58,
      paddingBottom: 32,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      paddingHorizontal: 4,
      paddingBottom: 4,
    },
    headerCopy: {
      flex: 1,
    },
    kicker: {
      color: colors.success,
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.primaryText,
      fontSize: 38,
      fontWeight: '900',
      letterSpacing: -0.9,
    },
    subtitle: {
      marginTop: 4,
      color: colors.mutedText,
      fontSize: 15,
      lineHeight: 21,
    },
    headerLink: {
      color: colors.accent,
      fontSize: 17,
      fontWeight: '900',
      paddingTop: 4,
    },
    statusCard: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.elevatedCard,
      padding: 14,
    },
    statusItem: {
      flex: 1,
      gap: 3,
    },
    statusLabel: {
      color: colors.mutedText,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    statusValue: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '900',
      textTransform: 'capitalize',
    },
    statusDivider: {
      width: 1,
      height: 34,
      marginHorizontal: 10,
      backgroundColor: colors.border,
    },
    section: {
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.card,
      padding: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
    },
    sectionHeader: {
      gap: 4,
      paddingBottom: 2,
    },
    sectionTitle: {
      color: colors.primaryText,
      fontSize: 22,
      fontWeight: '900',
      letterSpacing: -0.3,
    },
    sectionSubtitle: {
      color: colors.mutedText,
      fontSize: 13,
      lineHeight: 18,
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
      borderRadius: 18,
      backgroundColor: colors.background,
      padding: 12,
    },
    switchCopy: {
      flex: 1,
      gap: 3,
    },
    profileGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    profileField: {
      minWidth: '30%',
      flex: 1,
      gap: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.background,
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '700',
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    label: {
      color: colors.primaryText,
      fontSize: 15,
      fontWeight: '800',
    },
    muted: {
      color: colors.mutedText,
      fontSize: 13,
      lineHeight: 18,
    },
    optionButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      backgroundColor: colors.background,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    optionButtonSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    optionButtonText: {
      color: colors.secondaryText,
      fontWeight: '800',
    },
    optionButtonTextSelected: {
      color: '#fff',
    },
    deviceButton: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 999,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    deviceButtonText: {
      color: colors.accent,
      fontWeight: '900',
    },
    clearDeviceButton: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: 999,
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    clearDeviceButtonText: {
      color: colors.danger,
      fontWeight: '900',
    },
    disabledButton: {
      opacity: 0.55,
    },
    modal: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalBody: {
      gap: 12,
      padding: 16,
      paddingTop: 56,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    modalTitle: {
      flex: 1,
      color: colors.primaryText,
      fontSize: 24,
      fontWeight: '900',
    },
    modalClose: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: '900',
    },
    modalCopy: {
      color: colors.mutedText,
      fontSize: 14,
      lineHeight: 20,
    },
    error: {
      color: colors.danger,
      fontWeight: '800',
    },
    deviceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.card,
      padding: 12,
    },
    chevron: {
      color: colors.accent,
      fontSize: 28,
    },
    link: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: '900',
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 8,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
    },
  });
}
