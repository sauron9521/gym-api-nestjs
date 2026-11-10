import { Module } from '@nestjs/common';

import { ExercisesController } from './controllers/exercises.controller.js';
import { ExerciseTrainerAccessController } from './controllers/exercise-trainer-access.controller.js';
import { ExercisesRepository } from './repositories/exercises.repository.js';
import { ExerciseTrainerAccessRepository } from './repositories/exercise-trainer-access.repository.js';
import { ExercisesService } from './services/exercises.service.js';
import { ExerciseTrainerAccessService } from './services/exercise-trainer-access.service.js';
import { TrainerAthletesModule } from '#src/modules/trainer-athletes/trainer-athletes.module';

@Module({
  imports: [TrainerAthletesModule],
  controllers: [ExercisesController, ExerciseTrainerAccessController],
  providers: [ExercisesRepository, ExercisesService, ExerciseTrainerAccessRepository, ExerciseTrainerAccessService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
