import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {

    catch(exception: unknown, host: ArgumentsHost) {
         console.error('EXCEPTION:', exception); // ← agrega esta línea
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

        const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;

        const message = typeof exceptionResponse === 'object' && exceptionResponse !== null
            ? (exceptionResponse as any).message ?? 'Error interno del servidor' : exceptionResponse ?? 'Error interno del servidor';

        const errors = Array.isArray(message) ? message : [];
        const msg = Array.isArray(message) ? 'Error de validación' : message;

        response.status(status).json({
            success: false,
            status,
            message: msg,
            data: null,
            errors,
        });
    }
}