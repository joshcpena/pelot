import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type DimensionValue,
} from 'react-native';

import type { ThemeColors } from '../settings/settings';
import { dashboardMetricById, type DashboardValueContext } from './dashboard';
import { RideMap } from './RideMap';
import type { DashboardCard, RideSettings } from './types';

type CardLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragState = {
  card: DashboardCard;
  layout: CardLayout;
  x: Animated.Value;
  y: Animated.Value;
};

function getOverlapArea(a: CardLayout, b: CardLayout) {
  const xOverlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );

  return xOverlap * yOverlap;
}

function getSpanDimensions(span: DashboardCard['span']) {
  const [columns, rows] = span.split('x').map(Number);

  return { columns, rows };
}

export function DashboardGrid({
  colors,
  context,
  layout,
  settings,
  rowHeight = 66,
  onLongPressCard,
  isEditing = false,
  onAddCard,
  onMoveCard,
  onPressCard,
  onRemoveCard,
}: {
  colors: ThemeColors;
  context: DashboardValueContext;
  layout: DashboardCard[];
  settings: RideSettings;
  rowHeight?: number;
  onLongPressCard?: (card: DashboardCard) => void;
  isEditing?: boolean;
  onAddCard?: () => void;
  onMoveCard?: (draggedCardId: string, targetCardId: string) => void;
  onPressCard?: (card: DashboardCard) => void;
  onRemoveCard?: (cardId: string) => void;
}) {
  const styles = createStyles(colors);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [jiggle] = useState(() => new Animated.Value(0));
  const cardLayoutsRef = useRef<Record<string, CardLayout>>({});
  const dragStateRef = useRef<DragState | null>(null);
  const lastTargetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeDragId) {
      jiggle.stopAnimation();
      jiggle.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(jiggle, {
          toValue: 1,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(jiggle, {
          toValue: -1,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(jiggle, {
          toValue: 0,
          duration: 90,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => animation.stop();
  }, [activeDragId, jiggle]);

  function setCardLayout(cardId: string, event: LayoutChangeEvent) {
    cardLayoutsRef.current[cardId] = event.nativeEvent.layout;
  }

  function startDrag(card: DashboardCard) {
    const layout = cardLayoutsRef.current[card.id];

    if (!layout) {
      return;
    }

    const nextDragState = {
      card,
      layout,
      x: new Animated.Value(layout.x),
      y: new Animated.Value(layout.y),
    };

    lastTargetIdRef.current = null;
    setActiveDragId(card.id);
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }

  function moveDrag(dx: number, dy: number) {
    const currentDragState = dragStateRef.current;

    if (!currentDragState) {
      return;
    }

    const nextX = currentDragState.layout.x + dx;
    const nextY = currentDragState.layout.y + dy;
    const draggedLayout = {
      ...currentDragState.layout,
      x: nextX,
      y: nextY,
    };

    currentDragState.x.setValue(nextX);
    currentDragState.y.setValue(nextY);

    const target = layout.reduce<DashboardCard | null>((bestTarget, card) => {
      const cardLayout = cardLayoutsRef.current[card.id];

      if (card.id === currentDragState.card.id || !cardLayout) {
        return bestTarget;
      }

      const overlapArea = getOverlapArea(draggedLayout, cardLayout);
      const currentBestArea = bestTarget
        ? getOverlapArea(draggedLayout, cardLayoutsRef.current[bestTarget.id])
        : 0;

      return overlapArea > currentBestArea ? card : bestTarget;
    }, null);

    const targetLayout = target ? cardLayoutsRef.current[target.id] : null;
    const targetOverlapArea = targetLayout
      ? getOverlapArea(draggedLayout, targetLayout)
      : 0;
    const draggedArea = draggedLayout.width * draggedLayout.height;

    if (targetOverlapArea < draggedArea * 0.18) {
      lastTargetIdRef.current = null;
      return;
    }

    if (!target) {
      lastTargetIdRef.current = null;
      return;
    }

    if (lastTargetIdRef.current === target.id) {
      return;
    }

    lastTargetIdRef.current = target.id;
    onMoveCard?.(currentDragState.card.id, target.id);
  }

  function endDrag() {
    setActiveDragId(null);
    setDragState(null);
    dragStateRef.current = null;
    lastTargetIdRef.current = null;
  }
  const cards = layout.map((card) => {
    const metric = dashboardMetricById.get(card.metricId);

    if (!metric) {
      return null;
    }

    const { columns, rows } = getSpanDimensions(card.span);
    const width = `${(columns / 3) * 100}%` as DimensionValue;
    const height = rows * rowHeight;
    const cardStyle = { width, height };
    const content =
      card.metricId === 'map' ? (
        <View style={styles.mapContent}>
          <RideMap
            points={context.routePoints}
            mapType={settings.mapType}
            plannedRoute={context.plannedRoute}
          />
        </View>
      ) : (
        <MetricCardContent
          colors={colors}
          label={metric.label}
          value={metric.getValue(context)}
          isWide={columns === 3}
        />
      );

    if (isEditing) {
      return (
        <EditDashboardCard
          key={card.id}
          card={card}
          cardStyle={cardStyle}
          isActive={activeDragId === card.id}
          label={metric.label}
          onLayout={setCardLayout}
          onPressCard={onPressCard}
          onRemoveCard={onRemoveCard}
          onStartDrag={startDrag}
          onMoveDrag={moveDrag}
          onEndDrag={endDrag}
          styles={styles}
        >
          {content}
        </EditDashboardCard>
      );
    }

    return (
      <Pressable
        key={card.id}
        delayLongPress={1000}
        onLongPress={onLongPressCard ? () => onLongPressCard(card) : undefined}
        style={[
          card.metricId === 'map' ? styles.cardShell : styles.metricCard,
          cardStyle,
        ]}
      >
        {content}
      </Pressable>
    );
  });

  const grid = (
    <View style={styles.grid}>
      {cards}
      {isEditing ? (
        <Pressable style={styles.addTile} onPress={onAddCard}>
          <Text style={styles.addTileIcon}>+</Text>
          <Text style={styles.addTileText}>Add metric</Text>
        </Pressable>
      ) : null}
      {dragState ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.dragOverlay,
            {
              width: dragState.layout.width,
              height: dragState.layout.height,
              transform: [
                { translateX: dragState.x },
                { translateY: dragState.y },
                {
                  rotate: jiggle.interpolate({
                    inputRange: [-1, 1],
                    outputRange: ['-1.2deg', '1.2deg'],
                  }),
                },
              ],
            },
          ]}
        >
          {renderCardContent(dragState.card)}
        </Animated.View>
      ) : null}
    </View>
  );

  return grid;

  function renderCardContent(card: DashboardCard) {
    const metric = dashboardMetricById.get(card.metricId);

    if (!metric) {
      return null;
    }

    const { columns } = getSpanDimensions(card.span);

    return card.metricId === 'map' ? (
      <View style={styles.mapContent}>
        <RideMap
          points={context.routePoints}
          mapType={settings.mapType}
          plannedRoute={context.plannedRoute}
        />
      </View>
    ) : (
      <MetricCardContent
        colors={colors}
        label={metric.label}
        value={metric.getValue(context)}
        isWide={columns === 3}
      />
    );
  }
}

function EditDashboardCard({
  card,
  cardStyle,
  children,
  isActive,
  label,
  onLayout,
  onPressCard,
  onRemoveCard,
  onStartDrag,
  onMoveDrag,
  onEndDrag,
  styles,
}: {
  card: DashboardCard;
  cardStyle: { width: DimensionValue; height: number };
  children: ReactNode;
  isActive: boolean;
  label: string;
  onLayout: (cardId: string, event: LayoutChangeEvent) => void;
  onPressCard?: (card: DashboardCard) => void;
  onRemoveCard?: (cardId: string) => void;
  onStartDrag: (card: DashboardCard) => void;
  onMoveDrag: (dx: number, dy: number) => void;
  onEndDrag: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const hasDraggedRef = useRef(false);
  const cardRef = useRef(card);
  const onEndDragRef = useRef(onEndDrag);
  const onMoveDragRef = useRef(onMoveDrag);
  const onPressCardRef = useRef(onPressCard);
  const onStartDragRef = useRef(onStartDrag);

  useEffect(() => {
    cardRef.current = card;
    onEndDragRef.current = onEndDrag;
    onMoveDragRef.current = onMoveDrag;
    onPressCardRef.current = onPressCard;
    onStartDragRef.current = onStartDrag;
  }, [card, onEndDrag, onMoveDrag, onPressCard, onStartDrag]);

  // PanResponder callbacks must stay stable; refs are only read from gesture events.
  // eslint-disable-next-line react-hooks/refs
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        hasDraggedRef.current = false;
        onStartDragRef.current(cardRef.current);
      },
      onPanResponderMove: (_, gesture) => {
        if (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4) {
          hasDraggedRef.current = true;
        }

        onMoveDragRef.current(gesture.dx, gesture.dy);
      },
      onPanResponderRelease: () => {
        const didDrag = hasDraggedRef.current;
        onEndDragRef.current();

        if (!didDrag) {
          onPressCardRef.current?.(cardRef.current);
        }
      },
      onPanResponderTerminate: () => onEndDragRef.current(),
    }),
  );

  return (
    <View
      onLayout={(event) => onLayout(card.id, event)}
      style={[styles.editSlot, cardStyle]}
    >
      <Animated.View {...panResponder.panHandlers} style={styles.editResponder}>
        <Pressable
          style={[styles.editCard, isActive && styles.editCardPlaceholder]}
          onPressIn={() => onStartDrag(card)}
          onPress={() => {
            onEndDrag();
            onPressCard?.(card);
          }}
        >
          {children}
        </Pressable>
        <Pressable
          accessibilityLabel={`Remove ${label}`}
          style={styles.removeBadge}
          onPress={() => onRemoveCard?.(card.id)}
        >
          <Text style={styles.removeBadgeText}>-</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function MetricCardContent({
  colors,
  label,
  value,
  isWide,
}: {
  colors: ThemeColors;
  label: string;
  value: string;
  isWide: boolean;
}) {
  const styles = createStyles(colors);

  return (
    <>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, isWide && styles.metricValueWide]}>
        {value}
      </Text>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    grid: {
      position: 'relative',
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cardShell: {
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    mapContent: {
      flex: 1,
    },
    metricCard: {
      justifyContent: 'center',
      backgroundColor: colors.card,
      padding: 8,
    },
    editSlot: {
      backgroundColor: colors.background,
      padding: 2,
    },
    editResponder: {
      flex: 1,
    },
    editCard: {
      flex: 1,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: colors.accent,
      backgroundColor: colors.card,
    },
    editCardPlaceholder: {
      opacity: 0.28,
      borderStyle: 'dashed',
    },
    dragOverlay: {
      position: 'absolute',
      zIndex: 100,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: colors.accent,
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.24,
      shadowRadius: 14,
      elevation: 12,
    },
    dropActive: {
      backgroundColor: colors.accentSoft,
    },
    removeBadge: {
      position: 'absolute',
      top: 5,
      right: 5,
      width: 26,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: colors.danger,
    },
    removeBadgeText: {
      color: '#fff',
      fontSize: 20,
      fontWeight: '900',
      lineHeight: 22,
    },
    addTile: {
      width: '33.333%',
      height: 66,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.border,
      borderStyle: 'dashed',
      backgroundColor: colors.background,
    },
    addTileIcon: {
      color: colors.accent,
      fontSize: 24,
      fontWeight: '900',
      lineHeight: 26,
    },
    addTileText: {
      color: colors.mutedText,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
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
