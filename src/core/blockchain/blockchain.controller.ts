import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { BlockchainService } from './services/blockchain.service';
import { PowerLevelService } from './services/power-level.service';
import { SignatureService } from './services/signature.service';

import { AuthorizationGuard, QuickAuthPayload } from '../../security/guards';
import { Session } from '../../security/decorators';

import { hasResponse, hasError, HttpStatus } from '../../utils';

import { logger } from '../../main';

@ApiTags('blockchain-service')
@Controller('blockchain-service')
export class BlockchainController {
  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly powerLevelService: PowerLevelService,
    private readonly signatureService: SignatureService,
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
        return hasError(
          null,
          HttpStatus.BAD_REQUEST,
          'authorizeWallet',
          'Wallet address and deadline are required',
        );
      }

      const authData = await this.signatureService.generateAuthorizationSignature(
        session.sub,
        walletAddress,
        deadline,
      );

      return hasResponse(null, {
        authData,
        fid: session.sub,
        walletAddress,
        deadline,
      });
    } catch (error) {
      logger.error('Failed to generate authorization signature:', error);
      return hasError(
        null,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'authorizeWallet',
        'Failed to generate authorization signature',
      );
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
        return hasError(
          null,
          HttpStatus.BAD_REQUEST,
          'levelUp',
          'New level and deadline are required',
        );
      }

      const canLevelUp = await this.powerLevelService.canLevelUp(
        session.sub,
        newLevel,
      );

      if (!canLevelUp.eligible) {
        return hasError(
          null,
          HttpStatus.FORBIDDEN,
          'levelUp',
          `Cannot level up: ${canLevelUp.reason}`,
        );
      }

      const signature = await this.signatureService.generateLevelUpSignature(
        session.sub,
        newLevel,
        deadline,
      );

      return hasResponse(null, {
        signature,
        fid: session.sub,
        newLevel,
        deadline,
        validation: canLevelUp,
      });
    } catch (error) {
      logger.error('Failed to generate level up signature:', error);
      return hasError(
        null,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'levelUp',
        'Failed to generate level up signature',
      );
    }
  }

  @Post('/claim-reward')
  @UseGuards(AuthorizationGuard)
  async claimReward(
    @Session() session: QuickAuthPayload,
    @Body() body: { amount: string; day: number; deadline: number },
  ) {
    try {
      logger.log(
        `💰 [BLOCKCHAIN] Reward claim signature request for FID: ${session.sub}`,
      );

      const { amount, day, deadline } = body;

      if (!amount || day === undefined || !deadline) {
        return hasError(
          null,
          HttpStatus.BAD_REQUEST,
          'claimReward',
          'Amount, day, and deadline are required',
        );
      }

      const signature = await this.signatureService.generateRewardClaimSignature(
        session.sub,
        amount,
        day,
        deadline,
      );

      return hasResponse(null, {
        signature,
        fid: session.sub,
        amount,
        day,
        deadline,
      });
    } catch (error) {
      logger.error('Failed to generate reward claim signature:', error);
      return hasError(
        null,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'claimReward',
        'Failed to generate reward claim signature',
      );
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
        return hasError(
          null,
          HttpStatus.FORBIDDEN,
          'getPowerLevel',
          'Can only check your own power level',
        );
      }

      const powerLevelData = await this.powerLevelService.getUserPowerLevel(
        parseInt(fid),
      );

      return hasResponse(null, powerLevelData);
    } catch (error) {
      logger.error('Failed to get power level:', error);
      return hasError(
        null,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getPowerLevel',
        'Failed to get power level data',
      );
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
        return hasError(
          null,
          HttpStatus.FORBIDDEN,
          'getUserStake',
          'Can only check your own stake',
        );
      }

      const stakeData = await this.blockchainService.getUserStakeInfo(
        parseInt(fid),
      );

      return hasResponse(null, stakeData);
    } catch (error) {
      logger.error('Failed to get user stake:', error);
      return hasError(
        null,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getUserStake',
        'Failed to get stake information',
      );
    }
  }
}