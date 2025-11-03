import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RewardClaim, User } from '../../../models';
import { getConfig } from '../../../security/config';
import { logger } from '../../../main';
import { SignatureService } from './signature.service';

interface RewardEligibility {
  eligible: boolean;
  reason?: string;
  hasVoted: boolean;
  hasShared: boolean;
  hasClaimed: boolean;
  expectedAmount?: string;
}

export interface ClaimStatusResponse {
  canClaim: boolean;
  hasClaimed: boolean;
  shareVerified: boolean;
  amount: string;
  day: number;
  estimatedGas?: string;
}

export interface ClaimRewardResponse {
  signature: string;
  amount: string;
  deadline: number;
  nonce: number;
  canClaim: boolean;
}

@Injectable()
export class RewardService {
  private readonly BASE_VOTE_COST = '100000000000000000000'; // 100 BRND in wei
  private readonly REWARD_MULTIPLIER = 10;

  constructor(
    @InjectRepository(RewardClaim)
    private readonly rewardClaimRepository: Repository<RewardClaim>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly signatureService: SignatureService,
  ) {}

  async getClaimStatus(fid: number, day: number): Promise<ClaimStatusResponse> {
    try {
      logger.log(`🔍 [REWARD] Checking claim status for FID: ${fid}, Day: ${day}`);

      const user = await this.userRepository.findOne({ where: { fid } });
      if (!user) {
        throw new Error('User not found');
      }

      const rewardClaim = await this.rewardClaimRepository.findOne({
        where: { userFid: fid, day },
      });

      const hasClaimed = rewardClaim?.claimedAt != null;
      const shareVerified = rewardClaim?.shareVerified || false;
      const canClaim = shareVerified && !hasClaimed;

      const expectedAmount = this.calculateRewardAmount(user.brndPowerLevel);

      return {
        canClaim,
        hasClaimed,
        shareVerified,
        amount: expectedAmount,
        day,
      };
    } catch (error) {
      logger.error(`Error checking claim status for FID ${fid}:`, error);
      throw error;
    }
  }

  async generateClaimSignature(
    fid: number,
    day: number,
    recipientAddress: string,
  ): Promise<ClaimRewardResponse> {
    try {
      logger.log(`💰 [REWARD] Generating claim signature for FID: ${fid}, Day: ${day}`);

      const eligibility = await this.validateRewardEligibility(fid, day);
      if (!eligibility.eligible) {
        throw new Error(`Cannot claim reward: ${eligibility.reason}`);
      }

      const user = await this.userRepository.findOne({ where: { fid } });
      if (!user) {
        throw new Error('User not found');
      }

      const amount = this.calculateRewardAmount(user.brndPowerLevel);
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour deadline

      const { signature, nonce } = await this.signatureService.generateRewardClaimSignature(
        recipientAddress,
        fid,
        amount,
        day,
        deadline,
      );

      // Update or create reward claim record
      let rewardClaim = await this.rewardClaimRepository.findOne({
        where: { userFid: fid, day },
      });

      if (!rewardClaim) {
        rewardClaim = this.rewardClaimRepository.create({
          userFid: fid,
          day,
          amount,
          nonce,
        });
      }

      rewardClaim.signatureGeneratedAt = new Date();
      rewardClaim.nonce = nonce;
      await this.rewardClaimRepository.save(rewardClaim);

      return {
        signature,
        amount,
        deadline,
        nonce,
        canClaim: true,
      };
    } catch (error) {
      logger.error(`Error generating claim signature for FID ${fid}:`, error);
      throw error;
    }
  }

  async validateRewardEligibility(fid: number, day: number): Promise<RewardEligibility> {
    try {
      const user = await this.userRepository.findOne({ where: { fid } });
      if (!user) {
        return {
          eligible: false,
          reason: 'User not found',
          hasVoted: false,
          hasShared: false,
          hasClaimed: false,
        };
      }

      const rewardClaim = await this.rewardClaimRepository.findOne({
        where: { userFid: fid, day },
      });

      const hasVoted = user.lastVoteDay >= day; // Simplified check
      const hasShared = rewardClaim?.shareVerified || false;
      const hasClaimed = rewardClaim?.claimedAt != null;

      if (hasClaimed) {
        return {
          eligible: false,
          reason: 'Already claimed for this day',
          hasVoted,
          hasShared,
          hasClaimed: true,
        };
      }

      if (!hasVoted) {
        return {
          eligible: false,
          reason: 'User has not voted for this day',
          hasVoted: false,
          hasShared,
          hasClaimed: false,
        };
      }

      if (!hasShared) {
        return {
          eligible: false,
          reason: 'User has not shared their cast',
          hasVoted: true,
          hasShared: false,
          hasClaimed: false,
        };
      }

      const expectedAmount = this.calculateRewardAmount(user.brndPowerLevel);

      return {
        eligible: true,
        hasVoted: true,
        hasShared: true,
        hasClaimed: false,
        expectedAmount,
      };
    } catch (error) {
      logger.error(`Error validating reward eligibility for FID ${fid}:`, error);
      return {
        eligible: false,
        reason: 'Internal error',
        hasVoted: false,
        hasShared: false,
        hasClaimed: false,
      };
    }
  }

  calculateRewardAmount(brndPowerLevel: number): string {
    const voteCost = this.getVoteCost(brndPowerLevel);
    const rewardAmount = BigInt(voteCost) * BigInt(this.REWARD_MULTIPLIER);
    return rewardAmount.toString();
  }

  private getVoteCost(brndPowerLevel: number): string {
    if (brndPowerLevel === 0) return this.BASE_VOTE_COST;
    if (brndPowerLevel >= 8) return (BigInt(this.BASE_VOTE_COST) * BigInt(8)).toString();
    return (BigInt(this.BASE_VOTE_COST) * BigInt(brndPowerLevel)).toString();
  }

  async markRewardClaimed(fid: number, day: number, txHash: string): Promise<void> {
    try {
      const rewardClaim = await this.rewardClaimRepository.findOne({
        where: { userFid: fid, day },
      });

      if (rewardClaim) {
        rewardClaim.claimedAt = new Date();
        rewardClaim.claimTxHash = txHash;
        await this.rewardClaimRepository.save(rewardClaim);
        logger.log(`✅ [REWARD] Marked reward as claimed for FID: ${fid}, Day: ${day}`);
      }
    } catch (error) {
      logger.error(`Error marking reward as claimed for FID ${fid}:`, error);
    }
  }

  async verifyShareForReward(fid: number, day: number, castHash?: string): Promise<boolean> {
    try {
      let rewardClaim = await this.rewardClaimRepository.findOne({
        where: { userFid: fid, day },
      });

      if (!rewardClaim) {
        // Create a new reward claim if user voted
        const user = await this.userRepository.findOne({ where: { fid } });
        if (!user || user.lastVoteDay < day) {
          return false; // User hasn't voted
        }

        const amount = this.calculateRewardAmount(user.brndPowerLevel);
        rewardClaim = this.rewardClaimRepository.create({
          userFid: fid,
          day,
          amount,
        });
      }

      rewardClaim.shareVerified = true;
      rewardClaim.shareVerifiedAt = new Date();
      if (castHash) {
        rewardClaim.castHash = castHash;
      }

      await this.rewardClaimRepository.save(rewardClaim);
      logger.log(`✅ [REWARD] Share verified for FID: ${fid}, Day: ${day}`);
      return true;
    } catch (error) {
      logger.error(`Error verifying share for FID ${fid}:`, error);
      return false;
    }
  }

  async getUserRewardHistory(fid: number): Promise<{
    totalClaimed: string;
    pendingRewards: Array<{
      day: number;
      amount: string;
      canClaim: boolean;
      shareVerified: boolean;
    }>;
    rewardHistory: Array<{
      day: number;
      amount: string;
      claimedAt: string;
      txHash: string;
    }>;
  }> {
    try {
      const rewardClaims = await this.rewardClaimRepository.find({
        where: { userFid: fid },
        order: { day: 'DESC' },
      });

      const claimedRewards = rewardClaims.filter(claim => claim.claimedAt);
      const pendingRewards = rewardClaims.filter(claim => !claim.claimedAt);

      const totalClaimed = claimedRewards
        .reduce((sum, claim) => sum + BigInt(claim.amount), BigInt(0))
        .toString();

      const rewardHistory = claimedRewards.map(claim => ({
        day: claim.day,
        amount: claim.amount,
        claimedAt: claim.claimedAt.toISOString(),
        txHash: claim.claimTxHash || '',
      }));

      const pendingRewardsFormatted = pendingRewards.map(claim => ({
        day: claim.day,
        amount: claim.amount,
        canClaim: claim.shareVerified,
        shareVerified: claim.shareVerified,
      }));

      return {
        totalClaimed,
        pendingRewards: pendingRewardsFormatted,
        rewardHistory,
      };
    } catch (error) {
      logger.error(`Error getting reward history for FID ${fid}:`, error);
      throw error;
    }
  }
}