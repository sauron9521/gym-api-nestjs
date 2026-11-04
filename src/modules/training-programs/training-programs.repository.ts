import { Injectable } from '@nestjs/common';
import type {
  ExerciseType,
  WorkoutSetType,
} from '../../generated/prisma/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  CreateTrainingProgramWorkoutInput,
  UpdateTrainingProgramExerciseInput,
  UpdateTrainingProgramSetInput,
  UpdateTrainingProgramWorkoutInput,
} from './types/training-program.types.js';

import { TrainingProgramCrudRepository } from './repositories/training-program-crud.repository.js';
import { TrainingProgramVersionRepository } from './repositories/training-program-version.repository.js';
import { TrainingProgramAssignmentRepository } from './repositories/training-program-assignment.repository.js';
import { TrainingProgramExerciseRepository } from './repositories/training-program-exercise.repository.js';
import { TrainingProgramSetRepository } from './repositories/training-program-set.repository.js';
import { TrainingProgramWorkoutRepository } from './repositories/training-program-workout.repository.js';

import type { FindManyTrainingProgramAssignmentsParams } from './repositories/training-program-assignment.repository.js';

//ТИМЧАСОВО Шляпа
export { trainingProgramSelect } from './selects/training-program.select.js';
export { trainingProgramVersionSelect } from './selects/training-program-version.select.js';
export {
  trainingProgramAssignmentSelect,
  trainingProgramAssignmentDetailsSelect,
} from './selects/training-program-assignment.select.js';
export type { FindManyTrainingProgramAssignmentsParams } from './repositories/training-program-assignment.repository.js';

// -----------------------------------------------------------------------------
// PARAMS
// -----------------------------------------------------------------------------

export type FindManyTrainingProgramsParams = {
  where: Prisma.TrainingProgramWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainingProgramOrderByWithRelationInput[];
};

// -----------------------------------------------------------------------------
// REPOSITORY
// -----------------------------------------------------------------------------

@Injectable()
export class TrainingProgramsRepository {
  constructor(
    private readonly crudRepository: TrainingProgramCrudRepository,
    private readonly versionRepository: TrainingProgramVersionRepository,
    private readonly assignmentRepository: TrainingProgramAssignmentRepository,
    private readonly exerciseRepository: TrainingProgramExerciseRepository,
    private readonly setRepository: TrainingProgramSetRepository,
    private readonly workoutRepository: TrainingProgramWorkoutRepository,
  ) {}

  async createProgramWithDraft(input: {
    trainerId: string;
    title: string;
    description?: string | null;
    durationWeeks?: number | null;
  }) {
    return this.crudRepository.createProgramWithDraft(input);
  }

  async createDraftFromLatestPublished(programId: string) {
    return this.versionRepository.createDraftFromLatestPublished(programId);
  }

  async publishVersion(programId: string, versionId: string) {
    return this.versionRepository.publishVersion(programId, versionId);
  }

  // ===========================================================================
  // WORKOUTS
  // ===========================================================================
  async createWorkout(
    programId: string,
    versionId: string,
    input: CreateTrainingProgramWorkoutInput,
  ) {
    return this.workoutRepository.createWorkout(programId, versionId, input);
  }

  async updateWorkout(
    programId: string,
    versionId: string,
    workoutId: string,
    input: UpdateTrainingProgramWorkoutInput,
  ) {
    return this.workoutRepository.updateWorkout(
      programId,
      versionId,
      workoutId,
      input,
    );
  }

  async deleteWorkout(programId: string, versionId: string, workoutId: string) {
    return this.workoutRepository.deleteWorkout(
      programId,
      versionId,
      workoutId,
    );
  }

  // ===========================================================================
  // TRAINING PROGRAMS
  // ===========================================================================

  async findMany(params: FindManyTrainingProgramsParams) {
    return this.crudRepository.findMany(params);
  }

  async findProgramById(
    id: string,
    where: Prisma.TrainingProgramWhereInput = {},
  ) {
    return this.crudRepository.findProgramById(id, where);
  }

  async createProgram(data: Prisma.TrainingProgramCreateInput) {
    return this.crudRepository.createProgram(data);
  }

  async updateProgram(
    where: Prisma.TrainingProgramWhereUniqueInput,
    data: Prisma.TrainingProgramUpdateInput,
  ) {
    return this.crudRepository.updateProgram(where, data);
  }

  // ===========================================================================
  // PROGRAM VERSIONS
  // ===========================================================================

  async findVersions(programId: string) {
    return this.versionRepository.findVersions(programId);
  }

  async findVersionById(
    id: string,
    where: Prisma.TrainingProgramVersionWhereInput = {},
  ) {
    return this.versionRepository.findVersionById(id, where);
  }

  async findVersionByNumber(programId: string, version: number) {
    return this.versionRepository.findVersionByNumber(programId, version);
  }

  async findDraftVersion(programId: string) {
    return this.versionRepository.findDraftVersion(programId);
  }

  async createVersion(data: Prisma.TrainingProgramVersionCreateInput) {
    return this.versionRepository.createVersion(data);
  }

  async updateVersion(
    where: Prisma.TrainingProgramVersionWhereUniqueInput,
    data: Prisma.TrainingProgramVersionUpdateInput,
  ) {
    return this.versionRepository.updateVersion(where, data);
  }

  // ===========================================================================
  // PROGRAM ASSIGNMENTS
  // ===========================================================================

  async findManyAssignments(params: FindManyTrainingProgramAssignmentsParams) {
    return this.assignmentRepository.findManyAssignments(params);
  }

  async findAssignmentById(
    id: string,
    where: Prisma.TrainingProgramAssignmentWhereInput = {},
  ) {
    return this.assignmentRepository.findAssignmentById(id, where);
  }

  async findAssignmentDetailsById(
    id: string,
    where: Prisma.TrainingProgramAssignmentWhereInput = {},
  ) {
    return this.assignmentRepository.findAssignmentDetailsById(id, where);
  }

  async findActiveAssignmentByRelationship(trainerAthleteId: string) {
    return this.assignmentRepository.findActiveAssignmentByRelationship(
      trainerAthleteId,
    );
  }

  async createAssignmentForActiveRelationship(input: {
    trainerAthleteId: string;
    trainerId: string;
    athleteId: string;
    data: Prisma.TrainingProgramAssignmentCreateInput;
  }) {
    return this.assignmentRepository.createAssignmentForActiveRelationship(
      input,
    );
  }

  async updateAssignment(
    where: Prisma.TrainingProgramAssignmentWhereUniqueInput,
    data: Prisma.TrainingProgramAssignmentUpdateInput,
  ) {
    return this.assignmentRepository.updateAssignment(where, data);
  }

  async completeAssignmentIfNoUnfinishedWorkouts(input: {
    assignmentId: string;
    athleteId: string;
    completedAt: Date;
  }) {
    return this.assignmentRepository.completeAssignmentIfNoUnfinishedWorkouts(
      input,
    );
  }

  // ===========================================================================
  // PROGRAM EXERCISES
  // ===========================================================================
  async createProgramExercise(
    programId: string,
    versionId: string,
    workoutId: string,
    data: {
      exerciseId: string;
      exerciseNameSnapshot: string;
      exerciseTypeSnapshot: ExerciseType;
      sortOrder: number;
      notes: string | null;
    },
  ) {
    return this.exerciseRepository.createProgramExercise(
      programId,
      versionId,
      workoutId,
      data,
    );
  }

  async updateProgramExercise(
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseId: string,
    data: UpdateTrainingProgramExerciseInput,
  ) {
    return this.exerciseRepository.updateProgramExercise(
      programId,
      versionId,
      workoutId,
      exerciseId,
      data,
    );
  }

  async deleteProgramExercise(
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseId: string,
  ) {
    return this.exerciseRepository.deleteProgramExercise(
      programId,
      versionId,
      workoutId,
      exerciseId,
    );
  }

  async reorderProgramExercises(
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseIds: string[],
  ) {
    return this.exerciseRepository.reorderProgramExercises(
      programId,
      versionId,
      workoutId,
      exerciseIds,
    );
  }

  // ===========================================================================
  // PROGRAM SETS
  // ===========================================================================
  async createProgramSet(
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    data: {
      setNumber: number;
      setType?: WorkoutSetType;
      plannedReps?: number | null;
      plannedWeightKg?: number | null;
      plannedDurationSeconds?: number | null;
      plannedDistanceMeters?: number | null;
      restSeconds?: number | null;
      targetRpe?: number | null;
      targetRir?: number | null;
      notes?: string | null;
    },
  ) {
    return this.setRepository.createProgramSet(
      programId,
      versionId,
      workoutId,
      programExerciseId,
      data,
    );
  }

  async updateProgramSet(
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setId: string,
    data: UpdateTrainingProgramSetInput,
  ) {
    return this.setRepository.updateProgramSet(
      programId,
      versionId,
      workoutId,
      programExerciseId,
      setId,
      data,
    );
  }

  async deleteProgramSet(
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setId: string,
  ) {
    return this.setRepository.deleteProgramSet(
      programId,
      versionId,
      workoutId,
      programExerciseId,
      setId,
    );
  }

  async reorderProgramSets(
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setIds: string[],
  ) {
    return this.setRepository.reorderProgramSets(
      programId,
      versionId,
      workoutId,
      programExerciseId,
      setIds,
    );
  }
}
