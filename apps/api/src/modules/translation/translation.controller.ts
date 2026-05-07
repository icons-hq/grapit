import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  TRANSLATION_TARGET_LOCALES,
  TranslationService,
} from './translation.service.js';

const createSourceSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  field: z.string().min(1),
  sourceText: z.string().min(1),
});

const reviewDraftSchema = z.object({
  translatedText: z.string().min(1).optional(),
});

const editSourceSchema = z.object({
  sourceText: z.string().min(1),
});

const queueFiltersSchema = z.object({
  contentType: z.string().min(1).optional(),
  locale: z.enum(TRANSLATION_TARGET_LOCALES).optional(),
  status: z.enum(['draft', 'review', 'published', 'stale']).optional(),
  updatedFrom: z.string().datetime().optional(),
  updatedTo: z.string().datetime().optional(),
});

type CreateSourceInput = z.infer<typeof createSourceSchema>;
type ReviewDraftInput = z.infer<typeof reviewDraftSchema>;
type EditSourceInput = z.infer<typeof editSourceSchema>;
type QueueFiltersInput = z.infer<typeof queueFiltersSchema>;

@Controller('admin/translations')
@UseGuards(RolesGuard)
@Roles('admin')
export class TranslationController {
  constructor(private readonly translationService: TranslationService) {}

  @Post('sources')
  async createSource(
    @Body(new ZodValidationPipe(createSourceSchema)) body: CreateSourceInput,
    @Req() req: Request,
  ) {
    const user = req.user as { id: string };
    return this.translationService.createSource({
      ...body,
      createdBy: user.id,
    });
  }

  @Post('sources/:sourceId/drafts')
  async generateDrafts(@Param('sourceId') sourceId: string) {
    return this.translationService.generateDrafts(sourceId);
  }

  @Patch('sources/:sourceId')
  async editSource(
    @Param('sourceId') sourceId: string,
    @Body(new ZodValidationPipe(editSourceSchema)) body: EditSourceInput,
  ) {
    return this.translationService.markStaleOnSourceEdit(sourceId, body.sourceText);
  }

  @Get('queue')
  async listQueue(
    @Query(new ZodValidationPipe(queueFiltersSchema)) query: QueueFiltersInput,
  ) {
    return this.translationService.listQueue(query);
  }

  @Post('drafts/:draftId/review')
  async reviewDraft(
    @Param('draftId') draftId: string,
    @Body(new ZodValidationPipe(reviewDraftSchema)) body: ReviewDraftInput,
    @Req() req: Request,
  ) {
    const user = req.user as { id: string };
    return this.translationService.markReviewed(
      draftId,
      user.id,
      body.translatedText,
    );
  }

  @Post('drafts/:draftId/publish')
  async publishDraft(@Param('draftId') draftId: string) {
    return this.translationService.publishDraft(draftId);
  }
}
