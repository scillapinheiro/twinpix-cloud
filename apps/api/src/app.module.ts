import { DynamicModule, Global, Module } from '@nestjs/common';
import { mkdirSync, rmSync } from 'node:fs';
import { AuthModule } from './auth/auth.module';
import { ActionsModule } from './actions/actions.module';
import { BatchModule } from './batch/batch.module';
import { CloudModule } from './cloud/cloud.module';
import type { AppConfig } from './config';
import { ReviewModule } from './review/review.module';
import { ScanModule } from './scan/scan.module';
import { Db } from './storage/db';
import { CONFIG, DB } from './tokens';

@Global()
@Module({})
class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: CONFIG, useValue: config },
        {
          provide: DB,
          useFactory: () => {
            mkdirSync(config.dataDir, { recursive: true });
            if (config.demo) rmSync(config.dbFile, { force: true });
            return new Db(config.dbFile);
          },
        },
      ],
      exports: [CONFIG, DB],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(config), AuthModule, CloudModule, ScanModule, ReviewModule, ActionsModule, BatchModule],
    };
  }
}
