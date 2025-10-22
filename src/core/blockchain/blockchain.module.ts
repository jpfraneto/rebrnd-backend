import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './services/blockchain.service';
import { PowerLevelService } from './services/power-level.service';
import { SignatureService } from './services/signature.service';
import { AuthModule } from '../auth/auth.module';

import { User } from '../../models';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [BlockchainController],
  providers: [BlockchainService, PowerLevelService, SignatureService],
  exports: [BlockchainService, PowerLevelService, SignatureService],
})
export class BlockchainModule {}
