import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { BatchPreview, BatchSummary } from '@twinpix/shared';
import { BatchService } from './batch.service';

@Controller()
export class BatchController {
  constructor(private readonly batch: BatchService) {}

  @Get('scans/:id/batch')
  preview(@Param('id', ParseIntPipe) id: number): BatchPreview {
    return this.batch.preview(id);
  }

  @Post('scans/:id/batch')
  @HttpCode(200)
  start(@Param('id', ParseIntPipe) id: number, @Body() body: { lineKeys?: string[] }): BatchSummary {
    return this.batch.start(id, Array.isArray(body?.lineKeys) ? body.lineKeys : []);
  }

  @Get('batches')
  list(): BatchSummary[] {
    return this.batch.list();
  }

  @Get('batches/:id')
  get(@Param('id', ParseIntPipe) id: number): BatchSummary {
    return this.batch.summary(id);
  }

  @Post('batches/:id/pause')
  @HttpCode(200)
  pause(@Param('id', ParseIntPipe) id: number): BatchSummary {
    return this.batch.pause(id);
  }

  @Post('batches/:id/resume')
  @HttpCode(200)
  resume(@Param('id', ParseIntPipe) id: number): BatchSummary {
    return this.batch.resume(id);
  }

  @Post('batches/:id/undo')
  @HttpCode(200)
  undo(@Param('id', ParseIntPipe) id: number): BatchSummary {
    return this.batch.undo(id);
  }
}
