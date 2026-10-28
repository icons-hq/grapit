import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { adminBodyParser } from './admin-body-parser.js';

@Controller()
class BodyProbeController {
  @Post('buyer') buyer(@Body() body: { seat: string }) { return body; }
  @Post('admin/seat-map') admin(@Body() body: { seats: string[] }) { return { count: body.seats.length }; }
}

describe('admin seat map body parsing', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [BodyProbeController] }).compile();
    app = module.createNestApplication();
    app.use('/admin', adminBodyParser());
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('still parses buyer JSON through Nest after installing the scoped admin parser', async () => {
    const response = await request(app.getHttpServer()).post('/buyer').send({ seat: '1F:A-1' }).expect(201);
    expect(response.body).toEqual({ seat: '1F:A-1' });
  });

  it('accepts a large venue import on admin routes while keeping the buyer body limit', async () => {
    const body = { seats: Array.from({ length: 10000 }, (_, index) => `FLOOR1:A-${index}`) };
    const response = await request(app.getHttpServer()).post('/admin/seat-map').send(body).expect(201);
    expect(response.body).toEqual({ count: 10000 });
    await request(app.getHttpServer()).post('/buyer').send(body).expect(413);
  });
});
