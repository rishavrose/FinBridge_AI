import type { FastifyInstance } from 'fastify';
import { authenticateRequest } from '../../middleware/auth.js';
import {
  getActiveAlerts, getAlertHistory, acknowledgeAlert,
  createIncident, listIncidents, updateIncident,
} from '../../alerts/engine.js';

export async function alertRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticateRequest);

  /** GET /alerts — active alerts */
  fastify.get('/alerts', async (_req, reply) => {
    const alerts = await getActiveAlerts();
    return reply.send({ alerts, count: alerts.length });
  });

  /** GET /alerts/history — last 50 alert events */
  fastify.get<{ Querystring: { limit?: string } }>('/alerts/history', async (req, reply) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const history = await getAlertHistory(limit);
    return reply.send({ history, count: history.length });
  });

  /** PATCH /alerts/:id/acknowledge */
  fastify.patch<{ Params: { id: string } }>('/alerts/:id/acknowledge', async (req, reply) => {
    const ok = await acknowledgeAlert(req.params.id, (req as any).user?.sub ?? 'unknown');
    if (!ok) return reply.status(404).send({ error: 'Alert not found' });
    return reply.send({ acknowledged: true });
  });

  /** GET /incidents */
  fastify.get('/incidents', async (_req, reply) => {
    const incidents = await listIncidents();
    return reply.send({ incidents, count: incidents.length });
  });

  /** POST /incidents */
  fastify.post<{
    Body: {
      title: string; description: string; severity: string;
      affectedSystem: string; status?: string;
    }
  }>('/incidents', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'description', 'severity', 'affectedSystem'],
        properties: {
          title:          { type: 'string' },
          description:    { type: 'string' },
          severity:       { type: 'string', enum: ['info', 'warning', 'critical'] },
          affectedSystem: { type: 'string' },
          status:         { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const incident = await createIncident({
      title: req.body.title,
      description: req.body.description,
      severity: req.body.severity as any,
      affectedSystem: req.body.affectedSystem,
      status: (req.body.status as any) ?? 'open',
      alerts: [],
    });
    return reply.status(201).send({ incident });
  });

  /** PATCH /incidents/:id */
  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/incidents/:id', async (req, reply) => {
      const updated = await updateIncident(req.params.id, req.body as any);
      if (!updated) return reply.status(404).send({ error: 'Incident not found' });
      return reply.send({ incident: updated });
    },
  );
}
