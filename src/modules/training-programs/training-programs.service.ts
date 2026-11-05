import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  AddTrainingProgramExerciseInput,
  CancelTrainingProgramAssignmentInput,
  CreateTrainingProgramAssignmentInput,
  CreateTrainingProgramInput,
  CreateTrainingProgramSetInput,
  CreateTrainingProgramWorkoutInput,
  ReorderTrainingProgramExercisesInput,
  ReorderTrainingProgramSetsInput,
  TrainingProgramActor,
  TrainingProgramAssignmentListQuery,
  TrainingProgramListQuery,
  UpdateTrainingProgramDraftInput,
  UpdateTrainingProgramExerciseInput,
  UpdateTrainingProgramSetInput,
  UpdateTrainingProgramWorkoutInput,
} from './types/training-program.types.js';
import { TrainingProgramWorkoutService } from './services/training-program-workout.service.js';
import { TrainingProgramExerciseService } from './services/training-program-exercise.service.js';
import { TrainingProgramSetService } from './services/training-program-set.service.js';
import { TrainingProgramCrudService } from './services/training-program-crud.service.js';
import { TrainingProgramVersionService } from './services/training-program-version.service.js';
import { TrainingProgramAssignmentService } from './services/training-program-assignment.service.js';

@Injectable()
export class TrainingProgramsService {
  constructor(
    private readonly crudService: TrainingProgramCrudService,
    private readonly versionService: TrainingProgramVersionService,
    private readonly assignmentService: TrainingProgramAssignmentService,
    private readonly workoutService: TrainingProgramWorkoutService,
    private readonly exerciseService: TrainingProgramExerciseService,
    private readonly setService: TrainingProgramSetService,
  ) {}

  async addExercise(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    input: AddTrainingProgramExerciseInput,
  ) {
    return this.exerciseService.addExercise(
      actor,
      programId,
      versionId,
      workoutId,
      input,
    );
  }

  async updateExercise(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseId: string,
    input: UpdateTrainingProgramExerciseInput,
  ) {
    return this.exerciseService.updateExercise(
      actor,
      programId,
      versionId,
      workoutId,
      exerciseId,
      input,
    );
  }

  async removeExercise(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseId: string,
  ) {
    return this.exerciseService.removeExercise(
      actor,
      programId,
      versionId,
      workoutId,
      exerciseId,
    );
  }

  async reorderExercises(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    input: ReorderTrainingProgramExercisesInput,
  ) {
    return this.exerciseService.reorderExercises(
      actor,
      programId,
      versionId,
      workoutId,
      input,
    );
  }

  async createWorkout(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    input: CreateTrainingProgramWorkoutInput,
  ) {
    return this.workoutService.createWorkout(
      actor,
      programId,
      versionId,
      input,
    );
  }

  async updateWorkout(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    input: UpdateTrainingProgramWorkoutInput,
  ) {
    return this.workoutService.updateWorkout(
      actor,
      programId,
      versionId,
      workoutId,
      input,
    );
  }

  async deleteWorkout(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
  ) {
    return this.workoutService.deleteWorkout(
      actor,
      programId,
      versionId,
      workoutId,
    );
  }

  // ===========================================================================
  // CREATE PROGRAM
  // ===========================================================================

  async create(actor: TrainingProgramActor, input: CreateTrainingProgramInput) {
    return this.crudService.create(actor, input);
  }

  async findMany(actor: TrainingProgramActor, query: TrainingProgramListQuery) {
    return this.crudService.findMany(actor, query);
  }

  async findOne(id: string, actor: TrainingProgramActor) {
    return this.crudService.findOne(id, actor);
  }

  async archive(id: string, actor: TrainingProgramActor) {
    return this.crudService.archive(id, actor);
  }

  async findVersions(programId: string, actor: TrainingProgramActor) {
    return this.versionService.findVersions(programId, actor);
  }

  async findVersion(
    programId: string,
    versionId: string,
    actor: TrainingProgramActor,
  ) {
    return this.versionService.findVersion(programId, versionId, actor);
  }

  async createNextDraft(programId: string, actor: TrainingProgramActor) {
    return this.versionService.createNextDraft(programId, actor);
  }

  async updateDraftVersion(
    programId: string,
    versionId: string,
    actor: TrainingProgramActor,
    input: UpdateTrainingProgramDraftInput,
  ) {
    return this.versionService.updateDraftVersion(
      programId,
      versionId,
      actor,
      input,
    );
  }

  async publishVersion(
    programId: string,
    versionId: string,
    actor: TrainingProgramActor,
  ) {
    return this.versionService.publishVersion(programId, versionId, actor);
  }

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  private validatePagination(query: TrainingProgramListQuery): void {
    if (
      !Number.isInteger(query.page) ||
      query.page < 1 ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new BadRequestException('Invalid pagination parameters');
    }
  }

  async addSet(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    input: CreateTrainingProgramSetInput,
  ) {
    return this.setService.addSet(
      actor,
      programId,
      versionId,
      workoutId,
      programExerciseId,
      input,
    );
  }

  async updateSet(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setId: string,
    input: UpdateTrainingProgramSetInput,
  ) {
    return this.setService.updateSet(
      actor,
      programId,
      versionId,
      workoutId,
      programExerciseId,
      setId,
      input,
    );
  }

  async removeSet(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setId: string,
  ) {
    return this.setService.removeSet(
      actor,
      programId,
      versionId,
      workoutId,
      programExerciseId,
      setId,
    );
  }

  async reorderSets(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    input: ReorderTrainingProgramSetsInput,
  ) {
    return this.setService.reorderSets(
      actor,
      programId,
      versionId,
      workoutId,
      programExerciseId,
      input,
    );
  }

  async assignVersionToAthlete(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    input: CreateTrainingProgramAssignmentInput,
  ) {
    return this.assignmentService.assignVersionToAthlete(
      actor,
      programId,
      versionId,
      input,
    );
  }

  async findManyAssignments(
    actor: TrainingProgramActor,
    query: TrainingProgramAssignmentListQuery,
  ) {
    return this.assignmentService.findManyAssignments(actor, query);
  }

  async findOneAssignment(assignmentId: string, actor: TrainingProgramActor) {
    return this.assignmentService.findOneAssignment(assignmentId, actor);
  }

  async findOneAssignmentDetails(
    assignmentId: string,
    actor: TrainingProgramActor,
  ) {
    return this.assignmentService.findOneAssignmentDetails(assignmentId, actor);
  }

  async completeAssignment(assignmentId: string, actor: TrainingProgramActor) {
    return this.assignmentService.completeAssignment(assignmentId, actor);
  }

  async cancelAssignment(
    assignmentId: string,
    actor: TrainingProgramActor,
    input: CancelTrainingProgramAssignmentInput = {},
  ) {
    return this.assignmentService.cancelAssignment(assignmentId, actor, input);
  }
}
