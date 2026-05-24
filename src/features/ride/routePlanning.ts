import type {
  DestinationOption,
  PlannedRoute,
  RouteCoordinate,
} from './types';

type PlacesTextSearchResponse = {
  places?: {
    id?: string;
    displayName?: {
      text?: string;
    };
    formattedAddress?: string;
    location?: RouteCoordinate;
  }[];
  error?: {
    message?: string;
  };
};

type RoutesResponse = {
  routes?: {
    distanceMeters?: number;
    duration?: string;
    polyline?: {
      encodedPolyline?: string;
    };
    legs?: {
      steps?: {
        distanceMeters?: number;
        navigationInstruction?: {
          instructions?: string;
          maneuver?: string;
        };
        polyline?: {
          encodedPolyline?: string;
        };
      }[];
    }[];
  }[];
  error?: {
    message?: string;
  };
};

type GoogleErrorResponse = {
  error?: {
    message?: string;
    status?: string;
  };
};

export type PlanBikeRouteInput = {
  destination: DestinationOption;
  origin: RouteCoordinate;
};

export type SearchDestinationsInput = {
  query: string;
  origin: RouteCoordinate;
};

function decodePolyline(polyline: string): RouteCoordinate[] {
  const coordinates: RouteCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < polyline.length) {
    let byte = 0;
    let shift = 0;
    let result = 0;

    do {
      byte = polyline.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;

    do {
      byte = polyline.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({
      latitude: latitude / 100000,
      longitude: longitude / 100000,
    });
  }

  return coordinates;
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

function formatDuration(duration: string | undefined) {
  const seconds = Number(duration?.replace(/s$/, ''));

  if (!Number.isFinite(seconds)) {
    return 'Unknown time';
  }

  const roundedMinutes = Math.max(1, Math.round(seconds / 60));
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

async function getGoogleErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as GoogleErrorResponse;
    const message = body.error?.message;
    const status = body.error?.status;

    if (message && status) {
      return `${fallback} (${status}): ${message}`;
    }

    if (message) {
      return `${fallback}: ${message}`;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export async function searchBikeDestinations({
  query,
  origin,
}: SearchDestinationsInput): Promise<DestinationOption[]> {
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    throw new Error('Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to search places.');
  }

  const destination = query.trim();

  if (!destination) {
    return [];
  }

  return searchDestinations(destination, origin, googleMapsApiKey);
}

async function searchDestinations(
  destination: string,
  origin: RouteCoordinate,
  googleMapsApiKey: string,
) {
  const response = await fetch(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleMapsApiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery: destination,
        locationBias: {
          circle: {
            center: origin,
            radius: 50000,
          },
        },
        maxResultCount: 8,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await getGoogleErrorMessage(response, 'Google Places request failed'),
    );
  }

  const places = (await response.json()) as PlacesTextSearchResponse;
  const options =
    places.places
      ?.filter((candidate) => candidate.location)
      .map((place, index) => ({
        id:
          place.id ??
          `${place.location?.latitude ?? 0},${place.location?.longitude ?? 0},${index}`,
        name: place.displayName?.text ?? place.formattedAddress ?? destination,
        address: place.formattedAddress ?? null,
        coordinate: place.location as RouteCoordinate,
      })) ?? [];

  if (options.length === 0) {
    throw new Error(
      places.error?.message ?? 'Google Places could not find that destination.',
    );
  }

  return options;
}

export async function planBikeRoute({
  destination,
  origin,
}: PlanBikeRouteInput): Promise<PlannedRoute> {
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    throw new Error('Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to plan routes.');
  }

  const response = await fetch(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleMapsApiKey,
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: origin } },
        destination: { location: { latLng: destination.coordinate } },
        travelMode: 'BICYCLE',
        computeAlternativeRoutes: false,
        polylineQuality: 'HIGH_QUALITY',
        polylineEncoding: 'ENCODED_POLYLINE',
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await getGoogleErrorMessage(response, 'Google Routes request failed'),
    );
  }

  const routes = (await response.json()) as RoutesResponse;
  const route = routes.routes?.[0];
  const encodedPolyline = route?.polyline?.encodedPolyline;

  if (!route || !encodedPolyline) {
    throw new Error(
      routes.error?.message ?? 'Google could not plan a bicycling route.',
    );
  }

  const coordinates = decodePolyline(encodedPolyline);
  const steps =
    route.legs
      ?.flatMap((leg) => leg.steps ?? [])
      .map((step, index) => ({
        instruction:
          step.navigationInstruction?.instructions ??
          step.navigationInstruction?.maneuver?.replace(/_/g, ' ') ??
          (index === 0 ? `Head toward ${destination.name}` : 'Continue'),
        distanceMeters: step.distanceMeters ?? null,
        coordinates: step.polyline?.encodedPolyline
          ? decodePolyline(step.polyline.encodedPolyline)
          : [],
      })) ?? [];

  return {
    destination: destination.name,
    distanceText: formatDistance(route.distanceMeters),
    durationText: formatDuration(route.duration),
    coordinates,
    steps:
      steps.length > 0
        ? steps
        : [
            {
              instruction: `Navigate to ${destination.name}`,
              distanceMeters: route.distanceMeters ?? null,
              coordinates,
            },
          ],
  };
}
