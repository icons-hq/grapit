import { Body, Controller, HttpCode, Post, Request } from '@nestjs/common';
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

const paymentBranchReleaseSchema = z.object({
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
});

type PaymentBranchReleaseDto = z.infer<typeof paymentBranchReleaseSchema>;

const asyncPaymentReturnSchema = z.object({
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
  paymentKey: z.string().min(1, '결제 키가 필요합니다'),
  amount: z.number().positive('결제 금액은 0보다 커야 합니다').optional(),
  // Accepted for older clients and ignored: the wallet comes from the provider
  // lookup and the order's frozen checkout method.
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
    @Request() req: { user: { id: string } },
  ) {
    return this.paymentService.prepareTossPaymentBranch({
      ...body,
      userId: req.user.id,
    });
  }

  /**
   * Called by the checkout page whenever the provider SDK rejected `requestPayment`
   * (before opening checkout, or after the buyer closed it), or when the branch response
   * was lost or failed with a 5xx after a possible commit.
   */
  @Post('branch/release')
  @HttpCode(200)
  releaseTossPaymentHandoff(
    @Body(new ZodValidationPipe(paymentBranchReleaseSchema))
    body: PaymentBranchReleaseDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.paymentService.releaseTossPaymentHandoff({
      orderId: body.orderId,
      userId: req.user.id,
    });
  }

  /** Pending return of an asynchronously approved foreign wallet order (others get 409). */
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
