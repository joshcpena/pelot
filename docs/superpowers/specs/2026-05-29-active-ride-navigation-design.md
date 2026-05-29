# Active Ride Navigation Design

## Context

Pelot currently keeps Active Ride Navigation behavior in `app/index.tsx`, while provider parsing and recent destination persistence live in `src/features/ride/routePlanning.ts`. This makes the Home route responsible for origin choice, destination search state, selected destination state, recent destinations, off-route detection, reroute cooldowns, and provider error handling.

This design deepens Active Ride Navigation into one module whose interface is the test surface. The implementation will preserve existing behavior while placing provider and platform mechanics behind adapters.

## Goals

- Preserve current route search, route planning, recent destination, cancel, and reroute behavior.
- Move Active Ride Navigation policy out of `HomeScreen`.
- Keep foreground location permission and current-position mechanics behind an origin adapter.
- Put MapTiler, OpenRouteService, recent destination storage, and time behind explicit adapters.
- Make search/select/cancel/reroute behavior testable without rendering the Home route or native map.

## Non-Goals

- Do not change route provider behavior, request parameters, thresholds, or user-facing error messages.
- Do not redesign the route planner UI.
- Do not change MapLibre rendering or navigation HUD behavior.
- Do not change ride recording metrics or foreground/background recording ownership.

## Architecture

Active Ride Navigation becomes a deep module under `src/features/ride/`. The Home route remains the renderer and user-event caller. The new module owns navigation state transitions and policy:

- Search query and destination options.
- Recent destination loading and remembering.
- Origin selection for search and planning.
- Planned route and selected destination lifecycle.
- Cancel behavior.
- Off-route detection, in-flight reroute state, and reroute cooldown.
- Error state for search, planning, and reroute failures.

The main seam is Active Ride Navigation, not MapTiler or OpenRouteService. Provider modules are adapters behind that seam.

## Adapters

The Active Ride Navigation implementation depends on these adapters:

- `origin`: hides Expo location permission/current-position mechanics and returns either a `RouteCoordinate` or a ride-level failure.
- `placeSearch`: searches destinations from an origin. The production adapter uses MapTiler.
- `routePlanner`: plans a bike route from an origin to a destination. The production adapter uses OpenRouteService.
- `recents`: loads, saves, and normalizes recent route destinations. The production adapter uses the existing settings table storage.
- `clock`: returns the current timestamp so cooldown behavior is deterministic in tests.

`routePlanning.ts` should be split or reshaped so MapTiler search, OpenRouteService route planning, and recent destination storage are explicit production adapters. Existing exports can remain temporarily as compatibility shims, but callers outside Active Ride Navigation should stop coordinating provider calls directly.

## External Interface

The first implementation should expose a hook-shaped interface because the current caller is React stateful:

```ts
const navigation = useActiveRideNavigation({
  rideStatus,
  routePoints,
  currentCoordinate,
  routeProfile,
  adapters,
});
```

The returned interface should expose state and intentions, not provider mechanics:

```ts
{
  destinationInput,
  destinationOptions,
  recentDestinations,
  plannedRoute,
  selectedDestination,
  isPlannerOpen,
  routePlanError,
  isSearchingDestinations,
  isPlanningRoute,
  setDestinationInput,
  openPlanner,
  closePlanner,
  searchDestinations,
  clearDestinationInput,
  selectDestination,
  cancelNavigation,
  maybeReroute,
}
```

This interface is intentionally wider than a pure state machine. Its depth comes from hiding ordering constraints that currently live in the Home route.

## Behavior

`searchDestinations()`:

- Trims the destination input.
- Sets `Enter a destination first.` for an empty query.
- Clears stale planned route and selected destination state.
- Gets an origin through the origin adapter.
- Calls the place search adapter.
- Stores the route search origin.
- Exposes provider failures as the current user-facing error text.

`selectDestination(destination)`:

- Sets the input text to the selected destination name.
- Uses the stored search origin when available.
- Otherwise asks the origin adapter for a fresh origin.
- Calls the route planning adapter.
- Stores the planned route and selected destination.
- Clears destination options and route search origin.
- Remembers the selected destination through the recents adapter.
- Closes the planner state.

`openPlanner()`:

- Sets planner state open through the Active Ride Navigation interface.
- Loads recent destinations through the recents adapter.
- Ignores recents load failures, preserving current behavior.

`closePlanner()`:

- Sets planner state closed through the Active Ride Navigation interface.
- Leaves keyboard dismissal and keyboard-height state in the Home route because those are UI-specific.

`clearDestinationInput()`:

- Clears the input, destination options, route search origin, and current route planning error.
- Leaves focus management in the Home route because it is UI-specific.

`cancelNavigation()`:

- Clears the planned route, selected destination, route search origin, destination options, and route planning error.

`maybeReroute()`:

- Does nothing unless the ride is recording, a planned route exists, and a destination is selected.
- Uses the current coordinate when available, otherwise the latest route point.
- Does nothing when the route has fewer than two coordinates.
- Uses the existing 75 meter off-route threshold.
- Uses the existing 30 second reroute cooldown.
- Suppresses duplicate reroutes while one is in flight.
- On success, replaces the planned route and clears the error.
- On failure, sets the current error text and preserves the planned route and selected destination.

## Error Handling

User-facing behavior stays the same:

- Empty search input: `Enter a destination first.`
- Missing location permission: `Location permission is required to plan a route.`
- MapTiler and OpenRouteService failures keep their existing messages.
- Unknown search failure: `Could not search destinations.`
- Unknown route planning failure: `Could not plan bike route.`
- Unknown reroute failure: `Could not reroute.`
- Recent destination load/save failures remain nonblocking.

The origin adapter should translate platform-level permission failures into the existing route-planning message so Active Ride Navigation does not import Expo permission types.

## Testing

Tests should hit the Active Ride Navigation interface and fake adapters.

Cover:

- Origin fallback order: active ride coordinate, last ride point, last known position, cached origin, current position.
- Search behavior: trims query, rejects empty query, clears stale planned route and selection, stores search origin.
- Select behavior: uses stored search origin when present, plans route, remembers destination, closes planner state.
- Cancel behavior: clears route, destination, search origin, options, and error.
- Reroute behavior: no route/no destination/not recording does nothing, inside threshold does nothing, outside threshold replans, cooldown suppresses repeated calls, failed reroute preserves current route.
- Recents behavior: normalizes, dedupes, caps, and ignores load/save failures where current behavior does.
- Provider adapter behavior: MapTiler parsing, OpenRouteService parsing, missing-key errors, no-result errors.

## Migration Notes

The first implementation should be behavior-preserving and can move in this order:

1. Extract route geometry needed for off-route checks into the Active Ride Navigation implementation or an internal helper.
2. Introduce adapter types and production adapters for current `routePlanning.ts` behavior.
3. Add the Active Ride Navigation hook with fake-adapter tests.
4. Replace Home route search/select/cancel/reroute state with the new module interface.
5. Keep `RideMap` props unchanged for the first pass.

## Open Decisions

- The heavy approach is approved: use explicit adapters now instead of a light extraction.
- Active Ride Navigation owns both pre-ride planning and active-ride rerouting.
- Location permission mechanics stay behind an origin adapter.
- Current behavior should be preserved.
