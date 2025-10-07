// src/models/NotificationQueue/NotificationQueue.model.ts

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';

import { User } from '../User';
import {
  NotificationTypeEnum,
  NotificationStatusEnum,
} from './NotificationQueue.types';

@Entity({ name: 'notification_queue' })
@Index(['status', 'scheduledFor'])
@Index(['userId', 'type'])
export class NotificationQueue {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, (user) => user.notificationQueue, {
    onDelete: 'CASCADE',
  })
  user: User;

  @Column()
  userId: number;

  @Column({
    type: 'enum',
    enum: NotificationTypeEnum,
    default: NotificationTypeEnum.DAILY_REMINDER,
  })
  type: NotificationTypeEnum;

  @Column()
  notificationId: string; // For idempotency with Farcaster

  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column()
  targetUrl: string;

  @Column({
    type: 'enum',
    enum: NotificationStatusEnum,
    default: NotificationStatusEnum.PENDING,
  })
  status: NotificationStatusEnum;

  @Column({
    default: 0,
  })
  retryCount: number;

  @Column()
  scheduledFor: Date; // When to send this notification

  @Column({
    default: null,
    nullable: true,
  })
  sentAt: Date;

  @Column({
    default: null,
    nullable: true,
    type: 'text',
  })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
