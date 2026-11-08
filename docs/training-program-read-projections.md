# Training program read projections

This document describes database projections, not a new API version.

## Existing behavior

- `GET /training-programs` returns a lightweight paginated program list.
- `GET /training-programs/:id/versions` already returns version metadata,
  without nested workouts/exercises/sets.
- `GET /training-programs/:id/versions/:versionId` returns full version
  details for the program editor.
- `GET /training-programs/assignments/:assignmentId` returns full assignment
  details for an authorized actor. Historical trainer views remain redacted.

## Assignment lists for mobile/web

The assignment listing endpoints support an optional `view` query parameter:

- `GET /training-programs/assignments` (or `?view=full`): existing format,
  including workout instances on active assignments.
- `GET /training-programs/assignments?view=summary`: same list metadata and
  authorization rules, **without** the potentially large `workouts` array
  for active assignments.

The `view=summary` shape intentionally omits the `workouts` property; it
does not return an empty array. Clients that need the complete assignment
should request `GET /training-programs/assignments/:assignmentId`.

## Internal access checks

`TrainingProgramAccessService` uses
`trainingProgramDraftAccessSelect`, which loads only the draft status,
duration, and IDs/order of child records needed by editing validations.
Full read response projections remain unchanged.

A later optimization can replace the remaining nested ID tree with targeted
existence queries and can add pagination to assignment workout history.

## Compatibility

The default assignment list format and existing route responses are unchanged.
No Prisma migration is required. The summary view is opt-in.
