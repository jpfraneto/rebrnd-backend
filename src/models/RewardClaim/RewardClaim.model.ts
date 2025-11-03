import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity({ name: 'reward_claims' })
@Unique(['userFid', 'day'])
@Index(['userFid', 'day'])
export class RewardClaim {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userFid: number;

  @Column()
  day: number;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({ nullable: true })
  signatureGeneratedAt: Date;

  @Column({ nullable: true })
  claimedAt: Date;

  @Column({ nullable: true, length: 66 })
  claimTxHash: string;

  @Column({ default: false })
  shareVerified: boolean;

  @Column({ nullable: true })
  shareVerifiedAt: Date;

  @Column({ nullable: true })
  castHash: string;

  @Column({ nullable: true })
  nonce: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}