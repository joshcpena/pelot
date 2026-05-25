import type {
  DestinationOption,
  PlannedRoute,
  RouteProfile,
  RouteCoordinate,
} from './types';

const openRouteServiceProfiles: Record<RouteProfile, string> = {
  bike: 'cycling-regular',
  roadbike: 'cycling-road',
  mtb: 'cycling-mountain',
};

type MapTilerGeocodingResponse = {
  features?: {
    id?: string;
    text?: string;
    place_name?: string;
    place_name_en?: string;
    properties?: {
      name?: string;
      address?: string;
      locality?: string;
      region?: string;
      country?: string;
    };
    geometry?: {
      coordinates?: [number, number, ...number[]];
    };
  }[];
  message?: string;
  error?: string;
};

type OpenRouteServiceDirectionsResponse = {
  features?: {
    geometry?: {
      coordinates?: [number, number, ...number[]][];
    };
    properties?: {
      summary?: {
        distance?: number;
        duration?: number;
      };
      segments?: {
        steps?: {
          distance?: number;
          duration?: number;
          instruction?: string;
          name?: string;
          way_points?: [number, number];
        }[];
      }[];
    };
  }[];
  error?: {
    code?: number;
    message?: string;
  };
};

type ApiErrorResponse = {
  error?: {
    code?: number | string;
    message?: string;
  };
  message?: string;
  error_message?: string;
};

export type PlanBikeRouteInput = {
  destination: DestinationOption;
  origin: RouteCoordinate;
  routeProfile: RouteProfile;
};

export type SearchDestinationsInput = {
  query: string;
  origin: RouteCoordinate;
};

function toCoordinate(
  coordinate: [number, number, ...number[]],
): RouteCoordinate {
  return {
    longitude: coordinate[0],
    latitude: coordinate[1],
  };
}

function toLngLat(coordinate: RouteCoordinate) {
  return [coordinate.longitude, coordinate.latitude];
}

function getSearchBoundingBox(origin: RouteCoordinate, radiusMeters = 50000) {
  const latitudeDelta = radiusMeters / 111_320;
  const longitudeDelta =
    radiusMeters /
    (111_320 * Math.max(Math.cos((origin.latitude * Math.PI) / 180), 0.01));

  return [
    origin.longitude - longitudeDelta,
    origin.latitude - latitudeDelta,
    origin.longitude + longitudeDelta,
    origin.latitude + latitudeDelta,
  ].join(',');
}

function formatDistance(meters: number | undefined) {
  if (meters == null) {
    return 'Unknown distance';
  }

  if (meters >= 1609.344) {
    return `${(meters / 1609.344).toFixed(1)} mi`;
  }

  return `${Math.round(meters)} m`;
}

function formatDuration(seconds: number | undefined) {
  if (!Number.isFinite(seconds)) {
    return 'Unknown time';
  }

  const roundedMinutes = Math.max(1, Math.round((seconds ?? 0) / 60));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} hr ${minutes} min`;
  }

  if (hours > 0) {
    return `${hours} hr`;
  }

  return `${minutes} min`;
}

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    const code = body.error?.code;
    const message = body.error?.message ?? body.message ?? body.error_message;

    if (message && code) {
      return `${fallback} (${code}): ${message}`;
    }

    if (message) {
      return `${fallback}: ${message}`;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

async function fetchMapTilerGeocodingResults({
  destination,
  mapTilerApiKey,
  origin,
  types,
}: {
  destination: string;
  mapTilerApiKey: string;
  origin: RouteCoordinate;
  types?: string;
}) {
  const url = new URL(
    `https://api.maptiler.com/geocoding/${encodeURIComponent(destination)}.json`,
  );
  url.searchParams.set('key', mapTilerApiKey);
  url.searchParams.set('limit', '8');
  url.searchParams.set('proximity', `${origin.longitude},${origin.latitude}`);
  url.searchParams.set('bbox', getSearchBoundingBox(origin));

  if (types) {
    url.searchParams.set('types', types);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, 'MapTiler geocoding request failed'),
    );
  }

  return (await response.json()) as MapTilerGeocodingResponse;
}

function toDestinationOptions(
  results: MapTilerGeocodingResponse,
  destination: string,
) {
  return (
    results.features
      ?.filter((feature) => feature.geometry?.coordinates)
      .map((feature, index) => {
        const coordinate = feature.geometry?.coordinates;
        const address = getAddress(feature);

        return {
          id:
            feature.id ??
            `${coordinate?.[1] ?? 0},${coordinate?.[0] ?? 0},${index}`,
          name:
            feature.text ?? feature.properties?.name ?? address ?? destination,
          address,
          coordinate: toCoordinate(coordinate as [number, number, ...number[]]),
        };
      }) ?? []
  );
}

function dedupeDestinationOptions(options: DestinationOption[]) {
  const seen = new Set<string>();

  return options.filter((option) => {
    const key = `${option.name}:${option.coordinate.latitude.toFixed(6)},${option.coordinate.longitude.toFixed(6)}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getAddress(
  feature: NonNullable<MapTilerGeocodingResponse['features']>[number],
) {
  const properties = feature.properties;
  const structuredAddress = [
    properties?.address,
    properties?.locality,
    properties?.region,
    properties?.country,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    (feature.place_name ?? feature.place_name_en ?? structuredAddress) || null
  );
}

export async function searchBikeDestinations({
  query,
  origin,
}: SearchDestinationsInput): Promise<DestinationOption[]> {
  const mapTilerApiKey = process.env.EXPO_PUBLIC_MAPTILER_API_KEY;

  if (!mapTilerApiKey) {
    throw new Error('Set EXPO_PUBLIC_MAPTILER_API_KEY to search places.');
  }

  const destination = query.trim();

  if (!destination) {
    return [];
  }

  const [generalResults, poiResults] = await Promise.all([
    fetchMapTilerGeocodingResults({ destination, mapTilerApiKey, origin }),
    fetchMapTilerGeocodingResults({
      destination,
      mapTilerApiKey,
      origin,
      types: 'poi',
    }),
  ]);
  const options = dedupeDestinationOptions([
    ...toDestinationOptions(poiResults, destination),
    ...toDestinationOptions(generalResults, destination),
  ]).slice(0, 8);

  if (options.length === 0) {
    throw new Error(
      generalResults.message ??
        generalResults.error ??
        poiResults.message ??
        poiResults.error ??
        'MapTiler could not find that destination.',
    );
  }

  return options;
}

export async function planBikeRoute({
  destination,
  origin,
  routeProfile,
}: PlanBikeRouteInput): Promise<PlannedRoute> {
  const openRouteServiceApiKey =
    process.env.EXPO_PUBLIC_OPENROUTESERVICE_API_KEY;

  if (!openRouteServiceApiKey) {
    throw new Error(
      'Set EXPO_PUBLIC_OPENROUTESERVICE_API_KEY to plan bike routes.',
    );
  }

  const response = await fetch(
    `https://api.openrouteservice.org/v2/directions/${openRouteServiceProfiles[routeProfile]}/geojson`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, application/geo+json',
        Authorization: openRouteServiceApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [toLngLat(origin), toLngLat(destination.coordinate)],
        instructions: true,
        options: {
          avoid_features: ['steps', 'fords', 'ferries'],
        },
        preference: 'recommended',
        units: 'm',
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(
        response,
        'OpenRouteService route request failed',
      ),
    );
  }

  const routes = (await response.json()) as OpenRouteServiceDirectionsResponse;
  const route = routes.features?.[0];
  const routeCoordinates = route?.geometry?.coordinates;

  if (!route || !routeCoordinates || routeCoordinates.length < 2) {
    throw new Error(
      routes.error?.message ??
        'OpenRouteService could not plan a bicycling route.',
    );
  }

  const coordinates = routeCoordinates.map(toCoordinate);
  const steps =
    route.properties?.segments
      ?.flatMap((segment) => segment.steps ?? [])
      .map((step, index) => {
        const wayPoints = step.way_points;
        const stepCoordinates = wayPoints
          ? coordinates.slice(wayPoints[0], wayPoints[1] + 1)
          : [];

        return {
          instruction:
            step.instruction ??
            step.name ??
            (index === 0 ? `Head toward ${destination.name}` : 'Continue'),
          streetName: step.name?.trim() || null,
          distanceMeters: step.distance ?? null,
          coordinates: stepCoordinates,
        };
      }) ?? [];
  const distanceMeters = route.properties?.summary?.distance;
  const durationSeconds = route.properties?.summary?.duration;

  return {
    destination: destination.name,
    distanceText: formatDistance(distanceMeters),
    durationText: formatDuration(durationSeconds),
    coordinates,
    steps:
      steps.length > 0
        ? steps
        : [
            {
              instruction: `Navigate to ${destination.name}`,
              streetName: destination.name,
              distanceMeters: distanceMeters ?? null,
              coordinates,
            },
          ],
  };
}
