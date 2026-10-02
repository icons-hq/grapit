import {
  ForbiddenException,
  type ExecutionContext,
  type INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Agent } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ADMIN_CAPABILITIES_KEY } from '../../common/decorators/admin-capabilities.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCutoverController } from './admin-cutover.controller.js';
import { AdminCutoverService } from './admin-cutover.service.js';

type AuthMode =
  | 'anonymous'
  | 'user'
  | 'admin_without_audit'
  | 'admin_with_audit';

describe('AdminCutoverController', () => {
  let app: INestApplication;
  let agent: Agent;
  let mode: AuthMode = 'admin_with_audit';
  let service: {
    getGateSummary: Mock;
  };

  beforeAll(async () => {
    service = {
      getGateSummary: vi.fn(),
    };
    const reflector = new Reflector();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AdminCutoverController],
      providers: [
        {
          provide: AdminCutoverService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          if (mode === 'anonymous') {
            throw new UnauthorizedException();
          }
          if (mode === 'user') {
            req.user = { id: 'user-1', role: 'user', roles: ['user'] };
            throw new ForbiddenException();
          }
          req.user = {
            id: 'admin-1',
            email: 'admin@grapit.test',
            role: 'admin',
            roles: ['admin'],
            adminCapabilities:
              mode === 'admin_with_audit' ? ['audit.read'] : ['support.manage'],
          };
          return true;
        },
      })
      .overrideGuard(AdminCapabilitiesGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          const required = reflector.getAllAndOverride<string[]>(
            ADMIN_CAPABILITIES_KEY,
            [ctx.getHandler(), ctx.getClass()],
          );
          if (!required?.length) {
            return true;
          }
          const capabilities = req.user?.adminCapabilities ?? [];
          return required.every((capability) => capabilities.includes(capability));
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    // One listening server and one keep-alive socket for the file. Without it supertest
    // listens on and closes a new ephemeral port per request, which intermittently
    // fails with "socket hang up" when a pooled socket of a closed server is reused.
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  beforeEach(() => {
    mode = 'admin_with_audit';
    service.getGateSummary.mockReset();
    service.getGateSummary.mockResolvedValue(cutoverSummary());
  });

  afterAll(async () => {
    agent?.destroy();
    await app?.close();
  });

  it.each([
    ['anonymous', 401],
    ['user', 403],
    ['admin_without_audit', 403],
    ['admin_with_audit', 200],
  ] as const)(
    'requires admin role plus audit.read capability for %s callers',
    async (authMode, expectedStatus) => {
      mode = authMode;

      const res = await request(app.getHttpServer()).get('/admin/cutover/gates').agent(agent);

      expect(res.status).toBe(expectedStatus);
      if (expectedStatus === 200) {
        expect(service.getGateSummary).toHaveBeenCalledTimes(1);
        expect(res.body).toMatchObject({
          finalEnableAllowed: false,
          firstBlockingGate: {
            gateId: 'BLOCKED_GATE',
            state: 'BLOCKED',
          },
        });
      }
    },
  );

  it('returns redacted cutover readiness rows with firstBlockingGate and finalEnableAllowed=false', async () => {
    mode = 'admin_with_audit';

    const res = await request(app.getHttpServer()).get('/admin/cutover/gates').agent(agent);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      generatedAt: '2026-05-20T05:00:00.000Z',
      countsByState: {
        BLOCKED: 1,
        PASS: 1,
      },
      missingEvidenceCount: 1,
      finalEnableAllowed: false,
      firstBlockingGate: {
        gateId: 'BLOCKED_GATE',
        state: 'BLOCKED',
        evidenceRefs: [],
      },
      rows: [
        {
          gateId: 'BLOCKED_GATE',
          state: 'BLOCKED',
          evidenceRefs: [],
          rollbackOrCloseTrigger: 'Rollback on health 5xx',
        },
        {
          gateId: 'PASS_GATE',
          state: 'PASS',
          evidenceRefs: ['evidence/pass.json'],
        },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('paymentKey');
    expect(JSON.stringify(res.body)).not.toContain('cookie');
  });
});

function cutoverSummary() {
  return {
    generatedAt: '2026-05-20T05:00:00.000Z',
    ledgerGeneratedAt: '2026-05-20T00:00:00.000Z',
    source: {
      state: 'loaded',
      runtimeArtifactRequired: false,
    },
    rows: [
      {
        gateId: 'BLOCKED_GATE',
        requirementIds: ['M1-01'],
        state: 'BLOCKED',
        environment: 'production',
        evidenceRefs: [],
        evidenceMissing: true,
        failureReason: 'Evidence is missing.',
        approvalState: 'not_requested',
        approver: null,
        approvalTimestamp: null,
        compensatingMonitoring: 'Watch health and payment safety',
        rollbackOrCloseTrigger: 'Rollback on health 5xx',
        sourceDecisions: ['D-08'],
        redactionNotes: 'Redacted metadata only.',
        blocking: true,
        blockingReason: '증거가 비어 있어 no-go입니다',
      },
      {
        gateId: 'PASS_GATE',
        requirementIds: ['OPS-01'],
        state: 'PASS',
        environment: 'production',
        evidenceRefs: ['evidence/pass.json'],
        evidenceMissing: false,
        failureReason: null,
        approvalState: 'not_requested',
        approver: null,
        approvalTimestamp: null,
        compensatingMonitoring: 'Watch Cloud Run logs',
        rollbackOrCloseTrigger: 'Close booking on payment mismatch',
        sourceDecisions: ['D-16'],
        redactionNotes: 'Redacted metadata only.',
        blocking: false,
        blockingReason: null,
      },
    ],
    countsByState: {
      PASS: 1,
      FAIL: 0,
      ACCEPTED_RISK: 0,
      CONFIG_READY_NOT_DRILLED: 0,
      BLOCKED: 1,
    },
    missingEvidenceCount: 1,
    firstBlockingGate: {
      gateId: 'BLOCKED_GATE',
      state: 'BLOCKED',
      evidenceRefs: [],
    },
    finalEnableAllowed: false,
    redactionNotes: ['Redacted metadata and evidence refs only.'],
  };
}
