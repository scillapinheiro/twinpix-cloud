import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { SCAN_OPTIONS, ScanService } from './scan.service';

@Module({
  controllers: [ScanController],
  providers: [ScanService, { provide: SCAN_OPTIONS, useValue: { offlineRetryMs: 30_000 } }],
  exports: [ScanService],
})
export class ScanModule {}
