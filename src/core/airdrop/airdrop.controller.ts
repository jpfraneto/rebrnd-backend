import { Controller, Get, UseGuards, Res, Query } from '@nestjs/common';
import { Response } from 'express';
import { AuthorizationGuard, QuickAuthPayload } from '../../security/guards';
import { Session } from '../../security/decorators';
import { hasResponse, hasError, HttpStatus } from '../../utils/http';
import { AirdropService } from './services/airdrop.service';

@Controller('airdrop-service')
export class AirdropController {
  constructor(private readonly airdropService: AirdropService) {}

  @Get('check-user')
  @UseGuards(AuthorizationGuard)
  async checkUser(@Session() user: QuickAuthPayload, @Res() res: Response) {
    try {
      const airdropCalculation = await this.airdropService.checkUserEligibility(
        user.sub,
      );

      return hasResponse(res, {
        eligible: true,
        calculation: airdropCalculation,
        user: {
          fid: user.sub,
          address: user.address,
        },
      });
    } catch (error) {
      console.error('Error checking airdrop eligibility:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'checkUser',
        'Error checking airdrop eligibility',
      );
    }
  }

  @Get('leaderboard')
  async getLeaderboard(@Res() res: Response, @Query('limit') limit?: string) {
    try {
      const limitNum = limit ? parseInt(limit, 10) : 100;
      const maxLimit = 1000;
      const actualLimit = Math.min(limitNum, maxLimit);

      const leaderboard = await this.airdropService.getLeaderboard(actualLimit);

      const leaderboardWithRanking = leaderboard.map((entry, index) => ({
        rank: index + 1,
        fid: entry.fid,
        username: entry.user?.username || 'Unknown',
        photoUrl: entry.user?.photoUrl || null,
        basePoints: Number(entry.basePoints),
        multipliers: {
          followAccounts: Number(entry.followAccountsMultiplier),
          channelInteraction: Number(entry.channelInteractionMultiplier),
          holdingBrnd: Number(entry.holdingBrndMultiplier),
          collectibles: Number(entry.collectiblesMultiplier),
          votedBrands: Number(entry.votedBrandsMultiplier),
          sharedPodiums: Number(entry.sharedPodiumsMultiplier),
          neynarScore: Number(entry.neynarScoreMultiplier),
          proUser: Number(entry.proUserMultiplier),
        },
        totalMultiplier: Number(entry.totalMultiplier),
        finalScore: Number(entry.finalScore),
        tokenAllocation: Number(entry.tokenAllocation),
        percentage: Number(entry.percentage),
        lastUpdated: entry.updatedAt,
      }));

      return hasResponse(res, {
        leaderboard: leaderboardWithRanking,
        total: leaderboard.length,
        limit: actualLimit,
      });
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getLeaderboard',
        'Error fetching leaderboard',
      );
    }
  }
}
