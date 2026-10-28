import { json, type RequestHandler } from 'express';

// A venue import carries floor, tier and section seat IDs. The default 100 KiB
// parser rejects a 10,000-seat map before it reaches schema validation. Keep a
// bounded allowance on admin routes only; buyer/payment routes keep the default.
export function adminBodyParser(): RequestHandler {
  const parser = json({ limit: '2mb' });
  // Nest detects its global parser by the middleware name `jsonParser`.
  // Keep this scoped wrapper named differently, so buyer JSON is still parsed.
  return function parseAdminJson(req, res, next) { parser(req, res, next); };
}
