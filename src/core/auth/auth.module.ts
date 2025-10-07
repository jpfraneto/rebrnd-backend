// Dependencies
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Controllers
import { AuthController } from './auth.controller';

// Services
import { AuthService } from './services';
import { UserService } from '../user/services';

// Models
import { Brand, User, UserBrandVotes, UserDailyActions } from '../../models';
import { AdminGuard } from 'src/security/guards';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Brand, UserBrandVotes, UserDailyActions]),
  ],
  controllers: [AuthController],
  providers: [AuthService, UserService, AdminGuard],
  exports: [AuthService, AdminGuard],
})
export class AuthModule {}
