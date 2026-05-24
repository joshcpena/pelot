import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Easing,
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

const ENTER_EDIT_DELAY_MS = 550;

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
  onCancelNavigation,
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
  onCancelNavigation?: () => void;
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
            destinationOptions={context.destinationOptions}
            isNavigating={context.isNavigating}
            onCancelNavigation={onCancelNavigation}
            points={context.routePoints}
            mapType={settings.mapType}
            plannedRoute={context.plannedRoute}
            unitSystem={settings.unitSystem}
          />
        </View>
      ) : (
        <MetricCardContent
          colors={colors}
          metricId={card.metricId}
          label={metric.label}
          columns={columns}
          rows={rows}
          value={metric.getValue(context)}
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

    if (card.metricId === 'map') {
      return (
        <View key={card.id} style={[styles.cardShell, cardStyle]}>
          {content}
        </View>
      );
    }

    return (
      <DashboardMetricCard
        key={card.id}
        card={card}
        cardStyle={cardStyle}
        onLongPressCard={onLongPressCard}
        styles={styles}
      >
        {content}
      </DashboardMetricCard>
    );
  });

  const grid = (
    <View style={styles.grid}>
      {cards}
      {isEditing ? (
        <Pressable
          style={({ pressed }) => [
            styles.addTile,
            pressed && styles.addTilePressed,
          ]}
          onPress={onAddCard}
        >
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
          destinationOptions={context.destinationOptions}
          isNavigating={context.isNavigating}
          points={context.routePoints}
          mapType={settings.mapType}
          plannedRoute={context.plannedRoute}
          unitSystem={settings.unitSystem}
        />
      </View>
    ) : (
      <MetricCardContent
        colors={colors}
        metricId={card.metricId}
        label={metric.label}
        columns={columns}
        rows={getSpanDimensions(card.span).rows}
        value={metric.getValue(context)}
      />
    );
  }
}

function DashboardMetricCard({
  card,
  cardStyle,
  children,
  onLongPressCard,
  styles,
}: {
  card: DashboardCard;
  cardStyle: { width: DimensionValue; height: number };
  children: ReactNode;
  onLongPressCard?: (card: DashboardCard) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const [holdFeedback] = useState(() => new Animated.Value(0));

  function resetHoldFeedback() {
    holdFeedback.stopAnimation();
    Animated.timing(holdFeedback, {
      toValue: 0,
      duration: 90,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  function startHoldFeedback() {
    if (!onLongPressCard) {
      return;
    }

    holdFeedback.stopAnimation();
    holdFeedback.setValue(0);
    Animated.timing(holdFeedback, {
      toValue: 1,
      duration: ENTER_EDIT_DELAY_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  return (
    <Animated.View
      style={[
        styles.holdCard,
        cardStyle,
        {
          transform: [
            {
              scale: holdFeedback.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.975],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        delayLongPress={ENTER_EDIT_DELAY_MS}
        onLongPress={onLongPressCard ? () => onLongPressCard(card) : undefined}
        onPressIn={startHoldFeedback}
        onPressOut={resetHoldFeedback}
        style={styles.metricCard}
      >
        {children}
      </Pressable>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.holdTapGlow,
          {
            opacity: holdFeedback.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.28],
            }),
          },
        ]}
      />
    </Animated.View>
  );
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
  const [editFeedback] = useState(() => new Animated.Value(0));

  useEffect(() => {
    cardRef.current = card;
    onEndDragRef.current = onEndDrag;
    onMoveDragRef.current = onMoveDrag;
    onPressCardRef.current = onPressCard;
    onStartDragRef.current = onStartDrag;
  }, [card, onEndDrag, onMoveDrag, onPressCard, onStartDrag]);

  function playEditFeedback(nextCard: DashboardCard) {
    editFeedback.stopAnimation();
    editFeedback.setValue(0);

    Animated.sequence([
      Animated.timing(editFeedback, {
        toValue: 1,
        duration: 40,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(editFeedback, {
        toValue: 0,
        duration: 50,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => onPressCardRef.current?.(nextCard));
  }

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
          playEditFeedback(cardRef.current);
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
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.editResponder,
          {
            transform: [
              {
                scale: editFeedback.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0.965],
                }),
              },
            ],
          },
        ]}
      >
        <Pressable
          style={[styles.editCard, isActive && styles.editCardPlaceholder]}
          onPressIn={() => onStartDrag(card)}
          onPress={() => {
            onEndDrag();
            playEditFeedback(card);
          }}
        >
          {children}
        </Pressable>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.editTapGlow,
            {
              opacity: editFeedback.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.22],
              }),
            },
          ]}
        />
        <Pressable
          accessibilityLabel={`Remove ${label}`}
          style={({ pressed }) => [
            styles.removeBadge,
            pressed && styles.removeBadgePressed,
          ]}
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
  columns,
  label,
  metricId,
  rows,
  value,
}: {
  colors: ThemeColors;
  columns: number;
  label: string;
  metricId: DashboardCard['metricId'];
  rows: number;
  value: string;
}) {
  const styles = createStyles(colors);
  const scale = Math.pow(columns * rows, 0.78);
  const isHeartRateMessage =
    metricId === 'heartRateCurrent' && !/^\d+\s*bpm$/i.test(value);
  const valueFontSize = Math.min(
    104,
    Math.round(13 + scale * (isHeartRateMessage ? 3 : 11.5)),
  );
  const labelFontSize = Math.min(22, Math.round(8 + scale * 2.2));
  const labelLineHeight = Math.round(labelFontSize * 1.15);

  return (
    <View style={styles.metricContent}>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[
          styles.metricLabel,
          { fontSize: labelFontSize, lineHeight: labelLineHeight },
        ]}
      >
        {label}
      </Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={isHeartRateMessage ? 3 : 1}
        style={[
          styles.metricValue,
          isHeartRateMessage && styles.metricMessageValue,
          {
            fontSize: valueFontSize,
            lineHeight: isHeartRateMessage
              ? Math.round(valueFontSize * 0.96)
              : undefined,
          },
        ]}
      >
        {value}
      </Text>
    </View>
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
    holdCard: {
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    holdTapGlow: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderWidth: 2,
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    mapContent: {
      flex: 1,
    },
    metricCard: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      justifyContent: 'center',
      backgroundColor: colors.card,
      padding: 8,
    },
    metricContent: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
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
    editTapGlow: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderWidth: 2,
      borderColor: colors.accent,
      backgroundColor: colors.accent,
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
    removeBadgePressed: {
      opacity: 0.76,
      transform: [{ scale: 0.9 }],
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
    addTilePressed: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      transform: [{ scale: 0.985 }],
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
      fontWeight: '800',
      includeFontPadding: false,
      letterSpacing: 0.8,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    metricValue: {
      marginTop: 4,
      color: colors.primaryText,
      fontWeight: '900',
      includeFontPadding: false,
      textAlign: 'center',
    },
    metricMessageValue: {
      width: '100%',
      flexShrink: 1,
    },
  });
}
