import { Brand } from '../Brand';
import { User } from './';

export enum UserRoleEnum {
  USER = 'user',
  ADMIN = 'admin',
}

/**
 * Interface for Current User
 */
export interface CurrentUser {
  id: User['id'];
  userName: User['username'];
  fid: User['fid'];
  role: UserRoleEnum;
  token: string;
}

export interface UserBrandRanking {
  brand: Brand;
  points: number; // Total points this user gave this brand
  voteCount: number; // How many times user voted for this brand
  lastVoted: Date; // When they last voted for this brand
  position: number; // User's personal ranking (1st, 2nd, 3rd, etc.)
}
