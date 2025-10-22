import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../../models';
import { BlockchainService } from './blockchain.service';
import { logger } from '../../../main';

export interface PowerLevel {
  id: number;
  title: string;
  description: string;
  multiplier: number;
  leaderboardPoints: number;
  podiumPoints: number;
  shareReward: number;
  isCompleted: boolean;
  isActive: boolean;
  actionType: 'follow' | 'stake' | 'streak' | 'podiums' | 'collectibles';
  actionValue?: string;
  progress?: { current: number; total: number };
  showButton: boolean;
  requirement?: {
    type: string;
    value: number | string;
    unit: string;
  };
}

export interface PowerLevelValidation {
  eligible: boolean;
  reason?: string;
  currentLevel: number;
  nextLevel: number;
  requirements: {
    met: boolean;
    description: string;
    current?: number;
    required?: number;
  }[];
}

@Injectable()
export class PowerLevelService {
  private readonly POWER_LEVELS: PowerLevel[] = [
    {
      id: 1,
      title: 'FOLLOW @BRND',
      description: 'x1 rewards',
      multiplier: 1,
      leaderboardPoints: 10,
      podiumPoints: 100,
      shareReward: 1000,
      isCompleted: false,
      isActive: true,
      actionType: 'follow',
      showButton: true,
      requirement: {
        type: 'follow',
        value: '@brnd',
        unit: 'account',
      },
    },
    {
      id: 2,
      title: 'STAKE 2M $BRND',
      description: 'x2 rewards',
      multiplier: 2,
      leaderboardPoints: 12,
      podiumPoints: 200,
      shareReward: 2000,
      isCompleted: false,
      isActive: false,
      actionType: 'stake',
      actionValue: '2M',
      showButton: true,
      requirement: {
        type: 'stake',
        value: 2_000_000,
        unit: 'BRND',
      },
    },
    {
      id: 3,
      title: 'PODIUM STREAK: 5 DAYS',
      description: 'x3 rewards',
      multiplier: 3,
      leaderboardPoints: 18,
      podiumPoints: 300,
      shareReward: 3000,
      isCompleted: false,
      isActive: false,
      actionType: 'streak',
      progress: { current: 0, total: 5 },
      showButton: false,
      requirement: {
        type: 'streak',
        value: 5,
        unit: 'days',
      },
    },
    {
      id: 4,
      title: 'STAKE 4M $BRND',
      description: 'x4 rewards',
      multiplier: 4,
      leaderboardPoints: 24,
      podiumPoints: 400,
      shareReward: 4000,
      isCompleted: false,
      isActive: false,
      actionType: 'stake',
      actionValue: '4M',
      showButton: true,
      requirement: {
        type: 'stake',
        value: 4_000_000,
        unit: 'BRND',
      },
    },
    {
      id: 5,
      title: 'VOTE 100 PODIUMS',
      description: 'x5 rewards',
      multiplier: 5,
      leaderboardPoints: 30,
      podiumPoints: 500,
      shareReward: 5000,
      isCompleted: false,
      isActive: false,
      actionType: 'podiums',
      progress: { current: 0, total: 100 },
      showButton: false,
      requirement: {
        type: 'podiums',
        value: 100,
        unit: 'votes',
      },
    },
    {
      id: 6,
      title: 'STAKE 6M $BRND',
      description: 'x6 rewards',
      multiplier: 6,
      leaderboardPoints: 36,
      podiumPoints: 600,
      shareReward: 6000,
      isCompleted: false,
      isActive: false,
      actionType: 'stake',
      actionValue: '6M',
      showButton: true,
      requirement: {
        type: 'stake',
        value: 6_000_000,
        unit: 'BRND',
      },
    },
    {
      id: 7,
      title: 'COLLECT 7 BRND COLLECTIBLE CASTS',
      description: 'x7 BRND COLLECTIBLE CASTS rewards',
      multiplier: 7,
      leaderboardPoints: 42,
      podiumPoints: 700,
      shareReward: 7000,
      isCompleted: false,
      isActive: false,
      actionType: 'collectibles',
      actionValue: '7',
      showButton: false,
      requirement: {
        type: 'collectibles',
        value: 7,
        unit: 'casts',
      },
    },
    {
      id: 8,
      title: 'STAKE 8M $BRND',
      description: 'x8 rewards',
      multiplier: 8,
      leaderboardPoints: 48,
      podiumPoints: 800,
      shareReward: 8000,
      isCompleted: false,
      isActive: false,
      actionType: 'stake',
      actionValue: '8M',
      showButton: true,
      requirement: {
        type: 'stake',
        value: 8_000_000,
        unit: 'BRND',
      },
    },
  ];

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly blockchainService: BlockchainService,
  ) {}

  async getUserPowerLevel(fid: number): Promise<{
    currentLevel: number;
    currentPowerLevel: PowerLevel;
    nextLevel?: PowerLevel;
    allLevels: PowerLevel[];
    progress: any;
  }> {
    try {
      logger.log(`📈 [POWER LEVEL] Getting power level for FID: ${fid}`);

      const user = await this.userRepository.findOne({
        where: { fid },
        relations: ['userBrandVotes'],
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Get user's blockchain data
      const [stakeInfo, followStatus] = await Promise.all([
        this.blockchainService.getUserStakeInfo(fid),
        this.blockchainService.checkFollowStatus(fid),
      ]);

      // Calculate current achievements
      const achievements = await this.calculateAchievements(
        user,
        stakeInfo,
        followStatus,
      );

      // Determine current level and populate power levels with progress
      let currentLevel = 0;
      const levelsWithProgress = this.POWER_LEVELS.map((level) => {
        const levelCopy = { ...level };
        const isCompleted = this.isLevelCompleted(level, achievements);

        levelCopy.isCompleted = isCompleted;
        if (isCompleted && level.id > currentLevel) {
          currentLevel = level.id;
        }

        // Update progress for tracking levels
        if (level.actionType === 'streak') {
          levelCopy.progress = {
            current: achievements.dailyStreak,
            total: level.requirement?.value as number,
          };
        } else if (level.actionType === 'podiums') {
          levelCopy.progress = {
            current: achievements.totalPodiums,
            total: level.requirement?.value as number,
          };
        } else if (level.actionType === 'collectibles') {
          levelCopy.progress = {
            current: achievements.collectibles,
            total: level.requirement?.value as number,
          };
        }

        // Set active status
        levelCopy.isActive = level.id === currentLevel + 1 || level.id === 1;

        return levelCopy;
      });

      const currentPowerLevel = levelsWithProgress.find(
        (l) => l.id === currentLevel,
      );
      const nextLevel = levelsWithProgress.find((l) => l.id === currentLevel + 1);

      return {
        currentLevel,
        currentPowerLevel:
          currentPowerLevel || levelsWithProgress[0], // Default to level 1 if none completed
        nextLevel,
        allLevels: levelsWithProgress,
        progress: achievements,
      };
    } catch (error) {
      logger.error('Error getting user power level:', error);
      throw error;
    }
  }

  async canLevelUp(fid: number, targetLevel: number): Promise<PowerLevelValidation> {
    try {
      logger.log(
        `✅ [POWER LEVEL] Checking if FID ${fid} can level up to ${targetLevel}`,
      );

      const powerLevelData = await this.getUserPowerLevel(fid);
      const targetPowerLevel = this.POWER_LEVELS.find(
        (l) => l.id === targetLevel,
      );

      if (!targetPowerLevel) {
        return {
          eligible: false,
          reason: 'Invalid target level',
          currentLevel: powerLevelData.currentLevel,
          nextLevel: targetLevel,
          requirements: [],
        };
      }

      if (targetLevel <= powerLevelData.currentLevel) {
        return {
          eligible: false,
          reason: 'Target level must be higher than current level',
          currentLevel: powerLevelData.currentLevel,
          nextLevel: targetLevel,
          requirements: [],
        };
      }

      if (targetLevel !== powerLevelData.currentLevel + 1) {
        return {
          eligible: false,
          reason: 'Can only level up one level at a time',
          currentLevel: powerLevelData.currentLevel,
          nextLevel: targetLevel,
          requirements: [],
        };
      }

      const isCompleted = targetPowerLevel.isCompleted;
      const requirements = await this.getLevelRequirements(
        fid,
        targetPowerLevel,
        powerLevelData.progress,
      );

      return {
        eligible: isCompleted,
        reason: isCompleted ? undefined : 'Requirements not met',
        currentLevel: powerLevelData.currentLevel,
        nextLevel: targetLevel,
        requirements,
      };
    } catch (error) {
      logger.error('Error checking level up eligibility:', error);
      throw error;
    }
  }

  private async calculateAchievements(
    user: User,
    stakeInfo: any,
    followStatus: any,
  ): Promise<any> {
    const totalPodiums = user.userBrandVotes?.length || 0;

    return {
      followingBrnd: followStatus.followingBrnd,
      followingFloc: followStatus.followingFloc,
      stakedAmount: stakeInfo.stakedAmount,
      totalBalance: stakeInfo.totalBalance,
      dailyStreak: user.dailyStreak || 0,
      totalPodiums: user.totalPodiums || totalPodiums,
      votedBrandsCount: user.votedBrandsCount || 0,
      collectibles: 0, // TODO: Implement collectibles counting
    };
  }

  private isLevelCompleted(level: PowerLevel, achievements: any): boolean {
    switch (level.actionType) {
      case 'follow':
        return achievements.followingBrnd;

      case 'stake':
        const requiredStake = level.requirement?.value as number;
        return achievements.totalBalance >= requiredStake;

      case 'streak':
        const requiredStreak = level.requirement?.value as number;
        return achievements.dailyStreak >= requiredStreak;

      case 'podiums':
        const requiredPodiums = level.requirement?.value as number;
        return achievements.totalPodiums >= requiredPodiums;

      case 'collectibles':
        const requiredCollectibles = level.requirement?.value as number;
        return achievements.collectibles >= requiredCollectibles;

      default:
        return false;
    }
  }

  private async getLevelRequirements(
    fid: number,
    level: PowerLevel,
    achievements: any,
  ): Promise<
    Array<{
      met: boolean;
      description: string;
      current?: number;
      required?: number;
    }>
  > {
    const requirements = [];

    switch (level.actionType) {
      case 'follow':
        requirements.push({
          met: achievements.followingBrnd,
          description: 'Follow @brnd on Farcaster',
          current: achievements.followingBrnd ? 1 : 0,
          required: 1,
        });
        break;

      case 'stake':
        const requiredStake = level.requirement?.value as number;
        requirements.push({
          met: achievements.totalBalance >= requiredStake,
          description: `Stake ${(requiredStake / 1_000_000).toLocaleString()}M BRND tokens`,
          current: Math.round(achievements.totalBalance),
          required: requiredStake,
        });
        break;

      case 'streak':
        const requiredStreak = level.requirement?.value as number;
        requirements.push({
          met: achievements.dailyStreak >= requiredStreak,
          description: `Maintain a ${requiredStreak}-day voting streak`,
          current: achievements.dailyStreak,
          required: requiredStreak,
        });
        break;

      case 'podiums':
        const requiredPodiums = level.requirement?.value as number;
        requirements.push({
          met: achievements.totalPodiums >= requiredPodiums,
          description: `Vote in ${requiredPodiums} podiums`,
          current: achievements.totalPodiums,
          required: requiredPodiums,
        });
        break;

      case 'collectibles':
        const requiredCollectibles = level.requirement?.value as number;
        requirements.push({
          met: achievements.collectibles >= requiredCollectibles,
          description: `Collect ${requiredCollectibles} BRND cast collectibles`,
          current: achievements.collectibles,
          required: requiredCollectibles,
        });
        break;
    }

    return requirements;
  }
}