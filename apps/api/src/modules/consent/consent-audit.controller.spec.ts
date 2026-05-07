import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { ConsentAuditController } from './consent-audit.controller.js';
import { ConsentService } from './consent.service.js';

describe('ConsentAuditController', () => {
  function createController() {
    const service = {
      queryConsentAudit: vi.fn().mockResolvedValue([
        {
          itemKey: 'cross_border_transfer',
          version: '2026-05-01',
          language: 'ko',
          maskedUser: {
            id: 'user-1',
            email: 'fa***@example.com',
            phone: '+82********78',
          },
          maskedIp: '203.0.113.0',
          timestamp: '2026-05-06T00:00:00.000Z',
          sourceFlow: 'signup',
          accepted: true,
        },
      ]),
    };

    return {
      controller: new ConsentAuditController(service as unknown as ConsentService),
      service,
    };
  }

  it('is guarded by RolesGuard and admin role metadata', () => {
    const guards = Reflect.getMetadata('__guards__', ConsentAuditController) as unknown[];
    expect(guards).toContain(RolesGuard);
    expect(Reflect.getMetadata(ROLES_KEY, ConsentAuditController)).toEqual(['admin']);
  });

  it('passes every COMP-02 filter to the service', async () => {
    const { controller, service } = createController();

    await controller.queryAudit({
      itemKey: 'cross_border_transfer',
      version: '2026-05-01',
      language: 'ko',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.999Z',
      ip: '203.0.113.10',
      userId: 'user-1',
      email: 'fan@example.com',
    });

    expect(service.queryConsentAudit).toHaveBeenCalledWith({
      itemKey: 'cross_border_transfer',
      version: '2026-05-01',
      language: 'ko',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.999Z',
      ip: '203.0.113.10',
      userId: 'user-1',
      email: 'fan@example.com',
    });
  });

  it('returns dense masked rows and no raw email, phone, or IP by default', async () => {
    const { controller } = createController();

    const result = await controller.queryAudit({
      itemKey: 'cross_border_transfer',
      version: '2026-05-01',
      language: 'ko',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.999Z',
      ip: '203.0.113.10',
      userId: 'user-1',
      email: 'fan@example.com',
    });

    expect(result).toEqual([
      {
        itemKey: 'cross_border_transfer',
        version: '2026-05-01',
        language: 'ko',
        maskedUser: {
          id: 'user-1',
          email: 'fa***@example.com',
          phone: '+82********78',
        },
        maskedIp: '203.0.113.0',
        timestamp: '2026-05-06T00:00:00.000Z',
        sourceFlow: 'signup',
        accepted: true,
      },
    ]);

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
