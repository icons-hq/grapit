import { Controller, Get, UseGuards } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'node:crypto';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

/**
 * AdminDiagnosticsController — Phase 13 Plan 03 (D-12).
 *
 * 새 Sentry 프로젝트(grabit-api) 이벤트 수신 검증을 위한 admin-only endpoint.
 * 404/SDK-init 기반 검증 방식은 비결정적이므로 폐기하고,
 * 명시적 `Sentry.captureException(new Error(marker))` 호출로 event ID 를 반환한다.
 * 호출자는 반환된 eventId 를 Sentry UI/API 에서 조회해 수신 여부를 확정할 수 있다.
 *
 * JwtAuthGuard 는 APP_GUARD 로 전역 적용되어 있으므로 미인증 → 401, 비관리자 → 403
 * (T-13-27 mitigation). 운영 Sentry 에 이벤트를 쓰는 진단 도구이므로 제한 권한
 * 관리자(현장 scanner 등)는 막고 `security.manage` 보유자(superuser 포함)만 허용한다.
 */
@Controller('admin')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
@AdminCapabilities('security.manage')
export class AdminDiagnosticsController {
  @Get('_sentry-test')
  sentryTest(): { eventId: string | undefined; marker: string } {
    const marker = `phase-13 sentry-test ${randomUUID()}`;
    const eventId = Sentry.captureException(new Error(marker));
    return { eventId, marker };
  }
}
