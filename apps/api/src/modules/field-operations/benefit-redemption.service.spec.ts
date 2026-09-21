import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ADMIN_CAPABILITIES_KEY } from '../../common/decorators/admin-capabilities.decorator.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { BenefitRedemptionController } from './benefit-redemption.controller.js';

// Persistence, competing requests, input binding, negative attempts, after-entry
// redemption and result locks are covered by the real HTTP/PostgreSQL suite.
describe('Benefit redemption route contract', () => {
  it('requires online redemption with its own capability within the scanner bundle', () => {
    expect(Reflect.getMetadata(PATH_METADATA, BenefitRedemptionController)).toBe('field/benefits');
    expect(Reflect.getMetadata(ROLES_KEY, BenefitRedemptionController)).toEqual(['admin']);
    expect(Reflect.getMetadata(PATH_METADATA, BenefitRedemptionController.prototype.redeem)).toBe('redeem');
    expect(Reflect.getMetadata(METHOD_METADATA, BenefitRedemptionController.prototype.redeem)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ADMIN_CAPABILITIES_KEY, BenefitRedemptionController.prototype.redeem)).toEqual(['field.benefits.redeem']);
    expect(Object.getOwnPropertyNames(BenefitRedemptionController.prototype)).toEqual(['constructor', 'redeem']);
  });
});
