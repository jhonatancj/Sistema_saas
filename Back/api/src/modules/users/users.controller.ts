import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

class CreateUserDto {
  email!: string;
  password!: string;
  firstName!: string;
  lastName!: string;
  roles!: string[];
}

class UpdateUserDto {
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
  roles?: string[];
}

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(@Request() req) {
    return this.usersService.findAll(req.user.schemaName);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.usersService.findOne(req.user.schemaName, id);
  }

  @Post()
  create(@Request() req, @Body() dto: CreateUserDto) {
    return this.usersService.create(req.user.schemaName, dto);
  }

  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(req.user.schemaName, id, dto);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.usersService.remove(req.user.schemaName, id);
  }
}