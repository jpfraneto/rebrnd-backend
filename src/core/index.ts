// Dependencies
import { AuthModule } from './auth/auth.module';
import { BrandModule } from './brand/brand.module';
import { UserModule } from './user/user.module';
import { VoteModule } from './vote/vote.module';
import { NotificationModule } from './notification/notification.module';
import { EmbedsModule } from './embeds/embeds.module';
import { AdminModule } from './admin/admin.module';

const CoreModules = [
  UserModule,
  BrandModule,
  AuthModule,
  VoteModule,
  NotificationModule,
  EmbedsModule,
  AdminModule,
];

export default CoreModules;
