import type { PlannedRoute, RouteCoordinate } from './types';

type DirectionsResponse = {
  status: string;
  error_message?: string;
  routes?: {
    overview_polyline?: {
      points?: string;
    };
    legs?: {
      distance?: {
        text?: string;
      };
      duration?: {
        text?: string;
      };
    }[];
  }[];
};

export type PlanBikeRouteInput = {
  destination: string;
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

export async function planBikeRoute({
  destination,
  origin,
}: PlanBikeRouteInput): Promise<PlannedRoute> {
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    throw new Error('Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to plan routes.');
  }

  const params = new URLSearchParams({
    alternatives: 'false',
    destination,
    key: googleMapsApiKey,
    mode: 'bicycling',
    origin: `${origin.latitude},${origin.longitude}`,
  });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error('Google Directions request failed.');
  }

  const directions = (await response.json()) as DirectionsResponse;
  const route = directions.routes?.[0];
  const encodedPolyline = route?.overview_polyline?.points;

  if (directions.status !== 'OK' || !route || !encodedPolyline) {
    throw new Error(
      directions.error_message ??
        `Google could not plan a bicycling route (${directions.status}).`,
    );
  }

  const firstLeg = route.legs?.[0];

  return {
    destination,
    distanceText: firstLeg?.distance?.text ?? 'Unknown distance',
    durationText: firstLeg?.duration?.text ?? 'Unknown time',
    coordinates: decodePolyline(encodedPolyline),
  };
}
