import { Module } from '@nestjs/common';

import { ExercisesModule } from '#src/modules/exercises/exercises.module';
import { TrainerAthletesModule } from '#src/modules/trainer-athletes/trainer-athletes.module';

import { TrainingProgramsController } from './training-programs.controller.js';
import { TrainingProgramAssignmentsController } from './training-program-assignments.controller.js';
import { TrainingProgramVersionsController } from './training-program-versions.controller.js';
import { TrainingProgramWorkoutsController } from './training-program-workouts.controller.js';
import { TrainingProgramExercisesController } from './training-program-exercises.controller.js';
import { TrainingProgramsService } from './services/training-programs.service.js';

import { TrainingProgramCrudRepository } from './repositories/training-program-crud.repository.js';
import { TrainingProgramVersionRepository } from './repositories/training-program-version.repository.js';
import { TrainingProgramAssignmentRepository } from './repositories/training-program-assignment.repository.js';
import { TrainingProgramExerciseRepository } from './repositories/training-program-exercise.repository.js';
import { TrainingProgramSetRepository } from './repositories/training-program-set.repository.js';
import { TrainingProgramWorkoutRepository } from './repositories/training-program-workout.repository.js';

import { TrainingProgramAccessService } from './services/training-program-access.service.js';
import { TrainingProgramWorkoutService } from './services/training-program-workout.service.js';
import { TrainingProgramExerciseService } from './services/training-program-exercise.service.js';
import { TrainingProgramSetService } from './services/training-program-set.service.js';
import { TrainingProgramCrudService } from './services/training-program-crud.service.js';
import { TrainingProgramVersionService } from './services/training-program-version.service.js';
import { TrainingProgramAssignmentService } from './services/training-program-assignment.service.js';

@Module({
  imports: [ExercisesModule, TrainerAthletesModule],
  exports: [TrainingProgramsService],
  // Register literal /assignments routes before /:programId.
  controllers: [
    TrainingProgramAssignmentsController,
    TrainingProgramVersionsController,
    TrainingProgramWorkoutsController,
    TrainingProgramExercisesController,
    TrainingProgramsController,
  ],
  providers: [
    TrainingProgramsService,

    TrainingProgramAccessService,
    TrainingProgramWorkoutService,
    TrainingProgramExerciseService,
    TrainingProgramSetService,
    TrainingProgramCrudService,
    TrainingProgramVersionService,
    TrainingProgramAssignmentService,

    TrainingProgramCrudRepository,
    TrainingProgramVersionRepository,
    TrainingProgramAssignmentRepository,
    TrainingProgramExerciseRepository,
    TrainingProgramSetRepository,
    TrainingProgramWorkoutRepository,
  ],
})
export class TrainingProgramsModule {}
