import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './services/blockchain.service';
import { PowerLevelService } from './services/power-level.service';
import { SignatureService } from './services/signature.service';
import { RewardService } from './services/reward.service';
import { CastVerificationService } from './services/cast-verification.service';
import { ContractUploadService } from './services/contract-upload.service';
import { IndexerService } from './services/indexer.service';
import { UserService } from '../user/services';
import { BrandService } from '../brand/services';
import { AuthModule } from '../auth/auth.module';

import {
  User,
  Brand,
  UserBrandVotes,
  UserDailyActions,
  Category,
} from '../../models';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Brand,
      UserBrandVotes,
      UserDailyActions,
      Category,
    ]),
    AuthModule,
  ],
  controllers: [BlockchainController],
  providers: [
    BlockchainService,
    PowerLevelService,
    SignatureService,
    RewardService,
    CastVerificationService,
    ContractUploadService,
    IndexerService,
    UserService,
    BrandService,
  ],
  exports: [
    BlockchainService,
    PowerLevelService,
    SignatureService,
    RewardService,
    CastVerificationService,
    ContractUploadService,
    IndexerService,
  ],
})
export class BlockchainModule {}
