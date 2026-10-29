import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import type { AppConfig } from '../config';
import { CLOUD_PROVIDER, CONFIG } from '../tokens';
import type { CloudProvider } from './cloud-provider';
import { seedDemo } from './demo-seed';
import { FakeCloudProvider } from './fake-cloud-provider';
import { FilesController } from './files.controller';
import { FoldersController } from './folders.controller';
import { GraphClient } from './onedrive/graph-client';
import { OneDriveProvider } from './onedrive/onedrive-provider';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [FoldersController, FilesController],
  providers: [
    {
      provide: CLOUD_PROVIDER,
      inject: [CONFIG, AuthService],
      useFactory: (config: AppConfig, auth: AuthService): CloudProvider => {
        if (config.provider === 'fake') {
          const fake = new FakeCloudProvider();
          fake.pageSize = 5;
          seedDemo(fake);
          return fake;
        }
        return new OneDriveProvider(new GraphClient(auth), { testFolder: config.testFolder });
      },
    },
  ],
  exports: [CLOUD_PROVIDER],
})
export class CloudModule {}
