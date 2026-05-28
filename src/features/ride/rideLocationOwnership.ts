export function shouldPersistBackgroundRidePoint(
  appState: string | null | undefined,
) {
  return appState !== 'active';
}
