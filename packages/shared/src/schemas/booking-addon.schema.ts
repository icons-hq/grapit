import { z } from 'zod';
import { ticketBenefitDisplayCopySchema } from './benefit.schema';

export const bookingAddonSelectionSchema = z.object({
  addonId: z.string().uuid(),
  seatKey: z.string().min(1).max(120),
}).strict();
export const bookingAddonSelectionsSchema = z.array(bookingAddonSelectionSchema).max(40)
  .refine((items) => new Set(items.map((x) => `${x.addonId}:${x.seatKey}`)).size === items.length,
    '중복된 애드온 선택입니다.');
export const bookingAddonDefinitionSchema = z.object({
  identity: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  displayCopy: ticketBenefitDisplayCopySchema,
  price: z.number().int().positive().max(10000000),
  capacity: z.number().int().positive().max(50000),
  eligibleTierNames: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
}).strict();
export type BookingAddonSelection = z.infer<typeof bookingAddonSelectionSchema>;
export type BookingAddonDefinition = z.infer<typeof bookingAddonDefinitionSchema>;
export interface BookingAddonChoice extends BookingAddonSelection {
  price: number;
  displayCopy: BookingAddonDefinition['displayCopy'];
  expiresAt: string;
}
export interface BookingAddonStock extends BookingAddonDefinition {
  id: string;
  available: number;
  held: number;
  sold: number;
}
export interface BookingAddonSnapshot {
  showtimeId: string;
  /** PostgreSQL statement time in microseconds orders updates across API instances. */
  revision?: number;
  generatedAt: string;
  nextExpiryAt: string | null;
  addons: BookingAddonStock[];
  selections: BookingAddonChoice[];
}

/** Public counters only: never broadcast a buyer, seat selection or order. */
export interface BookingAddonStockUpdate {
  showtimeId: string;
  revision: number;
  generatedAt: string;
  nextExpiryAt: string | null;
  stocks: Pick<BookingAddonStock, 'id' | 'available' | 'held' | 'sold' | 'capacity' | 'active'>[];
}
