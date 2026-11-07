export function exportIncident(_incidentId: string): Promise<{
  incidentId: string;
  findings: readonly { evidenceIds: readonly string[] }[];
}> {
  throw new Error('not implemented');
}
