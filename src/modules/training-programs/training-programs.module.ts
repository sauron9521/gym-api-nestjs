import { Module } from '@nestjs/common';

import { ExercisesModule } from '../exercises/exercises.module.js';
import { TrainerAthletesModule } from '../trainer-athletes/trainer-athletes.module.js';

import { TrainingProgramsController } from './training-programs.controller.js';
import { TrainingProgramsRepository } from './training-programs.repository.js';
import { TrainingProgramsService } from './training-programs.service.js';

@Module({
  imports: [ExercisesModule, TrainerAthletesModule],
  controllers: [TrainingProgramsController],
  providers: [TrainingProgramsRepository, TrainingProgramsService],
  exports: [TrainingProgramsService],
})
export class TrainingProgramsModule {}
