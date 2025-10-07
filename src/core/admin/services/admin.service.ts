// src/core/admin/services/admin.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Brand, Category } from '../../../models';
import { CreateBrandDto, UpdateBrandDto } from '../dto';
import NeynarService from '../../../utils/neynar';

import { UserBrandVotes } from '../../../models';

@Injectable()
export class AdminService {
  private neynarService: NeynarService;

  constructor(
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {
    this.neynarService = new NeynarService();
    console.log('AdminService initialized');
  }

  async fixWeeklyScores(): Promise<{ message: string; updatedBrands: number }> {
    console.log('🔄 Fixing weekly scores from votes since last reset...');

    try {
      // Calculate the last Friday 18:00 UTC (when weekly reset happened)
      const lastFridayReset = this.getLastFridayReset();

      console.log(
        `📅 Calculating scores from: ${lastFridayReset.toISOString()}`,
      );

      // Use raw query to update weekly scores
      const result = await this.brandRepository.query(
        `
        UPDATE brands b SET scoreWeek = (
          SELECT COALESCE(SUM(
            CASE 
              WHEN ubv.brand1Id = b.id THEN 60
              WHEN ubv.brand2Id = b.id THEN 30  
              WHEN ubv.brand3Id = b.id THEN 10
              ELSE 0
            END
          ), 0)
          FROM user_brand_votes ubv
          WHERE ubv.date > ?
          AND (ubv.brand1Id = b.id OR ubv.brand2Id = b.id OR ubv.brand3Id = b.id)
        )
      `,
        [lastFridayReset],
      );

      console.log('✅ Weekly scores fixed successfully');

      return {
        message: 'Weekly scores fixed successfully',
        updatedBrands: result.affectedRows || 0,
      };
    } catch (error) {
      console.error('❌ Failed to fix weekly scores:', error);
      throw new Error(`Failed to fix weekly scores: ${error.message}`);
    }
  }

  /**
   * Calculate the last Friday 18:00 UTC when weekly reset happened
   * This uses the same logic as your BrandService deployment time
   */
  private getLastFridayReset(): Date {
    const now = new Date();
    const deploymentTime = new Date('2025-06-20T18:00:00.000Z');

    // Find the first Friday 18:00 UTC after deployment (same as BrandService logic)
    let cycleStart = new Date(deploymentTime);
    while (cycleStart.getUTCDay() !== 5 || cycleStart.getUTCHours() !== 18) {
      cycleStart.setTime(cycleStart.getTime() + 60 * 60 * 1000); // Add 1 hour
    }

    // Calculate which cycle we're in
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const timeSinceFirstCycle = now.getTime() - cycleStart.getTime();
    const cycleNumber = Math.floor(timeSinceFirstCycle / msPerWeek) + 1;

    // Return the start of current cycle (last Friday 18:00 UTC)
    return new Date(cycleStart.getTime() + (cycleNumber - 1) * msPerWeek);
  }

  async getAllBrands(
    page: number = 1,
    limit: number = 50,
    search: string = '',
  ): Promise<[Brand[], number]> {
    const skip = (page - 1) * limit;

    return this.brandRepository.findAndCount({
      where: search ? { name: Like(`%${search}%`) } : {},
      relations: ['category'],
      order: { name: 'ASC' },
      skip,
      take: limit,
    });
  }

  async createBrand(createBrandDto: CreateBrandDto): Promise<Brand> {
    console.log('Creating brand with data:', createBrandDto);

    // Handle channelOrProfile field from frontend
    if (createBrandDto.channelOrProfile) {
      if (createBrandDto.queryType === 0) {
        // Channel type
        createBrandDto.channel = createBrandDto.channelOrProfile.startsWith('/')
          ? createBrandDto.channelOrProfile
          : `/${createBrandDto.channelOrProfile}`;
      } else {
        // Profile type
        createBrandDto.profile = createBrandDto.channelOrProfile.startsWith('@')
          ? createBrandDto.channelOrProfile
          : `@${createBrandDto.channelOrProfile}`;
      }
    }

    // Get or create category with default fallback
    const category = await this.getOrCreateCategory(
      createBrandDto.categoryId || 'General',
    );

    // Handle profile/channel logic similar to seeding service
    const { profile, channel, queryType } =
      this.processProfileAndChannel(createBrandDto);

    // Set warpcastUrl fallback
    const warpcastUrl = createBrandDto.warpcastUrl || createBrandDto.url;

    // Fetch follower count from Neynar if possible
    let followerCount = createBrandDto.followerCount || 0;
    try {
      if (queryType === 0 && channel) {
        // Channel query - remove leading slash for API
        followerCount = await this.neynarService.getChannelFollowerCount(
          channel.startsWith('/') ? channel.slice(1) : channel,
        );
      } else if (queryType === 1 && profile) {
        // Profile query - remove leading @ for API
        followerCount = await this.neynarService.getProfileFollowerCount(
          profile.startsWith('@') ? profile.slice(1) : profile,
        );
      }
    } catch (error) {
      console.warn(
        'Failed to fetch follower count from Neynar:',
        error.message,
      );
      // Continue with provided or default value
    }

    const brand = this.brandRepository.create({
      name: createBrandDto.name,
      url: createBrandDto.url,
      warpcastUrl,
      description: createBrandDto.description,
      imageUrl: createBrandDto.imageUrl || '',
      profile,
      channel,
      queryType,
      followerCount,
      category,
      // Initialize scoring fields (like seeding service)
      score: 0,
      stateScore: 0,
      scoreWeek: 0,
      stateScoreWeek: 0,
      scoreMonth: 0,
      stateScoreMonth: 0,
      ranking: '0',
      rankingWeek: 0,
      rankingMonth: 0,
      bonusPoints: 0,
      banned: 0,
      currentRanking: 0,
    });

    const savedBrand = await this.brandRepository.save(brand);
    console.log('Brand created successfully:', savedBrand);
    return savedBrand;
  }

  async updateBrand(
    id: number,
    updateBrandDto: UpdateBrandDto,
  ): Promise<Brand> {
    console.log(`Updating brand ${id} with data:`, updateBrandDto);

    const brand = await this.brandRepository.findOne({
      where: { id },
      relations: ['category'],
    });

    if (!brand) {
      throw new Error('Brand not found');
    }

    // If category is being updated, get or create it
    if (updateBrandDto.categoryId) {
      brand.category = await this.getOrCreateCategory(
        updateBrandDto.categoryId,
      );
    }

    // Update basic fields
    if (updateBrandDto.name !== undefined) brand.name = updateBrandDto.name;
    if (updateBrandDto.url !== undefined) brand.url = updateBrandDto.url;
    if (updateBrandDto.warpcastUrl !== undefined)
      brand.warpcastUrl = updateBrandDto.warpcastUrl;
    if (updateBrandDto.description !== undefined)
      brand.description = updateBrandDto.description;
    if (updateBrandDto.imageUrl !== undefined)
      brand.imageUrl = updateBrandDto.imageUrl;

    // Handle profile/channel updates
    if (
      updateBrandDto.queryType !== undefined ||
      updateBrandDto.profile !== undefined ||
      updateBrandDto.channel !== undefined
    ) {
      const updateData = {
        ...brand,
        ...updateBrandDto,
      };

      const { profile, channel, queryType } =
        this.processProfileAndChannel(updateData);
      brand.profile = profile;
      brand.channel = channel;
      brand.queryType = queryType;
    }

    // Update follower count if needed
    if (updateBrandDto.followerCount !== undefined) {
      brand.followerCount = updateBrandDto.followerCount;
    }

    const savedBrand = await this.brandRepository.save(brand);
    console.log('Brand updated successfully:', savedBrand);
    return savedBrand;
  }

  async deleteBrand(id: number): Promise<void> {
    const brand = await this.brandRepository.findOne({ where: { id } });

    if (!brand) {
      throw new Error('Brand not found');
    }

    await this.brandRepository.remove(brand);
    console.log(`Brand ${id} deleted successfully`);
  }

  async getCategories(): Promise<Category[]> {
    return this.categoryRepository.find({
      order: { name: 'ASC' },
    });
  }

  /**
   * Refresh follower count for a specific brand from Neynar
   */
  async refreshBrandFollowerCount(id: number): Promise<Brand> {
    const brand = await this.brandRepository.findOne({
      where: { id },
      relations: ['category'],
    });

    if (!brand) {
      throw new Error('Brand not found');
    }

    try {
      let followerCount = 0;

      if (brand.queryType === 0 && brand.channel) {
        // Channel query
        followerCount = await this.neynarService.getChannelFollowerCount(
          brand.channel.startsWith('/')
            ? brand.channel.slice(1)
            : brand.channel,
        );
      } else if (brand.queryType === 1 && brand.profile) {
        // Profile query
        followerCount = await this.neynarService.getProfileFollowerCount(
          brand.profile.startsWith('@')
            ? brand.profile.slice(1)
            : brand.profile,
        );
      }

      brand.followerCount = followerCount;
      return await this.brandRepository.save(brand);
    } catch (error) {
      console.error('Failed to refresh follower count from Neynar:', error);
      throw new Error(`Failed to refresh follower count: ${error.message}`);
    }
  }

  /**
   * Get or create category (like seeding service)
   */
  private async getOrCreateCategory(
    categoryIdOrName: number | string,
  ): Promise<Category> {
    // If it's a number, try to find by ID first
    if (typeof categoryIdOrName === 'number') {
      const existingCategory = await this.categoryRepository.findOne({
        where: { id: categoryIdOrName },
      });

      if (existingCategory) {
        return existingCategory;
      }

      throw new Error(`Category with ID ${categoryIdOrName} not found`);
    }

    // If it's a string, find or create by name
    let category = await this.categoryRepository.findOne({
      where: { name: categoryIdOrName },
    });

    if (!category) {
      category = this.categoryRepository.create({
        name: categoryIdOrName,
      });
      await this.categoryRepository.save(category);
      console.log(`Created new category: ${categoryIdOrName}`);
    }

    return category;
  }

  /**
   * Process profile and channel logic (similar to seeding service)
   */
  private processProfileAndChannel(data: any): {
    profile: string;
    channel: string;
    queryType: number;
  } {
    const hasProfile = data.profile && data.profile.trim() !== '';
    const hasChannel = data.channel && data.channel.trim() !== '';

    let profile = '';
    let channel = '';
    let queryType = data.queryType || 0;

    if (hasChannel) {
      // Use provided channel
      channel = data.channel.startsWith('/')
        ? data.channel
        : `/${data.channel}`;
      queryType = 0; // Channel type
    } else if (hasProfile) {
      // Generate channel from profile or use profile
      profile = data.profile.startsWith('@')
        ? data.profile
        : `@${data.profile}`;

      if (queryType === 0) {
        // If they want channel type but only provided profile, convert
        channel = profile.replace('@', '/');
      } else {
        // Profile type
        queryType = 1;
      }
    } else {
      // No channel or profile - generate fallback
      const fallbackName = data.name.toLowerCase().replace(/\s+/g, '-');

      if (queryType === 0) {
        channel = `/${fallbackName}`;
      } else {
        profile = `@${fallbackName}`;
      }
    }

    return { profile, channel, queryType };
  }
}
