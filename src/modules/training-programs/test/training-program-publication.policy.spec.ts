import { BadRequestException } from '@nestjs/common';

import { assertPublishableVersion } from '../policies/training-program-publication.policy.js';

describe('assertPublishableVersion', () => {
  const validVersion = () => ({
    durationWeeks: 4 as number | null,
    workouts: [
      {
        weekNumber: 1,
        exercises: [{ sets: [{ setNumber: 1 }] }],
      },
    ],
  });

  it('accepts a program with one executable workout and exercise set', () => {
    expect(() => assertPublishableVersion(validVersion())).not.toThrow();
  });

  it('accepts multiple valid workouts and exercises across the duration', () => {
    const version = {
      durationWeeks: 4,
      workouts: [
        {
          weekNumber: 1,
          exercises: [{ sets: [{}] }, { sets: [{}, {}] }],
        },
        { weekNumber: 4, exercises: [{ sets: [{}] }] },
      ],
    };
    expect(() => assertPublishableVersion(version)).not.toThrow();
  });

  it('allows an unspecified duration while still requiring executable content', () => {
    const version = validVersion();
    version.durationWeeks = null;
    version.workouts[0].weekNumber = 5;

    expect(() => assertPublishableVersion(version)).not.toThrow();
  });

  it('accepts a workout on the last week of the configured duration', () => {
    const version = validVersion();
    version.workouts[0].weekNumber = 4;
    expect(() => assertPublishableVersion(version)).not.toThrow();
  });

  it('rejects publishing an empty program', () => {
    expect(() => assertPublishableVersion({
      durationWeeks: 4,
      workouts: [],
    })).toThrow(new BadRequestException('A program must contain at least one workout'));
  });

  it('rejects a workout beyond the configured duration', () => {
    const version = validVersion();
    version.workouts[0].weekNumber = 5;

    expect(() => assertPublishableVersion(version)).toThrow(
      new BadRequestException('A workout week cannot exceed the program duration'),
    );
  });

  it('rejects a workout without exercises', () => {
    const version = validVersion();
    version.workouts[0].exercises = [];

    expect(() => assertPublishableVersion(version)).toThrow(
      new BadRequestException('Every program workout must contain at least one exercise'),
    );
  });

  it('rejects exercises with no sets', () => {
    const version = validVersion();
    version.workouts[0].exercises[0].sets = [];

    expect(() => assertPublishableVersion(version)).toThrow(
      new BadRequestException('Every program exercise must contain at least one set'),
    );
  });

  it('checks later workouts rather than only the first', () => {
    const version = {
      durationWeeks: 4,
      workouts: [
        { weekNumber: 1, exercises: [{ sets: [{}] }] },
        { weekNumber: 2, exercises: [{ sets: [] }] },
      ],
    };

    expect(() => assertPublishableVersion(version)).toThrow(
      new BadRequestException('Every program exercise must contain at least one set'),
    );
  });

  it('checks later exercises rather than only the first', () => {
    const version = {
      durationWeeks: 4,
      workouts: [
        { weekNumber: 1, exercises: [{ sets: [{}] }, { sets: [] }] },
      ],
    };

    expect(() => assertPublishableVersion(version)).toThrow(
      new BadRequestException('Every program exercise must contain at least one set'),
    );
  });
});
