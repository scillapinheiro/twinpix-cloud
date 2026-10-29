import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, PCA_FACTORY } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, { provide: PCA_FACTORY, useValue: undefined }],
  exports: [AuthService],
})
export class AuthModule {}
