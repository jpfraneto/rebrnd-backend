import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { BlockchainService } from './services/blockchain.service';
import { PowerLevelService } from './services/power-level.service';
import { SignatureService } from './services/signature.service';
import { RewardService } from './services/reward.service';
import { CastVerificationService } from './services/cast-verification.service';

import { AuthorizationGuard, QuickAuthPayload } from '../../security/guards';
import { Session } from '../../security/decorators';

import { HttpStatus } from '../../utils';
import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';

import { logger } from '../../main';

@ApiTags('blockchain-service')
@Controller('blockchain-service')
export class BlockchainController {
  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly powerLevelService: PowerLevelService,
    private readonly signatureService: SignatureService,
    private readonly rewardService: RewardService,
    private readonly castVerificationService: CastVerificationService,
  ) {}

  @Post('/authorize-wallet')
  @UseGuards(AuthorizationGuard)
  async authorizeWallet(
    @Session() session: QuickAuthPayload,
    @Body() body: { walletAddress: string; deadline: number },
  ) {
    try {
      logger.log(
        `🔐 [BLOCKCHAIN] Authorization signature request for FID: ${session.sub}`,
      );

      const { walletAddress, deadline } = body;

      if (!walletAddress || !deadline) {
        throw new BadRequestException('Wallet address and deadline are required');
      }

      const authData = await this.signatureService.generateAuthorizationSignature(
        session.sub,
        walletAddress,
        deadline,
      );

      return {
        authData,
        fid: session.sub,
        walletAddress,
        deadline,
      };
    } catch (error) {
      logger.error('Failed to generate authorization signature:', error);
      throw new Error('Failed to generate authorization signature');
    }
  }

  @Post('/level-up')
  @UseGuards(AuthorizationGuard)
  async levelUp(
    @Session() session: QuickAuthPayload,
    @Body() body: { newLevel: number; deadline: number },
  ) {
    try {
      logger.log(
        `📈 [BLOCKCHAIN] Level up signature request for FID: ${session.sub}`,
      );

      const { newLevel, deadline } = body;

      if (!newLevel || !deadline) {
        throw new BadRequestException('New level and deadline are required');
      }

      const canLevelUp = await this.powerLevelService.canLevelUp(
        session.sub,
        newLevel,
      );

      if (!canLevelUp.eligible) {
        throw new ForbiddenException(`Cannot level up: ${canLevelUp.reason}`);
      }

      const signature = await this.signatureService.generateLevelUpSignature(
        session.sub,
        newLevel,
        deadline,
      );

      return {
        signature,
        fid: session.sub,
        newLevel,
        deadline,
        validation: canLevelUp,
      };
    } catch (error) {
      logger.error('Failed to generate level up signature:', error);
      throw new InternalServerErrorException('Failed to generate level up signature');
    }
  }

  @Post('/claim-reward')
  @UseGuards(AuthorizationGuard)
  async claimReward(
    @Session() session: QuickAuthPayload,
    @Body() body: { day: number; recipientAddress: string },
  ) {
    try {
      logger.log(
        `💰 [BLOCKCHAIN] Reward claim signature request for FID: ${session.sub}`,
      );

      const { day, recipientAddress } = body;

      if (day === undefined || !recipientAddress) {
        throw new BadRequestException('Day and recipient address are required');
      }

      const claimResponse = await this.rewardService.generateClaimSignature(
        session.sub,
        day,
        recipientAddress,
      );

      return claimResponse;
    } catch (error) {
      logger.error('Failed to generate reward claim signature:', error);
      throw new InternalServerErrorException(error.message || 'Failed to generate reward claim signature');
    }
  }

  @Get('/power-level/:fid')
  @UseGuards(AuthorizationGuard)
  async getPowerLevel(
    @Session() session: QuickAuthPayload,
    @Param('fid') fid: string,
  ) {
    try {
      if (session.sub.toString() !== fid) {
        throw new ForbiddenException('Can only check your own power level');
      }

      const powerLevelData = await this.powerLevelService.getUserPowerLevel(
        parseInt(fid),
      );

      return powerLevelData;
    } catch (error) {
      logger.error('Failed to get power level:', error);
      throw new InternalServerErrorException('Failed to get power level data');
    }
  }

  @Get('/user-stake/:fid')
  @UseGuards(AuthorizationGuard)
  async getUserStake(
    @Session() session: QuickAuthPayload,
    @Param('fid') fid: string,
  ) {
    try {
      if (session.sub.toString() !== fid) {
        throw new ForbiddenException('Can only check your own stake');
      }

      const stakeData = await this.blockchainService.getUserStakeInfo(
        parseInt(fid),
      );

      return stakeData;
    } catch (error) {
      logger.error('Failed to get user stake:', error);
      throw new InternalServerErrorException('Failed to get stake information');
    }
  }

  @Get('/claim-status/:day')
  @UseGuards(AuthorizationGuard)
  async getClaimStatus(
    @Session() session: QuickAuthPayload,
    @Param('day') day: string,
  ) {
    try {
      logger.log(
        `🔍 [BLOCKCHAIN] Claim status request for FID: ${session.sub}, Day: ${day}`,
      );

      const claimStatus = await this.rewardService.getClaimStatus(
        session.sub,
        parseInt(day),
      );

      return claimStatus;
    } catch (error) {
      logger.error('Failed to get claim status:', error);
      throw new InternalServerErrorException('Failed to get claim status');
    }
  }

  @Post('/verify-share')
  @UseGuards(AuthorizationGuard)
  async verifyShare(
    @Session() session: QuickAuthPayload,
    @Body() body: { castHash: string; day: number },
  ) {
    try {
      logger.log(
        `✅ [BLOCKCHAIN] Manual share verification request for FID: ${session.sub}`,
      );

      const { castHash, day } = body;

      if (!castHash || day === undefined) {
        throw new BadRequestException('Cast hash and day are required');
      }

      const verificationResult = await this.castVerificationService.manuallyVerifyShare(
        castHash,
        session.sub,
        day,
      );

      return verificationResult;
    } catch (error) {
      logger.error('Failed to verify share:', error);
      throw new InternalServerErrorException('Failed to verify share');
    }
  }

  @Get('/share-status/:day')
  @UseGuards(AuthorizationGuard)
  async getShareStatus(
    @Session() session: QuickAuthPayload,
    @Param('day') day: string,
  ) {
    try {
      const shareStatus = await this.castVerificationService.getShareStatus(
        session.sub,
        parseInt(day),
      );

      return shareStatus;
    } catch (error) {
      logger.error('Failed to get share status:', error);
      throw new InternalServerErrorException('Failed to get share status');
    }
  }

  @Get('/user-rewards')
  @UseGuards(AuthorizationGuard)
  async getUserRewards(@Session() session: QuickAuthPayload) {
    try {
      logger.log(
        `📊 [BLOCKCHAIN] User rewards request for FID: ${session.sub}`,
      );

      const rewardHistory = await this.rewardService.getUserRewardHistory(
        session.sub,
      );

      return rewardHistory;
    } catch (error) {
      logger.error('Failed to get user rewards:', error);
      throw new InternalServerErrorException('Failed to get user rewards');
    }
  }

  @Get('/user-info/:walletAddress')
  async getUserInfo(@Param('walletAddress') walletAddress: string) {
    try {
      logger.log(
        `🔍 [BLOCKCHAIN] User info request for wallet: ${walletAddress}`,
      );

      // This would typically query the smart contract for user info
      // For now, return mock data structure matching V3 contract
      const mockUserInfo = {
        fid: 0,
        brndPowerLevel: 1,
        lastVoteDay: 0,
        totalVotes: 0,
        expectedReward: '1000000000000000000000', // 1000 BRND
        hasVotedToday: false,
        hasSharedToday: false,
        canClaimToday: false,
      };

      return mockUserInfo;
    } catch (error) {
      logger.error('Failed to get user info:', error);
      throw new InternalServerErrorException('Failed to get user info');
    }
  }

  @Post('/webhooks/farcaster/cast-created')
  async handleCastWebhook(@Body() payload: any) {
    try {
      logger.log(`📱 [WEBHOOK] Received cast webhook`);

      const processed = await this.castVerificationService.processCastWebhook(payload);

      return { processed };
    } catch (error) {
      logger.error('Failed to process cast webhook:', error);
      throw new InternalServerErrorException('Failed to process cast webhook');
    }
  }
}