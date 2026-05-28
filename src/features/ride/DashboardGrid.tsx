import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Svg, { Line, Path } from 'react-native-svg';
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
import {
  DASHBOARD_MAX_ROWS,
  dashboardMetricById,
  getDashboardSpanDimensions,
  type DashboardValueContext,
} from './dashboard';
import {
  GARMIN_HEART_RATE_ZONES,
  HEART_RATE_ZONE_COLORS,
  getEffectiveMaxHeartRateBpm,
  getHeartRateZone,
  getHeartRateZoneLabel,
  type HeartRateZoneResult,
} from './heartRateZones';
import { RideMap } from './RideMap';
import type { DashboardCard, DashboardMetricId, RideSettings } from './types';

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

type DashboardMapTileMode = 'live' | 'slot';

const ENTER_EDIT_DELAY_MS = 550;
const GAUGE_START_ANGLE = -110;
const GAUGE_ARC_DEGREES = 220;
const GAUGE_CENTER_X = 56;
const GAUGE_CENTER_Y = 63;
const GAUGE_RADIUS = 43;
const GAUGE_ZONE_GAP_DEGREES = 0;
const GAUGE_NEEDLE_INNER_RADIUS = 34.5;
const GAUGE_NEEDLE_OUTER_RADIUS = 51.5;

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

export function DashboardGrid({
  colors,
  context,
  layout,
  settings,
  rowHeight = 66,
  canAddCard = true,
  mapTileMode = 'live',
  metricValues,
  onLongPressCard,
  onLongPressEmpty,
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
  canAddCard?: boolean;
  mapTileMode?: DashboardMapTileMode;
  metricValues?: Map<DashboardMetricId, string>;
  onLongPressCard?: (card: DashboardCard) => void;
  onLongPressEmpty?: () => void;
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

  function renderMapContent(
    card: DashboardCard,
    shouldHandleLongPress: boolean,
  ) {
    if (mapTileMode === 'slot') {
      return (
        <View style={styles.mapContent}>
          <DashboardMapSlotPlaceholder styles={styles} />
        </View>
      );
    }

    return (
      <View style={styles.mapContent}>
        <RideMap
          destinationOptions={context.destinationOptions}
          isNavigating={context.isNavigating}
          onCancelNavigation={onCancelNavigation}
          onLongPress={
            shouldHandleLongPress && !isEditing && onLongPressCard
              ? () => onLongPressCard(card)
              : undefined
          }
          points={context.routePoints}
          liveRideCoordinate={context.currentCoordinate}
          mapType={settings.mapType}
          plannedRoute={context.plannedRoute}
          rideStatus={context.rideStatus}
          unitSystem={settings.unitSystem}
        />
      </View>
    );
  }

  const cards = layout.map((card) => {
    const metric = dashboardMetricById.get(card.metricId);

    if (!metric) {
      return null;
    }

    const { columns, rows } = getDashboardSpanDimensions(card.span);
    const width = `${(columns / 3) * 100}%` as DimensionValue;
    const height = rows * rowHeight;
    const cardStyle = { width, height };
    const content =
      card.metricId === 'map'
        ? renderMapContent(card, true)
        : renderMetricContent(card, metric.label, columns, rows);

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

  const gridHeight = rowHeight * DASHBOARD_MAX_ROWS;
  const emptySpaceLongPressHandler = !isEditing ? onLongPressEmpty : undefined;

  const grid = (
    <View
      style={[
        styles.grid,
        emptySpaceLongPressHandler ? { minHeight: gridHeight } : null,
      ]}
    >
      {emptySpaceLongPressHandler ? (
        <DashboardEmptySpaceEditTarget
          onLongPress={emptySpaceLongPressHandler}
          showLabel={layout.length === 0}
          styles={styles}
        />
      ) : null}
      {cards}
      {isEditing && canAddCard ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.addTile,
            { height: rowHeight },
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

    const { columns } = getDashboardSpanDimensions(card.span);

    return card.metricId === 'map'
      ? renderMapContent(card, false)
      : renderMetricContent(
          card,
          metric.label,
          columns,
          getDashboardSpanDimensions(card.span).rows,
        );
  }

  function renderMetricContent(
    card: DashboardCard,
    label: string,
    columns: number,
    rows: number,
  ) {
    if (card.metricId === 'heartRateZoneBar') {
      return (
        <HeartRateZoneBarContent
          colors={colors}
          columns={columns}
          context={context}
          rows={rows}
        />
      );
    }

    if (card.metricId === 'heartRateZoneGauge') {
      return (
        <HeartRateZoneGaugeContent
          colors={colors}
          columns={columns}
          context={context}
          rows={rows}
        />
      );
    }

    const metric = dashboardMetricById.get(card.metricId);

    return (
      <MetricCardContent
        colors={colors}
        metricId={card.metricId}
        label={label}
        columns={columns}
        rows={rows}
        value={
          metricValues?.get(card.metricId) ?? metric?.getValue(context) ?? '--'
        }
      />
    );
  }
}

function DashboardMapSlotPlaceholder({
  styles,
}: {
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.mapSlotPlaceholder}>
      <View style={styles.mapSlotHorizon} />
      <Text style={styles.mapSlotLabel}>Map</Text>
    </View>
  );
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
  const cardLabel =
    dashboardMetricById.get(card.metricId)?.label ?? 'Dashboard metric';

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
        accessibilityHint="Press and hold to edit this metric."
        accessibilityLabel={cardLabel}
        accessibilityRole="button"
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
          accessibilityHint="Drag to reorder, or tap to customize this metric."
          accessibilityLabel={label}
          accessibilityRole="button"
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
          accessibilityRole="button"
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

function DashboardEmptySpaceEditTarget({
  onLongPress,
  showLabel,
  styles,
}: {
  onLongPress: () => void;
  showLabel: boolean;
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
        styles.emptyDashboardTarget,
        {
          transform: [
            {
              scale: holdFeedback.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.985],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityHint="Press and hold to edit this dashboard screen."
        accessibilityLabel="Empty dashboard screen"
        accessibilityRole="button"
        delayLongPress={ENTER_EDIT_DELAY_MS}
        onLongPress={onLongPress}
        onPressIn={startHoldFeedback}
        onPressOut={resetHoldFeedback}
        style={styles.emptyDashboardPressable}
      >
        {showLabel ? (
          <Text style={styles.emptyDashboardText}>No metrics</Text>
        ) : null}
      </Pressable>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.emptyDashboardGlow,
          {
            opacity: holdFeedback.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.16],
            }),
          },
        ]}
      />
    </Animated.View>
  );
}

type HeartRateZoneRenderState =
  | {
      kind: 'ready';
      result: HeartRateZoneResult;
    }
  | {
      kind: 'message';
      title: string;
      detail: string;
    };

function getHeartRateZoneRenderState(
  context: DashboardValueContext,
): HeartRateZoneRenderState {
  if (!context.settings.connectedHeartRateDevice) {
    return {
      kind: 'message',
      title: 'No device',
      detail: 'Heart rate',
    };
  }

  if (context.heartRateStatus === 'connecting') {
    return {
      kind: 'message',
      title: 'Connecting',
      detail: context.settings.connectedHeartRateDevice.name,
    };
  }

  if (context.heartRateStatus === 'error') {
    return {
      kind: 'message',
      title: 'Error',
      detail: context.heartRateError ?? 'Heart rate unavailable',
    };
  }

  if (context.heartRateBpm == null) {
    return {
      kind: 'message',
      title: 'Waiting',
      detail: context.settings.connectedHeartRateDevice.name,
    };
  }

  const maxHeartRate = getEffectiveMaxHeartRateBpm(context.settings);

  if (!maxHeartRate) {
    return {
      kind: 'message',
      title: 'Set max HR',
      detail: 'Or add age',
    };
  }

  const result = getHeartRateZone(context.heartRateBpm, maxHeartRate.bpm);

  if (!result) {
    return {
      kind: 'message',
      title: '--',
      detail: 'Heart rate',
    };
  }

  return { kind: 'ready', result };
}

function HeartRateZoneMessage({
  colors,
  detail,
  title,
}: {
  colors: ThemeColors;
  detail: string;
  title: string;
}) {
  const styles = createStyles(colors);

  return (
    <View style={styles.hrZoneMessage}>
      <Text
        adjustsFontSizeToFit
        numberOfLines={2}
        style={styles.hrZoneMessageTitle}
      >
        {title}
      </Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={2}
        style={styles.hrZoneMessageDetail}
      >
        {detail}
      </Text>
    </View>
  );
}

function HeartRateZoneBarContent({
  colors,
  columns,
  context,
  rows,
}: {
  colors: ThemeColors;
  columns: number;
  context: DashboardValueContext;
  rows: number;
}) {
  const styles = createStyles(colors);
  const state = getHeartRateZoneRenderState(context);

  if (state.kind === 'message') {
    return (
      <HeartRateZoneMessage
        colors={colors}
        detail={state.detail}
        title={state.title}
      />
    );
  }

  const { result } = state;
  const label = getHeartRateZoneLabel(result);
  const zoneColor = getZoneColor(result);
  const isCompact = rows <= 1;
  const scale = Math.pow(columns * rows, 0.68);
  const bpmFontSize = Math.min(70, Math.round(20 + scale * 10));
  const zoneFontSize = Math.min(
    isCompact ? 36 : 60,
    Math.round(16 + scale * 8.5),
  );
  const zoneLabelMaxWidth = columns < 2 ? '54%' : '68%';
  const readoutMinHeight = Math.min(
    isCompact ? 44 : 116,
    Math.max(isCompact ? 36 : 58, rows * 28),
  );

  return (
    <View
      style={[
        styles.hrZoneBarContent,
        isCompact && styles.hrZoneBarContentCompact,
      ]}
    >
      <View
        style={[
          styles.hrZoneBarHeader,
          isCompact && styles.hrZoneBarHeaderCompact,
        ]}
      >
        <Text style={styles.hrZoneKicker}>HR Zone</Text>
      </View>
      <View
        style={[
          styles.hrZoneBarReadout,
          { minHeight: readoutMinHeight },
          isCompact && styles.hrZoneBarReadoutCompact,
        ]}
      >
        <View style={styles.hrZoneBpmRow}>
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            style={[
              styles.hrZoneBpm,
              { color: zoneColor, fontSize: bpmFontSize },
            ]}
          >
            {result.bpm}
          </Text>
        </View>
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          style={[
            styles.hrZoneLabel,
            {
              color: zoneColor,
              fontSize: zoneFontSize,
              maxWidth: zoneLabelMaxWidth,
            },
          ]}
        >
          {label}
        </Text>
      </View>
      <HeartRateZoneTrack
        colors={colors}
        isCompact={isCompact}
        markerProgress={result.markerProgress}
      />
    </View>
  );
}

function HeartRateZoneTrack({
  colors,
  isCompact,
  markerProgress,
}: {
  colors: ThemeColors;
  isCompact: boolean;
  markerProgress: number;
}) {
  const styles = createStyles(colors);

  return (
    <View
      style={[
        styles.hrZoneTrackWrap,
        isCompact && styles.hrZoneTrackWrapCompact,
      ]}
    >
      <View style={styles.hrZoneTrack}>
        {HEART_RATE_ZONE_COLORS.map((color, index) => (
          <View
            key={color}
            style={[
              styles.hrZoneTrackSegment,
              { backgroundColor: color },
              index > 0 && styles.hrZoneTrackSegmentGap,
            ]}
          />
        ))}
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.hrZoneBarMarker,
          {
            left: `${markerProgress * 100}%`,
          },
        ]}
      />
    </View>
  );
}

function HeartRateZoneGaugeContent({
  colors,
  columns,
  context,
  rows,
}: {
  colors: ThemeColors;
  columns: number;
  context: DashboardValueContext;
  rows: number;
}) {
  const styles = createStyles(colors);
  const state = getHeartRateZoneRenderState(context);

  if (state.kind === 'message') {
    return (
      <HeartRateZoneMessage
        colors={colors}
        detail={state.detail}
        title={state.title}
      />
    );
  }

  const { result } = state;
  const label = getHeartRateZoneLabel(result);
  const zoneColor = getZoneColor(result);
  const needleAngle =
    GAUGE_START_ANGLE + result.markerProgress * GAUGE_ARC_DEGREES;
  const needleStart = getGaugePoint(needleAngle, GAUGE_NEEDLE_INNER_RADIUS);
  const needleEnd = getGaugePoint(needleAngle, GAUGE_NEEDLE_OUTER_RADIUS);
  const scale = Math.pow(columns * rows, 0.72);
  const bpmFontSize = Math.min(76, Math.round(18 + scale * 9.8));
  const gaugeVisualHeight = Math.min(230, Math.max(86, rows * 49));
  const gaugeLabelFontSize = Math.min(42, Math.round(13 + scale * 3.7));

  return (
    <View style={styles.hrZoneGaugeContent}>
      <View style={styles.hrZoneGaugeHeader}>
        <Text style={styles.hrZoneKicker}>HR Zone</Text>
      </View>
      <View style={styles.hrZoneGaugeStack}>
        <View style={[styles.hrZoneGaugeVisual, { height: gaugeVisualHeight }]}>
          <Svg
            height="100%"
            viewBox="0 0 112 92"
            width="100%"
            preserveAspectRatio="xMidYMid meet"
          >
            <Path
              d={getGaugeArcPath(GAUGE_START_ANGLE, GAUGE_START_ANGLE + 220)}
              fill="none"
              stroke={colors.border}
              strokeLinecap="butt"
              strokeWidth={13}
            />
            {GARMIN_HEART_RATE_ZONES.map((zoneDefinition, index) => {
              const zoneArcStart =
                GAUGE_START_ANGLE +
                index * (GAUGE_ARC_DEGREES / GARMIN_HEART_RATE_ZONES.length) +
                GAUGE_ZONE_GAP_DEGREES / 2;
              const zoneArcEnd =
                GAUGE_START_ANGLE +
                (index + 1) *
                  (GAUGE_ARC_DEGREES / GARMIN_HEART_RATE_ZONES.length) -
                GAUGE_ZONE_GAP_DEGREES / 2;

              return (
                <Path
                  key={zoneDefinition.zone}
                  d={getGaugeArcPath(zoneArcStart, zoneArcEnd)}
                  fill="none"
                  stroke={HEART_RATE_ZONE_COLORS[index]}
                  strokeLinecap="butt"
                  strokeWidth={13}
                />
              );
            })}
            <Line
              stroke="#000"
              strokeLinecap="butt"
              strokeWidth={3}
              x1={needleStart.x}
              x2={needleEnd.x}
              y1={needleStart.y}
              y2={needleEnd.y}
            />
          </Svg>
          <View style={styles.hrZoneGaugeReadout}>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={[
                styles.hrZoneBpm,
                { color: zoneColor, fontSize: bpmFontSize },
              ]}
            >
              {result.bpm}
            </Text>
          </View>
        </View>
        <Text
          adjustsFontSizeToFit
          numberOfLines={1}
          style={[
            styles.hrZoneGaugeLabel,
            { color: zoneColor, fontSize: gaugeLabelFontSize },
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

function getZoneColor(result: HeartRateZoneResult) {
  if (!result.zone) {
    return result.state === 'below'
      ? HEART_RATE_ZONE_COLORS[0]
      : HEART_RATE_ZONE_COLORS[HEART_RATE_ZONE_COLORS.length - 1];
  }

  return HEART_RATE_ZONE_COLORS[result.zone.zone - 1];
}

function getGaugePoint(angle: number, radius: number) {
  const radians = ((angle - 90) * Math.PI) / 180;

  return {
    x: GAUGE_CENTER_X + radius * Math.cos(radians),
    y: GAUGE_CENTER_Y + radius * Math.sin(radians),
  };
}

function getGaugeArcPath(startAngle: number, endAngle: number) {
  const start = getGaugePoint(startAngle, GAUGE_RADIUS);
  const end = getGaugePoint(endAngle, GAUGE_RADIUS);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 ${largeArcFlag} 1`,
    `${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
  ].join(' ');
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
      position: 'relative',
      zIndex: 1,
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    holdCard: {
      position: 'relative',
      zIndex: 1,
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
    mapSlotPlaceholder: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    mapSlotHorizon: {
      position: 'absolute',
      right: -24,
      bottom: -36,
      left: -24,
      height: '58%',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
      transform: [{ rotate: '-7deg' }],
    },
    mapSlotLabel: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 0,
      textTransform: 'uppercase',
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
    hrZoneMessage: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
    },
    hrZoneMessageTitle: {
      width: '100%',
      color: colors.primaryText,
      fontSize: 24,
      fontWeight: '900',
      includeFontPadding: false,
      textAlign: 'center',
    },
    hrZoneMessageDetail: {
      width: '100%',
      marginTop: 5,
      color: colors.mutedText,
      fontSize: 11,
      fontWeight: '800',
      includeFontPadding: false,
      letterSpacing: 0.4,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    hrZoneBarContent: {
      flex: 1,
      position: 'relative',
      justifyContent: 'center',
      gap: 7,
      padding: 10,
    },
    hrZoneBarContentCompact: {
      justifyContent: 'flex-start',
      gap: 0,
      paddingTop: 0,
      paddingBottom: 0,
    },
    hrZoneBarHeader: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    hrZoneBarHeaderCompact: {
      position: 'absolute',
      top: 2,
      right: 0,
      left: 0,
      zIndex: 2,
    },
    hrZoneGaugeHeader: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    hrZoneKicker: {
      color: colors.mutedText,
      fontSize: 10,
      fontWeight: '900',
      includeFontPadding: false,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    hrZoneBarReadout: {
      position: 'relative',
      minHeight: 54,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hrZoneBarReadoutCompact: {
      position: 'absolute',
      top: 12,
      right: 0,
      left: 0,
      minHeight: 34,
    },
    hrZoneBpmRow: {
      position: 'absolute',
      left: 0,
      maxWidth: '45%',
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'flex-start',
      gap: 4,
    },
    hrZoneBpm: {
      flexShrink: 1,
      fontWeight: '900',
      includeFontPadding: false,
      letterSpacing: 0,
    },
    hrZoneLabel: {
      alignSelf: 'center',
      fontWeight: '900',
      includeFontPadding: false,
      letterSpacing: 0,
      textAlign: 'center',
    },
    hrZoneTrackWrap: {
      position: 'relative',
      paddingTop: 11,
    },
    hrZoneTrackWrapCompact: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      left: 0,
      paddingTop: 7,
    },
    hrZoneTrack: {
      height: 12,
      flexDirection: 'row',
      overflow: 'hidden',
      borderRadius: 4,
      backgroundColor: colors.border,
    },
    hrZoneTrackSegment: {
      flex: 1,
    },
    hrZoneTrackSegmentGap: {
      marginLeft: 2,
    },
    hrZoneBarMarker: {
      position: 'absolute',
      top: 4,
      width: 0,
      height: 0,
      marginLeft: -6,
      borderLeftWidth: 6,
      borderRightWidth: 6,
      borderTopWidth: 11,
      borderTopColor: '#000',
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
    },
    hrZoneGaugeContent: {
      flex: 1,
      alignItems: 'center',
      padding: 8,
    },
    hrZoneGaugeStack: {
      flex: 1,
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    hrZoneGaugeVisual: {
      width: '100%',
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    hrZoneGaugeReadout: {
      position: 'absolute',
      top: '36%',
      right: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hrZoneGaugeLabel: {
      fontWeight: '900',
      includeFontPadding: false,
      letterSpacing: 0,
      textAlign: 'center',
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
      boxShadow: '0 8px 14px rgba(0, 0, 0, 0.24)',
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
    emptyDashboardTarget: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    emptyDashboardPressable: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
      padding: 16,
    },
    emptyDashboardGlow: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderWidth: 2,
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    emptyDashboardText: {
      color: colors.mutedText,
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 0.6,
      textAlign: 'center',
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
