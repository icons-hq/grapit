import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  AdminSupportContentService,
  SUPPORT_CONTENT_LOCALES,
  type SupportContentListFilters,
} from './admin-support-content.service.js';

const faqCategorySchema = z.enum([
  'general',
  'event_info',
  'booking',
  'payment_error',
  'refund_unprocessed',
  'refund_dispute',
  'signup_failure',
  'account',
  'ticket_delivery',
  'seat_accessibility',
  'abuse_fraud',
  'other',
]);

const noticeCategorySchema = z.enum([
  'general',
  'urgent',
  'maintenance',
  'payment',
  'refund',
  'signup',
  'event',
]);

const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
const translationUseSchema = z.enum(['manual', 'assisted']);
const listSchema = z.object({
  type: z.enum(['faq', 'notice']).optional(),
  locale: z.enum(SUPPORT_CONTENT_LOCALES).optional(),
  reviewState: z
    .enum(['draft', 'review', 'approved', 'published', 'archived'])
    .optional(),
  includeArchived: z
    .preprocess((value) => value === true || value === 'true', z.boolean())
    .optional(),
});

const createFaqSchema = z.object({
  category: faqCategorySchema,
  locale: z.enum(SUPPORT_CONTENT_LOCALES),
  question: z.string().min(1),
  answer: z.string().min(1),
  sortOrder: z.number().int().optional(),
  isPinned: z.boolean().optional(),
  translationUse: translationUseSchema.optional(),
});

const updateFaqSchema = createFaqSchema.partial().extend({
  actorUserId: z.never().optional(),
});

const createNoticeSchema = z.object({
  category: noticeCategorySchema,
  locale: z.enum(SUPPORT_CONTENT_LOCALES),
  title: z.string().min(1),
  body: z.string().min(1),
  priority: prioritySchema.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  translationUse: translationUseSchema.optional(),
});

const updateNoticeSchema = createNoticeSchema.partial().extend({
  actorUserId: z.never().optional(),
});

type CreateFaqInput = z.infer<typeof createFaqSchema>;
type UpdateFaqInput = z.infer<typeof updateFaqSchema>;
type CreateNoticeInput = z.infer<typeof createNoticeSchema>;
type UpdateNoticeInput = z.infer<typeof updateNoticeSchema>;

@Controller('admin/support-content')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
@AdminCapabilities('support.manage')
export class AdminSupportContentController {
  constructor(private readonly service: AdminSupportContentService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listSchema)) query: SupportContentListFilters,
  ) {
    return this.service.list(query);
  }

  @Get('faqs/:id')
  getFaq(@Param('id') id: string) {
    return this.service.getFaq(id);
  }

  @Post('faqs')
  createFaq(
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(createFaqSchema)) body: CreateFaqInput,
  ) {
    return this.service.createFaq({ ...body, actorUserId });
  }

  @Patch('faqs/:id')
  updateFaq(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(updateFaqSchema)) body: UpdateFaqInput,
  ) {
    return this.service.updateFaq(id, { ...body, actorUserId });
  }

  @Post('faqs/:id/review')
  reviewFaq(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    return this.service.reviewFaq(id, { actorUserId });
  }

  @Post('faqs/:id/publish')
  publishFaq(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    return this.service.publishFaq(id, { actorUserId });
  }

  @Post('faqs/:id/archive')
  archiveFaq(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    return this.service.archiveFaq(id, { actorUserId });
  }

  @Get('notices/:id')
  getNotice(@Param('id') id: string) {
    return this.service.getNotice(id);
  }

  @Post('notices')
  createNotice(
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(createNoticeSchema)) body: CreateNoticeInput,
  ) {
    return this.service.createNotice({ ...body, actorUserId });
  }

  @Patch('notices/:id')
  updateNotice(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(updateNoticeSchema)) body: UpdateNoticeInput,
  ) {
    return this.service.updateNotice(id, { ...body, actorUserId });
  }

  @Post('notices/:id/review')
  reviewNotice(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    return this.service.reviewNotice(id, { actorUserId });
  }

  @Post('notices/:id/publish')
  publishNotice(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    return this.service.publishNotice(id, { actorUserId });
  }

  @Post('notices/:id/archive')
  archiveNotice(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    return this.service.archiveNotice(id, { actorUserId });
  }
}
