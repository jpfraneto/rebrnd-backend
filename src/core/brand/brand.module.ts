// Dependencies
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

// Controllers
import { BrandController } from './brand.controller';

// Services
import { BrandService } from './services';
import { UserService } from '../user/services';
import { BrandSeederService } from './services/brand-seeding.service';
import { AdminService } from '../admin/services/admin.service';

// Models
import {
  Brand,
  User,
  UserBrandVotes,
  UserDailyActions,
  Category,
} from '../../models';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from '../admin/admin.controller';
import { BrandSchedulerService } from './services/brand-scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      User,
      Brand,
      UserBrandVotes,
      UserDailyActions,
      Category,
    ]),
    AuthModule,
  ],
  controllers: [BrandController, AdminController],
  providers: [
    BrandService,
    UserService,
    BrandSeederService,
    AdminService,
    BrandSchedulerService,
  ],
  exports: [BrandService],
})
export class BrandModule {}
