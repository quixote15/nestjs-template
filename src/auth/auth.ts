export class CredentialsDto {
  email: string;
  password: string;
}

/** Who made the request, as JwtAuthGuard read it from the token. */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface AccessToken {
  accessToken: string;
  tokenType: 'Bearer';
}

/** The JWT claims: `sub` is the user id. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
}
