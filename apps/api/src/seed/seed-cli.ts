import { db } from '#db';
import { seedProductFixtures } from './seed.ts';

try {
  const result = await seedProductFixtures();
  console.log(
    JSON.stringify({
      outcome: 'seeded',
      workspaceId: result.workspaceId,
      integrationsCount: result.integrations.length,
      scenariosCount: result.scenarios.length,
      incidentsCount: result.incidentIds.length,
      sampleIncidentId: result.incidentIds[0] ?? null,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
} finally {
  await db.close();
}
