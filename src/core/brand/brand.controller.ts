// Dependencies
import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

// Services
import { BrandOrderType, BrandResponse, BrandService } from './services';
import { BrandSeederService } from './services/brand-seeding.service';
import { UserService } from '../user/services/user.service';

// Models
import { Brand, CurrentUser } from '../../models';

// Utils
import { HttpStatus, hasError, hasResponse } from '../../utils';

// Security
import { AuthorizationGuard, QuickAuthPayload } from '../../security/guards';
import { Session } from '../../security/decorators';
import NeynarService from 'src/utils/neynar';

export type BrandTimePeriod = 'week' | 'month' | 'all';

@ApiTags('brand-service')
@Controller('brand-service')
export class BrandController {
  constructor(
    private readonly brandService: BrandService,
    private readonly brandSeederService: BrandSeederService,
    private readonly userService: UserService,
  ) {}

  /**
   * Retrieves a brand by its ID.
   *
   * @param {Brand['id']} id - The ID of the brand to retrieve.
   * @returns {Promise<Brand | undefined>} The brand entity or undefined if not found.
   */
  @Get('/brand/:id')
  getBrandById(
    @Param('id') id: Brand['id'],
  ): Promise<BrandResponse | undefined> {
    return this.brandService.getById(id, [], ['category']);
  }

  /**
   * Retrieves all brands with pagination.
   *
   * @param {BrandOrderType} order - The order in which to sort the brands.
   * @param {string} search - The search query to filter brands.
   * @param {number} pageId - The ID of the page to retrieve.
   * @param {number} limit - The number of brands to retrieve per page.
   * @param {Response} res - The response object.
   * @returns {Promise<Response>} A response object containing the page ID, total count of brands, and an array of brand objects.
   * @param {BrandTimePeriod} period - The time period to filter brands.
   */
  @Get('/list')
  @UseGuards(AuthorizationGuard)
  async getAllBrands(
    @Query('order') order: BrandOrderType,
    @Query('period') period: BrandTimePeriod = 'all', // NEW: Add period parameter
    @Query('search') search: string,
    @Query('pageId') pageId: number,
    @Query('limit') limit: number,
    @Res() res: Response,
  ) {
    const [brands, count] = await this.brandService.getAll(
      [
        'id',
        'name',
        'url',
        'imageUrl',
        'profile',
        'channel',
        'stateScore',
        'score',
        'ranking',
        'scoreWeek',
        'stateScoreWeek',
        'rankingWeek',
        'scoreMonth', // NEW
        'stateScoreMonth', // NEW
        'rankingMonth', // NEW
        'banned',
      ],
      [],
      order,
      period, // NEW: Pass period to service
      search,
      pageId,
      limit,
    );

    return hasResponse(res, {
      pageId,
      count,
      brands,
    });
  }

  /**
   * Records votes for multiple brands.
   *
   * @param {CurrentUser} user - The current user session.
   * @param {{ ids: string[] }} ids - An object containing an array of brand IDs to vote for.
   * @param {Response} res - The response object.
   * @returns {Promise<Response>} A response object indicating the result of the vote operation.
   */
  @Post('/vote')
  @UseGuards(AuthorizationGuard)
  async voteBrands(
    @Session() user: QuickAuthPayload, // Get FID from QuickAuth token
    @Body() { ids }: { ids: number[] },
    @Res() res: Response,
  ): Promise<Response> {
    console.log(
      '🗳️ [VoteBrands] User FID:',
      user.sub,
      'attempting to vote with IDs:',
      ids.join(', '),
    );

    try {
      // Validate request body
      if (!ids || !Array.isArray(ids)) {
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'voteBrands',
          'Invalid request: ids must be an array',
        );
      }

      if (ids.length !== 3) {
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'voteBrands',
          'Invalid request: must provide exactly 3 brand IDs',
        );
      }

      // Check for duplicate IDs
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== 3) {
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'voteBrands',
          'Invalid request: all brand IDs must be different',
        );
      }

      console.log(
        '✅ [VoteBrands] Vote validation passed, submitting votes...',
      );

      // Use user.sub (FID) - the brandService will find the user in the database
      const votes = await this.brandService.voteForBrands(user.sub, ids);

      return hasResponse(res, {
        id: votes.id,
        date: votes.date,
        brand1: {
          id: votes.brand1.id,
          name: votes.brand1.name,
          imageUrl: votes.brand1.imageUrl,
        },
        brand2: {
          id: votes.brand2.id,
          name: votes.brand2.name,
          imageUrl: votes.brand2.imageUrl,
        },
        brand3: {
          id: votes.brand3.id,
          name: votes.brand3.name,
          imageUrl: votes.brand3.imageUrl,
        },
        message: 'Vote submitted successfully',
        bot_cast_hash: votes.bot_cast_hash,
      });
    } catch (error) {
      console.error('❌ [VoteBrands] Voting error:', error);

      // Handle specific error types
      if (error.message.includes('already voted')) {
        return hasError(res, HttpStatus.CONFLICT, 'voteBrands', error.message);
      }

      if (error.message.includes('not found')) {
        return hasError(res, HttpStatus.NOT_FOUND, 'voteBrands', error.message);
      }

      if (error.message.includes('do not exist')) {
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'voteBrands',
          error.message,
        );
      }

      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'voteBrands',
        'An unexpected error occurred while processing your vote',
      );
    }
  }

  /**
   * Verifies a shared cast and awards points for valid shares.
   *
   * This endpoint validates that:
   * 1. The cast hash exists on Farcaster
   * 2. The cast was posted by the authenticated user
   * 3. The cast contains the correct embed URL
   * 4. The vote hasn't been shared before
   *
   * @param user - The authenticated user from QuickAuth
   * @param castHash - The Farcaster cast hash to verify (0x format)
   * @param voteId - The ID of the vote being shared
   * @param res - The response object
   * @returns Verification result and updated user points
   */
  @Post('/verify-share')
  @UseGuards(AuthorizationGuard)
  async verifyShare(
    @Session() user: QuickAuthPayload,
    @Body() { castHash, voteId }: { castHash: string; voteId: string },
    @Res() res: Response,
  ): Promise<Response> {
    try {
      console.log(
        `🔍 [VerifyShare] User FID: ${user.sub}, Cast: ${castHash}, Vote: ${voteId}`,
      );

      // Validate input
      if (!castHash || !voteId) {
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'verifyShare',
          'Cast hash and vote ID are required',
        );
      }

      // Validate cast hash format (should start with 0x and be 66 characters)
      if (!/^0x[a-fA-F0-9]{40}$/.test(castHash)) {
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'verifyShare',
          'Invalid cast hash format',
        );
      }
      console.log('CAST HASH', castHash);

      // Get the user from database
      const dbUser = await this.userService.getByFid(user.sub);
      if (!dbUser) {
        return hasError(
          res,
          HttpStatus.NOT_FOUND,
          'verifyShare',
          'User not found',
        );
      }

      // Get the vote and check if it belongs to the user
      const vote = await this.brandService.getVoteById(voteId);
      if (!vote) {
        return hasError(
          res,
          HttpStatus.NOT_FOUND,
          'verifyShare',
          'Vote not found',
        );
      }

      if (vote.user.fid !== dbUser.fid) {
        return hasError(
          res,
          HttpStatus.FORBIDDEN,
          'verifyShare',
          'Vote does not belong to user',
        );
      }

      // Check if vote has already been shared
      if (vote.shared) {
        return hasError(
          res,
          HttpStatus.CONFLICT,
          'verifyShare',
          'Vote has already been shared',
        );
      }

      // Verify cast with Neynar
      try {
        const neynar = new NeynarService();
        const castData = await neynar.getCastByHash(castHash);
        // Verify the cast author FID matches the user
        if (castData.author.fid !== user.sub) {
          return hasError(
            res,
            HttpStatus.FORBIDDEN,
            'verifyShare',
            'Cast was not posted by the authenticated user',
          );
        }

        // Verify the cast contains the correct embed URL
        const expectedEmbedUrl = `https://brnd.land`;

        // Find embed that matches our URL and has the url property
        const correctEmbedIndex = castData.embeds.findIndex((embed) => {
          if ('url' in embed) {
            return embed.url.includes(expectedEmbedUrl);
          }
          return false;
        });

        if (correctEmbedIndex === -1) {
          return hasError(
            res,
            HttpStatus.BAD_REQUEST,
            'verifyShare',
            'Cast does not contain the correct embed URL',
          );
        }

        // We know this embed has the url property since we checked above
        const correctEmbed = castData.embeds[correctEmbedIndex] as any;
        const correctEmbedUrl = correctEmbed.url;
        const voteIdFromQueryParam = correctEmbedUrl.split('?voteId=')[1];
        if (voteId !== voteIdFromQueryParam) {
          return hasError(
            res,
            HttpStatus.BAD_REQUEST,
            'verifyShare',
            'Cast does not contain the correct vote ID',
          );
        }

        // All verifications passed - update vote and award points
        await this.brandService.markVoteAsShared(voteId, castHash);
        const updatedUser = await this.userService.addPoints(dbUser.id, 3);

        return hasResponse(res, {
          verified: true,
          pointsAwarded: 3,
          newTotalPoints: updatedUser.points,
          message: 'Share verified successfully! 3 points awarded.',
        });
      } catch (neynarError) {
        console.error(
          '❌ [VerifyShare] Neynar verification failed:',
          neynarError,
        );

        // Handle specific Neynar errors
        if (neynarError.message?.includes('Cast not found')) {
          return hasError(
            res,
            HttpStatus.NOT_FOUND,
            'verifyShare',
            'Cast not found on Farcaster',
          );
        }

        return hasError(
          res,
          HttpStatus.INTERNAL_SERVER_ERROR,
          'verifyShare',
          'Failed to verify cast with Farcaster',
        );
      }
    } catch (error) {
      console.error('❌ [VerifyShare] Unexpected error:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'verifyShare',
        'An unexpected error occurred during verification',
      );
    }
  }

  /**
   * Handles the request to create a new brand.
   *
   * @param {CurrentUser} user - The current user session.
   * @param {{ name: string }} body - An object containing the name of the new brand.
   */
  @Post('/request')
  @UseGuards(AuthorizationGuard)
  async requestBrand(
    @Session() user: CurrentUser,
    @Body() { name }: { name: string },
    @Res() res: Response,
  ): Promise<Response> {
    try {
      console.log(name, user);
      return hasResponse(res, {});
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'requestBrand',
        error.toString(),
      );
    }
  }

  /**
   * Handles the request to follow a brand.
   *
   * @param {CurrentUser} user - The current user session.
   * @param {string} id - The ID of the brand to follow.
   */
  @Post('/:id/follow')
  @UseGuards(AuthorizationGuard)
  async followBrand(@Session() user: CurrentUser, @Param('id') id: string) {
    console.log({ user, id });
  }

  // Add these endpoints to your BrandController (brand.controller.ts)
  // Place them after your existing endpoints, before the dev endpoints

  /**
   * DEBUG: Get detailed scoring information for top brands
   * This will help us understand why scores are so similar
   */
  @Get('/debug/scoring')
  async debugScoring(@Res() res: Response) {
    console.log('🔍 [DEBUG] Analyzing scoring system...');

    try {
      const debugInfo = await this.brandService.getDebugScoringInfo();

      return hasResponse(res, debugInfo);
    } catch (error) {
      console.error('❌ Error in debug scoring:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'debugScoring',
        error.message,
      );
    }
  }
  /**
   * Get current cycle rankings with time remaining until cycle end
   * PUBLIC ENDPOINT - No authentication required for easy access
   */
  @Get('/cycles/:period/rankings')
  async getCycleRankings(
    @Param('period') period: 'week' | 'month',
    @Query('limit') limit: number = 10,
    @Res() res: Response,
  ) {
    console.log(`getCycleRankings called - period: ${period}, limit: ${limit}`);

    if (period !== 'week' && period !== 'month') {
      return hasError(
        res,
        HttpStatus.BAD_REQUEST,
        'getCycleRankings',
        'Period must be "week" or "month"',
      );
    }

    try {
      console.log(`Fetching ${period} cycle rankings...`);
      const result = await this.brandService.getCycleRankings(period, limit);
      console.log(`Found ${result.rankings.length} brands for ${period} cycle`);

      return hasResponse(res, {
        period,
        rankings: result.rankings,
        cycleInfo: result.cycleInfo,
        metadata: {
          generatedAt: new Date().toISOString(),
          totalBrands: result.rankings.length,
          cycleNumber: result.cycleInfo.cycleNumber,
        },
      });
    } catch (error) {
      console.error('Error in getCycleRankings:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getCycleRankings',
        error.message,
      );
    }
  }

  /**
   * Get deployment info and first vote timestamp
   * PUBLIC ENDPOINT - No authentication required for easy access
   */
  @Get('/deployment-info')
  async getDeploymentInfo(@Res() res: Response) {
    console.log('getDeploymentInfo called - public access');

    try {
      const deploymentInfo = await this.brandService.getDeploymentInfo();
      return hasResponse(res, deploymentInfo);
    } catch (error) {
      console.error('Error in getDeploymentInfo:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getDeploymentInfo',
        error.message,
      );
    }
  }

  /**
   * Get historical weekly leaderboard data
   * PUBLIC ENDPOINT - No authentication required for easy access
   *
   * @param {string} week - Week identifier (YYYY-MM-DD format for the Friday of that week)
   * @param {number} limit - Number of brands to return (default: 10)
   * @param {Response} res - The response object
   * @returns {Promise<Response>} Weekly leaderboard data with available weeks picker
   */
  @Get('/weekly-leaderboard')
  async getWeeklyLeaderboard(
    @Query('week') week: string,
    @Query('limit') limit: number = 10,
    @Res() res: Response,
  ) {
    console.log(`getWeeklyLeaderboard called - week: ${week}, limit: ${limit}`);

    try {
      const result = await this.brandService.getWeeklyLeaderboard(week, limit);

      return hasResponse(res, {
        selectedWeek: week,
        leaderboard: result.leaderboard,
        weekPicker: result.weekPicker,
        metadata: {
          generatedAt: new Date().toISOString(),
          totalBrands: result.leaderboard.length,
          weekNumber: result.weekNumber,
          isCurrentWeek: result.isCurrentWeek,
        },
      });
    } catch (error) {
      console.error('Error in getWeeklyLeaderboard:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getWeeklyLeaderboard',
        error.message,
      );
    }
  }

  // ============================================================================
  // LOCAL DEVELOPMENT SEEDING ENDPOINTS
  // ============================================================================

  /**
   * Seeds brands from brands-seed.json file (LOCAL DEVELOPMENT ONLY).
   *
   * Usage:
   * - POST /brand-service/dev/seed (create new brands, skip existing)
   * - POST /brand-service/dev/seed?overwrite=true (update existing brands)
   *
   * @param {string} overwrite - Whether to overwrite existing brands
   * @param {Response} res - The response object
   * @returns {Promise<Response>} Seeding results with statistics
   */
  @Get('/dev/seed')
  @UseGuards(AuthorizationGuard)
  async seedBrands(
    @Session() user: QuickAuthPayload,
    @Query('overwrite') overwrite: string = 'false',
    @Res() res: Response,
  ): Promise<Response> {
    const adminFids = [16098, 5431];
    if (!adminFids.includes(user.sub)) {
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'seedBrands',
        'Admin access required',
      );
    }
    try {
      const shouldOverwrite = overwrite.toLowerCase() === 'true';
      const result = await this.brandSeederService.seedBrands(shouldOverwrite);

      return hasResponse(res, {
        message: 'Brand seeding completed successfully',
        ...result,
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'seedBrands',
        `Seeding failed: ${error.message}`,
      );
    }
  }

  /**
   * Gets database statistics (LOCAL DEVELOPMENT ONLY).
   * Shows brand counts, categories, and distribution.
   *
   * @param {Response} res - The response object
   * @returns {Promise<Response>} Database statistics
   */
  @Get('/dev/stats')
  @UseGuards(AuthorizationGuard)
  async getDatabaseStats(
    @Session() user: QuickAuthPayload,
    @Res() res: Response,
  ): Promise<Response> {
    const adminFids = [16098, 5431];
    if (!adminFids.includes(user.sub)) {
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'getDatabaseStats',
        'Admin access required',
      );
    }
    try {
      const stats = await this.brandSeederService.getStats();

      return hasResponse(res, {
        message: 'Database statistics retrieved successfully',
        ...stats,
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getDatabaseStats',
        `Failed to get stats: ${error.message}`,
      );
    }
  }

  /**
   * Previews what would happen during seeding without actually doing it (LOCAL DEVELOPMENT ONLY).
   * Shows which brands would be created, which exist, and which are missing channels.
   *
   * @param {Response} res - The response object
   * @returns {Promise<Response>} Preview results
   */
  @Get('/dev/preview')
  @UseGuards(AuthorizationGuard)
  async previewSeeding(
    @Session() user: QuickAuthPayload,
    @Res() res: Response,
  ): Promise<Response> {
    const adminFids = [16098, 5431];
    if (!adminFids.includes(user.sub)) {
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'previewSeeding',
        'Admin access required',
      );
    }
    try {
      const preview = await this.brandSeederService.previewSeeding();

      return hasResponse(res, {
        message: 'Seeding preview completed',
        ...preview,
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'previewSeeding',
        `Preview failed: ${error.message}`,
      );
    }
  }

  /**
   * Retrieves recent podiums from all users (public feed).
   * Shows community voting activity with pagination.
   *
   * @param {number} page - Page number for pagination
   * @param {number} limit - Number of podiums per page
   * @param {Response} res - The response object
   * @returns {Promise<Response>} Recent podiums with user and brand details
   */
  @Get('/recent-podiums')
  @UseGuards(AuthorizationGuard)
  async getRecentPodiums(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      console.log(
        `🏆 [RecentPodiums] Fetching page ${page} with limit ${limit}`,
      );

      const [podiums, count] = await this.brandService.getRecentPodiums(
        page,
        limit,
      );

      // Format the response to match frontend expectations
      const formattedPodiums = podiums.map((vote) => ({
        id: vote.id,
        date: vote.date,
        createdAt: vote.date,
        user: {
          fid: vote.user.fid,
          username: vote.user.username,
          photoUrl: vote.user.photoUrl,
        },
        brands: [
          {
            id: vote.brand1.id,
            name: vote.brand1.name,
            imageUrl: vote.brand1.imageUrl,
            score: vote.brand1.score,
            ranking: vote.brand1.ranking,
          },
          {
            id: vote.brand2.id,
            name: vote.brand2.name,
            imageUrl: vote.brand2.imageUrl,
            score: vote.brand2.score,
            ranking: vote.brand2.ranking,
          },
          {
            id: vote.brand3.id,
            name: vote.brand3.name,
            imageUrl: vote.brand3.imageUrl,
            score: vote.brand3.score,
            ranking: vote.brand3.ranking,
          },
        ],
        pointsAwarded: 100, // Total points (60 + 30 + 10)
      }));

      return hasResponse(res, {
        podiums: formattedPodiums,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
          hasNextPage: page * limit < count,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error('❌ [RecentPodiums] Error fetching podiums:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getRecentPodiums',
        'Failed to fetch recent podiums',
      );
    }
  }

  /**
   * Clears all brands from database (LOCAL DEVELOPMENT ONLY).
   * Use with extreme caution!
   *
   * @param {string} confirm - Must be 'yes' to proceed
   * @param {Response} res - The response object
   * @returns {Promise<Response>} Deletion results
   */
  @Post('/dev/clear')
  @UseGuards(AuthorizationGuard)
  async clearAllBrands(
    @Session() user: QuickAuthPayload,
    @Query('confirm') confirm: string,
    @Res() res: Response,
  ): Promise<Response> {
    const adminFids = [16098, 5431];
    if (!adminFids.includes(user.sub)) {
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'clearAllBrands',
        'Admin access required',
      );
    }
    try {
      if (confirm !== 'yes') {
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'clearAllBrands',
          'Must provide ?confirm=yes to clear all brands',
        );
      }

      const deletedCount = await this.brandSeederService.clearAllBrands();

      return hasResponse(res, {
        message: `Successfully cleared ${deletedCount} brands from database`,
        deletedCount,
        warning: 'This action cannot be undone',
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'clearAllBrands',
        `Failed to clear brands: ${error.message}`,
      );
    }
  }
}
