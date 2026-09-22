import { AssetType, AssetTypeConfig } from '@/types';

export const ASSET_CONFIG: Record<AssetType, AssetTypeConfig> = {
  [AssetType.CASH]: { label: '\u73b0\u91d1', color: '#1f9d72' },
  [AssetType.STOCK]: { label: '\u80a1\u7968', color: '#3559d7' },
  [AssetType.BOND]: { label: '\u503a\u5238', color: '#d99b32' },
  [AssetType.FUND]: { label: '\u57fa\u91d1', color: '#7d5bc6' },
  [AssetType.PROPERTY]: { label: '\u623f\u4ea7', color: '#d16a56' },
  [AssetType.OTHER]: { label: '\u5176\u4ed6', color: '#7c8799' },
};
