import { describe, expect, it } from 'vitest';

import { queryWorkoutsSchema } from '../dto/query-workouts.dto.js';

describe('queryWorkoutsSchema: list view', () => {
  it('preserves existing default full-response behavior', () => {
    const parsed = queryWorkoutsSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.view).toBeUndefined();
  });

  it('accepts explicit summary and full views', () => {
    expect(queryWorkoutsSchema.parse({ view: 'summary' }).view).toBe('summary');
    expect(queryWorkoutsSchema.parse({ view: 'full' }).view).toBe('full');
  });

  it('rejects unsupported views', () => {
    expect(queryWorkoutsSchema.safeParse({ view: 'aggregate' }).success).toBe(false);
  });
});
