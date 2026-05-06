import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TranslationService } from './translation.service.js';

const createSourceSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  field: z.string().min(1),
  sourceText: z.string().min(1),
});

const reviewDraftSchema = z.object({
  translatedText: z.string().min(1).optional(),
  reviewerId: z.string().uuid().optional(),
});

const editSourceSchema = z.object({
  sourceText: z.string().min(1),
});

type CreateSourceInput = z.infer<typeof createSourceSchema>;
type ReviewDraftInput = z.infer<typeof reviewDraftSchema>;
type EditSourceInput = z.infer<typeof editSourceSchema>;

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
  async listQueue() {
    return this.translationService.listQueue();
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
      body.reviewerId ?? user.id,
      body.translatedText,
    );
  }

  @Post('drafts/:draftId/publish')
  async publishDraft(@Param('draftId') draftId: string) {
    return this.translationService.publishDraft(draftId);
  }
}
