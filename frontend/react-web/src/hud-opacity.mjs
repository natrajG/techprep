// The slider fades only the card background. Below this floor the near-white text loses its backing.
export const MIN_HUD_OPACITY = 0.7;
export const DEFAULT_HUD_OPACITY = 0.85;

export function clampHudOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_HUD_OPACITY;
  return Math.min(1, Math.max(MIN_HUD_OPACITY, number));
}
