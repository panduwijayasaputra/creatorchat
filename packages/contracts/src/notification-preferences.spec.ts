import { describe, expect, it } from 'vitest';
import {
  creatorMutePath,
  MutePublicCodeSchema,
  MuteResponseSchema,
  NotificationPreferencesResponseSchema,
  UpdateNotificationPreferencesBodySchema,
} from './notification-preferences.js';

describe('UpdateNotificationPreferencesBodySchema', () => {
  it('takes either switch or both', () => {
    expect(UpdateNotificationPreferencesBodySchema.parse({ show_content: true })).toEqual({
      show_content: true,
    });
    expect(UpdateNotificationPreferencesBodySchema.parse({ messages_enabled: false })).toEqual({
      messages_enabled: false,
    });
    expect(
      UpdateNotificationPreferencesBodySchema.safeParse({
        messages_enabled: true,
        show_content: false,
      }).success,
    ).toBe(true);
  });

  it('refuses an empty body, unknown keys and non-booleans', () => {
    for (const body of [
      {},
      { other: true },
      { show_content: 'yes' },
      { messages_enabled: 1 },
      null,
    ]) {
      expect(
        UpdateNotificationPreferencesBodySchema.safeParse(body).success,
        JSON.stringify(body),
      ).toBe(false);
    }
  });
});

describe('responses and the mute route', () => {
  it('the answers are exact', () => {
    expect(
      NotificationPreferencesResponseSchema.safeParse({
        messages_enabled: true,
        show_content: false,
      }).success,
    ).toBe(true);
    expect(
      NotificationPreferencesResponseSchema.safeParse({
        messages_enabled: true,
        show_content: false,
        user_id: 'x',
      }).success,
    ).toBe(false);
    expect(MuteResponseSchema.safeParse({ muted: true }).success).toBe(true);
    expect(MuteResponseSchema.safeParse({ muted: 'yes' }).success).toBe(false);
  });

  it('builds the mute path from a public code and checks the code format', () => {
    expect(creatorMutePath('salsa234')).toBe('/v1/creators/by-code/salsa234/mute');
    expect(MutePublicCodeSchema.safeParse('salsa234').success).toBe(true);
    for (const bad of ['', 'SALSA234', 'salsa1', 'salsa23456', '../x']) {
      expect(MutePublicCodeSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
