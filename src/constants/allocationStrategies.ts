import { AssetType } from '@/types';

export interface AllocationStrategy {
  id: string;
  name: string;
  description: string;
  riskLevel: string;
  weights: Partial<Record<AssetType, number>>;
  custom?: boolean;
}

export const ALLOCATION_STRATEGIES: AllocationStrategy[] = [
  {
    id: 'balanced-60-40',
    name: '稳健 60/40',
    description: '以股债平衡为核心，适合希望在增长和回撤之间取平衡的配置。',
    riskLevel: '中等',
    weights: {
      [AssetType.STOCK]: 60,
      [AssetType.BOND]: 35,
      [AssetType.CASH]: 5,
    },
  },
  {
    id: 'permanent-portfolio',
    name: '永久组合',
    description: '用四类资产应对不同宏观环境，更重视稳定性和分散。',
    riskLevel: '偏稳健',
    weights: {
      [AssetType.STOCK]: 25,
      [AssetType.BOND]: 25,
      [AssetType.CASH]: 25,
      [AssetType.OTHER]: 25,
    },
  },
  {
    id: 'all-weather-lite',
    name: '全天候简化',
    description: '债券权重更高，搭配股票和其他资产，追求跨周期的相对平滑。',
    riskLevel: '偏稳健',
    weights: {
      [AssetType.STOCK]: 30,
      [AssetType.BOND]: 45,
      [AssetType.CASH]: 10,
      [AssetType.OTHER]: 15,
    },
  },
  {
    id: 'core-satellite',
    name: '核心卫星',
    description: '以基金作为核心仓位，再用股票等资产做增强。',
    riskLevel: '中等',
    weights: {
      [AssetType.FUND]: 50,
      [AssetType.STOCK]: 25,
      [AssetType.BOND]: 15,
      [AssetType.CASH]: 10,
    },
  },
  {
    id: 'growth',
    name: '激进成长',
    description: '权益资产占比高，适合更能承受波动、追求长期增长的配置。',
    riskLevel: '偏高',
    weights: {
      [AssetType.STOCK]: 70,
      [AssetType.FUND]: 20,
      [AssetType.CASH]: 5,
      [AssetType.OTHER]: 5,
    },
  },
  {
    id: 'defensive-income',
    name: '防守收益',
    description: '以债券和现金为主，减少权益波动，优先考虑资产稳定和流动性。',
    riskLevel: '低',
    weights: {
      [AssetType.BOND]: 55,
      [AssetType.CASH]: 25,
      [AssetType.FUND]: 15,
      [AssetType.STOCK]: 5,
    },
  },
  {
    id: 'equity-index',
    name: '指数增强',
    description: '基金和股票权重较高，适合以宽基、行业基金和少量个股构建成长仓。',
    riskLevel: '偏高',
    weights: {
      [AssetType.FUND]: 55,
      [AssetType.STOCK]: 35,
      [AssetType.CASH]: 5,
      [AssetType.BOND]: 5,
    },
  },
  {
    id: 'barbell',
    name: '杠铃组合',
    description: '一端保留现金和债券，一端配置高弹性股票，减少中间模糊仓位。',
    riskLevel: '中高',
    weights: {
      [AssetType.STOCK]: 45,
      [AssetType.BOND]: 30,
      [AssetType.CASH]: 20,
      [AssetType.OTHER]: 5,
    },
  },
  {
    id: 'real-asset-tilt',
    name: '实物资产倾斜',
    description: '适合已有房产或黄金等实物资产敞口的人，强调抗通胀和资产分散。',
    riskLevel: '中等',
    weights: {
      [AssetType.PROPERTY]: 30,
      [AssetType.STOCK]: 25,
      [AssetType.FUND]: 20,
      [AssetType.BOND]: 15,
      [AssetType.CASH]: 10,
    },
  },
  {
    id: 'cash-flow',
    name: '现金流优先',
    description: '现金和债券留足安全垫，再配置基金和股票，适合阶段性保守管理。',
    riskLevel: '偏低',
    weights: {
      [AssetType.CASH]: 30,
      [AssetType.BOND]: 35,
      [AssetType.FUND]: 25,
      [AssetType.STOCK]: 10,
    },
  },
];
