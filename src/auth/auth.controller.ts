import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CredentialsDto, type AuthenticatedUser } from './auth.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, JwtAuthGuard } from './jwt-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: CredentialsDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: CredentialsDto) {
    return this.authService.login(dto);
  }

  /** The example authenticated endpoint: 401 without a valid token. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.profile(user.id);
  }
}
