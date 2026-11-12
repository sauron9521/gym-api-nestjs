import { TrainingProgramCrudRepository } from '../repositories/training-program-crud.repository.js';
import { TrainingProgramVersionRepository } from '../repositories/training-program-version.repository.js';
import { trainingProgramSelect } from '../selects/training-program.select.js';
import { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';

describe('Training Programs repository edge coverage', () => {
  describe('TrainingProgramCrudRepository', () => {
    const prisma = {
      $transaction: vi.fn(),
      trainingProgram: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    let repository: TrainingProgramCrudRepository;

    beforeEach(() => {
      vi.resetAllMocks();
      repository = new TrainingProgramCrudRepository(prisma as never);
    });

    it('honors custom ordering and computes the final partial page', async () => {
      const data = [{ id: 'program-last' }];
      prisma.$transaction.mockResolvedValue([data, 21]);

      const result = await repository.findMany({
        where: { trainerId: 'trainer-1', status: 'PUBLISHED' },
        skip: 20,
        take: 10,
        orderBy: [{ id: 'asc' }],
      });

      expect(prisma.trainingProgram.findMany).toHaveBeenCalledExactlyOnceWith({
        where: { trainerId: 'trainer-1', status: 'PUBLISHED' },
        skip: 20,
        take: 10,
        orderBy: [{ id: 'asc' }],
        select: trainingProgramSelect,
      });
      expect(prisma.trainingProgram.count).toHaveBeenCalledExactlyOnceWith({
        where: { trainerId: 'trainer-1', status: 'PUBLISHED' },
      });
      expect(result).toEqual({
        data,
        meta: { total: 21, skip: 20, take: 10, totalPages: 3 },
      });
    });

    it('returns an empty page with zero total pages', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      await expect(repository.findMany({
        where: { trainerId: 'trainer-1' }, skip: 0, take: 20,
      })).resolves.toEqual({
        data: [],
        meta: { total: 0, skip: 0, take: 20, totalPages: 0 },
      });
    });

    it('allows an unfiltered lookup with the default where predicate', async () => {
      const result = { id: 'program-1' };
      prisma.trainingProgram.findFirst.mockResolvedValue(result);
      await expect(repository.findProgramById('program-1')).resolves.toBe(result);
      expect(prisma.trainingProgram.findFirst).toHaveBeenCalledExactlyOnceWith({
        where: { AND: [{ id: 'program-1' }, {}] },
        select: trainingProgramSelect,
      });
    });

    it('creates the initial draft using null defaults for optional fields', async () => {
      const result = { id: 'program-1' };
      prisma.trainingProgram.create.mockResolvedValue(result);
      await expect(repository.createProgramWithDraft({
        trainerId: 'trainer-1', title: 'Strength',
      })).resolves.toBe(result);

      expect(prisma.trainingProgram.create).toHaveBeenCalledExactlyOnceWith({
        data: {
          trainer: { connect: { id: 'trainer-1' } },
          versions: {
            create: {
              version: 1,
              title: 'Strength',
              description: null,
              durationWeeks: null,
              status: 'DRAFT',
            },
          },
        },
        select: trainingProgramSelect,
      });
    });

    it('preserves explicit draft properties and never creates a published version', async () => {
      await repository.createProgramWithDraft({
        trainerId: 'trainer-1',
        title: 'Full Body',
        description: 'Four weeks',
        durationWeeks: 4,
      });
      expect(prisma.trainingProgram.create).toHaveBeenCalledExactlyOnceWith({
        data: {
          trainer: { connect: { id: 'trainer-1' } },
          versions: {
            create: {
              version: 1,
              title: 'Full Body',
              description: 'Four weeks',
              durationWeeks: 4,
              status: 'DRAFT',
            },
          },
        },
        select: trainingProgramSelect,
      });
    });

    it('preserves explicit null values when creating the first draft', async () => {
      await repository.createProgramWithDraft({
        trainerId: 'trainer-1',
        title: 'Open-ended',
        description: null,
        durationWeeks: null,
      });
      expect(prisma.trainingProgram.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          versions: {
            create: expect.objectContaining({
              description: null,
              durationWeeks: null,
            }),
          },
        }),
        select: trainingProgramSelect,
      });
    });
  });

  describe('TrainingProgramVersionRepository duration changes', () => {
    const prisma = {
      $transaction: vi.fn(),
      trainingProgramVersion: { update: vi.fn() },
    };
    const where = { id: 'version-1', programId: 'program-1', status: 'DRAFT' as const };
    let repository: TrainingProgramVersionRepository;

    beforeEach(() => {
      vi.resetAllMocks();
      repository = new TrainingProgramVersionRepository(prisma as never);
    });

    it('updates title without a row-lock transaction', async () => {
      const result = { id: where.id, title: 'New title' };
      prisma.trainingProgramVersion.update.mockResolvedValue(result);
      await expect(repository.updateVersion(where, { title: 'New title' }))
        .resolves.toBe(result);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
        where, data: { title: 'New title' },
        select: trainingProgramVersionSelect,
      });
    });

    it('does not acquire a duration lock when clearing the duration', async () => {
      await repository.updateVersion(where, { durationWeeks: null });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
        where, data: { durationWeeks: null },
        select: trainingProgramVersionSelect,
      });
    });

    it('uses normal Prisma update semantics when a composite key has no version ID', async () => {
      const composite = {
        programId_version: { programId: 'program-1', version: 2 },
      };
      await repository.updateVersion(composite, { durationWeeks: 4 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
        where: composite, data: { durationWeeks: 4 },
        select: trainingProgramVersionSelect,
      });
    });

    it('falls back to conditional update if the version row vanished before the lock', async () => {
      const updated = { id: where.id, durationWeeks: 4 };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        trainingProgramWorkout: { findFirst: vi.fn() },
        trainingProgramVersion: { update: vi.fn().mockResolvedValue(updated) },
      };
      prisma.$transaction.mockImplementation(async (
        callback: (transaction: typeof tx) => Promise<unknown>,
      ) => callback(tx));

      await expect(repository.updateVersion(where, { durationWeeks: 4 }))
        .resolves.toBe(updated);
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
      expect(tx.trainingProgramWorkout.findFirst).not.toHaveBeenCalled();
      expect(tx.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
        where, data: { durationWeeks: 4 },
        select: trainingProgramVersionSelect,
      });
    });

    it('allows any positive duration if no workouts have been scheduled', async () => {
      const updated = { id: where.id, durationWeeks: 2 };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: where.id }]),
        trainingProgramWorkout: { findFirst: vi.fn().mockResolvedValue(null) },
        trainingProgramVersion: { update: vi.fn().mockResolvedValue(updated) },
      };
      prisma.$transaction.mockImplementation(async (
        callback: (transaction: typeof tx) => Promise<unknown>,
      ) => callback(tx));
      await expect(repository.updateVersion(where, { durationWeeks: 2 }))
        .resolves.toBe(updated);
      expect(tx.trainingProgramWorkout.findFirst).toHaveBeenCalledExactlyOnceWith({
        where: { versionId: where.id },
        orderBy: { weekNumber: 'desc' },
        select: { weekNumber: true },
      });
      expect(tx.trainingProgramVersion.update).toHaveBeenCalledOnce();
    });

    it('accepts a duration equal to the final scheduled workout week', async () => {
      const updated = { id: where.id, durationWeeks: 4 };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: where.id }]),
        trainingProgramWorkout: { findFirst: vi.fn().mockResolvedValue({ weekNumber: 4 }) },
        trainingProgramVersion: { update: vi.fn().mockResolvedValue(updated) },
      };
      prisma.$transaction.mockImplementation(async (
        callback: (transaction: typeof tx) => Promise<unknown>,
      ) => callback(tx));
      await expect(repository.updateVersion(where, { durationWeeks: 4 }))
        .resolves.toBe(updated);
      expect(tx.$queryRaw.mock.invocationCallOrder[0])
        .toBeLessThan(tx.trainingProgramWorkout.findFirst.mock.invocationCallOrder[0]!);
      expect(tx.trainingProgramWorkout.findFirst.mock.invocationCallOrder[0])
        .toBeLessThan(tx.trainingProgramVersion.update.mock.invocationCallOrder[0]!);
      expect(tx.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
        where, data: { durationWeeks: 4 },
        select: trainingProgramVersionSelect,
      });
    });

    it('propagates a failed conditional update so the transaction can roll back', async () => {
      const failure = new Error('concurrent version state change');
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: where.id }]),
        trainingProgramWorkout: { findFirst: vi.fn().mockResolvedValue(null) },
        trainingProgramVersion: { update: vi.fn().mockRejectedValue(failure) },
      };
      prisma.$transaction.mockImplementation(async (
        callback: (transaction: typeof tx) => Promise<unknown>,
      ) => callback(tx));
      await expect(repository.updateVersion(where, { durationWeeks: 4 }))
        .rejects.toBe(failure);
    });
  });
});
