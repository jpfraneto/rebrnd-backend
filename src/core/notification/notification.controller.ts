// src/core/notification/notification.controller.ts

import {
  Controller,
  Post,
  Body,
  HttpStatus,
  Res,
  Get,
  Logger,
  Req,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { hasResponse, hasError } from '../../utils';
import { NotificationService } from './services';

import { getConfig } from '../../security/config';

@ApiTags('notification-service')
@Controller('notification-service')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Webhook endpoint for Farcaster miniapp events
   * Handles frame_added, frame_removed, notifications_enabled, notifications_disabled
   */
  @Post('/webhook')
  async handleWebhook(
    @Body() webhookData: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<Response> {
    const requestId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      this.logger.log(`[${requestId}] Farcaster webhook received`);
      this.logger.log(
        `[${requestId}] Method: ${req.method}, Content-Type: ${req.headers['content-type']}`,
      );

      // Log webhook data structure for debugging
      if (webhookData) {
        this.logger.log(
          `[${requestId}] Webhook keys: ${Object.keys(webhookData).join(', ')}`,
        );
      }

      // Validate basic webhook structure
      if (!webhookData || typeof webhookData !== 'object') {
        this.logger.error(`[${requestId}] Invalid webhook data structure`);
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'handleWebhook',
          'Invalid webhook data structure',
        );
      }

      let payload: any = null;
      let fid: number | null = null;
      let isVerified = false;

      // Attempt signature verification
      try {
        isVerified =
          await this.notificationService.verifyWebhookSignature(webhookData);

        if (isVerified) {
          payload = this.notificationService.decodeWebhookPayload(
            webhookData.payload,
          );
          fid = this.notificationService.extractFidFromHeader(
            webhookData.header,
          );
          this.logger.log(
            `[${requestId}] Webhook verified - FID: ${fid}, Event: ${payload?.event}`,
          );
        } else {
          this.logger.warn(
            `[${requestId}] Webhook signature verification failed`,
          );

          // In development, try to extract data anyway for debugging
          if (process.env.ENV !== 'prod') {
            this.logger.log(
              `[${requestId}] Development mode: attempting to process unverified webhook`,
            );

            try {
              payload = this.notificationService.decodeWebhookPayload(
                webhookData.payload,
              );
              fid = this.notificationService.extractFidFromHeader(
                webhookData.header,
              );
              this.logger.log(
                `[${requestId}] Extracted unverified data - FID: ${fid}, Event: ${payload?.event}`,
              );
            } catch (extractError) {
              this.logger.error(
                `[${requestId}] Failed to extract webhook data:`,
                extractError,
              );
            }
          }
        }
      } catch (verificationError) {
        this.logger.error(
          `[${requestId}] Webhook verification error:`,
          verificationError,
        );
      }

      // Process webhook events if we have valid data
      if (payload && fid && payload.event) {
        this.logger.log(
          `[${requestId}] Processing ${payload.event} event for FID: ${fid}`,
        );

        try {
          await this.processWebhookEvent(requestId, payload, fid);
          this.logger.log(
            `[${requestId}] Successfully processed ${payload.event} event`,
          );
        } catch (processingError) {
          this.logger.error(
            `[${requestId}] Error processing ${payload.event} event:`,
            processingError,
          );
          // Continue to return 200 to prevent retries for processing errors
        }
      } else {
        this.logger.error(
          `[${requestId}] Cannot process webhook - missing payload, FID, or event`,
        );

        // In production, return error for invalid webhooks
        if (process.env.ENV === 'prod' && !isVerified) {
          return hasError(
            res,
            HttpStatus.UNAUTHORIZED,
            'handleWebhook',
            'Webhook verification failed',
          );
        }
      }

      // Always return 200 OK to prevent Farcaster retries
      return hasResponse(res, {
        success: true,
        processed: !!(payload && fid),
        requestId,
      });
    } catch (error) {
      this.logger.error(`[${requestId}] Critical webhook error:`, error);

      // Return 200 even for critical errors to prevent retries during debugging
      return hasResponse(res, {
        success: false,
        error: error.message,
        requestId,
      });
    }
  }

  /**
   * Processes individual webhook events with proper error isolation
   * Prevents one event type failure from affecting others
   */
  private async processWebhookEvent(
    requestId: string,
    payload: any,
    fid: number,
  ): Promise<void> {
    switch (payload.event) {
      case 'frame_added':
        this.logger.log(`[${requestId}] Processing frame_added event`);
        await this.notificationService.handleFrameAdded(
          fid,
          payload.notificationDetails,
        );

        // Send welcome notification after frame addition
        if (payload.notificationDetails) {
          this.logger.log(
            `[${requestId}] Triggering welcome notification for new user`,
          );
          await this.notificationService.sendWelcomeNotification(fid);
        }
        break;

      case 'frame_removed':
        this.logger.log(`[${requestId}] Processing frame_removed event`);
        await this.notificationService.handleFrameRemoved(fid);
        break;

      case 'notifications_enabled':
        this.logger.log(
          `[${requestId}] Processing notifications_enabled event`,
        );
        await this.notificationService.handleNotificationsEnabled(
          fid,
          payload.notificationDetails,
        );
        break;

      case 'notifications_disabled':
        this.logger.log(
          `[${requestId}] Processing notifications_disabled event`,
        );
        await this.notificationService.handleNotificationsDisabled(fid);
        break;

      default:
        this.logger.warn(
          `[${requestId}] Unknown webhook event type: ${payload.event}`,
        );
    }
  }

  /**
   * Health check endpoint for monitoring notification system status
   * Provides system health information for uptime monitoring
   */
  @Get('/health')
  async healthCheck(@Res() res: Response): Promise<Response> {
    try {
      const config = getConfig();

      return hasResponse(res, {
        status: 'healthy',
        notifications: config.notifications.enabled ? 'enabled' : 'disabled',
        webhook: 'ready',
        environment: process.env.ENV || 'development',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'healthCheck',
        error.message,
      );
    }
  }

  /**
   * Test endpoint to verify webhook endpoint accessibility
   * Used for debugging webhook delivery issues
   */
  @Get('/webhook-test')
  async webhookTest(@Res() res: Response): Promise<Response> {
    this.logger.log('Webhook test endpoint accessed');
    return hasResponse(res, {
      message: 'Webhook endpoint is accessible',
      timestamp: new Date().toISOString(),
      environment: process.env.ENV || 'development',
    });
  }

  // Development-only endpoints for testing and debugging

  /**
   * Manual trigger for daily reminders - development environment only
   * Allows testing reminder flow without waiting for scheduled time
   */
  @Post('/dev/trigger-daily-reminders')
  async triggerDailyReminders(@Res() res: Response): Promise<Response> {
    try {
      if (process.env.ENV === 'prod') {
        return hasError(
          res,
          HttpStatus.FORBIDDEN,
          'triggerDailyReminders',
          'Development endpoint not available in production',
        );
      }

      await this.notificationService.queueDailyVoteReminders();
      return hasResponse(res, {
        message: 'Daily reminders triggered successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'triggerDailyReminders',
        error.message,
      );
    }
  }

  /**
   * Manual trigger for evening reminders - development environment only
   * Allows testing evening reminder flow
   */
  @Post('/dev/trigger-evening-reminders')
  async triggerEveningReminders(@Res() res: Response): Promise<Response> {
    try {
      if (process.env.ENV === 'prod') {
        return hasError(
          res,
          HttpStatus.FORBIDDEN,
          'triggerEveningReminders',
          'Development endpoint not available in production',
        );
      }

      await this.notificationService.queueEveningVoteReminders();
      return hasResponse(res, {
        message: 'Evening reminders triggered successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'triggerEveningReminders',
        error.message,
      );
    }
  }

  /**
   * Manual trigger for notification queue processing - development environment only
   * Forces immediate processing of pending notifications
   */
  @Post('/dev/process-queue')
  async processQueue(@Res() res: Response): Promise<Response> {
    try {
      if (process.env.ENV === 'prod') {
        return hasError(
          res,
          HttpStatus.FORBIDDEN,
          'processQueue',
          'Development endpoint not available in production',
        );
      }

      await this.notificationService.processPendingNotifications();
      return hasResponse(res, {
        message: 'Notification queue processed successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'processQueue',
        error.message,
      );
    }
  }

  /**
   * Manual trigger for complete monthly cycle - development environment only
   * Tests monthly winner announcement and score reset
   */
  @Post('/dev/trigger-monthly-cycle')
  async triggerMonthlyCycle(@Res() res: Response): Promise<Response> {
    try {
      if (process.env.ENV === 'prod') {
        return hasError(
          res,
          HttpStatus.FORBIDDEN,
          'triggerMonthlyCycle',
          'Development endpoint not available in production',
        );
      }

      await this.notificationService.processMonthlyWinnerCycle();
      return hasResponse(res, {
        message:
          'Monthly cycle triggered successfully (winner announcement + score reset)',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'triggerMonthlyCycle',
        error.message,
      );
    }
  }

  /**
   * Send test welcome notification - development environment only
   * Allows testing welcome notification flow for specific user
   */
  @Post('/dev/send-welcome/:fid')
  async sendTestWelcome(
    @Param('fid') fid: string,
    @Res() res: Response,
  ): Promise<Response> {
    try {
      if (process.env.ENV === 'prod') {
        return hasError(
          res,
          HttpStatus.FORBIDDEN,
          'sendTestWelcome',
          'Development endpoint not available in production',
        );
      }

      const fidNumber = parseInt(fid);
      if (isNaN(fidNumber)) {
        return hasError(
          res,
          HttpStatus.BAD_REQUEST,
          'sendTestWelcome',
          'Invalid FID format',
        );
      }

      await this.notificationService.sendWelcomeNotification(fidNumber);
      return hasResponse(res, {
        message: `Welcome notification sent to FID ${fidNumber}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return hasError(
        res,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'sendTestWelcome',
        error.message,
      );
    }
  }
}
