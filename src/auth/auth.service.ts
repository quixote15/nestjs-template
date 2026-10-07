import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Database } from '../infra/database/drizzle.js';
import { users } from '../infra/schemas/schema.js';
import type {
  AccessToken,
  AccessTokenPayload,
  AuthenticatedUser,
  CredentialsDto,
} from './auth.js';
import { hashPassword, verifyPassword } from './password.js';

const MIN_PASSWORD_LENGTH = 8;
// Compared against when the email is unknown, so a login takes as long whether or not the account exists.
const UNKNOWN_USER_HASH = hashPassword('unknown-user');

@Injectable()
export class AuthService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: CredentialsDto): Promise<AuthenticatedUser> {
    const { email, password } = parseCredentials(dto);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `A password needs at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }

    // One statement on the unique email: two concurrent registrations can't both insert.
    const [user] = await this.db
      .insert(users)
      .values({
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(password),
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email });
    if (!user) throw new ConflictException('Email already registered');
    return user;
  }

  async login(dto: CredentialsDto): Promise<AccessToken> {
    const { email, password } = parseCredentials(dto);
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));

    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await UNKNOWN_USER_HASH),
    );
    // One message for both cases: the response doesn't tell which emails have an account.
    if (!user || !valid)
      throw new UnauthorizedException('Invalid email or password');

    const payload: AccessTokenPayload = { sub: user.id, email: user.email };
    return {
      accessToken: await this.jwt.signAsync(payload),
      tokenType: 'Bearer',
    };
  }

  async profile(userId: string): Promise<AuthenticatedUser> {
    const [user] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    // A valid token outlives a deleted account until it expires.
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return user;
  }
}

function parseCredentials(
  dto: Partial<CredentialsDto> | undefined,
): CredentialsDto {
  const { email, password } = dto ?? {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
    throw new BadRequestException('A valid email is required');
  }
  if (typeof password !== 'string' || password.length === 0)
    throw new BadRequestException('A password is required');
  return { email: email.trim().toLowerCase(), password };
}
