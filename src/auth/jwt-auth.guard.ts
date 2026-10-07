import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload, AuthenticatedUser } from './auth.js';

type HttpRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
};

/** Lets a request through with a valid, unexpired `Authorization: Bearer <token>`; 401 otherwise. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const [scheme, token] = (
      typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : ''
    ).split(' ');
    if (scheme !== 'Bearer' || !token)
      throw new UnauthorizedException('Missing bearer token');

    try {
      // Checks the signature and `exp`; the algorithm is pinned in AuthModule.
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      request.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      // Don't say why (expired, tampered, wrong secret): the client does the same thing, log in again.
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

/** The user JwtAuthGuard authenticated. Only on routes behind `@UseGuards(JwtAuthGuard)`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context.switchToHttp().getRequest<HttpRequest>();
    if (!user) throw new UnauthorizedException();
    return user;
  },
);
