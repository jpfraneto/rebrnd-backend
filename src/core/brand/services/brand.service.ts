// Dependencies
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, MoreThan, Repository } from 'typeorm';

// Models
import { Brand, UserBrandVotes } from '../../../models';

// Services
import { UserService } from '../../user/services';
import { User } from '../../../security/decorators';
import NeynarService from '../../../utils/neynar';
import { getConfig } from '../../../security/config';

// Types
import { BrandOrderType, BrandResponse } from '.';
import { BrandTimePeriod } from '../brand.controller';

@Injectable()
export class BrandService {
  private readonly config = getConfig();

  constructor(
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,

    @InjectRepository(UserBrandVotes)
    private readonly userBrandVotesRepository: Repository<UserBrandVotes>,

    private readonly userService: UserService,
  ) {}

  // Add these methods to your BrandService (brand.service.ts)
  // Add the UserBrandVotes import if you don't have it
  // import { UserBrandVotes } from '../../../models';

  /**
   * Get cycle rankings with time remaining information
   * Safe read-only method for generating weekly/monthly screenshots
   */
  async getCycleRankings(period: 'week' | 'month', limit: number = 10) {
    console.log(`Getting ${period} cycle rankings, limit: ${limit}`);

    // Calculate cycle information to get current period dates
    const cycleInfo = this.calculateCycleInfo(period);

    // Get period start date
    const periodStart = new Date(cycleInfo.startTime);
    const now = new Date();

    // Get all brands first
    const allBrands = await this.brandRepository.find({
      where: { banned: 0 },
      relations: ['category'],
      select: [
        'id',
        'name',
        'imageUrl',
        'url',
        'warpcastUrl',
        'profile',
        'channel',
        'followerCount',
        'score',
        'ranking',
      ],
    });

    // Calculate current period scores for each brand
    const brandScoresMap = new Map<number, number>();

    // Get all votes for the current period
    const periodVotes = await this.userBrandVotesRepository
      .createQueryBuilder('vote')
      .leftJoinAndSelect('vote.brand1', 'brand1')
      .leftJoinAndSelect('vote.brand2', 'brand2')
      .leftJoinAndSelect('vote.brand3', 'brand3')
      .where('vote.date > :periodStart', { periodStart })
      .andWhere('vote.date <= :now', { now })
      .getMany();

    // Calculate scores from votes
    for (const vote of periodVotes) {
      if (vote.brand1) {
        const currentScore = brandScoresMap.get(vote.brand1.id) || 0;
        brandScoresMap.set(vote.brand1.id, currentScore + 60);
      }
      if (vote.brand2) {
        const currentScore = brandScoresMap.get(vote.brand2.id) || 0;
        brandScoresMap.set(vote.brand2.id, currentScore + 30);
      }
      if (vote.brand3) {
        const currentScore = brandScoresMap.get(vote.brand3.id) || 0;
        brandScoresMap.set(vote.brand3.id, currentScore + 10);
      }
    }

    // Add period scores to brands and sort
    const brandsWithPeriodScores = allBrands.map((brand) => ({
      ...brand,
      periodScore: brandScoresMap.get(brand.id) || 0,
    }));

    // Sort by period score and take top brands
    const topBrands = brandsWithPeriodScores
      .sort((a, b) => b.periodScore - a.periodScore)
      .slice(0, limit);

    // Format rankings with position and percentage of leader
    const leader = topBrands[0];
    const leaderScore = leader ? leader.periodScore : 0;

    const rankings = topBrands.map((brand, index) => ({
      position: index + 1,
      brand: {
        id: brand.id,
        name: brand.name,
        imageUrl: brand.imageUrl,
        url: brand.url,
        warpcastUrl: brand.warpcastUrl,
        profile: brand.profile,
        channel: brand.channel,
        followerCount: brand.followerCount,
        category: brand.category?.name || 'Uncategorized',
      },
      scores: {
        allTime: brand.score,
        current: brand.periodScore, // Current period score (dynamically calculated)
      },
      rankings: {
        allTime: parseInt(brand.ranking) || 0,
      },
      percentageOfLeader:
        leaderScore > 0
          ? Math.round((brand.periodScore / leaderScore) * 100)
          : 0,
    }));

    return {
      rankings,
      cycleInfo,
    };
  }

  /**
   * Get deployment information including first vote timestamp
   * Safe read-only method
   */
  async getDeploymentInfo() {
    console.log('Getting deployment information...');

    // Get first vote to understand actual deployment time
    const firstVote = await this.userBrandVotesRepository.findOne({
      order: { date: 'ASC' },
      select: ['id', 'date'],
    });

    // Get total votes count
    const totalVotes = await this.userBrandVotesRepository.count();

    // Get latest vote
    const latestVote = await this.userBrandVotesRepository.findOne({
      order: { date: 'DESC' },
      select: ['id', 'date'],
    });

    // Calculate cycles based on assumed deployment time
    const deploymentTime = this.getDeploymentTime();
    const currentTime = new Date();

    const weekCycleInfo = this.calculateCycleInfo('week');
    const monthCycleInfo = this.calculateCycleInfo('month');

    return {
      deployment: {
        assumedTime: deploymentTime.toISOString(),
        timezone: 'America/Santiago (Chile)',
        note: 'Deployed Friday June 20th, 2025 at 3pm Chile time',
      },
      firstVote: firstVote
        ? {
            id: firstVote.id,
            timestamp: firstVote.date.toISOString(),
            timeFromDeployment:
              firstVote.date.getTime() - deploymentTime.getTime(),
          }
        : null,
      latestVote: latestVote
        ? {
            id: latestVote.id,
            timestamp: latestVote.date.toISOString(),
          }
        : null,
      statistics: {
        totalVotes,
        daysActive: Math.floor(
          (currentTime.getTime() - deploymentTime.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      },
      cycles: {
        week: weekCycleInfo,
        month: monthCycleInfo,
      },
    };
  }

  /**
   * Calculate cycle information (when it started, when it ends, time remaining)
   */
  private calculateCycleInfo(period: 'week' | 'month') {
    const deploymentTime = this.getDeploymentTime();
    const currentTime = new Date();

    if (period === 'week') {
      // Weekly cycles: Friday 3pm Chile time
      return this.calculateWeeklyCycle(deploymentTime, currentTime);
    } else {
      // Monthly cycles: 1st of month, 9 AM UTC (as mentioned in your docs)
      return this.calculateMonthlyCycle(currentTime);
    }
  }

  /**
   * Calculate weekly cycle information
   */
  private calculateWeeklyCycle(deploymentTime: Date, currentTime: Date) {
    // Convert deployment time to Santiago timezone for calculation
    // Find the first Friday 3pm after deployment
    const cycleStart = new Date(deploymentTime);

    // If deployment was exactly Friday 3pm, that's cycle 1 start
    // Otherwise, find next Friday 3pm
    while (cycleStart.getUTCDay() !== 5 || cycleStart.getUTCHours() !== 18) {
      // 18 UTC = 3pm Chile
      cycleStart.setTime(cycleStart.getTime() + 60 * 60 * 1000); // Add 1 hour
    }

    // Calculate which cycle we're in
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const timeSinceFirstCycle = currentTime.getTime() - cycleStart.getTime();
    const cycleNumber = Math.floor(timeSinceFirstCycle / msPerWeek) + 1;

    // Calculate current cycle boundaries
    const currentCycleStart = new Date(
      cycleStart.getTime() + (cycleNumber - 1) * msPerWeek,
    );
    const currentCycleEnd = new Date(currentCycleStart.getTime() + msPerWeek);

    const timeRemaining = currentCycleEnd.getTime() - currentTime.getTime();

    return {
      period: 'week',
      cycleNumber,
      startTime: currentCycleStart.toISOString(),
      endTime: currentCycleEnd.toISOString(),
      timeRemaining: {
        milliseconds: timeRemaining,
        days: Math.floor(timeRemaining / (1000 * 60 * 60 * 24)),
        hours: Math.floor(
          (timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
        ),
        minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)),
      },
      isActive: timeRemaining > 0,
      nextCycleStart: new Date(currentCycleEnd.getTime()).toISOString(),
    };
  }

  /**
   * Calculate monthly cycle information
   */
  private calculateMonthlyCycle(currentTime: Date) {
    const currentYear = currentTime.getUTCFullYear();
    const currentMonth = currentTime.getUTCMonth();

    // Current month cycle: 1st day, 9 AM UTC
    const currentCycleStart = new Date(
      Date.UTC(currentYear, currentMonth, 1, 9, 0, 0),
    );

    // Next month cycle start
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    const currentCycleEnd = new Date(Date.UTC(nextYear, nextMonth, 1, 9, 0, 0));

    const timeRemaining = currentCycleEnd.getTime() - currentTime.getTime();

    // Calculate cycle number since June 2025 (when you deployed)
    const deploymentMonth = new Date(2025, 5, 1); // June 2025
    const monthsDiff = (currentYear - 2025) * 12 + currentMonth - 5;
    const cycleNumber = monthsDiff + 1;

    return {
      period: 'month',
      cycleNumber,
      startTime: currentCycleStart.toISOString(),
      endTime: currentCycleEnd.toISOString(),
      timeRemaining: {
        milliseconds: timeRemaining,
        days: Math.floor(timeRemaining / (1000 * 60 * 60 * 24)),
        hours: Math.floor(
          (timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
        ),
        minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)),
      },
      isActive: timeRemaining > 0,
      nextCycleStart: new Date(currentCycleEnd.getTime()).toISOString(),
    };
  }

  /**
   * DEBUG: Get detailed information about the scoring system
   */
  async getDebugScoringInfo() {
    console.log('🔍 [BrandService] Debugging scoring system...');

    // Get top 10 brands with ALL score fields
    const brands = await this.brandRepository.find({
      where: { banned: 0 },
      order: { score: 'DESC' },
      take: 10,
      select: [
        'id',
        'name',
        'score', // All-time
        'scoreWeek', // Weekly
        'scoreMonth', // Monthly
        'stateScore',
        'stateScoreWeek',
        'stateScoreMonth',
        'createdAt',
      ],
    });

    // Get some recent votes to see scoring logic
    const recentVotes = await this.userBrandVotesRepository.find({
      order: { date: 'DESC' },
      take: 5,
      relations: ['brand1', 'brand2', 'brand3'],
      select: {
        id: true,
        date: true,
        brand1: { id: true, name: true },
        brand2: { id: true, name: true },
        brand3: { id: true, name: true },
      },
    });

    // Calculate time periods
    const now = new Date();
    const deploymentTime = this.getDeploymentTime();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get vote counts for different periods
    const totalVotes = await this.userBrandVotesRepository.count();

    const votesThisWeek = await this.userBrandVotesRepository.count({
      where: {
        date: MoreThan(weekAgo),
      },
    });

    const votesThisMonth = await this.userBrandVotesRepository.count({
      where: {
        date: MoreThan(monthAgo),
      },
    });

    // Analyze the differences
    const scoreDifferences = brands.map((brand) => ({
      name: brand.name,
      scores: {
        allTime: brand.score,
        week: brand.scoreWeek,
        month: brand.scoreMonth,
      },
      differences: {
        monthVsAll: brand.score - brand.scoreMonth,
        weekVsAll: brand.score - brand.scoreWeek,
        monthVsWeek: brand.scoreMonth - brand.scoreWeek,
      },
      percentages: {
        monthOfAll:
          brand.score > 0
            ? Math.round((brand.scoreMonth / brand.score) * 100)
            : 0,
        weekOfAll:
          brand.score > 0
            ? Math.round((brand.scoreWeek / brand.score) * 100)
            : 0,
      },
    }));

    return {
      timestamp: now.toISOString(),
      deployment: {
        time: deploymentTime.toISOString(),
        daysAgo: Math.floor(
          (now.getTime() - deploymentTime.getTime()) / (1000 * 60 * 60 * 24),
        ),
      },
      voteCounts: {
        total: totalVotes,
        thisWeek: votesThisWeek,
        thisMonth: votesThisMonth,
      },
      periodAnalysis: {
        weekAgo: weekAgo.toISOString(),
        monthAgo: monthAgo.toISOString(),
      },
      topBrands: scoreDifferences,
      recentVotes: recentVotes.map((vote) => ({
        id: vote.id,
        date: vote.date.toISOString(),
        brands: [vote.brand1?.name, vote.brand2?.name, vote.brand3?.name],
      })),
      suspiciousPatterns: {
        allScoresIdentical: brands.every((b) => b.score === b.scoreMonth),
        weekScoresIdentical: brands.every((b) => b.scoreWeek === b.scoreMonth),
        noWeeklyDifference: brands.every(
          (b) => Math.abs(b.score - b.scoreWeek) < 10,
        ),
        noMonthlyDifference: brands.every(
          (b) => Math.abs(b.score - b.scoreMonth) < 10,
        ),
      },
    };
  }

  /**
   * Get historical weekly leaderboard data with week picker
   * Provides leaderboard data for a specific week and available weeks for selection
   */
  async getWeeklyLeaderboard(week: string, limit: number = 10) {
    console.log(
      `Getting weekly leaderboard for week: ${week}, limit: ${limit}`,
    );

    const deploymentTime = this.getDeploymentTime();
    const currentTime = new Date();

    // Generate available weeks from deployment until now
    const availableWeeks = this.generateAvailableWeeks(
      deploymentTime,
      currentTime,
    );

    // If no week specified, use the most recent week
    const selectedWeek =
      week || availableWeeks[availableWeeks.length - 1]?.value;

    if (!selectedWeek) {
      throw new Error('No weeks available yet');
    }

    // Validate week format and existence
    const selectedWeekData = availableWeeks.find(
      (w) => w.value === selectedWeek,
    );
    if (!selectedWeekData) {
      throw new Error('Invalid week selected');
    }

    // Parse the week date (YYYY-MM-DD format for Friday of that week)
    const weekDate = new Date(selectedWeek + 'T18:00:00.000Z'); // 3pm Chile time
    const weekStart = new Date(weekDate.getTime() - 6 * 24 * 60 * 60 * 1000); // Saturday before
    const weekEnd = new Date(weekDate.getTime() + 24 * 60 * 60 * 1000); // Saturday after

    console.log(
      `Week period: ${weekStart.toISOString()} to ${weekEnd.toISOString()}`,
    );

    // Get all votes for this specific week
    const weekVotes = await this.userBrandVotesRepository
      .createQueryBuilder('vote')
      .leftJoinAndSelect('vote.brand1', 'brand1')
      .leftJoinAndSelect('vote.brand2', 'brand2')
      .leftJoinAndSelect('vote.brand3', 'brand3')
      .where('vote.date > :weekStart', { weekStart })
      .andWhere('vote.date <= :weekEnd', { weekEnd })
      .orderBy('vote.date', 'DESC')
      .getMany();

    console.log(`Found ${weekVotes.length} votes for week ${selectedWeek}`);

    // Calculate scores for each brand during this week
    const brandScores = new Map<
      number,
      {
        brand: any;
        score: number;
        votes: { first: number; second: number; third: number };
      }
    >();

    // Process all votes for this week
    for (const vote of weekVotes) {
      // First place brand (60 points)
      if (vote.brand1) {
        const existing = brandScores.get(vote.brand1.id) || {
          brand: vote.brand1,
          score: 0,
          votes: { first: 0, second: 0, third: 0 },
        };
        existing.score += 60;
        existing.votes.first += 1;
        brandScores.set(vote.brand1.id, existing);
      }

      // Second place brand (30 points)
      if (vote.brand2) {
        const existing = brandScores.get(vote.brand2.id) || {
          brand: vote.brand2,
          score: 0,
          votes: { first: 0, second: 0, third: 0 },
        };
        existing.score += 30;
        existing.votes.second += 1;
        brandScores.set(vote.brand2.id, existing);
      }

      // Third place brand (10 points)
      if (vote.brand3) {
        const existing = brandScores.get(vote.brand3.id) || {
          brand: vote.brand3,
          score: 0,
          votes: { first: 0, second: 0, third: 0 },
        };
        existing.score += 10;
        existing.votes.third += 1;
        brandScores.set(vote.brand3.id, existing);
      }
    }

    // Convert to array and sort by score
    const sortedBrands = Array.from(brandScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Format the leaderboard
    const leaderboard = sortedBrands.map((brandData, index) => ({
      position: index + 1,
      brand: {
        id: brandData.brand.id,
        name: brandData.brand.name,
        imageUrl: brandData.brand.imageUrl,
        url: brandData.brand.url,
        warpcastUrl: brandData.brand.warpcastUrl,
        profile: brandData.brand.profile,
        channel: brandData.brand.channel,
      },
      weekScore: brandData.score,
      voteBreakdown: brandData.votes,
      totalVotes:
        brandData.votes.first + brandData.votes.second + brandData.votes.third,
    }));

    // Calculate week number
    const weekNumber = this.calculateWeekNumber(
      deploymentTime,
      new Date(selectedWeek + 'T18:00:00.000Z'),
    );
    const isCurrentWeek = this.isCurrentWeek(
      new Date(selectedWeek + 'T18:00:00.000Z'),
    );

    return {
      leaderboard,
      weekPicker: availableWeeks,
      weekNumber,
      isCurrentWeek,
      weekPeriod: {
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
        friday: weekDate.toISOString(),
      },
    };
  }

  /**
   * Generate list of available weeks from deployment until now
   */
  private generateAvailableWeeks(deploymentTime: Date, currentTime: Date) {
    const weeks = [];
    const firstFriday = this.getFirstFriday(deploymentTime);

    let currentWeek = new Date(firstFriday);

    while (currentWeek.getTime() <= currentTime.getTime()) {
      // Format as YYYY-MM-DD for the Friday of that week
      const weekValue = currentWeek.toISOString().split('T')[0];
      const weekLabel = this.formatWeekLabel(currentWeek);

      weeks.push({
        value: weekValue,
        label: weekLabel,
        isCurrentWeek: this.isCurrentWeek(currentWeek),
      });

      // Move to next Friday
      currentWeek = new Date(currentWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    return weeks.reverse(); // Most recent first
  }

  /**
   * Get the first Friday at 3pm Chile time after deployment
   */
  private getFirstFriday(deploymentTime: Date): Date {
    const friday = new Date(deploymentTime);

    // If deployment was exactly Friday 3pm Chile, that's the first Friday
    if (friday.getUTCDay() === 5 && friday.getUTCHours() === 18) {
      return friday;
    }

    // Otherwise, find the next Friday 3pm Chile
    while (friday.getUTCDay() !== 5 || friday.getUTCHours() !== 18) {
      friday.setTime(friday.getTime() + 60 * 60 * 1000); // Add 1 hour
    }

    return friday;
  }

  /**
   * Format week label for display
   */
  private formatWeekLabel(friday: Date): string {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Santiago',
    };

    const fridayStr = friday.toLocaleDateString('en-US', options);

    // Calculate the Saturday before (start of week)
    const saturday = new Date(friday.getTime() - 6 * 24 * 60 * 60 * 1000);
    const saturdayStr = saturday.toLocaleDateString('en-US', options);

    return `${saturdayStr} - ${fridayStr}`;
  }

  /**
   * Calculate week number since deployment
   */
  private calculateWeekNumber(deploymentTime: Date, weekFriday: Date): number {
    const firstFriday = this.getFirstFriday(deploymentTime);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksDiff = Math.floor(
      (weekFriday.getTime() - firstFriday.getTime()) / msPerWeek,
    );
    return weeksDiff + 1;
  }

  /**
   * Check if a Friday date represents the current week
   */
  private isCurrentWeek(friday: Date): boolean {
    const now = new Date();
    const currentWeekFriday = this.getCurrentWeekFriday(now);
    return (
      friday.toISOString().split('T')[0] ===
      currentWeekFriday.toISOString().split('T')[0]
    );
  }

  /**
   * Get the Friday of the current week
   */
  private getCurrentWeekFriday(date: Date): Date {
    const deploymentTime = this.getDeploymentTime();
    const firstFriday = this.getFirstFriday(deploymentTime);

    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksSinceFirst = Math.floor(
      (date.getTime() - firstFriday.getTime()) / msPerWeek,
    );

    return new Date(firstFriday.getTime() + weeksSinceFirst * msPerWeek);
  }

  /**
   * Get the assumed deployment time
   */
  private getDeploymentTime(): Date {
    // Friday June 20th, 2025 at 3pm Chile time
    // Chile is UTC-3, so 3pm Chile = 6pm UTC
    return new Date('2025-06-20T18:00:00.000Z');
  }

  /**
   * Retrieves a brand by its ID with optional selected fields and relations.
   * Now includes fan count (unique users who have voted for this brand).
   *
   * @param {Brand['id']} id - The ID of the brand to retrieve.
   * @param {(keyof Brand)[]} [select=[]] - Optional array of fields to select.
   * @param {(keyof Brand)[]} [relations=[]] - Optional array of relations to include.
   * @returns {Promise<BrandResponse | undefined>} The brand entity or undefined if not found.
   */
  async getById(
    id: Brand['id'],
    select: (keyof Brand)[] = [],
    relations: (keyof Brand)[] = [],
  ): Promise<BrandResponse | undefined> {
    try {
      const brand = await this.brandRepository.findOne({
        ...(select.length > 0 && {
          select,
        }),
        where: {
          id,
        },
        ...(relations.length > 0 && {
          relations,
        }),
      });

      if (!brand) {
        Logger.warn(`Brand with id ${id} not found`);
        return undefined;
      }

      const higherRankedCount = await this.brandRepository
        .createQueryBuilder('brand')
        .where('brand.banned = 0')
        .andWhere('brand.score > :brandScore', { brandScore: brand.score })
        .getCount();

      const currentRanking = higherRankedCount + 1;

      const fanCount = await this.userBrandVotesRepository
        .createQueryBuilder('vote')
        .select('COUNT(DISTINCT vote.userId)', 'count')
        .where(
          '(vote.brand1Id = :brandId OR vote.brand2Id = :brandId OR vote.brand3Id = :brandId)',
          { brandId: id },
        )
        .getRawOne();

      const totalFans = parseInt(fanCount?.count || '0');

      console.log(
        `📊 [BrandService] Brand ${brand.name} has ${totalFans} unique fans`,
      );

      // Fetch Neynar data (existing logic)
      const neynar = new NeynarService();
      let info;
      try {
        info =
          brand.queryType === 0
            ? await neynar.getTrendingCastInAChannel(brand.channel)
            : await neynar.getTrendingCastInAProfile(brand.profile);
      } catch (neynarError) {
        Logger.error(
          `Failed to fetch casts from Neynar: ${neynarError.message}`,
        );
        info = [];
      }

      return {
        brand: {
          ...brand,
          currentRanking,
        },
        casts: info,
        fanCount: totalFans,
      };
    } catch (error) {
      Logger.error(`Error fetching brand with id ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retrieves all brands with pagination.
   * For period-based queries (week/month), dynamically calculates scores from votes.
   *
   * @param {number} [pageId=1] - The page number to retrieve.
   * @param {number} [limit=15] - The number of brands to retrieve per page.
   * @returns {Promise<[Brand[], number]>} A promise that resolves to an array containing the list of brands and the total count.
   */
  async getAll(
    select: (keyof Brand)[] = [],
    relations: (keyof Brand)[] = [],
    order: BrandOrderType = 'all',
    period: BrandTimePeriod = 'all',
    searchName: string = '',
    pageId: number = 1,
    limit: number = 15,
  ): Promise<[Brand[], number]> {
    const hasSearch = searchName !== '';
    const skip = (pageId - 1) * limit;

    // For period-based queries, we need to calculate scores dynamically
    if (period !== 'all' && (order === 'all' || order === 'top')) {
      return this.getAllWithDynamicPeriodScoring(
        select,
        relations,
        order,
        period,
        searchName,
        pageId,
        limit,
      );
    }

    // For all-time scoring or non-score-based ordering, use original logic
    return this.brandRepository.findAndCount({
      ...(select.length > 0 && {
        select,
      }),

      skip,
      take: limit,

      where: {
        ...(hasSearch && {
          name: Like(`${searchName}%`),
        }),
        banned: 0, // Filter out banned brands
      },

      ...(relations.length > 0 && {
        relations,
      }),

      ...(order === 'all' && {
        order: {
          score: 'DESC', // Use all-time score for 'all' period
        },
      }),

      ...(order === 'new' && {
        order: {
          createdAt: 'DESC',
        },
      }),

      ...(order === 'top' && {
        order: {
          score: 'DESC', // Use all-time score for 'all' period
          followerCount: 'DESC',
        },
      }),
    });
  }

  /**
   * Helper method to get brands with dynamic period scoring
   */
  private async getAllWithDynamicPeriodScoring(
    select: (keyof Brand)[] = [],
    relations: (keyof Brand)[] = [],
    order: BrandOrderType = 'all',
    period: BrandTimePeriod,
    searchName: string = '',
    pageId: number = 1,
    limit: number = 15,
  ): Promise<[Brand[], number]> {
    const hasSearch = searchName !== '';
    const skip = (pageId - 1) * limit;

    // Calculate period dates
    const cycleInfo = this.calculateCycleInfo(period as 'week' | 'month');
    const periodStart = new Date(cycleInfo.startTime);
    const now = new Date();

    // Get all brands first (for counting and filtering)
    const allBrands = await this.brandRepository.find({
      ...(select.length > 0 && {
        select,
      }),
      where: {
        ...(hasSearch && {
          name: Like(`${searchName}%`),
        }),
        banned: 0,
      },
      ...(relations.length > 0 && {
        relations,
      }),
    });

    const totalCount = allBrands.length;

    // Calculate period scores for each brand
    const brandScoresMap = new Map<number, number>();

    // Get all votes for the current period
    const periodVotes = await this.userBrandVotesRepository
      .createQueryBuilder('vote')
      .leftJoinAndSelect('vote.brand1', 'brand1')
      .leftJoinAndSelect('vote.brand2', 'brand2')
      .leftJoinAndSelect('vote.brand3', 'brand3')
      .where('vote.date > :periodStart', { periodStart })
      .andWhere('vote.date <= :now', { now })
      .getMany();

    // Calculate scores from votes
    for (const vote of periodVotes) {
      if (vote.brand1) {
        const currentScore = brandScoresMap.get(vote.brand1.id) || 0;
        brandScoresMap.set(vote.brand1.id, currentScore + 60);
      }
      if (vote.brand2) {
        const currentScore = brandScoresMap.get(vote.brand2.id) || 0;
        brandScoresMap.set(vote.brand2.id, currentScore + 30);
      }
      if (vote.brand3) {
        const currentScore = brandScoresMap.get(vote.brand3.id) || 0;
        brandScoresMap.set(vote.brand3.id, currentScore + 10);
      }
    }

    // Add period scores to brands and sort
    const brandsWithPeriodScores = allBrands.map((brand) => ({
      ...brand,
      periodScore: brandScoresMap.get(brand.id) || 0,
    }));

    // Sort by period score and apply pagination
    let sortedBrands = brandsWithPeriodScores.sort(
      (a, b) => b.periodScore - a.periodScore,
    );

    // Apply additional sorting for 'top' order
    if (order === 'top') {
      sortedBrands = sortedBrands.sort((a, b) => {
        if (b.periodScore !== a.periodScore) {
          return b.periodScore - a.periodScore;
        }
        return (b.followerCount || 0) - (a.followerCount || 0);
      });
    }

    // Apply pagination
    const paginatedBrands = sortedBrands.slice(skip, skip + limit);

    // Remove the temporary periodScore field before returning
    const finalBrands = paginatedBrands.map((brand) => {
      const { periodScore, ...brandWithoutPeriodScore } = brand;
      return brandWithoutPeriodScore;
    }) as Brand[];

    return [finalBrands, totalCount];
  }

  /**
   * Checks if all brand IDs exist.
   *
   * @param {Brand['id'][]} brandIds - An array of brand IDs to check.
   * @returns {Promise<boolean>} A promise that resolves to true if all brand IDs exist, otherwise false.
   */
  async doAllBrandsExist(brandIds: Brand['id'][]): Promise<boolean> {
    const count = await this.brandRepository.count({
      where: {
        id: In(brandIds),
      },
    });
    return count === brandIds.length;
  }

  /**
   * Retrieves recent podiums (votes) from all users with pagination.
   * Shows public feed of all voting activity.
   *
   * @param {number} page - Page number for pagination
   * @param {number} limit - Number of podiums per page
   * @returns {Promise<[UserBrandVotes[], number]>} Array of votes and total count
   */
  async getRecentPodiums(
    page: number = 1,
    limit: number = 20,
  ): Promise<[UserBrandVotes[], number]> {
    console.log(
      `🏆 [BrandService] Getting recent podiums - page: ${page}, limit: ${limit}`,
    );

    const skip = (page - 1) * limit;

    const [podiums, count] = await this.userBrandVotesRepository.findAndCount({
      relations: [
        'user', // Get user info (username, photoUrl, etc.)
        'brand1', // 1st place brand
        'brand2', // 2nd place brand
        'brand3', // 3rd place brand
      ],
      order: {
        date: 'DESC', // Most recent first
      },
      skip,
      take: limit,
      // Optional: Filter out votes from banned users if needed
      // where: {
      //   user: {
      //     banned: false,
      //   },
      // },
    });

    console.log(
      `🏆 [BrandService] Found ${count} total podiums, returning ${podiums.length} for this page`,
    );

    return [podiums, count];
  }

  /**
   * Gets a vote by ID with user and brand relations.
   *
   * @param voteId - The vote ID to retrieve
   * @returns Vote with user and brand data
   */
  async getVoteById(voteId: string): Promise<UserBrandVotes | null> {
    try {
      const vote = await this.userBrandVotesRepository.findOne({
        where: { id: voteId },
        relations: ['user', 'brand1', 'brand2', 'brand3'],
      });

      return vote;
    } catch (error) {
      console.error('❌ [BrandService] Error getting vote by ID:', error);
      throw new Error('Failed to retrieve vote');
    }
  }

  /**
   * Marks a vote as shared and stores the cast hash.
   *
   * @param voteId - The vote ID to update
   * @param castHash - The Farcaster cast hash
   * @returns Updated vote
   */
  async markVoteAsShared(
    voteId: string,
    castHash: string,
  ): Promise<UserBrandVotes> {
    try {
      const vote = await this.userBrandVotesRepository.findOne({
        where: { id: voteId },
      });

      if (!vote) {
        throw new Error('Vote not found');
      }

      vote.shared = true;
      vote.castHash = castHash;

      return await this.userBrandVotesRepository.save(vote);
    } catch (error) {
      console.error('❌ [BrandService] Error marking vote as shared:', error);
      throw new Error('Failed to update vote sharing status');
    }
  }

  /**
   * Allows a user to vote for three brands.
   *
   * @param {User['id']} userId - The ID of the user voting.
   * @param {Brand['id'][]} brandIds - An array containing the IDs of the brands to vote for. Must contain exactly 3 IDs.
   * @throws Will throw an error if `brandIds` is not an array of length 3.
   * @throws Will throw an error if one or more of the selected brands do not exist.
   * @throws Will throw an error if the user has already voted today.
   * @returns {Promise<UserVote>} A promise that resolves to the user's vote for the current day.
   */
  async voteForBrands(
    fid: number, // Farcaster ID from QuickAuth token
    brandIds: Brand['id'][],
  ): Promise<UserBrandVotes & { bot_cast_hash: string }> {
    console.log(
      `🗳️ [BrandService] User ${fid} attempting to vote for brands:`,
      brandIds.join(', '),
    );

    // Enhanced validation
    if (!Array.isArray(brandIds) || brandIds.length !== 3) {
      throw new Error('Must provide exactly 3 brand IDs for voting.');
    }

    // Check for duplicate brand IDs
    const uniqueBrandIds = new Set(brandIds);
    if (uniqueBrandIds.size !== 3) {
      throw new Error('All selected brands must be different.');
    }

    // Verify that all brands exist in the database
    const doAllBrandsExist = await this.doAllBrandsExist(brandIds);
    if (!doAllBrandsExist) {
      throw new Error('One or more of the selected brands do not exist.');
    }

    // Find the user by FID (they should already exist from /me endpoint)
    const user = await this.userService.getByFid(fid);
    if (!user) {
      throw new Error('User not found. Please refresh the app and try again.');
    }

    console.log(`🗳️ [BrandService] Found user in database:`, {
      id: user.id,
      fid: user.fid,
      username: user.username,
    });

    // Get current UTC date for consistent timezone handling
    const currentDate = Math.floor(new Date().getTime() / 1000);

    const todayVotes = await this.userService.getUserVotes(
      user.id,
      currentDate,
    );
    console.log('TODAY VOTES', todayVotes);

    if (todayVotes !== undefined) {
      throw new Error('You have already voted today.');
    }

    // If everything has gone well, proceed to vote.
    const vote = this.userBrandVotesRepository.create({
      user: {
        id: user.id,
      },
      brand1: {
        id: brandIds[0],
      },
      brand2: {
        id: brandIds[1],
      },
      brand3: {
        id: brandIds[2],
      },
      date: new Date(),
    });

    const savedVote = await this.userBrandVotesRepository.save(vote);
    console.log('THE USER VOTED AND NOW IT IS GOING TO BE CASTED');
    const bot_cast_hash = await this.castUserVoteThroughMarloBot(savedVote);

    // Update user's calculated fields after voting
    await this.userService.updateUserCalculatedFields(user.id);

    await this.userService.addPoints(user.id, 3);
    await this.updateBrandScores(brandIds);

    return { ...savedVote, bot_cast_hash };
  }

  private async castUserVoteThroughMarloBot(
    savedVote: UserBrandVotes,
  ): Promise<string> {
    try {
      if (!this.config.isProduction) {
        return '0x25ea5a47c1c04db081b63493c369b8538c91543a';
      }
      // Fetch the vote with all relations populated
      const voteWithRelations = await this.userBrandVotesRepository.findOne({
        where: { id: savedVote.id },
        relations: ['user', 'brand1', 'brand2', 'brand3'],
      });

      if (!voteWithRelations) {
        throw new Error('Vote not found with relations');
      }

      const getProfileOrChannel = (brand: any) => {
        return brand?.profile || brand?.channel || brand?.name || 'Unknown';
      };

      const profile1 = getProfileOrChannel(voteWithRelations.brand1);
      const profile2 = getProfileOrChannel(voteWithRelations.brand2);
      const profile3 = getProfileOrChannel(voteWithRelations.brand3);

      // Validate required config before making API call
      if (!this.config.neynar.apiKey) {
        throw new Error('Neynar API key is missing');
      }
      if (!this.config.neynar.signerUuid) {
        throw new Error('Neynar signer UUID is missing');
      }

      const neynar_response = await fetch(
        'https://api.neynar.com/v2/farcaster/cast',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.neynar.apiKey,
          },
          body: JSON.stringify({
            signer_uuid: this.config.neynar.signerUuid,
            text: `@${voteWithRelations.user.username} just created a new brnd podium:\n\n🥇${voteWithRelations.brand1.name} - ${profile1}\n🥈${voteWithRelations.brand2.name} - ${profile2}\n🥉${voteWithRelations.brand3.name} - ${profile3}`,
          }),
        },
      );

      if (!neynar_response.ok) {
        const errorText = await neynar_response.text();
        console.log('Neynar error response:', errorText);
        throw new Error(
          `Neynar API error: ${neynar_response.status} - ${errorText}`,
        );
      }

      const data = await neynar_response.json();
      return data.cast.hash;
    } catch (error) {
      console.error(
        'Failed to cast vote through MarloBot:',
        JSON.stringify(error),
      );
      return null;
    }
  }

  private async updateBrandScores(brandIds: Brand['id'][]): Promise<void> {
    const [firstPlace, secondPlace, thirdPlace] = brandIds;

    await Promise.all([
      // First place (60 points) - update ALL score fields
      this.brandRepository.increment({ id: firstPlace }, 'score', 60),
      this.brandRepository.increment({ id: firstPlace }, 'stateScore', 60),
      this.brandRepository.increment({ id: firstPlace }, 'scoreWeek', 60),
      this.brandRepository.increment({ id: firstPlace }, 'scoreMonth', 60),

      // Second place (30 points) - update ALL score fields
      this.brandRepository.increment({ id: secondPlace }, 'score', 30),
      this.brandRepository.increment({ id: secondPlace }, 'stateScore', 30),
      this.brandRepository.increment({ id: secondPlace }, 'scoreWeek', 30),
      this.brandRepository.increment({ id: secondPlace }, 'scoreMonth', 30),

      // Third place (10 points) - update ALL score fields
      this.brandRepository.increment({ id: thirdPlace }, 'score', 10),
      this.brandRepository.increment({ id: thirdPlace }, 'stateScore', 10),
      this.brandRepository.increment({ id: thirdPlace }, 'scoreWeek', 10),
      this.brandRepository.increment({ id: thirdPlace }, 'scoreMonth', 10),
    ]);
  }
}
