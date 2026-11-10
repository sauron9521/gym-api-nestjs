import { Module } from '@nestjs/common';

import { UsersModule } from '#src/modules/users/users.module';

import { TrainerAthletesRepository } from './repositories/trainer-athletes.repository.js';
import { TrainerAthletesService } from './services/trainer-athletes.service.js';
import { TrainerAthleteTerminationService } from './services/trainer-athlete-termination.service.js';
import { TrainerAthleteExerciseCopyService } from './services/trainer-athlete-exercise-copy.service.js';
import { TrainerAthletesController } from './controllers/trainer-athletes.controller.js';

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
