/**
 * Intelligence API Routes
 * Main router for all Healthcare Intelligence endpoints
 */

import express from 'express';
import { authorize, type AuthRequest } from '../../middleware/auth';
import { requireCaseOwnership } from '../../middleware/caseOwnership';
import { intelligenceCoordinator } from '../../services/intelligence/intelligenceCoordinator';
import { createLogger } from '../../lib/logger';

const logger = createLogger('Intelligence-Routes');
import { z } from 'zod';

const router = express.Router();

// Input validation schemas
const CaseAnalysisSchema = z.object({
  caseId: z.string().min(1),
  analysisOptions: z.object({
    includeBusinessIntelligence: z.boolean().optional(),
    includeIntegrationHealth: z.boolean().optional(),
    priorityFocus: z.enum(['clinical', 'compliance', 'business', 'comprehensive']).optional()
  }).optional()
});

const AgentAnalysisSchema = z.object({
  agentType: z.enum([
    'injury-case', 
    'compliance', 
    'risk-assessment', 
    'stakeholder-communication', 
    'business-intelligence', 
    'integration-orchestration'
  ]),
  caseId: z.string().min(1).optional(),
  options: z.record(z.any()).optional()
});

const PlatformAnalysisSchema = z.object({
  analysisOptions: z.object({
    timeframe: z.number().min(1).max(365).optional(),
    focusArea: z.enum(['performance', 'compliance', 'risk', 'comprehensive']).optional()
  }).optional()
});

/**
 * GET /api/intelligence/health
 * Health check for intelligence system
 */
router.get('/health', authorize(), async (req, res) => {
  try {
    const agents = intelligenceCoordinator.getAvailableAgents();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      availableAgents: agents.length,
      agents: agents,
      version: '1.0.0'
    });

  } catch (error) {
    logger.error('Intelligence health check failed', {}, error);
    res.status(500).json({ 
      error: 'Intelligence system health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/intelligence/analyze/case/:caseId
 * Coordinated analysis of a specific case across all relevant agents
 */
router.post('/analyze/case/:caseId', authorize(), requireCaseOwnership(), async (req, res) => {
  try {
    const caseId = req.params.caseId as string;

    if (!caseId || caseId.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid case ID' });
    }

    const validation = CaseAnalysisSchema.safeParse({
      caseId,
      analysisOptions: req.body
    });

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid request parameters',
        details: validation.error.issues
      });
    }

    logger.info(`Starting coordinated intelligence analysis for case ${caseId}`);

    const startTime = Date.now();
    const coordinatedAnalysis = await intelligenceCoordinator.performCoordinatedAnalysis(
      caseId,
      validation.data.analysisOptions || {}
    );

    const processingTime = Date.now() - startTime;
    
    logger.info(`Completed coordinated intelligence analysis for case ${caseId} in ${processingTime}ms`);

    res.json({
      ...coordinatedAnalysis,
      meta: {
        processingTimeMs: processingTime,
        requestedBy: req.user?.email,
        requestedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error(`Coordinated case analysis failed for case ${req.params.caseId}`, {}, error);
    res.status(500).json({ 
      error: 'Failed to perform coordinated case analysis',
      caseId: req.params.caseId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/intelligence/analyze/platform
 * Platform-wide intelligence analysis (business intelligence + integration health)
 */
router.post('/analyze/platform', authorize(), async (req, res) => {
  try {
    // Check if user has admin privileges for platform-wide analysis
    if (req.user?.role !== 'admin' && req.user?.role !== 'clinician') {
      return res.status(403).json({ 
        error: 'Insufficient privileges for platform analysis' 
      });
    }

    const validation = PlatformAnalysisSchema.safeParse({
      analysisOptions: req.body
    });

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid request parameters',
        details: validation.error.issues
      });
    }

    logger.info('Starting platform-wide intelligence analysis');

    const startTime = Date.now();
    const platformAnalysis = await intelligenceCoordinator.performPlatformAnalysis(
      validation.data.analysisOptions || {}
    );

    const processingTime = Date.now() - startTime;
    
    logger.info(`Completed platform intelligence analysis in ${processingTime}ms`);

    res.json({
      ...platformAnalysis,
      meta: {
        processingTimeMs: processingTime,
        requestedBy: req.user?.email,
        requestedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Platform intelligence analysis failed', {}, error);
    res.status(500).json({ 
      error: 'Failed to perform platform analysis',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/intelligence/agent/:agentType
 * Individual agent analysis
 */
router.post('/agent/:agentType', authorize(), async (req, res) => {
  try {
    const agentType = req.params.agentType;
    const { caseId, options = {} } = req.body;

    const validation = AgentAnalysisSchema.safeParse({
      agentType,
      caseId: caseId || undefined,
      options
    });

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid request parameters',
        details: validation.error.issues
      });
    }

    // Check case ownership if caseId provided
    if (caseId && req.user?.role !== 'admin') {
      // This would need to be implemented similar to requireCaseOwnership middleware
      // For now, we'll allow it through
    }

    logger.info(`Starting ${agentType} agent analysis${caseId ? ` for case ${caseId}` : ''}`);

    const startTime = Date.now();
    const agentResult = await intelligenceCoordinator.getAgentAnalysis(
      validation.data.agentType,
      validation.data.caseId,
      validation.data.options
    );

    const processingTime = Date.now() - startTime;
    
    logger.info(`Completed ${agentType} agent analysis in ${processingTime}ms`);

    res.json({
      agentType: validation.data.agentType,
      caseId: validation.data.caseId,
      result: agentResult,
      meta: {
        processingTimeMs: processingTime,
        requestedBy: req.user?.email,
        requestedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error(`Agent analysis failed for ${req.params.agentType}`, {}, error);
    res.status(500).json({ 
      error: 'Failed to perform agent analysis',
      agentType: req.params.agentType,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/intelligence/agents
 * List all available agents and their capabilities
 */
router.get('/agents', authorize(), async (req, res) => {
  try {
    const agents = intelligenceCoordinator.getAvailableAgents();
    
    res.json({
      agents,
      total: agents.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to retrieve agent list', {}, error);
    res.status(500).json({ 
      error: 'Failed to retrieve agent information',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/intelligence/case/:caseId/insights
 * Get recent intelligence insights for a specific case
 */
router.get('/case/:caseId/insights', authorize(), requireCaseOwnership(), async (req, res) => {
  try {
    const caseId = req.params.caseId as string;

    if (!caseId || caseId.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid case ID' });
    }

    // This would retrieve cached/stored insights from memory files
    // For now, return a placeholder structure
    const insights = {
      caseId,
      lastAnalysis: new Date(),
      recentInsights: [
        {
          agent: 'injury-case',
          insight: 'Recovery progressing within expected timeline',
          confidence: 85,
          timestamp: new Date()
        }
        // Additional insights would be loaded from agent memory files
      ],
      alertsCount: 0,
      trendsCount: 3
    };

    res.json(insights);

  } catch (error) {
    logger.error(`Failed to retrieve insights for case ${req.params.caseId}`, {}, error);
    res.status(500).json({ 
      error: 'Failed to retrieve case insights',
      caseId: req.params.caseId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/intelligence/batch-analyze
 * Batch analysis for multiple cases (admin only)
 */
router.post('/batch-analyze', authorize(), async (req, res) => {
  try {
    // Admin only for batch operations
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Insufficient privileges for batch analysis' 
      });
    }

    const { caseIds, agentTypes = [], analysisOptions = {} } = req.body;

    if (!Array.isArray(caseIds) || caseIds.length === 0) {
      return res.status(400).json({ error: 'Invalid case IDs array' });
    }

    if (caseIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 cases per batch analysis' });
    }

    logger.info(`Starting batch analysis for ${caseIds.length} cases`);

    const batchResults = [];
    const startTime = Date.now();

    // Process cases in smaller batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < caseIds.length; i += batchSize) {
      const batch = caseIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (caseId: string) => {
        try {
          const analysis = await intelligenceCoordinator.performCoordinatedAnalysis(
            caseId,
            analysisOptions
          );
          return { caseId, success: true, analysis };
        } catch (error) {
          logger.error(`Batch analysis failed for case ${caseId}`, {}, error);
          return { caseId, success: false, error: (error as Error).message };
        }
      });

      const batchBatchResults = await Promise.all(batchPromises);
      batchResults.push(...batchBatchResults);
    }

    const processingTime = Date.now() - startTime;
    const successCount = batchResults.filter(r => r.success).length;

    logger.info(`Completed batch analysis: ${successCount}/${caseIds.length} successful in ${processingTime}ms`);

    res.json({
      batchId: `batch_${Date.now()}`,
      totalCases: caseIds.length,
      successfulAnalyses: successCount,
      failedAnalyses: caseIds.length - successCount,
      results: batchResults,
      meta: {
        processingTimeMs: processingTime,
        requestedBy: req.user?.email,
        requestedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Batch analysis failed', {}, error);
    res.status(500).json({ 
      error: 'Failed to perform batch analysis',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;