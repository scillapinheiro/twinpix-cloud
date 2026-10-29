import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, BadRequestException } from '@nestjs/common';
import type { CloudFolder, CloudItem, ScanSummary } from '@twinpix/shared';
import { ScanService } from './scan.service';

@Controller('scans')
export class ScanController {
  constructor(private readonly scans: ScanService) {}

  @Post()
  start(@Body() body: { roots?: CloudFolder[] }): ScanSummary {
    const roots = body?.roots;
    if (!Array.isArray(roots) || roots.length === 0 || !roots.every((r) => typeof r?.id === 'string' && typeof r?.path === 'string')) {
      throw new BadRequestException('Escolha pelo menos uma pasta.');
    }
    return this.scans.summary(this.scans.start(roots));
  }

  @Get('latest')
  latest(): ScanSummary | null {
    return this.scans.latest();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): ScanSummary {
    return this.scans.summary(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id', ParseIntPipe) id: number): ScanSummary {
    this.scans.pause(id);
    return this.scans.summary(id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id', ParseIntPipe) id: number): ScanSummary {
    this.scans.resume(id);
    return this.scans.summary(id);
  }

  @Get(':id/unanalyzed')
  unanalyzed(@Param('id', ParseIntPipe) id: number): CloudItem[] {
    return this.scans.unanalyzed(id);
  }
}
