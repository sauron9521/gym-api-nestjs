import { workoutSelect } from '../selects/workout.select.js';
import { WorkoutQueriesRepository } from './workout-queries.repository.js';
import { WorkoutCreationRepository } from './workout-creation.repository.js';
import { WorkoutLifecycleRepository } from './workout-lifecycle.repository.js';
import { WorkoutSetsRepository } from './workout-sets.repository.js';

@Injectable()
export class WorkoutsRepository extends WorkoutQueriesRepository {
  constructor(
    prisma: PrismaService,
    private readonly creationRepository: WorkoutCreationRepository,
    private readonly lifecycleRepository: WorkoutLifecycleRepository,
    private readonly setsRepository: WorkoutSetsRepository,
  ) {
    super(prisma);
  }

  create(data: Prisma.WorkoutCreateInput, athleteId: string, exerciseIds: string[]) {
    return this.creationRepository.create(data, athleteId, exerciseIds);
  }

  createFromProgram(input: Parameters<WorkoutCreationRepository['createFromProgram']>[0]) {
    return this.creationRepository.createFromProgram(input);
  }

  // UPDATE
  async update(
    where: Prisma.WorkoutWhereUniqueInput,
    data: Prisma.WorkoutUpdateInput,
  ) {
    return this.prisma.workout.update({
      where,
      data,
      select: workoutSelect,
    });
  }

  updateSet(id: string, data: Prisma.WorkoutSetUpdateInput) {
    return this.setsRepository.updateSet(id, data);
  }

  completeWorkout(input: Parameters<WorkoutLifecycleRepository['completeWorkout']>[0]) {
    return this.lifecycleRepository.completeWorkout(input);
  }

  startWorkout(input: Parameters<WorkoutLifecycleRepository['startWorkout']>[0]) {
    return this.lifecycleRepository.startWorkout(input);
  }
}
