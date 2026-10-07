import { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { KAFKA_CLIENT } from '../src/infra/messaging/kafka.js';
import * as schema from '../src/infra/schemas/schema.js';

describe('JWT authentication', () => {
  const client = new PGlite();
  const db = drizzle({ client });
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  const credentials = {
    email: 'Ana@Example.com',
    password: 'correct-horse-battery',
  };

  const login = async (body: object = credentials) => {
    const response = await http().post('/auth/login').send(body).expect(200);
    return response.body.accessToken as string;
  };

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    process.env.OUTBOX_RELAY = 'off';
    process.env.WORKFLOW_WORKER = 'off'; // no workflow polling: these tests don't run workflows
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db)
      .overrideProvider(KAFKA_CLIENT)
      .useValue({ emit: () => undefined })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();

    await http().post('/auth/register').send(credentials).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  it('stores a lowercased email and a hash, never the password', async () => {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'ana@example.com'));

    expect(user).toBeDefined();
    expect(user!.passwordHash).toMatch(/^scrypt\$/);
    expect(user!.passwordHash).not.toContain(credentials.password);
  });

  it('refuses a second account with the same email, whatever its case', async () => {
    await http()
      .post('/auth/register')
      .send({ email: 'ANA@example.com', password: 'another-password' })
      .expect(409);
  });

  it('refuses malformed credentials and short passwords', async () => {
    await http()
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'long-enough' })
      .expect(400);
    await http()
      .post('/auth/register')
      .send({ email: 'bob@example.com', password: 'short' })
      .expect(400);
    await http().post('/auth/login').send({}).expect(400);
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    const wrongPassword = await http()
      .post('/auth/login')
      .send({ ...credentials, password: 'wrong-password' })
      .expect(401);
    const unknownEmail = await http()
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: credentials.password })
      .expect(401);

    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('lets a valid token through to the authenticated endpoint', async () => {
    const token = await login({ ...credentials, email: 'ana@example.com' });

    const response = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      id: expect.any(String),
      email: 'ana@example.com',
    });
  });

  it('rejects a missing, tampered or expired token', async () => {
    const token = await login();
    const jwt = app.get(JwtService);
    const expired = await jwt.signAsync(
      { sub: 'someone', email: 'x@example.com' },
      { expiresIn: -10 },
    );
    const otherSecret = await jwt.signAsync(
      { sub: 'someone', email: 'x@example.com' },
      { secret: 'not-ours' },
    );

    await http().get('/auth/me').expect(401);
    await http().get('/auth/me').set('Authorization', token).expect(401); // no Bearer scheme
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}x`)
      .expect(401);
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${otherSecret}`)
      .expect(401);
  });
});
