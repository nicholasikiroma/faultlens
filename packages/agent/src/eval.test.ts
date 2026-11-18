import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenarioRepository, GOLDEN_SCENARIOS } from './eval-scenarios.ts';
import { MockModelProvider, runInvestigationAgent } from './index.ts';

for (const scenario of GOLDEN_SCENARIOS) {
  test(`golden eval: ${scenario.name}`, async () => {
    const { incident, repo } = buildScenarioRepository(scenario);
    const evidenceIds = scenario.evidence.map((e) => e.id);
    const provider = new MockModelProvider([
      {
        content: null,
        toolCalls: [
          { id: 't1', name: 'get_incident', arguments: {} },
          { id: 't2', name: 'get_rule_findings', arguments: {} },
          ...(evidenceIds.length > 0
            ? [{ id: 't3', name: 'get_evidence', arguments: { evidenceIds } }]
            : [{ id: 't3', name: 'list_event_attempts', arguments: { limit: 5 } }]),
        ],
      },
      {
        content: JSON.stringify(scenario.diagnosisJson),
        toolCalls: [],
      },
    ]);

    const result = await runInvestigationAgent({
      workspaceId: 'workspace-1',
      incidentId: incident.id,
      provider,
      repo,
    });

    assert.ok(result.output);
    const first = result.output.hypotheses[0];
    assert.ok(first);
    assert.equal(first.epistemicStatus, scenario.expectedEpistemic);
    assert.equal(first.remediation?.kind ?? null, scenario.expectedRemediationKind);
    if (scenario.expectedEpistemic === 'UNVERIFIED') {
      assert.equal(result.state, 'NEEDS_REVIEW');
    } else {
      assert.equal(result.state, 'COMPLETED');
      assert.ok(first.citedEvidenceIds.length > 0);
    }
  });
}
