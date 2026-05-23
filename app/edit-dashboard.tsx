import { Link } from 'expo-router';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Sortable, SortableItem } from 'react-native-reanimated-dnd';
import type { SortableRenderItemProps } from 'react-native-reanimated-dnd';

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
  defaultDashboardLayout,
  type DashboardMetricCategory,
} from '../src/features/ride/dashboard';
import type {
  DashboardCard,
  DashboardCardSpan,
  DashboardMetricId,
} from '../src/features/ride/types';

const categories: DashboardMetricCategory[] = [
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

export default function EditDashboardScreen() {
  const { settings, updateSetting } = useRideSettings();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [layout, setLayout] = useState(settings.dashboardLayout);
  const [metricPickerCardId, setMetricPickerCardId] = useState<string | null>(
    null,
  );
  const [sizePickerCardId, setSizePickerCardId] = useState<string | null>(null);

  function persist(nextLayout: DashboardCard[]) {
    setLayout(nextLayout);
    updateSetting('dashboardLayout', nextLayout).catch(() => {});
  }

  function updateCard(cardId: string, patch: Partial<DashboardCard>) {
    persist(
      layout.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
    );
  }

  function removeCard(cardId: string) {
    persist(layout.filter((card) => card.id !== cardId));
  }

  function chooseMetric(metricId: DashboardMetricId) {
    if (metricPickerCardId === 'new') {
      persist([...layout, createDashboardCard(metricId)]);
    } else if (metricPickerCardId) {
      updateCard(metricPickerCardId, { metricId });
    }

    setMetricPickerCardId(null);
  }

  function chooseSpan(span: DashboardCardSpan) {
    if (sizePickerCardId) {
      updateCard(sizePickerCardId, { span });
    }

    setSizePickerCardId(null);
  }

  function renderItem({
    item,
    ...props
  }: SortableRenderItemProps<DashboardCard>) {
    const metric = dashboardMetricById.get(item.metricId);

    return (
      <SortableItem
        data={item}
        onMove={(_, from, to) => {
          const next = [...layout];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          persist(next);
        }}
        {...props}
      >
        <View style={styles.editorCard}>
          <SortableItem.Handle>
            <View style={styles.dragHandle}>
              <Text style={styles.dragHandleText}>|||</Text>
            </View>
          </SortableItem.Handle>
          <View style={styles.editorCopy}>
            <Text style={styles.metricName}>
              {metric?.label ?? item.metricId}
            </Text>
            <Text style={styles.metricMeta}>
              {metric?.category ?? 'Unknown'} · {item.span}
            </Text>
          </View>
          <View style={styles.editorActions}>
            <Pressable
              style={styles.smallButton}
              onPress={() => setMetricPickerCardId(item.id)}
            >
              <Text style={styles.smallButtonText}>Metric</Text>
            </Pressable>
            <Pressable
              style={styles.smallButton}
              onPress={() => setSizePickerCardId(item.id)}
            >
              <Text style={styles.smallButtonText}>Size</Text>
            </Pressable>
            <Pressable
              style={styles.removeButton}
              onPress={() => removeCard(item.id)}
            >
              <Text style={styles.removeButtonText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      </SortableItem>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Dashboard</Text>
          <Text style={styles.title}>Edit Metrics</Text>
        </View>
        <Link href="/menu" style={styles.closeLink}>
          Done
        </Link>
      </View>

      <View style={styles.toolbar}>
        <Pressable
          style={styles.primaryButton}
          onPress={() => setMetricPickerCardId('new')}
        >
          <Text style={styles.primaryButtonText}>Add metric</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => persist(defaultDashboardLayout)}
        >
          <Text style={styles.secondaryButtonText}>Reset</Text>
        </Pressable>
      </View>

      <Sortable
        data={layout}
        renderItem={renderItem}
        itemHeight={108}
        style={styles.sortable}
      />

      <MetricPickerModal
        colors={colors}
        visible={metricPickerCardId != null}
        onClose={() => setMetricPickerCardId(null)}
        onSelect={chooseMetric}
      />
      <SizePickerModal
        colors={colors}
        card={layout.find((card) => card.id === sizePickerCardId) ?? null}
        visible={sizePickerCardId != null}
        onClose={() => setSizePickerCardId(null)}
        onSelect={chooseSpan}
      />
    </View>
  );
}

function MetricPickerModal({
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
            <Text style={styles.closeLink}>Close</Text>
          </Pressable>
        </View>
        {categories.map((category) => (
          <View key={category} style={styles.pickerSection}>
            <Text style={styles.sectionTitle}>{category}</Text>
            {dashboardMetricCatalog
              .filter((metric) => metric.category === category)
              .map((metric) => (
                <Pressable
                  key={metric.id}
                  style={styles.pickerRow}
                  onPress={() => onSelect(metric.id)}
                >
                  <Text style={styles.pickerLabel}>{metric.label}</Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
          </View>
        ))}
      </ScrollView>
    </Modal>
  );
}

function SizePickerModal({
  colors,
  card,
  visible,
  onClose,
  onSelect,
}: {
  colors: ThemeColors;
  card: DashboardCard | null;
  visible: boolean;
  onClose: () => void;
  onSelect: (span: DashboardCardSpan) => void;
}) {
  const styles = createStyles(colors);
  const metric = card ? dashboardMetricById.get(card.metricId) : null;
  const spans = metric?.supportedSpans ?? dashboardSpans;

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.sizeCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Choose Size</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.closeLink}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.rowWrap}>
            {spans.map((span) => (
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
                    card?.span === span && styles.spanButtonTextSelected,
                  ]}
                >
                  {span}
                </Text>
              </Pressable>
            ))}
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
      gap: 12,
      backgroundColor: colors.background,
      paddingTop: 56,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      paddingHorizontal: 16,
    },
    kicker: {
      color: colors.success,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.primaryText,
      fontSize: 30,
      fontWeight: '900',
    },
    closeLink: {
      color: colors.accent,
      fontSize: 16,
      fontWeight: '800',
    },
    toolbar: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
    },
    primaryButton: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: colors.success,
      padding: 12,
    },
    primaryButtonText: {
      color: '#fff',
      fontWeight: '900',
    },
    secondaryButton: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    secondaryButtonText: {
      color: colors.primaryText,
      fontWeight: '900',
    },
    sortable: {
      flex: 1,
      backgroundColor: colors.background,
    },
    editorCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderTopWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 10,
    },
    dragHandle: {
      width: 34,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
      backgroundColor: colors.background,
    },
    dragHandleText: {
      color: colors.mutedText,
      fontWeight: '900',
      transform: [{ rotate: '90deg' }],
    },
    editorCopy: {
      flex: 1,
    },
    metricName: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '900',
    },
    metricMeta: {
      marginTop: 3,
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '700',
    },
    editorActions: {
      gap: 5,
      width: 82,
    },
    smallButton: {
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 5,
    },
    smallButtonText: {
      color: colors.primaryText,
      fontSize: 11,
      fontWeight: '800',
    },
    removeButton: {
      alignItems: 'center',
      backgroundColor: colors.danger,
      paddingVertical: 5,
    },
    removeButtonText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '800',
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
    modalTitle: {
      color: colors.primaryText,
      fontSize: 24,
      fontWeight: '900',
    },
    pickerSection: {
      backgroundColor: colors.card,
      paddingVertical: 8,
    },
    sectionTitle: {
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
    chevron: {
      color: colors.accent,
      fontSize: 28,
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    sizeCard: {
      backgroundColor: colors.card,
      paddingTop: 20,
      paddingBottom: 36,
    },
    rowWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 16,
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
  });
}
