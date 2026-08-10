import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { MongoError } from 'mongodb';
import { Error as MongooseError } from 'mongoose';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 404 xatolarni jimlashtiramiz — botlar sekundiga o'nlab so'raydi
    // (`/wp-config.php~`, `/.ssh/id_rsa`, `/phpinfo.php` va h.k.). Log toza qoladi.
    const isNotFound = exception instanceof NotFoundException;
    if (!isNotFound) {
      this.logger.debug('Exception error:', exception);
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (!isNotFound) {
        this.logger.debug(`Exception response: ${JSON.stringify(res)}`);
      }

      if (
        exception instanceof BadRequestException &&
        typeof res !== 'string' &&
        Array.isArray((res as any).message)
      ) {
        const validationErrors = (res as any).message;
        message = this.formatValidationErrorsToMessage(validationErrors);

        this.logger.debug(
          `Validation errors: ${JSON.stringify(validationErrors)}`
        );
      } else {
        message =
          typeof res === 'string'
            ? res
            : Array.isArray((res as any).message)
              ? (res as any).message[0]
              : (res as any).message || 'Bad request';
      }
    } else if (
      exception instanceof MongoError ||
      exception instanceof MongooseError
    ) {
      status = this.getMongoErrorStatus(exception);
      message = this.getMongoErrorMessage(exception);
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack
      );
    } else {
      this.logger.error('Unknown error type:', exception);
    }

    
    const errorResponse = {
      status_code: status,
      message,
    };

    if (!isNotFound) {
      this.logger.debug(`Error response: ${JSON.stringify(errorResponse)}`);
    }
    response.status(status).json(errorResponse);
  }

  private formatValidationErrorsToMessage(validationErrors: string[]): string {
    if (!validationErrors || validationErrors.length === 0) {
      return 'Validation failed';
    }

    return validationErrors[0];
  }

  private getMongoErrorStatus(exception: MongoError | MongooseError): number {
    if ('code' in exception) {
      switch (exception.code) {
        case 11000:
          return HttpStatus.CONFLICT;
        case 121:
          return HttpStatus.BAD_REQUEST;
        default:
          return HttpStatus.BAD_REQUEST;
      }
    }
    if (exception instanceof MongooseError.CastError)
      return HttpStatus.BAD_REQUEST;
    if (exception instanceof MongooseError.ValidationError)
      return HttpStatus.UNPROCESSABLE_ENTITY;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getMongoErrorMessage(exception: MongoError | MongooseError): string {
    if ('code' in exception) {
      if (exception.code === 11000 && 'keyValue' in exception) {
        const duplicateFields = Object.keys(exception.keyValue);
        const fieldValues = Object.values(exception.keyValue).join(', ');
        return `A record with ${duplicateFields.join(', ')} '${fieldValues}' already exists`;
      }
      if (exception.code === 121) return `Document validation failed`;
    }

    if (exception instanceof MongooseError.ValidationError) {
      const firstError = Object.values(exception.errors)[0];
      return firstError?.message || 'Validation failed';
    }

    if (exception instanceof MongooseError.CastError) {
      return `Invalid ${exception.kind} value '${exception.value}' for field '${exception.path}'`;
    }

    return 'Database operation failed';
  }
}
