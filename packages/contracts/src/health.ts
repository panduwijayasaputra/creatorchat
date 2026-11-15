import { z } from 'zod';

export const DependencyStatusSchema = z.enum(['up', 'down']);
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

/** `GET /v1/health` — reachability only; never versions, hosts, URLs or error text. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    db: DependencyStatusSchema,
    redis: DependencyStatusSchema,
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
