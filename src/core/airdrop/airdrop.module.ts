import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AirdropController } from './airdrop.controller';
import { AirdropService } from './services/airdrop.service';
import { AirdropScore, User } from '../../models';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AirdropScore, User]),
    AuthModule,
  ],
  controllers: [AirdropController],
  providers: [AirdropService],
  exports: [AirdropService],
})
export class AirdropModule {}