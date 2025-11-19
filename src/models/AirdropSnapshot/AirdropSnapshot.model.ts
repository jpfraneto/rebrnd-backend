import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'airdrop_snapshots' })
export class AirdropSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 66, unique: true })
  merkleRoot: string; // hex string (0x...)

  @Column({ type: 'int' })
  totalUsers: number; // Should be 1111

  @Column({ type: 'bigint' })
  totalTokens: string; // Sum of all allocations (as string to handle large numbers)

  @Column({ type: 'json' })
  treeData: {
    // Store the full tree structure for proof generation
    leaves: Array<{
      fid: number;
      amount: string; // tokenAllocation as string
      leaf: string; // hex leaf hash
    }>;
    // Store the tree structure (optional, but useful for debugging)
    tree?: any;
  };

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  snapshotDate: Date;

  @Column({ type: 'varchar', length: 42, nullable: true })
  contractAddress: string; // Address of deployed airdrop contract (if deployed)

  @Column({ type: 'timestamp', nullable: true })
  deployedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

