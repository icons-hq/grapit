import { json, type RequestHandler } from 'express';
export function analyticsBodyParser(): RequestHandler {
  const parser = json({ limit: '16kb' });
  const replay = json({ limit: '800kb' });
  return function parseAnalyticsJson(req, res, next) { (req.path === '/replay' ? replay : parser)(req, res, next); };
}
