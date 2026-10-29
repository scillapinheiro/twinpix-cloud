import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { ApplyResult, DeletionPreview, HistoryEntry, UndoResponse } from '@twinpix/shared';
import { ActionsService } from './actions.service';

@Controller()
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  @Post('groups/:id/preview')
  @HttpCode(200)
  preview(@Param('id', ParseIntPipe) id: number, @Body() body: { deleteIds?: string[] }): DeletionPreview {
    return this.actions.preview(id, body?.deleteIds ?? []);
  }

  @Post('groups/:id/apply')
  @HttpCode(200)
  apply(@Param('id', ParseIntPipe) id: number, @Body() body: { deleteIds?: string[] }): Promise<ApplyResult> {
    return this.actions.apply(id, body?.deleteIds ?? []);
  }

  @Get('history')
  history(): HistoryEntry[] {
    return this.actions.history();
  }

  @Post('actions/:id/undo')
  @HttpCode(200)
  undo(@Param('id', ParseIntPipe) id: number): Promise<UndoResponse> {
    return this.actions.undo(id);
  }
}
