import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module.js';

import { TrainerAthletesRepository } from './trainer-athletes.repository.js';
import { TrainerAthletesService } from './trainer-athletes.service.js';
import { TrainerAthleteTerminationService } from './services/trainer-athlete-termination.service.js';
import { TrainerAthleteExerciseCopyService } from './services/trainer-athlete-exercise-copy.service.js';
import { TrainerAthletesController } from './trainer-athletes.controller.js';

@Module({
  imports: [UsersModule],
  controllers: [TrainerAthletesController],
  providers: [
    TrainerAthletesRepository,
    TrainerAthletesService,
    TrainerAthleteTerminationService,
    TrainerAthleteExerciseCopyService,
  ],
  exports: [TrainerAthletesService],
})
export class TrainerAthletesModule {}
