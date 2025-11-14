import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DailyService } from './daily.service';
import { DailyController } from './daily.controller';
import { UserService } from '../user/services';
import { AirdropService } from '../airdrop/services/airdrop.service';

import {
  User,
  UserBrandVotes,
  UserDailyActions,
  Brand,
  AirdropScore,
} from '../../models';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserBrandVotes,
      UserDailyActions,
      Brand,
      AirdropScore,
    ]),
  ],
  controllers: [DailyController],
  providers: [DailyService, UserService, AirdropService],
  exports: [DailyService],
})
export class DailyModule {}
