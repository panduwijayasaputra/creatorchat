import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ErrorCode, type ErrorResponse } from '@creatorchat/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  429: ErrorCode.RATE_LIMITED,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

const STATUS_TO_MESSAGE: Record<number, string> = {
  400: 'The request is invalid.',
  401: 'Authentication is required.',
  403: 'You are not allowed to do this.',
  404: 'Not found.',
  413: 'The request is too large.',
  429: 'Too many requests. Please try again later.',
  503: 'The service is temporarily unavailable.',
};

function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  // Fastify errors (invalid JSON, body too large, ...) carry a statusCode.
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

/**
 * Maps every failure to `{ code, message, request_id }`. Unexpected errors become a generic 500;
 * stack traces, Prisma errors and input values are never sent to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = request.id;

    let status = 500;
    const body: ErrorResponse = {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again.',
      request_id: requestId,
    };

    if (error instanceof AppError) {
      status = error.httpStatus;
      body.code = error.code;
      body.message = error.message;
      if (error.details !== undefined) body.details = error.details;
      for (const [name, value] of Object.entries(error.headers ?? {}))
        void reply.header(name, value);
    } else if (error instanceof ZodError) {
      status = 400;
      body.code = ErrorCode.VALIDATION_FAILED;
      body.message = 'The request is invalid.';
      // Field paths and rule messages only; zod issues are not echoed back with input values.
      body.details = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
    } else {
      const clientStatus = statusOf(error);
      if (clientStatus !== undefined) {
        status = clientStatus;
        body.code = STATUS_TO_CODE[clientStatus] ?? ErrorCode.VALIDATION_FAILED;
        body.message = STATUS_TO_MESSAGE[clientStatus] ?? 'The request could not be processed.';
      }
    }

    if (status >= 500) {
      // Error messages can embed secrets or user data (e.g. DB driver errors), so only the error
      // name and stack frames are logged — never the message text.
      const err = error instanceof Error ? error : new Error('Non-Error value thrown');
      const frames = (err.stack ?? '')
        .split('\n')
        .filter((line) => line.trimStart().startsWith('at '))
        .slice(0, 15);
      request.log.error({ errName: err.name, frames }, 'unhandled error');
    }

    void reply.status(status).header('x-request-id', requestId).send(body);
  }
}
