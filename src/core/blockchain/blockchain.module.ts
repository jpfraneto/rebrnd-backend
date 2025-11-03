import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './services/blockchain.service';
import { PowerLevelService } from './services/power-level.service';
import { SignatureService } from './services/signature.service';
import { RewardService } from './services/reward.service';
import { CastVerificationService } from './services/cast-verification.service';
import { ContractUploadService } from './services/contract-upload.service';
import { AuthModule } from '../auth/auth.module';

import { User, RewardClaim, Brand } from '../../models';

@Module({
  imports: [TypeOrmModule.forFeature([User, RewardClaim, Brand]), AuthModule],
  controllers: [BlockchainController],
  providers: [
    BlockchainService, 
    PowerLevelService, 
    SignatureService, 
    RewardService, 
    CastVerificationService,
    ContractUploadService
  ],
  exports: [
    BlockchainService, 
    PowerLevelService, 
    SignatureService, 
    RewardService, 
    CastVerificationService,
    ContractUploadService
  ],
})
export class BlockchainModule {}
