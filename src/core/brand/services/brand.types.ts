import { Brand } from '../../../models/Brand';

export type BrandOrderType = 'top' | 'new' | 'all';

export type BrandCast = {
  creator: string;
  creatorPfp: string;
  creatorPowerBadge: boolean;
  text: string;
  image?: string;
};

export type BrandResponse = {
  fanCount?: number;
  brand: Brand;
  casts: BrandCast[];
};
