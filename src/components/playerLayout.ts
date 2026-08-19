const PLAYER_HORIZONTAL_PADDING = 24;

export function getPlayerLayout(viewportWidth: number, viewportHeight: number) {
  const contentWidth = Math.max(0, viewportWidth - PLAYER_HORIZONTAL_PADDING * 2);

  return {
    artworkSize: Math.min(320, contentWidth, viewportHeight * 0.34),
  };
}
