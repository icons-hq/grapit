import { json, type RequestHandler } from 'express';
export function analyticsBodyParser(): RequestHandler {
  const parser = json({ limit: '16kb' });
  return function parseAnalyticsJson(req, res, next) { parser(req, res, next); };
}
