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

  @Get('database-summary')
  async getDatabaseSummary(@Res() res: Response) {
    try {
      console.log(`📊 [CONTROLLER] Getting database summary...`);

      const summary = await this.airdropService.getDatabaseSummary();

      console.log(`✅ [CONTROLLER] Database summary generated successfully`);

      return hasResponse(res, {
        message: 'Database summary generated successfully',
        summary,
      });
    } catch (error) {
      console.error('Error generating database summary:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getDatabaseSummary',
        'Error generating database summary',
      );
    }
  }

  @Get('fix-zero-allocations')
  async fixZeroAllocations(@Res() res: Response) {
    try {
      console.log(`🔧 [CONTROLLER] Fixing zero score allocations...`);

      const result = await this.airdropService.fixZeroScoreAllocations();

      console.log(`✅ [CONTROLLER] Zero allocation fix completed`);

      return hasResponse(res, {
        message: 'Zero score allocations fixed successfully',
        results: result,
      });
    } catch (error) {
      console.error('Error fixing zero allocations:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'fixZeroAllocations',
        'Error fixing zero allocations',
      );
    }
  }

  @Get('recalculate-tokens')
  async recalculateTokens(@Res() res: Response) {
    try {
      console.log(`🔄 [CONTROLLER] Starting token recalculation...`);

      const result = await this.airdropService.recalculateTokenDistribution();

      console.log(`✅ [CONTROLLER] Token recalculation completed`);

      return hasResponse(res, {
        message: 'Token distribution recalculated successfully',
        results: result,
      });
    } catch (error) {
      console.error('Error recalculating token distribution:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'recalculateTokens',
        'Error recalculating token distribution',
      );
    }
  }

  @Get('analytics')
  async getAnalytics(@Res() res: Response) {
    try {
      console.log(`📊 [CONTROLLER] Getting airdrop analytics...`);

      const analytics = await this.airdropService.getAirdropAnalytics();

      // Generate HTML report
      const html = `
<!DOCTYPE html>
<html>
<head>
    <title>BRND Airdrop Analytics Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .card { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .stat-box { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; }
        .stat-number { font-size: 24px; font-weight: bold; color: #2563eb; }
        .stat-label { color: #6b7280; margin-top: 5px; }
        .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        .table th, .table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        .table th { background: #f9fafb; font-weight: 600; }
        .highlight { background: #fef3cd; }
        .text-green { color: #16a34a; }
        .text-red { color: #dc2626; }
        .text-blue { color: #2563eb; }
        h1 { color: #1f2937; text-align: center; }
        h2 { color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 BRND Airdrop Analytics Dashboard</h1>
        
        <div class="card">
            <h2>📊 Summary</h2>
            <div class="stat-grid">
                <div class="stat-box">
                    <div class="stat-number">${analytics.summary.totalUsers.toLocaleString()}</div>
                    <div class="stat-label">Total Users</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${analytics.summary.totalTokensDistributed.toLocaleString()}</div>
                    <div class="stat-label">Total Tokens</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">$${analytics.summary.totalUSDValue.toLocaleString()}</div>
                    <div class="stat-label">Total USD Value</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${analytics.summary.averageTokensPerUser.toLocaleString()}</div>
                    <div class="stat-label">Avg Tokens/User</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">$${analytics.summary.averageUSDPerUser}</div>
                    <div class="stat-label">Avg USD/User</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">$${analytics.summary.brndUSDPrice}</div>
                    <div class="stat-label">BRND Price</div>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>💰 USD Distribution</h2>
            <div class="stat-grid">
                <div class="stat-box">
                    <div class="stat-number text-red">${analytics.usdDistribution.under1USD}</div>
                    <div class="stat-label">Under $1</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${analytics.usdDistribution.between1_5USD}</div>
                    <div class="stat-label">$1 - $5</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${analytics.usdDistribution.between5_10USD}</div>
                    <div class="stat-label">$5 - $10</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${analytics.usdDistribution.between10_20USD}</div>
                    <div class="stat-label">$10 - $20</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${analytics.usdDistribution.between20_30USD}</div>
                    <div class="stat-label">$20 - $30</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number text-green">${analytics.usdDistribution.over30USD}</div>
                    <div class="stat-label">Over $30</div>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>🏆 Top 20 Users</h2>
            <table class="table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Username</th>
                        <th>FID</th>
                        <th>Airdrop Score</th>
                        <th>Tokens</th>
                        <th>USD Value</th>
                        <th>%</th>
                    </tr>
                </thead>
                <tbody>
                    ${analytics.topUsers.map((user, index) => `
                    <tr ${index < 3 ? 'class="highlight"' : ''}>
                        <td><strong>#${index + 1}</strong></td>
                        <td>${user.user?.username || 'Unknown'}</td>
                        <td>${user.fid}</td>
                        <td>${Number(user.finalScore).toLocaleString()}</td>
                        <td>${Number(user.tokenAllocation).toLocaleString()}</td>
                        <td class="text-green"><strong>$${user.usdValue}</strong></td>
                        <td>${Number(user.percentage).toFixed(3)}%</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>📉 Bottom 20 Users</h2>
            <table class="table">
                <thead>
                    <tr>
                        <th>Username</th>
                        <th>FID</th>
                        <th>Airdrop Score</th>
                        <th>Tokens</th>
                        <th>USD Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${analytics.bottomUsers.map(user => `
                    <tr>
                        <td>${user.user?.username || 'Unknown'}</td>
                        <td>${user.fid}</td>
                        <td>${Number(user.finalScore).toLocaleString()}</td>
                        <td>${Number(user.tokenAllocation).toLocaleString()}</td>
                        <td class="text-blue">$${user.usdValue}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>📈 Key Statistics</h2>
            <div class="stat-grid">
                <div class="stat-box">
                    <div class="stat-number text-green">${analytics.statistics.highestAllocation.tokens.toLocaleString()}</div>
                    <div class="stat-label">Highest Tokens</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number text-green">$${analytics.statistics.highestAllocation.usd}</div>
                    <div class="stat-label">Highest USD</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${analytics.statistics.lowestAllocation.tokens.toLocaleString()}</div>
                    <div class="stat-label">Lowest Tokens</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">$${analytics.statistics.lowestAllocation.usd}</div>
                    <div class="stat-label">Lowest USD</div>
                </div>
            </div>
        </div>
        
        <div style="text-align: center; margin: 40px 0; color: #6b7280;">
            Generated on ${new Date().toLocaleString()}
        </div>
    </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      console.error('Error generating analytics:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getAnalytics',
        'Error generating analytics',
      );
    }
  }

  @Get('calculate-all-users')
  async calculateAllUsers(@Res() res: Response, @Query('batchSize') batchSize?: string) {
    try {
      const batchSizeNum = batchSize ? parseInt(batchSize, 10) : 10;
      const maxBatchSize = 50;
      const actualBatchSize = Math.min(batchSizeNum, maxBatchSize);

      console.log(`🚀 [CONTROLLER] Starting bulk airdrop calculation with batch size: ${actualBatchSize}`);

      const result = await this.airdropService.calculateAirdropForAllUsers(actualBatchSize);

      console.log(`✅ [CONTROLLER] Bulk calculation completed:`, result);

      return hasResponse(res, {
        message: 'Bulk airdrop calculation completed',
        results: result,
      });
    } catch (error) {
      console.error('Error calculating airdrop for all users:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'calculateAllUsers',
        'Error calculating airdrop for all users',
      );
    }
  }
}
