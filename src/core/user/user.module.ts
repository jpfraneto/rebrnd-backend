// Dependencies
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';

// Controllers
import { UserController } from './user.controller';

// Services
import { UserService } from './services';

// Models
import { Brand, User, UserBrandVotes, UserDailyActions } from '../../models';
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Brand, UserBrandVotes, UserDailyActions]),
    AuthModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
