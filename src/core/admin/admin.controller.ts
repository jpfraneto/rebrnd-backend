// src/core/admin/admin.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AdminService } from './services/admin.service';
import { CreateBrandDto, UpdateBrandDto } from './dto';
import { AuthorizationGuard, QuickAuthPayload } from '../../security/guards';
import { Session } from '../../security/decorators';
import { HttpStatus, hasError, hasResponse } from '../../utils';

const adminFids = [5431, 16098];

@ApiTags('admin-service')
@Controller('admin-service')
@UseGuards(AuthorizationGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {
    console.log('AdminController initialized');
  }

  /**
   * Get all brands for admin management
   */
  @Get('brands')
  async getAllBrands(
    @Session() user: QuickAuthPayload,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
    @Query('search') search: string = '',
    @Res() res: Response,
  ) {
    console.log(
      `getAllBrands called - user: ${user.sub}, page: ${page}, limit: ${limit}, search: "${search}"`,
    );

    // Check admin permissions
    if (!adminFids.includes(user.sub)) {
      console.log(`Access denied for user ${user.sub} - not in admin list`);
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'getAllBrands',
        'Admin access required',
      );
    }

    try {
      console.log('Fetching brands from service...');
      const [brands, count] = await this.adminService.getAllBrands(
        page,
        limit,
        search,
      );
      console.log(
        `Found ${count} total brands, returning ${brands.length} results`,
      );

      return hasResponse(res, {
        brands,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (error) {
      console.error('Error in getAllBrands:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getAllBrands',
        error.message,
      );
    }
  }

  /**
   * Create a new brand
   */
  @Post('brands')
  async createBrand(
    @Session() user: QuickAuthPayload,
    @Body() createBrandDto: CreateBrandDto,
    @Res() res: Response,
  ) {
    console.log(`createBrand called - user: ${user.sub}`, createBrandDto);

    if (!adminFids.includes(user.sub)) {
      console.log(`Access denied for user ${user.sub} - not in admin list`);
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'createBrand',
        'Admin access required',
      );
    }

    try {
      console.log('Creating new brand...');
      const brand = await this.adminService.createBrand(createBrandDto);
      console.log('Brand created successfully:', {
        id: brand.id,
        name: brand.name,
        queryType: brand.queryType,
        profile: brand.profile,
        channel: brand.channel,
        followerCount: brand.followerCount,
      });

      return hasResponse(res, {
        brand,
        message: 'Brand created successfully',
      });
    } catch (error) {
      console.error('Error in createBrand:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'createBrand',
        error.message,
      );
    }
  }

  /**
   * Update an existing brand
   */
  @Put('brands/:id')
  async updateBrand(
    @Session() user: QuickAuthPayload,
    @Param('id') id: number,
    @Body() updateBrandDto: UpdateBrandDto,
    @Res() res: Response,
  ) {
    console.log(
      `updateBrand called - user: ${user.sub}, id: ${id}`,
      updateBrandDto,
    );

    if (!adminFids.includes(user.sub)) {
      console.log(`Access denied for user ${user.sub} - not in admin list`);
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'updateBrand',
        'Admin access required',
      );
    }

    try {
      console.log(`Updating brand ${id}...`);

      // Handle channelOrProfile field from frontend
      if (updateBrandDto.channelOrProfile) {
        if (updateBrandDto.queryType === 0) {
          // Channel type
          updateBrandDto.channel = updateBrandDto.channelOrProfile.startsWith(
            '/',
          )
            ? updateBrandDto.channelOrProfile
            : `/${updateBrandDto.channelOrProfile}`;
        } else {
          // Profile type
          updateBrandDto.profile = updateBrandDto.channelOrProfile.startsWith(
            '@',
          )
            ? updateBrandDto.channelOrProfile
            : `@${updateBrandDto.channelOrProfile}`;
        }
      }

      const brand = await this.adminService.updateBrand(id, updateBrandDto);
      console.log('Brand updated successfully:', {
        id: brand.id,
        name: brand.name,
        queryType: brand.queryType,
        profile: brand.profile,
        channel: brand.channel,
        followerCount: brand.followerCount,
      });

      return hasResponse(res, {
        brand,
        message: 'Brand updated successfully',
      });
    } catch (error) {
      console.error('Error in updateBrand:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'updateBrand',
        error.message,
      );
    }
  }

  /**
   * Delete a brand
   */
  @Delete('brands/:id')
  async deleteBrand(
    @Session() user: QuickAuthPayload,
    @Param('id') id: number,
    @Res() res: Response,
  ) {
    console.log(`deleteBrand called - user: ${user.sub}, id: ${id}`);

    if (!adminFids.includes(user.sub)) {
      console.log(`Access denied for user ${user.sub} - not in admin list`);
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'deleteBrand',
        'Admin access required',
      );
    }

    try {
      console.log(`Deleting brand ${id}...`);
      await this.adminService.deleteBrand(id);
      console.log('Brand deleted successfully');
      return hasResponse(res, {
        message: 'Brand deleted successfully',
      });
    } catch (error) {
      console.error('Error in deleteBrand:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'deleteBrand',
        error.message,
      );
    }
  }

  /**
   * Get all categories for brand creation/editing
   */
  @Get('categories')
  async getCategories(@Session() user: QuickAuthPayload, @Res() res: Response) {
    console.log(`getCategories called - user: ${user.sub}`);

    if (!adminFids.includes(user.sub)) {
      console.log(`Access denied for user ${user.sub} - not in admin list`);
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'getCategories',
        'Admin access required',
      );
    }

    try {
      console.log('Fetching categories...');
      const categories = await this.adminService.getCategories();
      console.log(`Found ${categories.length} categories`);
      return hasResponse(res, { categories });
    } catch (error) {
      console.error('Error in getCategories:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'getCategories',
        error.message,
      );
    }
  }

  /**
   * Refresh follower count for a specific brand from Neynar
   */
  @Post('brands/:id/refresh-followers')
  async refreshBrandFollowerCount(
    @Session() user: QuickAuthPayload,
    @Param('id') id: number,
    @Res() res: Response,
  ) {
    console.log(
      `refreshBrandFollowerCount called - user: ${user.sub}, id: ${id}`,
    );

    if (!adminFids.includes(user.sub)) {
      console.log(`Access denied for user ${user.sub} - not in admin list`);
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'refreshBrandFollowerCount',
        'Admin access required',
      );
    }

    try {
      console.log(`Refreshing follower count for brand ${id}...`);
      const brand = await this.adminService.refreshBrandFollowerCount(id);
      console.log('Follower count refreshed successfully:', {
        id: brand.id,
        name: brand.name,
        followerCount: brand.followerCount,
      });

      return hasResponse(res, {
        brand,
        message: 'Follower count refreshed successfully',
      });
    } catch (error) {
      console.error('Error in refreshBrandFollowerCount:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'refreshBrandFollowerCount',
        error.message,
      );
    }
  }

  @Get('fix-weekly-scores')
  @UseGuards(AuthorizationGuard)
  async fixWeeklyScores(
    @Session() user: QuickAuthPayload,
    @Res() res: Response,
  ) {
    // Check admin authorization (your existing pattern)
    const adminFids = [39278, 16098];
    if (!adminFids.includes(user.sub)) {
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'fixWeeklyScores',
        'Admin access required',
      );
    }

    try {
      const result = await this.adminService.fixWeeklyScores();
      return hasResponse(res, result);
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'fixWeeklyScores',
        error.message,
      );
    }
  }

  /**
   * Bulk operations endpoint for advanced admin tasks
   */
  @Post('brands/bulk-refresh-followers')
  async bulkRefreshFollowerCounts(
    @Session() user: QuickAuthPayload,
    @Body() { brandIds }: { brandIds: number[] },
    @Res() res: Response,
  ) {
    console.log(
      `bulkRefreshFollowerCounts called - user: ${user.sub}, brandIds: ${brandIds?.join(', ')}`,
    );

    if (!adminFids.includes(user.sub)) {
      console.log(`Access denied for user ${user.sub} - not in admin list`);
      return hasError(
        res,
        HttpStatus.FORBIDDEN,
        'bulkRefreshFollowerCounts',
        'Admin access required',
      );
    }

    if (!brandIds || !Array.isArray(brandIds) || brandIds.length === 0) {
      return hasError(
        res,
        HttpStatus.BAD_REQUEST,
        'bulkRefreshFollowerCounts',
        'brandIds array is required',
      );
    }

    try {
      console.log(
        `Bulk refreshing follower counts for ${brandIds.length} brands...`,
      );
      const results = [];
      const errors = [];

      for (const brandId of brandIds) {
        try {
          const brand =
            await this.adminService.refreshBrandFollowerCount(brandId);
          results.push({
            id: brand.id,
            name: brand.name,
            followerCount: brand.followerCount,
            success: true,
          });
        } catch (error) {
          console.error(`Failed to refresh brand ${brandId}:`, error.message);
          errors.push({
            id: brandId,
            error: error.message,
            success: false,
          });
        }
      }

      console.log(
        `Bulk refresh completed: ${results.length} success, ${errors.length} errors`,
      );

      return hasResponse(res, {
        message: `Bulk refresh completed: ${results.length} success, ${errors.length} errors`,
        results,
        errors,
        summary: {
          total: brandIds.length,
          successful: results.length,
          failed: errors.length,
        },
      });
    } catch (error) {
      console.error('Error in bulkRefreshFollowerCounts:', error);
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'bulkRefreshFollowerCounts',
        error.message,
      );
    }
  }
}
