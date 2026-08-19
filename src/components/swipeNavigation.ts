export type PlaybackSwipeDirection = 'next' | 'previous';

export function getHorizontalSwipeDirection(
  deltaX: number,
  deltaY: number,
  velocityX = 0,
): PlaybackSwipeDirection | null {
  const horizontalEnough = Math.abs(deltaX) > Math.abs(deltaY) * 0.75;
  const crossedDistance = Math.abs(deltaX) >= 18;
  const flicked = Math.abs(deltaX) >= 6 && Math.abs(velocityX) >= 0.15;

  if (!horizontalEnough || (!crossedDistance && !flicked)) return null;

  const projectedX = deltaX + velocityX * 28;
  return projectedX < 0 ? 'next' : 'previous';
}
