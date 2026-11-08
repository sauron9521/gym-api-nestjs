import {
  archivedExerciseResponseSchema,
  exerciseListResponseSchema,
  exerciseResponseSchema,
  trainerAthleteHistoricalResponseSchema,
  trainerAthleteListResponseSchema,
  trainerAthleteResponseSchema,
  trainingAssignmentDetailsResponseSchema,
  trainingAssignmentHistoricalResponseSchema,
  trainingAssignmentListResponseSchema,
  trainingAssignmentResponseSchema,
  trainingAssignmentSummaryResponseSchema,
  trainingProgramListResponseSchema,
  trainingProgramResponseSchema,
  trainingProgramSetResponseSchema,
  trainingProgramVersionResponseSchema,
  workoutListResponseSchema,
  workoutResponseSchema,
  workoutSetResponseSchema,
  type ResponseSchema,
} from '../response-contracts.js';
import { exerciseSelect } from '../../modules/exercises/exercises.repository.js';
import {
  workoutSelect,
  workoutSetSelect,
} from '../../modules/workouts/workouts.repository.js';
import {
  trainerAthleteHistoricalSelect,
  trainerAthleteSelect,
} from '../../modules/trainer-athletes/trainer-athletes.repository.js';
import { trainingProgramSelect } from '../../modules/training-programs/selects/training-program.select.js';
import { trainingProgramVersionSelect } from '../../modules/training-programs/selects/training-program-version.select.js';
import {
  trainingProgramAssignmentDetailsSelect,
  trainingProgramAssignmentHistoricalSelect,
  trainingProgramAssignmentSelect,
  trainingProgramAssignmentSummarySelect,
} from '../../modules/training-programs/selects/training-program-assignment.select.js';

function assertMatchesSelect(
  schema: ResponseSchema,
  select: Record<string, unknown>,
) {
  expect(schema.type).toBe('object');
  const keys = Object.entries(select)
    .filter(([, value]) => value !== false)
    .map(([key]) => key)
    .sort();
  expect(Object.keys(schema.properties ?? {}).sort()).toEqual(keys);
  for (const [key, value] of Object.entries(select)) {
    if (value === false) continue;
    if (!value || typeof value !== 'object' || !('select' in value)) continue;
    const nested = value.select;
    if (!nested || typeof nested !== 'object') continue;
    const field = schema.properties?.[key];
    expect(field, `Missing nested field: ${key}`).toBeDefined();
    const child = field?.type === 'array' ? field.items : field;
    expect(child).toBeDefined();
    assertMatchesSelect(child!, nested as Record<string, unknown>);
  }
}

describe('OpenAPI response projections vs Prisma selects', () => {
  it('covers the exercise select without leaking unrelated fields', () => {
    assertMatchesSelect(exerciseResponseSchema, exerciseSelect);
    expect(Object.keys(archivedExerciseResponseSchema.properties ?? {}).sort())
      .toEqual(['id', 'isArchived', 'updatedAt']);
    expect(exerciseListResponseSchema.properties?.data?.items)
      .toEqual(exerciseResponseSchema);
  });

  it('covers complete workout and set projections', () => {
    assertMatchesSelect(workoutResponseSchema, workoutSelect);
    assertMatchesSelect(workoutSetResponseSchema, workoutSetSelect);
    expect(workoutListResponseSchema.properties?.data?.items)
      .toEqual(workoutResponseSchema);
    expect(workoutSetResponseSchema.properties?.actualWeightKg)
      .toMatchObject({ type: 'string', nullable: true });
    expect(workoutResponseSchema.properties).not.toHaveProperty(
      'idempotencyFingerprint',
    );
  });

  it('documents normal and historical trainer-athlete responses separately', () => {
    assertMatchesSelect(trainerAthleteResponseSchema, trainerAthleteSelect);
    assertMatchesSelect(
      trainerAthleteHistoricalResponseSchema,
      trainerAthleteHistoricalSelect,
    );
    expect(trainerAthleteHistoricalResponseSchema.properties?.trainer?.properties)
      .not.toHaveProperty('email');
    expect(trainerAthleteHistoricalResponseSchema.properties?.athlete?.properties)
      .not.toHaveProperty('email');
    expect(trainerAthleteListResponseSchema.properties?.data?.items?.oneOf)
      .toHaveLength(2);
  });

  it('matches nested training program/version projections', () => {
    assertMatchesSelect(trainingProgramResponseSchema, trainingProgramSelect);
    assertMatchesSelect(
      trainingProgramVersionResponseSchema,
      trainingProgramVersionSelect,
    );
    expect(trainingProgramListResponseSchema.properties?.data?.items)
      .toEqual(trainingProgramResponseSchema);
    expect(trainingProgramSetResponseSchema.properties?.plannedWeightKg)
      .toEqual({
        type: 'string',
        nullable: true,
        description: expect.any(String),
      });
  });

  it('matches full, summary, detailed and historical assignments', () => {
    assertMatchesSelect(
      trainingAssignmentResponseSchema,
      trainingProgramAssignmentSelect,
    );
    assertMatchesSelect(
      trainingAssignmentSummaryResponseSchema,
      trainingProgramAssignmentSummarySelect,
    );
    assertMatchesSelect(
      trainingAssignmentDetailsResponseSchema,
      trainingProgramAssignmentDetailsSelect,
    );
    assertMatchesSelect(
      trainingAssignmentHistoricalResponseSchema,
      trainingProgramAssignmentHistoricalSelect,
    );
    expect(trainingAssignmentHistoricalResponseSchema.properties).not
      .toHaveProperty('workouts');
    expect(trainingAssignmentHistoricalResponseSchema.properties).not
      .toHaveProperty('assignedBy');
    expect(trainingAssignmentHistoricalResponseSchema.properties?.athlete?.properties)
      .not.toHaveProperty('email');
    expect(trainingAssignmentListResponseSchema.properties?.data?.items?.oneOf)
      .toHaveLength(3);
  });

  it('keeps nullable dates, decimals and paginated metadata correctly typed', () => {
    expect(workoutResponseSchema.properties?.completedAt)
      .toMatchObject({ type: 'string', format: 'date-time', nullable: true });
    expect(workoutSetResponseSchema.properties?.plannedReps)
      .toEqual({ type: 'integer', nullable: true });
    for (const schema of [
      workoutListResponseSchema,
      exerciseListResponseSchema,
      trainerAthleteListResponseSchema,
      trainingProgramListResponseSchema,
      trainingAssignmentListResponseSchema,
    ]) {
      expect(Object.keys(schema.properties?.meta?.properties ?? {}).sort())
        .toEqual(['skip', 'take', 'total', 'totalPages']);
      expect(schema.properties?.meta?.required)
        .toEqual(['total', 'skip', 'take', 'totalPages']);
    }
  });
});
