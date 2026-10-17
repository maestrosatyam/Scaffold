// Keys of the original SVG pictograms shipped with the MCP Apps (drawn for this project,
// see src/apps/pictograms.ts). Kept in a dependency-free module so the server can validate
// routines without loading any UI code.
export const PICTOGRAM_KEYS = [
  'toothbrush',
  'face-wash',
  'shirt',
  'cereal',
  'backpack',
  'key',
  'basket',
  'washer',
  'detergent',
  'start-button',
  'shower',
  'bed',
  'cup',
  'plate',
  'shoe',
  'bus',
  'phone',
  'broom',
  'clock',
  'step',
] as const;
export type PictogramKey = (typeof PICTOGRAM_KEYS)[number];
