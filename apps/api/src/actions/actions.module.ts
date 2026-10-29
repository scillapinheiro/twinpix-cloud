import { Module } from '@nestjs/common';
import { ReviewModule } from '../review/review.module';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';

@Module({ imports: [ReviewModule], controllers: [ActionsController], providers: [ActionsService] })
export class ActionsModule {}
