import { Controller, Get, Inject, Param } from '@nestjs/common';
import { CLOUD_PROVIDER } from '../tokens';
import type { CloudProvider } from './cloud-provider';

@Controller('files')
export class FilesController {
  constructor(@Inject(CLOUD_PROVIDER) private readonly cloud: CloudProvider) {}

  @Get(':id/thumbnail')
  async thumbnail(@Param('id') id: string): Promise<{ url: string | null }> {
    return { url: await this.cloud.getThumbnailUrl(id) };
  }
}
