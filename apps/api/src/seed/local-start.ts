import { db } from '#db';
import { startWorker } from '../../../worker/src/main.ts';
import { config } from '../config.ts';
import { startApiServer } from '../http/server.ts';
import { seedProductFixtures } from './seed.ts';

if (!process.env['WIRESLEUTH_ADMIN_TOKEN']) {
  process.env['WIRESLEUTH_ADMIN_TOKEN'] = 'local-dev-admin-token';
}
if (!process.env['WIRESLEUTH_WORKSPACE_ID']) {
  process.env['WIRESLEUTH_WORKSPACE_ID'] = 'workspace-1';
}
if (!process.env['WIRESLEUTH_ADMIN_ACTOR']) {
  process.env['WIRESLEUTH_ADMIN_ACTOR'] = 'local-admin';
}

const seeded = await seedProductFixtures();
const worker = await startWorker();
const api = await startApiServer();
const sampleIncidentId = seeded.incidentIds[0] ?? '';

console.log(
  JSON.stringify({
    status: 'ready',
    apiUrl: api.url,
    workspaceId: seeded.workspaceId,
    scenariosCount: seeded.scenarios.length,
    incidentsCount: seeded.incidentIds.length,
    sampleIncidentId,
    inspectIncidentCurl: `curl -s -H "Authorization: Bearer ${config.adminToken}" "${api.url}/v1/incidents/${sampleIncidentId}/export"`,
  }),
);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await api.close();
    await worker.close();
  } catch (error) {
    console.error('Local backend shutdown failed', error);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
