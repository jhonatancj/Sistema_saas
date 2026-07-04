import {  Injectable,  NestInterceptor,  ExecutionContext,  CallHandler,} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
  errors: any[];
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const statusCode = context.switchToHttp().getResponse().statusCode;
    return next.handle().pipe(
      map((data) => ({
        success: true,
        status: statusCode,
        message: data?.message ?? 'OK',
        data: data?.message ? undefined : data,
        errors: [],
      })),
    );
  }
}