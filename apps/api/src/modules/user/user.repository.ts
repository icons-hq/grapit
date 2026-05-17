import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import * as schema from '../../database/schema/index.js';
import type { UserProfile } from '@grabit/shared/types/user.types.js';

export interface NewUser {
  email: string;
  passwordHash: string | null; // null for social-only accounts
  name: string;
  phone: string;
  gender: 'male' | 'female' | 'unspecified';
  country: string;
  birthDate: string;
  isPhoneVerified?: boolean;
  isEmailVerified?: boolean;
  marketingConsent?: boolean;
}

@Injectable()
export class UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByEmail(email: string) {
    const results = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return results[0] ?? null;
  }

  async findById(id: string) {
    const results = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return results[0] ?? null;
  }

  async create(data: NewUser, db: Pick<DrizzleDB, 'insert'> = this.db) {
    const results = await db
      .insert(schema.users)
      .values({
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        phone: data.phone,
        gender: data.gender,
        country: data.country,
        birthDate: data.birthDate,
        isPhoneVerified: data.isPhoneVerified ?? false,
        isEmailVerified: data.isEmailVerified ?? false,
        marketingConsent: data.marketingConsent ?? false,
      })
      .returning();
    return results[0]!;
  }

  async updatePassword(userId: string, passwordHash: string) {
    await this.db
      .update(schema.users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  async updateProfile(
    userId: string,
    data: Partial<
      Pick<
        UserProfile,
        'name' | 'phone' | 'preferredLocale' | 'isPhoneVerified' | 'marketingConsent'
      >
    >,
  ) {
    await this.db
      .update(schema.users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));

    return this.findById(userId);
  }
}
