import { PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../src/common/auth/roles.decorator.js';
import { RolesGuard } from '../src/common/auth/roles.guard.js';
import { UserJwtGuard } from '../src/common/auth/user-jwt.guard.js';
import { buildTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(async () => {
  await t.app.close();
});

const guardsOf = (target: object): unknown[] =>
  (Reflect.getMetadata('__guards__', target) as unknown[] | undefined) ?? [];

describe('user endpoints declare their roles', () => {
  it('every route under UserJwtGuard also has RolesGuard and a @Roles() declaration', () => {
    const controllers = [...t.app.get(ModulesContainer).values()].flatMap((m) => [
      ...m.controllers.values(),
    ]);
    const userControllers = controllers.filter((wrapper) => {
      const cls = wrapper.metatype as object | null;
      if (!cls) return false;
      const proto = (cls as { prototype: object }).prototype;
      const all = [
        ...guardsOf(cls),
        ...Object.getOwnPropertyNames(proto).flatMap((name) =>
          guardsOf((proto as Record<string, object>)[name] ?? {}),
        ),
      ];
      return all.includes(UserJwtGuard);
    });
    // The scan must actually find the user controllers, or it proves nothing.
    expect(userControllers.length).toBeGreaterThanOrEqual(2);

    const missing: string[] = [];
    for (const wrapper of userControllers) {
      const cls = wrapper.metatype as unknown as { name: string; prototype: object };
      const proto = cls.prototype as Record<string, object>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue; // not a route
        const guards = [...guardsOf(cls), ...guardsOf(handler)];
        const roles =
          (Reflect.getMetadata(ROLES_KEY, handler) as unknown[] | undefined) ??
          (Reflect.getMetadata(ROLES_KEY, cls) as unknown[] | undefined);
        if (!guards.includes(RolesGuard) || !roles || roles.length === 0) {
          missing.push(`${cls.name}.${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
