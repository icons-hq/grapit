import { Body, Controller, Post, Request } from '@nestjs/common';
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

const asyncPaymentReturnSchema = z.object({
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
  paymentKey: z.string().min(1, '결제 키가 필요합니다'),
  amount: z.number().positive('결제 금액은 0보다 커야 합니다').optional(),
  provider: z.enum(['ALIPAY_PLUS', 'TRUEMONEY']).optional(),
});

type AsyncPaymentReturnDto = z.infer<typeof asyncPaymentReturnSchema>;

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

  @Post('async-return')
  async reconcileAsyncPaymentReturn(
    @Body(new ZodValidationPipe(asyncPaymentReturnSchema))
    body: AsyncPaymentReturnDto,
    @Request() req: { user: { id: string } },
  ) {
    await this.paymentService.reconcileAsyncPaymentReturn({
      ...body,
      userId: req.user.id,
    });

    return { acknowledged: true };
  }
}
