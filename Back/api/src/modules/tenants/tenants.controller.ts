import { Controller, Post, Body, UseGuards, Request, Get, Patch } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

class RegisterTenantDto {
  name!: string;
  slug!: string;
  contactEmail!: string;
  countryCode!: string;
  adminPassword!: string;
}

class UpdateSettingsDto {
  name?: string;
  tradeName?: string;
  taxId?: string;
  countryCode?: string;
  timezone?: string;
  locale?: string;
  contactEmail?: string;
  contactPhone?: string;
  logoUrl?: string;
}

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) { }

  @Post('register')
  register(@Body() dto: RegisterTenantDto) {
    return this.tenantsService.register(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('settings')
  getSettings(@Request() req) {
    return this.tenantsService.getSettings(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('settings')
  updateSettings(@Request() req, @Body() dto: UpdateSettingsDto) {
    return this.tenantsService.updateSettings(req.user.tenantId, dto);
  }
}