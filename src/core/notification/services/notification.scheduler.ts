// src/core/notification/services/notification.scheduler.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);

  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Processes notification queue every 2 minutes for reliable delivery
   * Reduced frequency prevents duplicate processing while maintaining responsiveness
   */
  @Cron('*/2 * * * *', { name: 'processNotifications' })
  async processNotificationQueue() {
    this.logger.log('Starting scheduled notification queue processing');
    try {
      await this.notificationService.processPendingNotifications();
    } catch (error) {
      this.logger.error('Error in scheduled notification processing:', error);
    }
  }

  /**
   * Queues daily vote reminders at 10 AM UTC
   * Targets users who haven't voted yet today
   */
  @Cron('0 10 * * *', { name: 'dailyReminders', timeZone: 'UTC' })
  async queueDailyVoteReminders() {
    this.logger.log('Running scheduled daily vote reminders (10 AM UTC)');
    try {
      await this.notificationService.queueDailyVoteReminders();
    } catch (error) {
      this.logger.error('Error queuing daily reminders:', error);
    }
  }

  /**
   * Queues evening vote reminders at 8 PM UTC for users who still haven't voted
   * Provides last chance notification before day ends
   */
  @Cron('0 20 * * *', { name: 'eveningReminders', timeZone: 'UTC' })
  async queueEveningVoteReminders() {
    this.logger.log('Running scheduled evening vote reminders (8 PM UTC)');
    try {
      await this.notificationService.queueEveningVoteReminders();
    } catch (error) {
      this.logger.error('Error queuing evening reminders:', error);
    }
  }

  /**
   * Cleans up old notification records daily at 2 AM UTC
   * Maintains database performance by removing 30+ day old completed notifications
   */
  @Cron('0 2 * * *', { name: 'cleanupNotifications', timeZone: 'UTC' })
  async cleanupOldNotifications() {
    this.logger.log('Running scheduled notification cleanup (2 AM UTC)');
    try {
      await this.notificationService.cleanupOldNotifications();
    } catch (error) {
      this.logger.error('Error cleaning up notifications:', error);
    }
  }

  /**
   * Processes complete monthly cycle on the 1st of each month at 9 AM UTC
   * Announces previous month's winner and resets scores for new monthly competition
   */
  @Cron('0 9 1 * *', { name: 'monthlyWinnerCycle', timeZone: 'UTC' })
  async processMonthlyWinnerCycle() {
    this.logger.log(
      'Running scheduled monthly winner cycle (1st of month, 9 AM UTC)',
    );
    try {
      await this.notificationService.processMonthlyWinnerCycle();
    } catch (error) {
      this.logger.error('Error processing monthly winner cycle:', error);
    }
  }
}
