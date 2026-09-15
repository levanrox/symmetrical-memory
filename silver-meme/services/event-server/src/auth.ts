import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createUser, findUserByEmail, type Pool } from '@event-suite/db';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { DATABASE_POOL } from './database';
import { hashPassword, verifyPassword } from './password';

export { hashPassword, verifyPassword };

const PUBLIC_KEY = 'auth:public';
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** Marks a route as reachable without a token. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (request.user === undefined) {
      throw new UnauthorizedException('no authenticated user on the request');
    }

    return request.user;
  },
);

/**
 * Password hashing and verification live in `password.ts`; re-exported here so
 * existing callers keep working.
 */

function secret(): string {
  const configured = process.env.JWT_SECRET;

  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }

  return 'dev-only-insecure-secret';
}

export function signToken(user: AuthenticatedUser): string {
  return jwt.sign({ sub: user.id, name: user.name, email: user.email, role: user.role }, secret(), {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async login(email: string, password: string): Promise<{ token: string; user: AuthenticatedUser }> {
    const user = await findUserByEmail(this.pool, email);

    // Same error for an unknown email and a wrong password: telling them apart
    // hands an attacker a list of valid accounts.
    if (user === null || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('invalid email or password');
    }

    const authenticated: AuthenticatedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    return { token: signToken(authenticated), user: authenticated };
  }

  async register(input: {
    name: string;
    email: string;
    password: string;
    // `| undefined` so a parsed optional from zod can be passed straight through
    // under exactOptionalPropertyTypes.
    role?: string | undefined;
  }): Promise<AuthenticatedUser> {
    // Bootstrap only: once an operator exists, creating more requires being
    // authenticated. Without this, the public route is an open door.
    const existing = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM users');

    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      throw new ForbiddenException(
        'an operator already exists; sign in and create further accounts from the admin client',
      );
    }

    const user = await createUser(this.pool, {
      name: input.name,
      email: input.email,
      passwordHash: hashPassword(input.password),
      ...(input.role === undefined ? {} : { role: input.role }),
    });

    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }

    try {
      const payload = jwt.verify(header.slice('Bearer '.length), secret());

      if (typeof payload === 'string' || payload.sub === undefined) {
        throw new UnauthorizedException('malformed token');
      }

      request.user = {
        id: payload.sub,
        name: String(payload.name ?? ''),
        email: String(payload.email ?? ''),
        role: String(payload.role ?? 'EVENT_ADMIN'),
      };

      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }
}

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(8, { error: 'password must be at least 8 characters' }),
  role: z.string().min(1).optional(),
});

/**
 * Parses a body, turning a schema failure into a 400 naming the field.
 *
 * `schema.parse` would throw a raw ZodError, which surfaces as a 500 with a
 * stack trace — a malformed request is the caller's mistake, not the server's.
 */
function parseOrThrow<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((issue) => `${issue.path.join('.') || '<body>'}: ${issue.message}`),
    );
  }

  return result.data;
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/login')
  async login(@Body() body: unknown) {
    const input = parseOrThrow(loginSchema, body);
    return this.auth.login(input.email, input.password);
  }

  /**
   * Creates the first operator. Public only while the users table is empty;
   * after that it refuses, so the route is not an open door.
   */
  @Public()
  @Post('auth/register')
  async register(@Body() body: unknown) {
    const input = parseOrThrow(registerSchema, body);
    return this.auth.register(input);
  }

  @Get('auth/me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
