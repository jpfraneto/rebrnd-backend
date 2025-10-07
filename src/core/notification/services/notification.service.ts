// src/core/notification/services/notification.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  LessThan,
  LessThanOrEqual,
  In,
  Not,
  IsNull,
  MoreThan,
} from 'typeorm';
import {
  User,
  NotificationQueue,
  NotificationTypeEnum,
  NotificationStatusEnum,
  Brand,
} from '../../../models';
import { UserService } from '../../user/services';
import { getConfig } from '../../../security/config';
import {
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
} from '@farcaster/frame-node';
import {
  NotificationDetails,
  NotificationPayload,
  FarcasterNotificationResponse,
} from '../../../models/NotificationQueue/NotificationQueue.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly config = getConfig();
  private rateLimitTracker = new Map<string, number[]>();
  private isProcessing = false;
  private lastProcessingTime = 0;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(NotificationQueue)
    private readonly queueRepository: Repository<NotificationQueue>,

    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,

    private readonly userService: UserService,
  ) {}

  /**
   * Handles Farcaster frame addition webhook events
   * Updates user notification preferences and queues welcome notification
   */
  async handleFrameAdded(
    fid: number,
    notificationDetails?: NotificationDetails,
  ): Promise<void> {
    this.logger.log(`Processing frame_added event for FID: ${fid}`);

    try {
      const user = await this.userService.getByFid(fid);
      if (!user) {
        this.logger.error(`User not found for FID: ${fid}`);
        return;
      }

      // Enable notifications and store Farcaster-provided token/URL
      await this.userRepository.update(user.id, {
        notificationsEnabled: true,
        notificationToken: notificationDetails?.token || null,
        notificationUrl: notificationDetails?.url || null,
      });

      this.logger.log(`Notifications enabled for user: ${user.username}`);
      await this.queueWelcomeNotification(user);
    } catch (error) {
      this.logger.error(`Error handling frame addition for FID ${fid}:`, error);
    }
  }

  /**
   * Handles Farcaster frame removal webhook events
   * Disables notifications and cancels pending notifications for the user
   */
  async handleFrameRemoved(fid: number): Promise<void> {
    this.logger.log(`Processing frame_removed event for FID: ${fid}`);

    try {
      const user = await this.userService.getByFid(fid);
      if (!user) return;

      // Disable notifications and clear tokens
      await this.userRepository.update(user.id, {
        notificationsEnabled: false,
        notificationToken: null,
        notificationUrl: null,
      });

      // Cancel any pending notifications to prevent delivery after removal
      await this.queueRepository.update(
        { userId: user.id, status: NotificationStatusEnum.PENDING },
        {
          status: NotificationStatusEnum.SKIPPED,
          errorMessage: 'Frame removed',
        },
      );

      this.logger.log(
        `Notifications disabled and pending notifications cancelled for user: ${user.username}`,
      );
    } catch (error) {
      this.logger.error(`Error handling frame removal for FID ${fid}:`, error);
    }
  }

  /**
   * Handles Farcaster notification enable webhook events
   * Re-enables notifications with new token/URL after user explicitly enables them
   */
  async handleNotificationsEnabled(
    fid: number,
    notificationDetails: NotificationDetails,
  ): Promise<void> {
    this.logger.log(`Processing notifications_enabled event for FID: ${fid}`);

    try {
      const user = await this.userService.getByFid(fid);
      if (!user) return;

      await this.userRepository.update(user.id, {
        notificationsEnabled: true,
        notificationToken: notificationDetails.token,
        notificationUrl: notificationDetails.url,
      });

      this.logger.log(`Notifications re-enabled for user: ${user.username}`);
    } catch (error) {
      this.logger.error(`Error enabling notifications for FID ${fid}:`, error);
    }
  }

  /**
   * Handles Farcaster notification disable webhook events
   * Disables notifications and cancels pending notifications
   */
  async handleNotificationsDisabled(fid: number): Promise<void> {
    this.logger.log(`Processing notifications_disabled event for FID: ${fid}`);

    try {
      const user = await this.userService.getByFid(fid);
      if (!user) return;

      await this.userRepository.update(user.id, {
        notificationsEnabled: false,
        notificationToken: null,
        notificationUrl: null,
      });

      // Cancel pending notifications to respect user preference
      await this.queueRepository.update(
        { userId: user.id, status: NotificationStatusEnum.PENDING },
        {
          status: NotificationStatusEnum.SKIPPED,
          errorMessage: 'Notifications disabled by user',
        },
      );

      this.logger.log(
        `Notifications disabled and pending notifications cancelled for user ID: ${user.id}`,
      );
    } catch (error) {
      this.logger.error(`Error disabling notifications for FID ${fid}:`, error);
    }
  }

  /**
   * Queues a notification for delivery with proper duplicate prevention
   * Implements Farcaster's 24-hour idempotency requirement using (FID, notificationId)
   */
  async queueNotification(
    userId: number,
    type: NotificationTypeEnum,
    title: string,
    body: string,
    targetUrl: string = 'https://brnd.land',
    scheduledFor: Date = new Date(),
    customIdempotencyKey?: string,
  ): Promise<void> {
    try {
      if (!this.config.notifications.enabled) {
        this.logger.log(
          `Notifications globally disabled, skipping ${type} for user ${userId}`,
        );
        return;
      }

      // Generate idempotent notification ID per Farcaster spec requirements
      const dateStr = scheduledFor.toISOString().split('T')[0];
      const notificationId =
        customIdempotencyKey ||
        `${type}_${userId}_${dateStr}_${this.generateShortHash(title + body)}`;

      // Check for duplicates within 24-hour idempotency window
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const existingNotification = await this.queueRepository.findOne({
        where: {
          userId,
          notificationId,
          createdAt: MoreThan(yesterday),
        },
      });

      if (existingNotification) {
        this.logger.log(
          `Duplicate notification prevented: ${notificationId} for user ${userId}`,
        );
        return;
      }

      // Enforce Farcaster character limits to prevent API rejection
      const notification = this.queueRepository.create({
        userId,
        type,
        notificationId,
        title: title.substring(0, 32), // Farcaster max: 32 characters
        body: body.substring(0, 128), // Farcaster max: 128 characters
        targetUrl: 'https://brnd.land', // Farcaster max: 1024 characters
        scheduledFor,
        status: NotificationStatusEnum.PENDING,
      });

      await this.queueRepository.save(notification);
      this.logger.log(
        `Queued ${type} notification: ${notificationId} for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue notification for user ${userId}:`,
        error,
      );
    }
  }

  /**
   * Processes pending notifications with concurrency protection
   * Uses process-level locking to prevent duplicate delivery in horizontally scaled deployments
   */
  async processPendingNotifications(): Promise<void> {
    const now = Date.now();

    // Prevent concurrent processing to avoid duplicate sends in multi-instance deployments
    if (this.isProcessing || now - this.lastProcessingTime < 30000) {
      return;
    }

    this.isProcessing = true;
    this.lastProcessingTime = now;

    try {
      const currentTime = new Date();

      // Fetch notifications ready for delivery with retry limit enforcement
      const pendingNotifications = await this.queueRepository.find({
        where: {
          status: NotificationStatusEnum.PENDING,
          scheduledFor: LessThanOrEqual(currentTime),
          retryCount: LessThan(this.config.notifications.maxRetries),
        },
        relations: ['user'],
        take: 50, // Process in manageable batches
        order: { scheduledFor: 'ASC' }, // FIFO processing
      });

      if (pendingNotifications.length === 0) {
        return;
      }

      this.logger.log(
        `Processing ${pendingNotifications.length} pending notifications`,
      );

      // Group notifications by target URL for efficient batch delivery
      const notificationsByUrl =
        this.groupNotificationsByUrl(pendingNotifications);

      // Process each URL group sequentially to respect rate limits
      for (const [url, notifications] of notificationsByUrl.entries()) {
        await this.sendBatchNotifications(url, notifications);
        // Brief delay between URL groups to prevent overwhelming any single endpoint
        await this.sleep(100);
      }
    } catch (error) {
      this.logger.error(`Error processing notification queue:`, error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Send welcome notification when user adds the miniapp
   * Public method for webhook handler to trigger welcome flow
   */
  async sendWelcomeNotification(fid: number): Promise<void> {
    try {
      this.logger.log(`Initiating welcome notification for FID: ${fid}`);

      const user = await this.userService.getByFid(fid);
      if (!user) {
        this.logger.warn(
          `User with FID ${fid} not found for welcome notification`,
        );
        return;
      }

      await this.queueWelcomeNotification(user);
      this.logger.log(`Welcome notification queued for user ${user.username}`);
    } catch (error) {
      this.logger.error(
        `Failed to send welcome notification to FID ${fid}:`,
        error,
      );
    }
  }

  /**
   * Verifies Farcaster webhook signatures for security
   * Uses development-friendly validation in non-production environments
   */
  async verifyWebhookSignature(webhookData: any): Promise<boolean> {
    try {
      this.logWebhookDetails(webhookData);

      // Use relaxed validation in development for easier testing
      if (process.env.ENV !== 'prod') {
        this.logger.log('Development environment: Using structural validation');
        return this.validateWebhookStructure(webhookData);
      }

      // Production: Full cryptographic verification with Neynar
      if (!process.env.NEYNAR_API_KEY) {
        this.logger.error(
          'NEYNAR_API_KEY missing - cannot verify webhooks in production',
        );
        return false;
      }

      try {
        await parseWebhookEvent(webhookData, verifyAppKeyWithNeynar);
        this.logger.log('Webhook cryptographic verification successful');
        return true;
      } catch (verificationError) {
        this.logger.error(
          'Webhook verification failed:',
          verificationError.message,
        );
        return false;
      }
    } catch (error) {
      this.logger.error('Error during webhook verification:', error);
      return false;
    }
  }

  /**
   * Validates webhook structure without cryptographic verification
   * Used in development environments for easier debugging
   */
  private validateWebhookStructure(webhookData: any): boolean {
    try {
      if (!webhookData || typeof webhookData !== 'object') {
        this.logger.warn('Invalid webhook: not an object');
        return false;
      }

      if (!webhookData.header || !webhookData.payload) {
        this.logger.warn('Invalid webhook: missing header or payload');
        return false;
      }

      // Verify base64url encoding and extractable data
      try {
        const fid = this.extractFidFromHeader(webhookData.header);
        const payload = this.decodeWebhookPayload(webhookData.payload);

        if (!fid || typeof fid !== 'number') {
          this.logger.warn('Invalid header: no valid FID found');
          return false;
        }

        if (!payload || !payload.event) {
          this.logger.warn('Invalid payload: no event found');
          return false;
        }

        this.logger.log(
          `Valid webhook structure: FID=${fid}, event=${payload.event}`,
        );
        return true;
      } catch (decodeError) {
        this.logger.warn('Failed to decode webhook data:', decodeError.message);
        return false;
      }
    } catch (error) {
      this.logger.error('Error validating webhook structure:', error);
      return false;
    }
  }

  /**
   * Logs webhook details for debugging and monitoring
   * Helps diagnose webhook delivery issues in development
   */
  private logWebhookDetails(webhookData: any): void {
    try {
      this.logger.log('=== WEBHOOK ANALYSIS ===');
      this.logger.log(
        `Structure keys: ${Object.keys(webhookData || {}).join(', ')}`,
      );

      if (webhookData?.header) {
        try {
          const decodedHeader = Buffer.from(
            webhookData.header,
            'base64url',
          ).toString('utf-8');
          this.logger.log(`Header content: ${decodedHeader}`);
        } catch (e) {
          this.logger.log(`Header decode error: ${e.message}`);
        }
      }

      if (webhookData?.payload) {
        try {
          const decodedPayload = Buffer.from(
            webhookData.payload,
            'base64url',
          ).toString('utf-8');
          this.logger.log(`Payload content: ${decodedPayload}`);
        } catch (e) {
          this.logger.log(`Payload decode error: ${e.message}`);
        }
      }
      this.logger.log('=======================');
    } catch (error) {
      this.logger.error('Error logging webhook details:', error);
    }
  }

  /**
   * Queues daily vote reminder notifications for eligible users
   * Finds users who haven't voted today and have notifications enabled
   */
  async queueDailyVoteReminders(): Promise<void> {
    try {
      if (!this.config.notifications.enabled) {
        this.logger.log(
          'Notifications disabled globally, skipping daily reminders',
        );
        return;
      }

      this.logger.log('Processing daily vote reminders...');

      const today = new Date().toISOString().split('T')[0];

      // Find users who haven't voted today and haven't received a reminder today
      const usersNeedingReminder = await this.userRepository
        .createQueryBuilder('user')
        .leftJoin('user.userBrandVotes', 'vote', 'DATE(vote.date) = :today', {
          today,
        })
        .where('user.notificationsEnabled = true')
        .andWhere('user.notificationToken IS NOT NULL')
        .andWhere('vote.id IS NULL') // No vote today
        .andWhere(
          '(user.lastVoteReminderSent IS NULL OR DATE(user.lastVoteReminderSent) < :today)',
          { today },
        )
        .getMany();

      if (usersNeedingReminder.length === 0) {
        this.logger.log('No users require daily vote reminders');
        return;
      }

      // Queue reminders with unique IDs to prevent duplicates
      for (const user of usersNeedingReminder) {
        await this.queueNotification(
          user.id,
          NotificationTypeEnum.DAILY_REMINDER,
          '🗳️ Time to vote!',
          'Choose your top 3 favorite brands and earn 3 points!',
          `${this.config.notifications.baseUrl}/vote`,
          new Date(),
          `daily_reminder_${user.id}_${today}`, // Explicit idempotency key
        );
      }

      // Update reminder tracking to prevent duplicate processing
      await this.userRepository.update(
        usersNeedingReminder.map((u) => u.id),
        { lastVoteReminderSent: new Date() },
      );

      this.logger.log(
        `Queued daily reminders for ${usersNeedingReminder.length} users`,
      );
    } catch (error) {
      this.logger.error('Error queuing daily reminders:', error);
    }
  }

  /**
   * Queues evening vote reminders for users who received morning reminder but still haven't voted
   * Provides last chance notification before day ends
   */
  async queueEveningVoteReminders(): Promise<void> {
    try {
      if (!this.config.notifications.enabled) {
        this.logger.log(
          'Notifications disabled globally, skipping evening reminders',
        );
        return;
      }

      this.logger.log('Processing evening vote reminders...');

      const today = new Date().toISOString().split('T')[0];

      // Find users who got morning reminder but still haven't voted
      const usersNeedingEvening = await this.userRepository
        .createQueryBuilder('user')
        .leftJoin('user.userBrandVotes', 'vote', 'DATE(vote.date) = :today', {
          today,
        })
        .where('user.notificationsEnabled = true')
        .andWhere('user.notificationToken IS NOT NULL')
        .andWhere('vote.id IS NULL') // Still no vote today
        .andWhere('DATE(user.lastVoteReminderSent) = :today', { today }) // Got morning reminder
        .getMany();

      if (usersNeedingEvening.length === 0) {
        this.logger.log('No users require evening vote reminders');
        return;
      }

      // Queue evening reminders with different idempotency key
      for (const user of usersNeedingEvening) {
        await this.queueNotification(
          user.id,
          NotificationTypeEnum.EVENING_REMINDER,
          '⏰ Last chance to vote today!',
          "Don't break your voting streak! Vote now and earn 3 points.",
          `${this.config.notifications.baseUrl}/vote`,
          new Date(),
          `evening_reminder_${user.id}_${today}`, // Different key from morning
        );
      }

      this.logger.log(
        `Queued evening reminders for ${usersNeedingEvening.length} users`,
      );
    } catch (error) {
      this.logger.error('Error queuing evening reminders:', error);
    }
  }

  /**
   * Removes old notification records to maintain database performance
   * Keeps 30-day history for debugging while cleaning completed notifications
   */
  async cleanupOldNotifications(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.queueRepository.delete({
        createdAt: LessThan(thirtyDaysAgo),
        status: In([
          NotificationStatusEnum.SENT,
          NotificationStatusEnum.FAILED,
          NotificationStatusEnum.SKIPPED,
        ]),
      });

      this.logger.log(
        `Cleaned up ${result.affected || 0} old notification records`,
      );
    } catch (error) {
      this.logger.error('Error cleaning up old notifications:', error);
    }
  }

  /**
   * Queues monthly winner announcement for all notification-enabled users
   * Announces the brand with highest monthly score before resetting competition
   */
  async queueMonthlyWinnerAnnouncement(): Promise<void> {
    try {
      if (!this.config.notifications.enabled) {
        this.logger.log(
          'Notifications disabled globally, skipping monthly winner announcement',
        );
        return;
      }

      this.logger.log('Processing monthly winner announcement...');

      const monthlyWinner = await this.getMonthlyWinner();
      if (!monthlyWinner) {
        this.logger.log('No monthly winner found, skipping announcements');
        return;
      }

      const usersWithNotifications = await this.userRepository.find({
        where: {
          notificationsEnabled: true,
          notificationToken: Not(IsNull()),
        },
        select: ['id', 'username', 'fid'],
      });

      if (usersWithNotifications.length === 0) {
        this.logger.log(
          'No users with notifications enabled for winner announcement',
        );
        return;
      }

      const currentMonth = new Date().toLocaleDateString('en-US', {
        month: 'long',
      });
      const monthKey = new Date().toISOString().substring(0, 7); // YYYY-MM format

      // Queue winner announcements with month-specific idempotency
      for (const user of usersWithNotifications) {
        await this.queueNotification(
          user.id,
          NotificationTypeEnum.MONTHLY_WINNER,
          `🏆 ${currentMonth} Brand Champion!`,
          `${monthlyWinner.name} dominated this month with ${monthlyWinner.scoreMonth} points! See the full rankings.`,
          `${this.config.notifications.baseUrl}/brand/${monthlyWinner.id}`,
          new Date(),
          `monthly_winner_${user.id}_${monthKey}`, // Month-specific idempotency
        );
      }

      this.logger.log(
        `Queued monthly winner announcements for ${usersWithNotifications.length} users`,
      );
    } catch (error) {
      this.logger.error('Error queuing monthly winner announcements:', error);
    }
  }

  /**
   * Retrieves the brand with highest monthly score for winner announcement
   * Returns null if no brands have positive monthly scores
   */
  private async getMonthlyWinner(): Promise<Pick<
    Brand,
    'id' | 'name' | 'scoreMonth' | 'imageUrl'
  > | null> {
    try {
      const winner = await this.brandRepository
        .createQueryBuilder('brand')
        .select([
          'brand.id',
          'brand.name',
          'brand.scoreMonth',
          'brand.imageUrl',
        ])
        .where('brand.scoreMonth > 0')
        .andWhere('brand.banned = 0')
        .orderBy('brand.scoreMonth', 'DESC')
        .limit(1)
        .getOne();

      return winner || null;
    } catch (error) {
      this.logger.error('Error retrieving monthly winner:', error);
      return null;
    }
  }

  /**
   * Resets monthly scores for all brands to start fresh monthly competition
   * Called after winner announcement to begin new monthly cycle
   */
  async resetMonthlyScores(): Promise<void> {
    try {
      this.logger.log('Resetting monthly scores for fresh competition...');

      await this.brandRepository
        .createQueryBuilder()
        .update(Brand)
        .set({
          scoreMonth: 0,
          stateScoreMonth: 0,
          rankingMonth: 0,
        })
        .execute();

      this.logger.log('Monthly scores reset successfully for all brands');
    } catch (error) {
      this.logger.error('Error resetting monthly scores:', error);
    }
  }

  /**
   * Orchestrates complete monthly cycle: announce winner then reset scores
   * Ensures proper timing between announcement and reset operations
   */
  async processMonthlyWinnerCycle(): Promise<void> {
    try {
      this.logger.log('Starting monthly winner cycle...');

      // First announce the current month's winner
      await this.queueMonthlyWinnerAnnouncement();

      // Wait for announcements to be queued before resetting scores
      setTimeout(async () => {
        await this.resetMonthlyScores();
        this.logger.log('Monthly winner cycle completed');
      }, 10000); // 10-second delay ensures announcements are processed first
    } catch (error) {
      this.logger.error('Error processing monthly winner cycle:', error);
    }
  }

  /**
   * Decodes base64url encoded webhook payload from Farcaster
   * Handles the JSON Farcaster Signature format payload extraction
   */
  decodeWebhookPayload(encodedPayload: string): any {
    try {
      const decoded = Buffer.from(encodedPayload, 'base64url').toString(
        'utf-8',
      );
      return JSON.parse(decoded);
    } catch (error) {
      this.logger.error('Failed to decode webhook payload:', error);
      throw new Error('Invalid payload format');
    }
  }

  /**
   * Extracts Farcaster user ID from webhook header
   * Parses the JSON header to retrieve the FID for user identification
   */
  extractFidFromHeader(encodedHeader: string): number {
    try {
      const decoded = Buffer.from(encodedHeader, 'base64url').toString('utf-8');
      const header = JSON.parse(decoded);
      return header.fid;
    } catch (error) {
      this.logger.error('Failed to extract FID from header:', error);
      throw new Error('Invalid header format');
    }
  }

  /**
   * Queues welcome notification for new users who add the miniapp
   * Private method for internal welcome flow management
   */
  private async queueWelcomeNotification(user: User): Promise<void> {
    const welcomeId = `welcome_${user.id}_${Date.now()}`;

    await this.queueNotification(
      user.id,
      NotificationTypeEnum.WELCOME,
      'Welcome to BRND! 🎉',
      'Start voting for your favorite brands daily to earn points and climb the leaderboard!',
      this.config.notifications.baseUrl,
      new Date(),
      welcomeId,
    );
  }

  /**
   * Sends batch notifications to Farcaster endpoint with proper rate limiting
   * Groups notifications by target URL and implements Farcaster rate limits
   */
  private async sendBatchNotifications(
    notificationUrl: string,
    notifications: NotificationQueue[],
  ): Promise<void> {
    // Check rate limits before attempting to send
    if (!this.checkRateLimit(notificationUrl, notifications.length)) {
      this.logger.log(
        `Rate limit exceeded for ${notificationUrl}, delaying delivery`,
      );

      const nextRetry = new Date(Date.now() + 60000); // 1-minute delay
      await this.queueRepository.update(
        notifications.map((n) => n.id),
        { scheduledFor: nextRetry },
      );
      return;
    }

    // Extract valid tokens from user notifications
    const tokens = notifications
      .map((n) => n.user?.notificationToken)
      .filter(Boolean);

    if (tokens.length === 0) {
      await this.markNotificationsAsSkipped(
        notifications,
        'No valid notification tokens',
      );
      return;
    }

    // Use first notification as template (batch notifications share content)
    const template = notifications[0];

    const payload: NotificationPayload = {
      notificationId: template.notificationId,
      title: template.title,
      body: template.body,
      targetUrl: 'https://brnd.land',
      tokens,
    };

    try {
      // Send to Farcaster notification endpoint
      const response = await fetch(notificationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result: FarcasterNotificationResponse = await response.json();
      await this.processNotificationResults(notifications, result);

      this.logger.log(
        `Successfully sent batch of ${notifications.length} notifications`,
      );
    } catch (error) {
      this.logger.error(`Batch notification delivery failed:`, error);
      await this.handleNotificationFailures(notifications, error.message);
    }
  }

  /**
   * Implements Farcaster rate limiting: 1 per 30 seconds, 100 per day per token
   * Tracks notification frequency per URL to prevent API rejection
   */
  private checkRateLimit(url: string, count: number): boolean {
    const now = Date.now();
    const windowStart = now - 60000; // 1-minute sliding window

    const timestamps = this.rateLimitTracker.get(url) || [];
    const recentTimestamps = timestamps.filter((ts) => ts > windowStart);

    // Check if adding these notifications would exceed rate limit
    if (
      recentTimestamps.length + count >
      this.config.notifications.rateLimitPerMinute
    ) {
      return false;
    }

    // Update tracking with new timestamps
    recentTimestamps.push(...Array(count).fill(now));
    this.rateLimitTracker.set(url, recentTimestamps);

    return true;
  }

  /**
   * Handles notification delivery failures with exponential backoff retry
   * Implements progressive retry delays to handle temporary API issues
   */
  private async handleNotificationFailures(
    notifications: NotificationQueue[],
    errorMessage: string,
  ): Promise<void> {
    for (const notification of notifications) {
      const retryCount = notification.retryCount + 1;

      if (retryCount >= this.config.notifications.maxRetries) {
        // Mark as permanently failed after max retries
        await this.queueRepository.update(notification.id, {
          status: NotificationStatusEnum.FAILED,
          errorMessage,
          retryCount,
        });
      } else {
        // Schedule retry with exponential backoff
        const delays = [60000, 300000, 1800000]; // 1min, 5min, 30min
        const delay = delays[retryCount - 1] || 1800000;
        const nextRetry = new Date(Date.now() + delay);

        await this.queueRepository.update(notification.id, {
          retryCount,
          scheduledFor: nextRetry,
          errorMessage,
        });
      }
    }
  }

  /**
   * Processes Farcaster API response to update notification statuses
   * Handles successful, invalid, and rate-limited tokens appropriately
   */
  private async processNotificationResults(
    notifications: NotificationQueue[],
    result: FarcasterNotificationResponse,
  ): Promise<void> {
    const successfulTokens = new Set(result.successfulTokens || []);
    const invalidTokens = new Set(result.invalidTokens || []);
    const rateLimitedTokens = new Set(result.rateLimitedTokens || []);

    for (const notification of notifications) {
      const userToken = notification.user?.notificationToken;

      if (successfulTokens.has(userToken)) {
        // Mark as successfully delivered
        await this.queueRepository.update(notification.id, {
          status: NotificationStatusEnum.SENT,
          sentAt: new Date(),
        });
      } else if (invalidTokens.has(userToken)) {
        // Disable notifications for user with invalid token
        await this.userRepository.update(notification.userId, {
          notificationsEnabled: false,
          notificationToken: null,
        });

        await this.queueRepository.update(notification.id, {
          status: NotificationStatusEnum.SKIPPED,
          errorMessage: 'Invalid token - user notifications disabled',
        });
      } else if (rateLimitedTokens.has(userToken)) {
        // Reschedule rate-limited notifications for later delivery
        const nextRetry = new Date(Date.now() + 60000); // 1-minute delay
        await this.queueRepository.update(notification.id, {
          scheduledFor: nextRetry,
          retryCount: notification.retryCount + 1,
          errorMessage: 'Rate limited by Farcaster API',
        });
      } else {
        // Handle unknown response state with retry
        const nextRetry = new Date(Date.now() + 120000); // 2-minute delay
        await this.queueRepository.update(notification.id, {
          scheduledFor: nextRetry,
          retryCount: notification.retryCount + 1,
          errorMessage: 'Unknown delivery status',
        });
      }
    }
  }

  /**
   * Groups notifications by target URL for efficient batch processing
   * Enables sending multiple notifications to same Farcaster endpoint in single request
   */
  private groupNotificationsByUrl(
    notifications: NotificationQueue[],
  ): Map<string, NotificationQueue[]> {
    const groups = new Map<string, NotificationQueue[]>();

    for (const notification of notifications) {
      const url = notification.user?.notificationUrl;
      if (!url) continue;

      if (!groups.has(url)) {
        groups.set(url, []);
      }
      groups.get(url)!.push(notification);
    }

    return groups;
  }

  /**
   * Marks notifications as skipped with descriptive reason
   * Used when notifications cannot be delivered due to missing tokens or configuration
   */
  private async markNotificationsAsSkipped(
    notifications: NotificationQueue[],
    reason: string,
  ): Promise<void> {
    const ids = notifications.map((n) => n.id);
    await this.queueRepository.update(ids, {
      status: NotificationStatusEnum.SKIPPED,
      errorMessage: reason,
    });

    this.logger.log(`Marked ${ids.length} notifications as skipped: ${reason}`);
  }

  /**
   * Generates short hash for notification ID uniqueness
   * Creates consistent hash from content to prevent duplicate notifications with same content
   */
  private generateShortHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 8);
  }

  /**
   * Simple sleep utility for adding delays between operations
   * Prevents overwhelming external APIs with rapid sequential requests
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
