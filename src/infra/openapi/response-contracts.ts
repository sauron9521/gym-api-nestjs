/**
 * Response-only OpenAPI schemas for Prisma projections.
 *
 * These describe the serialized JSON actually returned by NestJS:
 * - Date -> ISO date-time string
 * - Prisma.Decimal -> decimal string (not JSON number)
 * - nullable relations are null
 *
 * Keep this file aligned with the select constants in each repository.
 * Contract tests validate the selected property names, including redaction.
 */
export type ResponseSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  format?: string;
  description?: string;
  enum?: string[];
  nullable?: boolean;
  properties?: Record<string, ResponseSchema>;
  required?: string[];
  items?: ResponseSchema;
  oneOf?: ResponseSchema[];
  additionalProperties?: boolean;
};

export const stringSchema: ResponseSchema = { type: 'string' };
export const uuidSchema: ResponseSchema = { type: 'string', format: 'uuid' };
export const integerSchema: ResponseSchema = { type: 'integer' };
export const booleanSchema: ResponseSchema = { type: 'boolean' };
export const dateTimeSchema: ResponseSchema = { type: 'string', format: 'date-time' };
export const decimalSchema: ResponseSchema = {
  type: 'string',
  description: 'Exact decimal encoded as a JSON string by Prisma.Decimal',
};

export function nullable(schema: ResponseSchema): ResponseSchema {
  return { ...schema, nullable: true };
}

export function objectSchema(
  properties: Record<string, ResponseSchema>,
): ResponseSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export function arraySchema(items: ResponseSchema): ResponseSchema {
  return { type: 'array', items };
}

export function enumSchema(values: string[]): ResponseSchema {
  return { type: 'string', enum: values };
}

export function paginatedSchema(items: ResponseSchema): ResponseSchema {
  return objectSchema({
    data: arraySchema(items),
    meta: objectSchema({
      total: integerSchema,
      skip: integerSchema,
      take: integerSchema,
      totalPages: integerSchema,
    }),
  });
}

/**
 * Registration always reports account creation. SUBMITTED means the mailer
 * accepted the send request, not that the message reached the inbox.
 * RETRY_REQUIRED instructs the signed-in user to call /auth/email/verification.
 */
export const registrationResponseSchema = objectSchema({
  id: uuidSchema,
  email: stringSchema,
  emailVerified: booleanSchema,
  role: enumSchema(['ATHLETE', 'TRAINER', 'ADMIN']),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  verificationEmailStatus: enumSchema(['SUBMITTED', 'RETRY_REQUIRED']),
});

const exerciseTypes = enumSchema(['STRENGTH', 'CARDIO', 'MOBILITY', 'PLYOMETRIC', 'OTHER']);
const setTypes = enumSchema(['WARMUP', 'WORKING', 'DROP_SET', 'AMRAP']);

const namedReference = objectSchema({
  id: uuidSchema,
  name: stringSchema,
  slug: stringSchema,
});

export const exerciseResponseSchema = objectSchema({
  id: uuidSchema,
  slug: nullable(stringSchema),
  name: stringSchema,
  description: nullable(stringSchema),
  instructions: nullable(stringSchema),
  source: enumSchema(['GLOBAL', 'ATHLETE_CUSTOM', 'TRAINER_CUSTOM']),
  visibility: nullable(enumSchema(['PRIVATE', 'SELECTED_TRAINERS'])),
  exerciseType: exerciseTypes,
  createdById: nullable(uuidSchema),
  isArchived: booleanSchema,
  copiedFromExerciseId: nullable(uuidSchema),
  muscleGroups: arraySchema(objectSchema({
    role: enumSchema(['PRIMARY', 'SECONDARY']),
    muscleGroup: namedReference,
  })),
  equipment: arraySchema(objectSchema({ equipment: namedReference })),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export const archivedExerciseResponseSchema = objectSchema({
  id: uuidSchema,
  isArchived: booleanSchema,
  updatedAt: dateTimeSchema,
});

export const exerciseListResponseSchema = paginatedSchema(exerciseResponseSchema);

export const exerciseTrainerAccessResponseSchema = objectSchema({
  id: uuidSchema,
  exerciseId: uuidSchema,
  trainerId: uuidSchema,
  grantedAt: dateTimeSchema,
  revokedAt: nullable(dateTimeSchema),
});

export const exerciseTrainerAccessListResponseSchema = arraySchema(
  exerciseTrainerAccessResponseSchema,
);


export const workoutSetResponseSchema = objectSchema({
  id: uuidSchema,
  workoutExerciseId: uuidSchema,
  setNumber: integerSchema,
  setType: setTypes,
  status: enumSchema(['PENDING', 'COMPLETED', 'SKIPPED']),
  plannedReps: nullable(integerSchema),
  plannedWeightKg: nullable(decimalSchema),
  plannedDurationSeconds: nullable(integerSchema),
  plannedDistanceMeters: nullable(decimalSchema),
  actualReps: nullable(integerSchema),
  actualWeightKg: nullable(decimalSchema),
  actualDurationSeconds: nullable(integerSchema),
  actualDistanceMeters: nullable(decimalSchema),
  restSeconds: nullable(integerSchema),
  targetRpe: nullable(decimalSchema),
  targetRir: nullable(integerSchema),
  rpe: nullable(decimalSchema),
  rir: nullable(integerSchema),
  completedAt: nullable(dateTimeSchema),
  notes: nullable(stringSchema),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

const workoutExerciseResponseSchema = objectSchema({
  id: uuidSchema,
  workoutId: uuidSchema,
  exerciseId: uuidSchema,
  exerciseNameSnapshot: stringSchema,
  exerciseTypeSnapshot: exerciseTypes,
  sortOrder: integerSchema,
  notes: nullable(stringSchema),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  sets: arraySchema(workoutSetResponseSchema),
});

export const workoutResponseSchema = objectSchema({
  id: uuidSchema,
  title: stringSchema,
  notes: nullable(stringSchema),
  athleteId: uuidSchema,
  createdById: uuidSchema,
  status: enumSchema(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  scheduledAt: nullable(dateTimeSchema),
  startedAt: nullable(dateTimeSchema),
  completedAt: nullable(dateTimeSchema),
  programAssignmentId: nullable(uuidSchema),
  programWorkoutId: nullable(uuidSchema),
  exercises: arraySchema(workoutExerciseResponseSchema),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});
export const workoutListResponseSchema = paginatedSchema(workoutResponseSchema);

/** Explicit summary list response: no nested exercises, sets, or notes. */
export const workoutSummaryResponseSchema = objectSchema({
  id: uuidSchema,
  title: stringSchema,
  athleteId: uuidSchema,
  createdById: uuidSchema,
  status: enumSchema(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  scheduledAt: nullable(dateTimeSchema),
  startedAt: nullable(dateTimeSchema),
  completedAt: nullable(dateTimeSchema),
  programAssignmentId: nullable(uuidSchema),
  programWorkoutId: nullable(uuidSchema),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  exerciseCount: integerSchema,
});
export const workoutSummaryListResponseSchema = paginatedSchema(workoutSummaryResponseSchema);

const identityWithEmailSchema = objectSchema({
  id: uuidSchema,
  email: stringSchema,
  role: enumSchema(['ATHLETE', 'TRAINER', 'ADMIN']),
});
const identityWithoutEmailSchema = objectSchema({
  id: uuidSchema,
  role: enumSchema(['ATHLETE', 'TRAINER', 'ADMIN']),
});

const relationshipFields = {
  id: uuidSchema,
  trainerId: uuidSchema,
  athleteId: uuidSchema,
  initiatedById: uuidSchema,
  status: enumSchema(['PENDING', 'ACTIVE', 'DECLINED', 'CANCELLED', 'TERMINATED']),
  respondedAt: nullable(dateTimeSchema),
  endedAt: nullable(dateTimeSchema),
  endedById: nullable(uuidSchema),
  endReason: nullable(stringSchema),
};
const relationshipDates = { createdAt: dateTimeSchema, updatedAt: dateTimeSchema };

/** Full relationship: participant details allowed for open relationships. */
export const trainerAthleteResponseSchema = objectSchema({
  ...relationshipFields,
  trainer: identityWithEmailSchema,
  athlete: identityWithEmailSchema,
  initiatedBy: identityWithEmailSchema,
  endedBy: nullable(identityWithEmailSchema),
  ...relationshipDates,
});

/** Historical trainer view deliberately omits all email addresses and endedBy. */
export const trainerAthleteHistoricalResponseSchema = objectSchema({
  ...relationshipFields,
  trainer: identityWithoutEmailSchema,
  athlete: identityWithoutEmailSchema,
  initiatedBy: identityWithoutEmailSchema,
  endedBy: nullable(identityWithoutEmailSchema),
  ...relationshipDates,
});

export const trainerAthletePublicResponseSchema: ResponseSchema = {
  oneOf: [trainerAthleteResponseSchema, trainerAthleteHistoricalResponseSchema],
};
export const trainerAthleteListResponseSchema = paginatedSchema(trainerAthletePublicResponseSchema);

export const trainingProgramVersionSummarySchema = objectSchema({
  id: uuidSchema,
  version: integerSchema,
  title: stringSchema,
  description: nullable(stringSchema),
  durationWeeks: nullable(integerSchema),
  status: enumSchema(['DRAFT', 'PUBLISHED']),
  publishedAt: nullable(dateTimeSchema),
});

export const trainingProgramResponseSchema = objectSchema({
  id: uuidSchema,
  trainerId: uuidSchema,
  status: enumSchema(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  versions: arraySchema(trainingProgramVersionSummarySchema),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});
export const trainingProgramListResponseSchema = paginatedSchema(trainingProgramResponseSchema);

export const trainingProgramSetResponseSchema = objectSchema({
  id: uuidSchema,
  programExerciseId: uuidSchema,
  setNumber: integerSchema,
  setType: setTypes,
  plannedReps: nullable(integerSchema),
  plannedWeightKg: nullable(decimalSchema),
  plannedDurationSeconds: nullable(integerSchema),
  plannedDistanceMeters: nullable(decimalSchema),
  restSeconds: nullable(integerSchema),
  targetRpe: nullable(decimalSchema),
  targetRir: nullable(integerSchema),
  notes: nullable(stringSchema),
});

export const trainingProgramExerciseResponseSchema = objectSchema({
  id: uuidSchema,
  workoutId: uuidSchema,
  exerciseId: uuidSchema,
  exerciseNameSnapshot: stringSchema,
  exerciseTypeSnapshot: exerciseTypes,
  sortOrder: integerSchema,
  notes: nullable(stringSchema),
  sets: arraySchema(trainingProgramSetResponseSchema),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export const trainingProgramWorkoutResponseSchema = objectSchema({
  id: uuidSchema,
  versionId: uuidSchema,
  weekNumber: integerSchema,
  dayNumber: integerSchema,
  title: stringSchema,
  notes: nullable(stringSchema),
  exercises: arraySchema(trainingProgramExerciseResponseSchema),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

const versionFields = {
  id: uuidSchema,
  programId: uuidSchema,
  version: integerSchema,
  title: stringSchema,
  description: nullable(stringSchema),
  durationWeeks: nullable(integerSchema),
  status: enumSchema(['DRAFT', 'PUBLISHED']),
  publishedAt: nullable(dateTimeSchema),
};

export const trainingProgramVersionListItemSchema = objectSchema({
  ...versionFields,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export const trainingProgramVersionResponseSchema = objectSchema({
  ...versionFields,
  workouts: arraySchema(trainingProgramWorkoutResponseSchema),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

const programReferenceSchema = objectSchema({
  id: uuidSchema,
  trainerId: uuidSchema,
  status: enumSchema(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
});
const assignmentProgramVersion = objectSchema({
  ...versionFields,
  program: programReferenceSchema,
});
const historicalAssignmentVersion = objectSchema({ ...versionFields });
const assignmentRelationship = objectSchema({
  id: uuidSchema,
  trainerId: uuidSchema,
  athleteId: uuidSchema,
  status: enumSchema(['PENDING', 'ACTIVE', 'DECLINED', 'CANCELLED', 'TERMINATED']),
});
const assignmentWorkout = objectSchema({
  id: uuidSchema,
  title: stringSchema,
  status: enumSchema(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  scheduledAt: nullable(dateTimeSchema),
  startedAt: nullable(dateTimeSchema),
  completedAt: nullable(dateTimeSchema),
});
const assignmentFields = {
  id: uuidSchema,
  versionId: uuidSchema,
  trainerAthleteId: uuidSchema,
  athleteId: uuidSchema,
  assignedById: uuidSchema,
  status: enumSchema(['ACTIVE', 'COMPLETED', 'CANCELLED', 'TERMINATED']),
  assignedAt: dateTimeSchema,
  startedAt: nullable(dateTimeSchema),
  completedAt: nullable(dateTimeSchema),
  endedAt: nullable(dateTimeSchema),
  endedById: nullable(uuidSchema),
  endReason: nullable(stringSchema),
};
const assignmentDates = { createdAt: dateTimeSchema, updatedAt: dateTimeSchema };
const assignmentDetailsFields = {
  trainerAthlete: assignmentRelationship,
  athlete: identityWithEmailSchema,
  assignedBy: identityWithEmailSchema,
  endedBy: nullable(identityWithEmailSchema),
};

export const trainingAssignmentResponseSchema = objectSchema({
  ...assignmentFields,
  version: assignmentProgramVersion,
  ...assignmentDetailsFields,
  workouts: arraySchema(assignmentWorkout),
  ...assignmentDates,
});

export const trainingAssignmentSummaryResponseSchema = objectSchema({
  ...assignmentFields,
  version: assignmentProgramVersion,
  ...assignmentDetailsFields,
  ...assignmentDates,
});

export const trainingAssignmentDetailsResponseSchema = objectSchema({
  ...assignmentFields,
  version: objectSchema({
    ...(trainingProgramVersionResponseSchema.properties ?? {}),
    program: programReferenceSchema,
  }),
  ...assignmentDetailsFields,
  workouts: arraySchema(assignmentWorkout),
  ...assignmentDates,
});

/**
 * Former trainers receive an explicitly redacted projection.
 * Do not invent email, endedBy, assignedBy or workouts properties.
 */
export const trainingAssignmentHistoricalResponseSchema = objectSchema({
  ...assignmentFields,
  version: historicalAssignmentVersion,
  trainerAthlete: assignmentRelationship,
  athlete: identityWithoutEmailSchema,
  ...assignmentDates,
});

export const trainingAssignmentListResponseSchema = paginatedSchema({
  oneOf: [
    trainingAssignmentResponseSchema,
    trainingAssignmentSummaryResponseSchema,
    trainingAssignmentHistoricalResponseSchema,
  ],
});

export const trainingAssignmentPublicDetailsResponseSchema: ResponseSchema = {
  oneOf: [
    trainingAssignmentDetailsResponseSchema,
    trainingAssignmentHistoricalResponseSchema,
  ],
};
