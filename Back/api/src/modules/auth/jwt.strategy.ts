import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  tenantId: string;
  schemaName: string;
  roles: string[];
  isSuperAdmin?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  // async validate(payload: JwtPayload) {
  //   if (!payload.sub || !payload.tenantId) {
  //     throw new UnauthorizedException();
  //   }
  //   return payload;
  // }
  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException();
    }
    // Super admin no tiene tenantId ni schemaName
    if (!payload.isSuperAdmin && !payload.tenantId) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}