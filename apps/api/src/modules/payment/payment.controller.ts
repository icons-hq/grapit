import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { paymentMethodSchema } from '@grabit/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PaymentService } from './payment.service.js';

const paymentBranchRequestSchema = z.object({
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
  paymentMethod: paymentMethodSchema,
  successUrl: z.string().url('successUrl은 유효한 URL이어야 합니다'),
  failUrl: z.string().url('failUrl은 유효한 URL이어야 합니다'),
  pendingUrl: z.string().url('pendingUrl은 유효한 URL이어야 합니다').optional(),
});

type PaymentBranchRequestDto = z.infer<typeof paymentBranchRequestSchema>;

@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('branch')
  getTossPaymentBranch(
    @Body(new ZodValidationPipe(paymentBranchRequestSchema))
    body: PaymentBranchRequestDto,
  ) {
    return this.paymentService.prepareTossPaymentBranch(body);
  }
}
