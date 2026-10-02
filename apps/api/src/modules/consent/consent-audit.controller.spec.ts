import { BadRequestException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_CONSENT_AUDIT_DEFAULT_LIMIT,
  ADMIN_CONSENT_AUDIT_MAX_LIMIT,
  consentAuditQuerySchema,
  type AdminCapabilityUser,
  type ConsentAuditPage,
} from '@grabit/shared';
import { ADMIN_CAPABILITIES_KEY } from '../../common/decorators/admin-capabilities.decorator.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { createAdminFixtureUser } from '../admin/admin-fixtures.js';
import { ConsentAuditController } from './consent-audit.controller.js';
import { ConsentService } from './consent.service.js';

const page: ConsentAuditPage = {
  items: [
    {
      id: '9b1c2d3e-0000-4000-8000-000000000001',
      itemKey: 'privacy',
      version: '2026-05-11',
      language: 'ko',
      maskedUser: {
        id: 'user-1',
        email: 'fa***@example.com',
        phone: '+82********78',
      },
      maskedIp: '203.0.113.0',
      timestamp: '2026-05-12T00:00:00.000Z',
      sourceFlow: 'signup',
      accepted: true,
    },
  ],
  nextCursor: 'next-page',
  defaultWindowFrom: null,
};

function createController() {
  const service = {
    queryConsentAudit: vi.fn().mockResolvedValue(page),
  };

  return {
    controller: new ConsentAuditController(service as unknown as ConsentService),
    service,
  };
}

function httpContext(user: AdminCapabilityUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ConsentAuditController.prototype.queryAudit,
    getClass: () => ConsentAuditController,
  } as unknown as ExecutionContext;
}

function canQuery(user: AdminCapabilityUser): boolean {
  const reflector = new Reflector();
  const context = httpContext(user);
  return new RolesGuard(reflector).canActivate(context)
    && new AdminCapabilitiesGuard(reflector).canActivate(context);
}

describe('ConsentAuditController', () => {
  it('requires the audit.read capability in addition to the admin role', () => {
    const guards = Reflect.getMetadata('__guards__', ConsentAuditController) as unknown[];
    expect(guards).toEqual([RolesGuard, AdminCapabilitiesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, ConsentAuditController)).toEqual(['admin']);
    expect(Reflect.getMetadata(ADMIN_CAPABILITIES_KEY, ConsentAuditController)).toEqual(['audit.read']);
  });

  it('denies the shared field scanner account even though its role is admin', () => {
    // Production scanner: role=admin with only the field.scan.* capabilities.
    expect(canQuery({
      id: 'scanner-account',
      role: 'admin',
      adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
    })).toBe(false);
    expect(canQuery({
      ...createAdminFixtureUser('scanner'),
      role: 'admin',
    })).toBe(false);
    expect(canQuery({
      ...createAdminFixtureUser('operator'),
      role: 'admin',
    })).toBe(false);
  });

  it('allows audit readers and full administrators', () => {
    expect(canQuery({ ...createAdminFixtureUser('reviewer'), role: 'admin' })).toBe(true);
    expect(canQuery({ id: 'admin-1', role: 'admin' })).toBe(true);
    expect(canQuery({ id: 'user-1', role: 'user', adminCapabilities: ['audit.read'] })).toBe(false);
  });

  it('bounds the page size and passes the cursor through the validated query', async () => {
    const { controller, service } = createController();
    const pipe = new ZodValidationPipe(consentAuditQuerySchema);

    const defaults = pipe.transform({}) as Parameters<ConsentAuditController['queryAudit']>[0];
    expect(defaults.limit).toBe(ADMIN_CONSENT_AUDIT_DEFAULT_LIMIT);
    expect(() => pipe.transform({ limit: String(ADMIN_CONSENT_AUDIT_MAX_LIMIT + 1) }))
      .toThrow(BadRequestException);
    expect(() => pipe.transform({ userId: 'not-a-uuid' })).toThrow(BadRequestException);

    const query = pipe.transform({
      itemKey: 'privacy',
      version: '2026-05-11',
      language: 'ko',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.999Z',
      ip: '203.0.113.10',
      userId: '5f0d7c8a-1111-4222-8333-944455556666',
      email: 'fan@example.com',
      limit: '25',
      cursor: 'opaque-cursor',
    }) as Parameters<ConsentAuditController['queryAudit']>[0];

    await expect(controller.queryAudit(query)).resolves.toEqual(page);
    expect(service.queryConsentAudit).toHaveBeenCalledWith({
      itemKey: 'privacy',
      version: '2026-05-11',
      language: 'ko',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.999Z',
      ip: '203.0.113.10',
      userId: '5f0d7c8a-1111-4222-8333-944455556666',
      email: 'fan@example.com',
      limit: 25,
      cursor: 'opaque-cursor',
    });
  });

  it('returns masked rows and no raw email, phone, or IP', async () => {
    const { controller } = createController();

    const result = await controller.queryAudit({ limit: 10 });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('fan@example.com');
    expect(serialized).not.toContain('+821012345678');
    expect(serialized).not.toContain('203.0.113.10');
  });

  it('masks email, phone, IPv4, and IPv6 values in service helpers', () => {
    expect(ConsentService.maskEmail('fan@example.com')).toBe('fa***@example.com');
    expect(ConsentService.maskPhone('+821012345678')).toBe('+82********78');
    expect(ConsentService.maskIp('203.0.113.10')).toBe('203.0.113.0');
    expect(ConsentService.maskIp('2001:db8:abcd:0012:0000:0000:0000:0001')).toBe(
      '2001:db8:abcd:0012::',
    );
  });
});
