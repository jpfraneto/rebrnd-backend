import { NotificationQueue } from '../NotificationQueue';

/**
 * @file This file defines the User entity with its properties and methods.
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

import { UserBrandVotes } from '../UserBrandVotes';

// Types
import { UserRoleEnum } from './';

/**
 * @class User
 * @classdesc User class represents a user in the system.
 */
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    unique: true,
    nullable: false,
  })
  fid: number;

  @Column()
  username: string;

  @Column({
    default: null,
    nullable: true,
  })
  photoUrl: string;

  @Column({
    default: 0,
  })
  points: number;

  @Column()
  role: UserRoleEnum;

  @Column({
    default: false,
  })
  notificationsEnabled: boolean;

  @Column({
    default: null,
    nullable: true,
  })
  notificationToken: string;

  @Column({
    default: null,
    nullable: true,
  })
  notificationUrl: string;

  @Column({
    default: null,
    nullable: true,
  })
  lastVoteReminderSent: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => UserBrandVotes, (userBrandVotes) => userBrandVotes.user)
  userBrandVotes: UserBrandVotes[];

  @OneToMany(
    () => NotificationQueue,
    (notificationQueue) => notificationQueue.user,
    { cascade: true },
  )
  notificationQueue: NotificationQueue[];
}
