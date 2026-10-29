import { Module } from '@nestjs/common';
import { BatchModule } from '../batch/batch.module';
import { ReviewModule } from '../review/review.module';
import { FoldersReconcileController } from './folders-reconcile.controller';
import { FoldersReconcileService } from './folders-reconcile.service';

@Module({
  imports: [ReviewModule, BatchModule],
  controllers: [FoldersReconcileController],
  providers: [FoldersReconcileService],
})
export class FoldersReconcileModule {}
