// Create: src/models/NotificationQueue/NotificationQueue.types.ts

/**
 * Enum for notification types
 */
export enum NotificationTypeEnum {
  DAILY_REMINDER = 'daily_reminder',
  EVENING_REMINDER = 'evening_reminder',
  WEEKLY_RANKINGS = 'weekly_rankings',
  MONTHLY_WINNER = 'monthly_winner',
  WELCOME = 'welcome',
  LEADERBOARD_UPDATE = 'leaderboard_update',
  BRAND_MILESTONE = 'brand_milestone',
}

/**
 * Enum for notification status
 */
export enum NotificationStatusEnum {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  PROCESSING = 'processing',
}

/**
 * Interface for notification details from Farcaster
 */
export interface NotificationDetails {
  url: string;
  token: string;
}

/**
 * Interface for notification payload sent to Farcaster
 */
export interface NotificationPayload {
  notificationId: string;
  title: string;
  body: string;
  targetUrl: string;
  tokens: string[];
}

/**
 * Interface for Farcaster webhook events
 */
export interface FarcasterWebhookEvent {
  header: string; // base64 encoded
  payload: string; // base64 encoded
  signature: string; // base64 encoded
}

/**
 * Interface for decoded webhook payload
 */
export interface DecodedWebhookPayload {
  event:
    | 'frame_added'
    | 'frame_removed'
    | 'notifications_enabled'
    | 'notifications_disabled';
  notificationDetails?: NotificationDetails;
}

/**
 * Interface for Farcaster notification response
 */
export interface FarcasterNotificationResponse {
  successfulTokens: string[];
  invalidTokens: string[];
  rateLimitedTokens: string[];
}
