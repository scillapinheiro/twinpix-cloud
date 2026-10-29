import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { BatchSummary, CloudItem, FolderCluster, ReconcileItem, ReconcilePlan } from '@twinpix/shared';
import { FoldersReconcileService } from './folders-reconcile.service';

const str = (v: unknown, msg: string): string => {
  if (typeof v !== 'string' || v === '') throw new BadRequestException(msg);
  return v;
};

@Controller()
export class FoldersReconcileController {
  constructor(private readonly folders: FoldersReconcileService) {}

  @Get('scans/:id/folder-clusters')
  clusters(@Param('id', ParseIntPipe) id: number): FolderCluster[] {
    return this.folders.clusters(id);
  }

  @Get('scans/:id/folder-clusters/unique')
  unique(@Param('id', ParseIntPipe) id: number, @Query('key') key?: string, @Query('folder') folder?: string): CloudItem[] {
    return this.folders.unique(id, str(key, 'Conjunto de pastas inválido.'), str(folder, 'Pasta escolhida inválida.'));
  }

  @Get('scans/:id/folder-clusters/plan')
  plan(@Param('id', ParseIntPipe) id: number, @Query('key') key?: string, @Query('keep') keep?: string): ReconcilePlan {
    return this.folders.plan(id, str(key, 'Conjunto de pastas inválido.'), str(keep, 'Pasta escolhida inválida.'));
  }

  @Post('scans/:id/folder-clusters/apply')
  @HttpCode(200)
  apply(@Param('id', ParseIntPipe) id: number, @Body() body: { key?: string; keepFolder?: string; items?: ReconcileItem[] }): BatchSummary {
    const key = str(body?.key, 'Conjunto de pastas inválido.');
    const keepFolder = str(body?.keepFolder, 'Pasta escolhida inválida.');
    if (!Array.isArray(body?.items)) throw new BadRequestException('A prévia mudou. Abra as pastas repetidas de novo.');
    return this.folders.apply(id, key, keepFolder, body.items);
  }
}
