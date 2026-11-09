import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/infra/database/generated/prisma/client.js';

const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run seed.');
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const muscleGroups = [
  { name: 'Chest', slug: 'chest' },
  { name: 'Latissimus Dorsi', slug: 'lats' },
  { name: 'Upper Back', slug: 'upper-back' },
  { name: 'Lower Back', slug: 'lower-back' },
  { name: 'Shoulders', slug: 'shoulders' },
  { name: 'Biceps', slug: 'biceps' },
  { name: 'Triceps', slug: 'triceps' },
  { name: 'Forearms', slug: 'forearms' },
  { name: 'Abdominals', slug: 'abs' },
  { name: 'Obliques', slug: 'obliques' },
  { name: 'Quadriceps', slug: 'quadriceps' },
  { name: 'Hamstrings', slug: 'hamstrings' },
  { name: 'Glutes', slug: 'glutes' },
  { name: 'Calves', slug: 'calves' },
  { name: 'Hip Adductors', slug: 'adductors' },
  { name: 'Hip Abductors', slug: 'abductors' },
  { name: 'Hip Flexors', slug: 'hip-flexors' },
  { name: 'Trapezius', slug: 'traps' },
] as const;

const equipmentItems = [
  { name: 'Barbell', slug: 'barbell' },
  { name: 'Dumbbell', slug: 'dumbbell' },
  { name: 'EZ Bar', slug: 'ez-bar' },
  { name: 'Kettlebell', slug: 'kettlebell' },
  { name: 'Cable Machine', slug: 'cable-machine' },
  { name: 'Smith Machine', slug: 'smith-machine' },
  { name: 'Resistance Band', slug: 'resistance-band' },
  { name: 'Pull-up Bar', slug: 'pull-up-bar' },
  { name: 'Dip Station', slug: 'dip-station' },
  { name: 'Bench', slug: 'bench' },
  { name: 'Squat Rack', slug: 'squat-rack' },
  { name: 'Leg Press Machine', slug: 'leg-press-machine' },
  { name: 'Leg Extension Machine', slug: 'leg-extension-machine' },
  { name: 'Leg Curl Machine', slug: 'leg-curl-machine' },
  { name: 'Lat Pulldown Machine', slug: 'lat-pulldown-machine' },
  { name: 'Chest Press Machine', slug: 'chest-press-machine' },
  { name: 'Pec Deck Machine', slug: 'pec-deck-machine' },
  { name: 'Calf Raise Machine', slug: 'calf-raise-machine' },
  { name: 'Adductor Machine', slug: 'adductor-machine' },
  { name: 'Abductor Machine', slug: 'abductor-machine' },
  { name: 'Treadmill', slug: 'treadmill' },
  { name: 'Stationary Bike', slug: 'stationary-bike' },
  { name: 'Rowing Machine', slug: 'rowing-machine' },
  { name: 'Elliptical Machine', slug: 'elliptical-machine' },
  { name: 'Plyometric Box', slug: 'plyo-box' },
  { name: 'Ab Wheel', slug: 'ab-wheel' },
  { name: 'Exercise Mat', slug: 'exercise-mat' },
  { name: 'Bodyweight', slug: 'bodyweight' },
] as const;

type ExerciseType = 'STRENGTH' | 'CARDIO' | 'MOBILITY' | 'PLYOMETRIC' | 'OTHER';

type ExerciseSeed = {
  slug: string;
  name: string;
  exerciseType: ExerciseType;
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  equipment: string[];
};

const exercises: ExerciseSeed[] = [
  // CHEST
  {
    slug: 'barbell-bench-press',
    name: 'Barbell Bench Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'shoulders'],
    equipment: ['barbell', 'bench'],
  },
  {
    slug: 'incline-barbell-bench-press',
    name: 'Incline Barbell Bench Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    equipment: ['barbell', 'bench'],
  },
  {
    slug: 'dumbbell-bench-press',
    name: 'Dumbbell Bench Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'shoulders'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 'incline-dumbbell-press',
    name: 'Incline Dumbbell Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders', 'triceps'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 'decline-barbell-bench-press',
    name: 'Decline Barbell Bench Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'],
    equipment: ['barbell', 'bench'],
  },
  {
    slug: 'dumbbell-fly',
    name: 'Dumbbell Fly',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 'cable-chest-fly',
    name: 'Cable Chest Fly',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'push-up',
    name: 'Push-up',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'shoulders'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'chest-press-machine',
    name: 'Machine Chest Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'shoulders'],
    equipment: ['chest-press-machine'],
  },
  {
    slug: 'pec-deck',
    name: 'Pec Deck',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders'],
    equipment: ['pec-deck-machine'],
  },

  // BACK
  {
    slug: 'pull-up',
    name: 'Pull-up',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['lats'],
    secondaryMuscles: ['biceps', 'upper-back'],
    equipment: ['pull-up-bar', 'bodyweight'],
  },
  {
    slug: 'chin-up',
    name: 'Chin-up',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['lats'],
    secondaryMuscles: ['biceps'],
    equipment: ['pull-up-bar', 'bodyweight'],
  },
  {
    slug: 'lat-pulldown',
    name: 'Lat Pulldown',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['lats'],
    secondaryMuscles: ['biceps', 'upper-back'],
    equipment: ['lat-pulldown-machine'],
  },
  {
    slug: 'seated-cable-row',
    name: 'Seated Cable Row',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['upper-back'],
    secondaryMuscles: ['lats', 'biceps'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'bent-over-barbell-row',
    name: 'Bent Over Barbell Row',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['upper-back'],
    secondaryMuscles: ['lats', 'biceps', 'lower-back'],
    equipment: ['barbell'],
  },
  {
    slug: 'one-arm-dumbbell-row',
    name: 'One Arm Dumbbell Row',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['lats'],
    secondaryMuscles: ['upper-back', 'biceps'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 'chest-supported-row',
    name: 'Chest Supported Row',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['upper-back'],
    secondaryMuscles: ['lats', 'biceps'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 't-bar-row',
    name: 'T-Bar Row',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['upper-back'],
    secondaryMuscles: ['lats', 'biceps'],
    equipment: ['barbell'],
  },
  {
    slug: 'straight-arm-pulldown',
    name: 'Straight Arm Pulldown',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['lats'],
    secondaryMuscles: ['upper-back'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'back-extension',
    name: 'Back Extension',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['lower-back', 'glutes'],
    secondaryMuscles: ['hamstrings'],
    equipment: ['bodyweight'],
  },

  // SHOULDERS
  {
    slug: 'barbell-overhead-press',
    name: 'Barbell Overhead Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps', 'abs'],
    equipment: ['barbell'],
  },
  {
    slug: 'dumbbell-shoulder-press',
    name: 'Dumbbell Shoulder Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'arnold-press',
    name: 'Arnold Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'dumbbell-lateral-raise',
    name: 'Dumbbell Lateral Raise',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'cable-lateral-raise',
    name: 'Cable Lateral Raise',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'dumbbell-front-raise',
    name: 'Dumbbell Front Raise',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['chest'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'reverse-dumbbell-fly',
    name: 'Reverse Dumbbell Fly',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['upper-back'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'face-pull',
    name: 'Face Pull',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['upper-back', 'traps'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'barbell-upright-row',
    name: 'Barbell Upright Row',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['shoulders', 'traps'],
    secondaryMuscles: ['biceps'],
    equipment: ['barbell'],
  },

  // BICEPS & TRICEPS
  {
    slug: 'barbell-biceps-curl',
    name: 'Barbell Biceps Curl',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['biceps'],
    secondaryMuscles: ['forearms'],
    equipment: ['barbell'],
  },
  {
    slug: 'ez-bar-curl',
    name: 'EZ Bar Curl',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['biceps'],
    secondaryMuscles: ['forearms'],
    equipment: ['ez-bar'],
  },
  {
    slug: 'dumbbell-biceps-curl',
    name: 'Dumbbell Biceps Curl',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['biceps'],
    secondaryMuscles: ['forearms'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'hammer-curl',
    name: 'Hammer Curl',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['biceps', 'forearms'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'incline-dumbbell-curl',
    name: 'Incline Dumbbell Curl',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['biceps'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 'cable-biceps-curl',
    name: 'Cable Biceps Curl',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['biceps'],
    secondaryMuscles: ['forearms'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'cable-triceps-pushdown',
    name: 'Cable Triceps Pushdown',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['triceps'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'overhead-cable-triceps-extension',
    name: 'Overhead Cable Triceps Extension',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['triceps'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'lying-triceps-extension',
    name: 'Lying Triceps Extension',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['triceps'],
    secondaryMuscles: ['shoulders'],
    equipment: ['ez-bar', 'bench'],
  },
  {
    slug: 'close-grip-bench-press',
    name: 'Close Grip Bench Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['triceps'],
    secondaryMuscles: ['chest', 'shoulders'],
    equipment: ['barbell', 'bench'],
  },
  {
    slug: 'bench-dip',
    name: 'Bench Dip',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['triceps'],
    secondaryMuscles: ['shoulders', 'chest'],
    equipment: ['bench', 'bodyweight'],
  },

  // LEGS & GLUTES
  {
    slug: 'barbell-back-squat',
    name: 'Barbell Back Squat',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['glutes', 'hamstrings', 'abs'],
    equipment: ['barbell', 'squat-rack'],
  },
  {
    slug: 'barbell-front-squat',
    name: 'Barbell Front Squat',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['glutes', 'abs'],
    equipment: ['barbell', 'squat-rack'],
  },
  {
    slug: 'goblet-squat',
    name: 'Goblet Squat',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['glutes', 'abs'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'leg-press',
    name: 'Leg Press',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['glutes', 'hamstrings'],
    equipment: ['leg-press-machine'],
  },
  {
    slug: 'leg-extension',
    name: 'Leg Extension',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['quadriceps'],
    equipment: ['leg-extension-machine'],
  },
  {
    slug: 'romanian-deadlift',
    name: 'Romanian Deadlift',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['hamstrings', 'glutes'],
    secondaryMuscles: ['lower-back'],
    equipment: ['barbell'],
  },
  {
    slug: 'conventional-deadlift',
    name: 'Conventional Deadlift',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['glutes', 'hamstrings'],
    secondaryMuscles: ['lower-back', 'upper-back', 'quadriceps'],
    equipment: ['barbell'],
  },
  {
    slug: 'sumo-deadlift',
    name: 'Sumo Deadlift',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['glutes', 'quadriceps'],
    secondaryMuscles: ['adductors', 'hamstrings', 'lower-back'],
    equipment: ['barbell'],
  },
  {
    slug: 'lying-leg-curl',
    name: 'Lying Leg Curl',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['hamstrings'],
    equipment: ['leg-curl-machine'],
  },
  {
    slug: 'seated-leg-curl',
    name: 'Seated Leg Curl',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['hamstrings'],
    equipment: ['leg-curl-machine'],
  },
  {
    slug: 'barbell-hip-thrust',
    name: 'Barbell Hip Thrust',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['hamstrings'],
    equipment: ['barbell', 'bench'],
  },
  {
    slug: 'glute-bridge',
    name: 'Glute Bridge',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['hamstrings'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'bulgarian-split-squat',
    name: 'Bulgarian Split Squat',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['quadriceps', 'glutes'],
    secondaryMuscles: ['hamstrings'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 'walking-lunge',
    name: 'Walking Lunge',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['quadriceps', 'glutes'],
    secondaryMuscles: ['hamstrings'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'standing-calf-raise',
    name: 'Standing Calf Raise',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['calves'],
    equipment: ['calf-raise-machine'],
  },
  {
    slug: 'seated-calf-raise',
    name: 'Seated Calf Raise',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['calves'],
    equipment: ['calf-raise-machine'],
  },
  {
    slug: 'hip-adduction-machine',
    name: 'Hip Adduction Machine',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['adductors'],
    equipment: ['adductor-machine'],
  },
  {
    slug: 'hip-abduction-machine',
    name: 'Hip Abduction Machine',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['abductors'],
    secondaryMuscles: ['glutes'],
    equipment: ['abductor-machine'],
  },

  // CORE
  {
    slug: 'plank',
    name: 'Plank',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['abs'],
    secondaryMuscles: ['obliques'],
    equipment: ['bodyweight', 'exercise-mat'],
  },
  {
    slug: 'side-plank',
    name: 'Side Plank',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['obliques'],
    secondaryMuscles: ['abs'],
    equipment: ['bodyweight', 'exercise-mat'],
  },
  {
    slug: 'cable-crunch',
    name: 'Cable Crunch',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['abs'],
    equipment: ['cable-machine'],
  },
  {
    slug: 'hanging-knee-raise',
    name: 'Hanging Knee Raise',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['abs'],
    secondaryMuscles: ['hip-flexors'],
    equipment: ['pull-up-bar'],
  },
  {
    slug: 'reverse-crunch',
    name: 'Reverse Crunch',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['abs'],
    secondaryMuscles: ['hip-flexors'],
    equipment: ['bodyweight', 'exercise-mat'],
  },
  {
    slug: 'russian-twist',
    name: 'Russian Twist',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['obliques'],
    secondaryMuscles: ['abs'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'ab-wheel-rollout',
    name: 'Ab Wheel Rollout',
    exerciseType: 'STRENGTH',
    primaryMuscles: ['abs'],
    secondaryMuscles: ['shoulders'],
    equipment: ['ab-wheel'],
  },

  // CARDIO
  {
    slug: 'treadmill-running',
    name: 'Treadmill Running',
    exerciseType: 'CARDIO',
    primaryMuscles: ['quadriceps', 'hamstrings', 'calves'],
    secondaryMuscles: ['glutes'],
    equipment: ['treadmill'],
  },
  {
    slug: 'stationary-cycling',
    name: 'Stationary Cycling',
    exerciseType: 'CARDIO',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['hamstrings', 'calves', 'glutes'],
    equipment: ['stationary-bike'],
  },
  {
    slug: 'rowing-machine-cardio',
    name: 'Rowing Machine',
    exerciseType: 'CARDIO',
    primaryMuscles: ['upper-back', 'lats'],
    secondaryMuscles: ['quadriceps', 'hamstrings', 'biceps'],
    equipment: ['rowing-machine'],
  },
  {
    slug: 'elliptical-training',
    name: 'Elliptical Training',
    exerciseType: 'CARDIO',
    primaryMuscles: ['quadriceps', 'glutes'],
    secondaryMuscles: ['hamstrings', 'calves'],
    equipment: ['elliptical-machine'],
  },

  // PLYOMETRICS
  {
    slug: 'box-jump',
    name: 'Box Jump',
    exerciseType: 'PLYOMETRIC',
    primaryMuscles: ['quadriceps', 'glutes'],
    secondaryMuscles: ['calves'],
    equipment: ['plyo-box'],
  },
  {
    slug: 'jump-squat',
    name: 'Jump Squat',
    exerciseType: 'PLYOMETRIC',
    primaryMuscles: ['quadriceps', 'glutes'],
    secondaryMuscles: ['calves'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'burpee',
    name: 'Burpee',
    exerciseType: 'PLYOMETRIC',
    primaryMuscles: ['chest', 'quadriceps'],
    secondaryMuscles: ['shoulders', 'abs'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'mountain-climber',
    name: 'Mountain Climber',
    exerciseType: 'CARDIO',
    primaryMuscles: ['abs'],
    secondaryMuscles: ['shoulders', 'quadriceps'],
    equipment: ['bodyweight'],
  },

  // MOBILITY
  {
    slug: 'cat-cow',
    name: 'Cat-Cow',
    exerciseType: 'MOBILITY',
    primaryMuscles: ['lower-back'],
    secondaryMuscles: ['abs'],
    equipment: ['bodyweight', 'exercise-mat'],
  },
  {
    slug: 'bird-dog',
    name: 'Bird Dog',
    exerciseType: 'MOBILITY',
    primaryMuscles: ['lower-back', 'abs'],
    secondaryMuscles: ['glutes'],
    equipment: ['bodyweight', 'exercise-mat'],
  },
  {
    slug: 'kneeling-hip-flexor-stretch',
    name: 'Kneeling Hip Flexor Stretch',
    exerciseType: 'MOBILITY',
    primaryMuscles: ['hip-flexors'],
    secondaryMuscles: ['quadriceps'],
    equipment: ['bodyweight', 'exercise-mat'],
  },
  {
    slug: 'thoracic-rotation',
    name: 'Thoracic Rotation',
    exerciseType: 'MOBILITY',
    primaryMuscles: ['upper-back'],
    secondaryMuscles: ['obliques'],
    equipment: ['bodyweight', 'exercise-mat'],
  },
];

function getRequiredId(
  map: Map<string, string>,
  slug: string,
  entity: string,
): string {
  const id = map.get(slug);

  if (!id) {
    throw new Error(`Unknown ${entity} slug: ${slug}`);
  }

  return id;
}

async function main() {
  let createdExercises = 0;
  let skippedExercises = 0;

  await prisma.$transaction(async (tx) => {
    const muscleGroupIds = new Map<string, string>();
    const equipmentIds = new Map<string, string>();

    // Seed muscle groups.
    for (const item of muscleGroups) {
      const record = await tx.muscleGroup.upsert({
        where: { slug: item.slug },
        update: {},
        create: item,
      });

      muscleGroupIds.set(item.slug, record.id);
    }

    // Seed equipment.
    for (const item of equipmentItems) {
      const record = await tx.equipment.upsert({
        where: { slug: item.slug },
        update: {},
        create: item,
      });

      equipmentIds.set(item.slug, record.id);
    }

    // Seed global exercises.
    for (const item of exercises) {
      const existing = await tx.exercise.findUnique({
        where: { slug: item.slug },
        select: { id: true },
      });

      // Do not overwrite existing exercises or reactivate archived ones.
      if (existing) {
        skippedExercises++;
        continue;
      }

      const exercise = await tx.exercise.create({
        data: {
          slug: item.slug,
          name: item.name,
          source: 'GLOBAL',
          visibility: null,
          exerciseType: item.exerciseType,
          createdById: null,
        },
      });

      const muscleLinks = [
        ...item.primaryMuscles.map((slug) => ({
          exerciseId: exercise.id,
          muscleGroupId: getRequiredId(muscleGroupIds, slug, 'muscle group'),
          role: 'PRIMARY' as const,
        })),
        ...(item.secondaryMuscles ?? []).map((slug) => ({
          exerciseId: exercise.id,
          muscleGroupId: getRequiredId(muscleGroupIds, slug, 'muscle group'),
          role: 'SECONDARY' as const,
        })),
      ];

      if (muscleLinks.length > 0) {
        await tx.exerciseMuscleGroup.createMany({
          data: muscleLinks,
        });
      }

      const equipmentLinks = item.equipment.map((slug) => ({
        exerciseId: exercise.id,
        equipmentId: getRequiredId(equipmentIds, slug, 'equipment'),
      }));

      if (equipmentLinks.length > 0) {
        await tx.exerciseEquipment.createMany({
          data: equipmentLinks,
        });
      }

      createdExercises++;
    }
  });

  console.info('Exercise seed completed.');
  console.info(`Muscle groups: ${muscleGroups.length}`);
  console.info(`Equipment items: ${equipmentItems.length}`);
  console.info(`Exercises created: ${createdExercises}`);
  console.info(`Exercises skipped: ${skippedExercises}`);
}

main()
  .catch((error: unknown) => {
    console.error('Exercise seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
