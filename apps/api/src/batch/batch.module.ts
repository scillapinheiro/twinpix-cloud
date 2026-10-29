import { Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { ReviewModule } from '../review/review.module';
import { BatchController } from './batch.controller';
import { BATCH_OPTIONS, BatchService } from './batch.service';

@Module({
  imports: [ReviewModule, ActionsModule],
  controllers: [BatchController],
  exports: [BatchService],
  providers: [BatchService, { provide: BATCH_OPTIONS, useValue: { offlineRetryMs: 30_000 } }],
})
export class BatchModule {}
