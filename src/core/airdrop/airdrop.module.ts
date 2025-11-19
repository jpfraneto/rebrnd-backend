import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AirdropController } from './airdrop.controller';
import { AirdropService } from './services/airdrop.service';
import { AirdropContractService } from './services/airdrop-contract.service';
import { AirdropScore, AirdropSnapshot, User } from '../../models';
import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AirdropScore, AirdropSnapshot, User]),
    AuthModule,
    BlockchainModule, // Import to access SignatureService
  ],
  controllers: [AirdropController],
  providers: [AirdropService, AirdropContractService],
  exports: [AirdropService, AirdropContractService],
})
export class AirdropModule {}
