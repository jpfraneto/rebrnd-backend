/**
 * @file This file defines the User entity with its properties and methods.
 */
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';

/**
 * @class UserBrandVotes
 * @classdesc UserBrandVotes class represents the votes of the users for each brands in the system.
 */
@Entity({ name: 'user_brand_votes' })
export class UserBrandVotes {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('User', 'userBrandVotes')
  user: any;

  @ManyToOne('Brand', 'userBrandVotes1')
  brand1: any;

  @ManyToOne('Brand', 'userBrandVotes2')
  brand2: any;

  @ManyToOne('Brand', 'userBrandVotes3')
  brand3: any;

  @Column()
  date: Date;

  @Column({ default: false })
  shared: boolean;

  @Column({ nullable: true })
  castHash: string;

  @Column({ nullable: true, length: 66 })
  transactionHash: string;

  // Reward claim fields
  @Column({ type: 'decimal', precision: 64, scale: 18, nullable: true })
  rewardAmount: string;

  @Column({ nullable: true })
  day: number;

  @Column({ default: false })
  shareVerified: boolean;

  @Column({ nullable: true })
  shareVerifiedAt: Date;

  @Column({ nullable: true })
  signatureGeneratedAt: Date;

  @Column({ nullable: true })
  nonce: number;

  @Column({ nullable: true })
  claimedAt: Date;

  @Column({ nullable: true, length: 66 })
  claimTxHash: string;
}
