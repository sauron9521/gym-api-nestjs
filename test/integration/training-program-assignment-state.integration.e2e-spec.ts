import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { PrismaModule, PrismaService } from '../../src/infra/database/index.js';
import { TrainingProgramAssignmentRepository } from '../../src/modules/training-programs/repositories/training-program-assignment.repository.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('TrainingProgramAssignmentRepository eligibility (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: TrainingProgramAssignmentRepository;

  let trainerId: string;
  let athleteId: string;
  let relationshipId: string;
  let programId: string;
  let versionId: string;

  const createAssignment = () =>
    repository.createAssignmentForActiveRelationship({
      programId,
      versionId,
      trainerAthleteId: relationshipId,
      trainerId,
      athleteId,
    });

  beforeAll(async () => {
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
      providers: [TrainingProgramAssignmentRepository],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    repository = app.get(TrainingProgramAssignmentRepository);

    const suffix = randomUUID();
    const trainer = await prisma.user.create({
      data: {
        email: `assignment-state-trainer-${suffix}@example.com`,
        passwordHash: 'test-password-hash',
        role: 'TRAINER',
      },
      select: { id: true },
    });
    trainerId = trainer.id;

    const athlete = await prisma.user.create({
      data: {
        email: `assignment-state-athlete-${suffix}@example.com`,
        passwordHash: 'test-password-hash',
        role: 'ATHLETE',
      },
      select: { id: true },
    });
    athleteId = athlete.id;

    const relationship = await prisma.trainerAthlete.create({
      data: {
        trainerId,
        athleteId,
        initiatedById: trainerId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    relationshipId = relationship.id;
  }, 20_000);

  beforeEach(async () => {
    const program = await prisma.trainingProgram.create({
      data: {
        trainerId,
        status: 'PUBLISHED',
        versions: {
          create: {
            title: 'Published Program',
            version: 1,
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        },
      },
      select: {
        id: true,
        versions: { select: { id: true } },
      },
    });
    programId = program.id;
    versionId = program.versions[0]!.id;
  });

  afterEach(async () => {
    await prisma.trainingProgramAssignment.deleteMany({
      where: { versionId },
    });
    await prisma.trainingProgramVersion.deleteMany({
      where: { programId },
    });
    await prisma.trainingProgram.delete({ where: { id: programId } });
  });

  afterAll(async () => {
    if (relationshipId) {
      await prisma.trainerAthlete.delete({
        where: { id: relationshipId },
      });
    }
    if (athleteId) {
      await prisma.user.delete({ where: { id: athleteId } });
    }
    if (trainerId) {
      await prisma.user.delete({ where: { id: trainerId } });
    }
    await app?.close();
  }, 20_000);

  it('creates an assignment when relationship, version and program are eligible', async () => {
    const assignment = await createAssignment();

    expect(assignment).toMatchObject({
      versionId,
      athleteId,
      trainerAthleteId: relationshipId,
      assignedById: trainerId,
      status: 'ACTIVE',
    });

    expect(await prisma.trainingProgramAssignment.count({
      where: { versionId, athleteId },
    })).toBe(1);
  });

  it('rejects an unpublished version without inserting an assignment', async () => {
    await prisma.trainingProgramVersion.update({
      where: { id: versionId },
      data: { status: 'DRAFT', publishedAt: null },
    });

    expect(await createAssignment()).toBeNull();
    expect(await prisma.trainingProgramAssignment.count({
      where: { versionId },
    })).toBe(0);
  });

  it('rejects an archived program without inserting an assignment', async () => {
    await prisma.trainingProgram.update({
      where: { id: programId },
      data: { status: 'ARCHIVED' },
    });

    expect(await createAssignment()).toBeNull();
    expect(await prisma.trainingProgramAssignment.count({
      where: { versionId },
    })).toBe(0);
  });

  it('rejects a version belonging to a different program', async () => {
    const other = await prisma.trainingProgram.create({
      data: {
        trainerId,
        status: 'PUBLISHED',
        versions: {
          create: {
            version: 1,
            title: 'Different Program',
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        },
      },
      select: { id: true, versions: { select: { id: true } } },
    });
    try {
      const assignment = await repository.createAssignmentForActiveRelationship({
        programId,
        versionId: other.versions[0]!.id,
        trainerAthleteId: relationshipId,
        trainerId,
        athleteId,
      });
      expect(assignment).toBeNull();
    } finally {
      await prisma.trainingProgramVersion.deleteMany({
        where: { programId: other.id },
      });
      await prisma.trainingProgram.delete({ where: { id: other.id } });
    }
  });

  it('serializes creation with a concurrent program archive', async () => {
    let creation:
      | ReturnType<TrainingProgramAssignmentRepository['createAssignmentForActiveRelationship']>
      | undefined;
    let blocked = false;

    await prisma.$transaction(
      async (tx) => {
        const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid()::integer AS pid
          FROM "training_programs"
          WHERE "id" = ${programId}
          FOR UPDATE
        `;
        expect(holder).toBeDefined();

        creation = createAssignment();

        // Wait until the second connection reaches the program row lock.
        for (let attempt = 0; attempt < 60; attempt++) {
          const [state] = await prisma.$queryRaw<
            Array<{ is_blocked: boolean }>
          >`
            SELECT EXISTS (
              SELECT 1
              FROM pg_stat_activity AS activity
              WHERE activity.datname = current_database()
                AND ${holder!.pid} = ANY(
                  pg_blocking_pids(activity.pid)
                )
            ) AS is_blocked
          `;

          if (state?.is_blocked) {
            blocked = true;
            break;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }

        expect(blocked).toBe(true);

        await tx.trainingProgram.update({
          where: { id: programId },
          data: { status: 'ARCHIVED' },
        });
      },
      { timeout: 15_000 },
    );

    expect(await creation).toBeNull();
    expect(await prisma.trainingProgramAssignment.count({
      where: { versionId },
    })).toBe(0);
  }, 25_000);
});
