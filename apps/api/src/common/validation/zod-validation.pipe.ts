import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates a param/query/body with a `packages/contracts` schema; failures become 400s. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    // A ZodError is mapped to VALIDATION_FAILED by AllExceptionsFilter.
    return this.schema.parse(value);
  }
}
