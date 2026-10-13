import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Scope,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SeasonScopeService } from '../season/season-scope.service';
import { READ_ONLY_SEASON_MESSAGE } from '../season/season.constants';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Routes that stay writable even when browsing an archived season (global app config). */
const WRITE_WHITELIST_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/settings/purge-database',
  // HR is not season-scoped: payroll and attendance continue between olive seasons.
  '/api/v1/hr',
];

function isWriteWhitelisted(path: string): boolean {
  return (
    WRITE_WHITELIST_PREFIXES.some((p) => path.startsWith(p)) ||
    path.includes('/settings/purge-database')
  );
}

@Injectable({ scope: Scope.REQUEST })
export class ReadOnlySeasonGuard implements CanActivate {
  constructor(
    private readonly seasonScope: SeasonScopeService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      method?: string;
      path?: string;
      url?: string;
    }>();
    const method = (req.method ?? 'GET').toUpperCase();
    if (!MUTATION_METHODS.has(method)) return true;

    const path = req.path ?? req.url?.split('?')[0] ?? '';
    if (isWriteWhitelisted(path)) {
      return true;
    }

    if (await this.seasonScope.isReadOnly()) {
      throw new ForbiddenException(READ_ONLY_SEASON_MESSAGE);
    }

    return true;
  }
}
