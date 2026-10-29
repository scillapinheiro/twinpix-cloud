import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import type { GroupView, RuleCriterion } from '@twinpix/shared';
import { isValidRules } from '../rules/suggest-keep';
import type { Db } from '../storage/db';
import { DB } from '../tokens';
import { ReviewService } from './review.service';
import { getRules, setRules } from './rules-settings';

@Controller()
export class ReviewController {
  constructor(
    private readonly review: ReviewService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get('scans/:id/groups/current')
  current(@Param('id', ParseIntPipe) id: number): GroupView | null {
    return this.review.current(id);
  }

  @Post('scans/:id/unskip')
  @HttpCode(204)
  unskip(@Param('id', ParseIntPipe) id: number): void {
    this.review.unskipAll(id);
  }

  @Get('groups/:id')
  view(@Param('id', ParseIntPipe) id: number): GroupView {
    return this.review.view(id);
  }

  @Post('groups/:id/skip')
  @HttpCode(200)
  skip(@Param('id', ParseIntPipe) id: number): GroupView | null {
    return this.review.skip(id);
  }

  @Get('groups/:id/previous')
  previous(@Param('id', ParseIntPipe) id: number): GroupView | null {
    return this.review.previous(id);
  }

  @Get('settings/rules')
  rules(): RuleCriterion[] {
    return getRules(this.db);
  }

  @Put('settings/rules')
  saveRules(@Body() body: unknown): RuleCriterion[] {
    if (!isValidRules(body) || body.length === 0) throw new BadRequestException('Lista de regras inválida.');
    setRules(this.db, body);
    return body;
  }
}
