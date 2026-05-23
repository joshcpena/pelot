import { StyleSheet, Text, View, type DimensionValue } from 'react-native';

import type { ThemeColors } from '../settings/settings';
import { dashboardMetricById, type DashboardValueContext } from './dashboard';
import { RideMap } from './RideMap';
import type { DashboardCard, RideSettings } from './types';

function getSpanDimensions(span: DashboardCard['span']) {
  const [columns, rows] = span.split('x').map(Number);

  return { columns, rows };
}

export function DashboardGrid({
  colors,
  context,
  layout,
  settings,
}: {
  colors: ThemeColors;
  context: DashboardValueContext;
  layout: DashboardCard[];
  settings: RideSettings;
}) {
  const styles = createStyles(colors);

  return (
    <View style={styles.grid}>
      {layout.map((card) => {
        const metric = dashboardMetricById.get(card.metricId);

        if (!metric) {
          return null;
        }

        const { columns, rows } = getSpanDimensions(card.span);
        const width = `${(columns / 3) * 100}%` as DimensionValue;
        const height = rows * (card.metricId === 'map' ? 92 : 66);

        if (card.metricId === 'map') {
          return (
            <View key={card.id} style={[styles.cardShell, { width, height }]}>
              <RideMap
                points={context.routePoints}
                mapType={settings.mapType}
                plannedRoute={context.plannedRoute}
              />
            </View>
          );
        }

        const value = metric.getValue(context);
        const isWide = columns === 3;

        return (
          <View key={card.id} style={[styles.metricCard, { width, height }]}>
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text
              style={[styles.metricValue, isWide && styles.metricValueWide]}
            >
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cardShell: {
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    metricCard: {
      justifyContent: 'center',
      backgroundColor: colors.card,
      padding: 8,
    },
    metricLabel: {
      color: colors.mutedText,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    metricValue: {
      marginTop: 2,
      color: colors.primaryText,
      fontSize: 18,
      fontWeight: '900',
    },
    metricValueWide: {
      fontSize: 42,
    },
  });
}
