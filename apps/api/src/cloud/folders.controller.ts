import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { CloudFolder, NestedRoot } from '@twinpix/shared';
import { findNestedRoots } from '../grouping/folders';
import { CLOUD_PROVIDER } from '../tokens';
import type { CloudProvider } from './cloud-provider';

@Controller('folders')
export class FoldersController {
  constructor(@Inject(CLOUD_PROVIDER) private readonly cloud: CloudProvider) {}

  @Get('root')
  root(): Promise<CloudFolder> {
    return this.cloud.getRoot();
  }

  @Get(':id/children')
  children(@Param('id') id: string): Promise<CloudFolder[]> {
    return this.cloud.listFolders(id);
  }

  @Post('resolve-link')
  @HttpCode(200)
  resolve(@Body() body: { url?: string }): Promise<CloudFolder> {
    if (typeof body?.url !== 'string' || !body.url.trim()) throw new BadRequestException('Cole o link da pasta.');
    return this.cloud.resolveFolderLink(body.url.trim());
  }

  @Post('check-nesting')
  @HttpCode(200)
  checkNesting(@Body() body: { paths?: string[] }): NestedRoot[] {
    return findNestedRoots(Array.isArray(body?.paths) ? body.paths.filter((p) => typeof p === 'string') : []);
  }
}
