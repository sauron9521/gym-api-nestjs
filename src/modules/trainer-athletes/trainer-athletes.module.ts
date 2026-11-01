import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module.js';

import { TrainerAthletesRepository } from './trainer-athletes.repository.js';
import { TrainerAthletesService } from './trainer-athletes.service.js';
import { TrainerAthletesController } from './trainer-athletes.controller.js';

@Module({
  imports: [UsersModule],
  controllers: [TrainerAthletesController],
  providers: [TrainerAthletesRepository, TrainerAthletesService],
  exports: [TrainerAthletesService],
})
export class TrainerAthletesModule {}
