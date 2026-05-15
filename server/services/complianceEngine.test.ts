import { describe, it, expect, beforeEach, vi } from 'vitest';
import { evaluateCase, getLatestComplianceReport } from './complianceEngine';
import { db } from '../db';
import { storage } from '../storage';

// Mock database and storage
vi.mock('../db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  }
}));

vi.mock('../storage', () => ({
  storage: {
    upsertAction: vi.fn(),
  }
}));

const mockDb = db as any;
const mockStorage = storage as any;

describe('Compliance Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Certificate Current Rule (CERT_CURRENT)', () => {
    it('should be compliant when worker is at work', async () => {
      const mockCase = {
        id: 'case-1',
        workerName: 'Test Worker',
        company: 'Test Company',
        currentStatus: 'At work',
        dateOfInjury: new Date('2024-01-01'),
        workStatus: 'At work',
        clinicalStatusJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRules = [
        {
          id: 'rule-1',
          ruleCode: 'CERT_CURRENT',
          name: 'Certificate must be current',
          severity: 'high',
          isActive: true,
          recommendedAction: 'Request new certificate',
          documentReferences: [{ source: 'WorkSafe Manual', section: '4.1' }],
        }
      ];

      // Mock database responses
      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);

      // Set up mocks for the two different query patterns:
      // 1. Case query: db.select().from().where().limit()
      // 2. Rules query: db.select().from().where()
      let whereCallCount = 0;
      let limitCallCount = 0;

      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount === 1) {
          // First where() call is for case query - return mockDb to continue chain
          return mockDb;
        } else {
          // Second where() call is for rules query - return rules directly
          return Promise.resolve(mockRules);
        }
      });

      mockDb.limit.mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          // First limit() call is for case query
          return Promise.resolve([mockCase]);
        }
        return Promise.resolve([]);
      });

      const result = await evaluateCase('case-1');

      expect(result.caseId).toBe('case-1');
      expect(result.overallStatus).toBe('compliant');
      expect(result.complianceScore).toBeGreaterThanOrEqual(0);
    });

    it('should be non-compliant when worker is off work with expired certificate', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const mockCase = {
        id: 'case-2',
        workerName: 'Off Work Worker',
        company: 'Test Company',
        currentStatus: 'Off work',
        dateOfInjury: new Date('2024-01-01'),
        workStatus: 'Off work',
        clinicalStatusJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockExpiredCert = {
        id: 'cert-1',
        caseId: 'case-2',
        endDate: yesterday.toISOString(),
        startDate: new Date('2024-01-01').toISOString(),
      };

      const mockRules = [
        {
          id: 'rule-1',
          ruleCode: 'CERT_CURRENT',
          name: 'Certificate must be current',
          severity: 'high',
          isActive: true,
          recommendedAction: 'Request new certificate',
          documentReferences: [{ source: 'WorkSafe Manual', section: '4.1' }],
        }
      ];

      // Mock database responses
      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);

      // Set up mocks for the query patterns:
      // 1. Case query: db.select().from().where().limit()
      // 2. Rules query: db.select().from().where()
      // 3. Certificate query (during rule evaluation): db.select().from().where().orderBy().limit()
      let whereCallCount = 0;
      let limitCallCount = 0;

      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount === 1) {
          // First where() call is for case query
          return mockDb;
        } else if (whereCallCount === 2) {
          // Second where() call is for rules query
          return Promise.resolve(mockRules);
        } else {
          // Third where() call is for certificate query during rule evaluation
          return mockDb;
        }
      });

      mockDb.orderBy.mockReturnValue(mockDb);

      mockDb.limit.mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          // First limit() call is for case query
          return Promise.resolve([mockCase]);
        } else if (limitCallCount === 2) {
          // Second limit() call is for certificate query
          return Promise.resolve([mockExpiredCert]);
        }
        return Promise.resolve([]);
      });

      mockStorage.upsertAction.mockResolvedValue({ id: 'action-1' });
      mockDb.values.mockResolvedValue([]);

      const result = await evaluateCase('case-2');

      expect(result.overallStatus).toBe('non_compliant');
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].status).toBe('non_compliant');
      expect(result.checks[0].finding).toContain('expired');
      expect(mockStorage.upsertAction).toHaveBeenCalled();
    });
  });

  describe('RTW Plan 10 Week Rule (RTW_PLAN_10WK)', () => {
    it('should be compliant when injury is less than 10 weeks old', async () => {
      const recentInjury = new Date();
      recentInjury.setDate(recentInjury.getDate() - 30); // 4 weeks ago

      const mockCase = {
        id: 'case-3',
        workerName: 'Recent Injury',
        company: 'Test Company',
        currentStatus: 'Off work',
        dateOfInjury: recentInjury,
        workStatus: 'Off work',
        clinicalStatusJson: { rtwPlanStatus: 'not_planned' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRules = [
        {
          id: 'rule-2',
          ruleCode: 'RTW_PLAN_10WK',
          name: 'RTW plan within 10 weeks',
          severity: 'high',
          isActive: true,
          recommendedAction: 'Develop RTW plan',
          documentReferences: [{ source: 'WIRC Act', section: '55' }],
        }
      ];

      // Mock database responses
      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);

      // Set up mocks for the query patterns
      let whereCallCount = 0;
      let limitCallCount = 0;

      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount === 1) {
          // First where() call is for case query
          return mockDb;
        } else {
          // Second where() call is for rules query
          return Promise.resolve(mockRules);
        }
      });

      mockDb.limit.mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          // First limit() call is for case query
          return Promise.resolve([mockCase]);
        }
        return Promise.resolve([]);
      });

      mockDb.values.mockResolvedValue([]);

      const result = await evaluateCase('case-3');

      expect(result.checks[0].status).toBe('compliant');
      expect(result.checks[0].finding).toContain('4 weeks old');
    });

    it('should be non-compliant when no RTW plan after 10 weeks', async () => {
      const oldInjury = new Date();
      oldInjury.setDate(oldInjury.getDate() - 80); // ~11 weeks ago

      const mockCase = {
        id: 'case-4',
        workerName: 'Long Term Case',
        company: 'Test Company',
        currentStatus: 'Off work',
        dateOfInjury: oldInjury,
        workStatus: 'Off work',
        clinicalStatusJson: { rtwPlanStatus: 'not_planned' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRules = [
        {
          id: 'rule-2',
          ruleCode: 'RTW_PLAN_10WK',
          name: 'RTW plan within 10 weeks',
          severity: 'high',
          isActive: true,
          recommendedAction: 'Develop RTW plan immediately',
          documentReferences: [{ source: 'WIRC Act', section: '55' }],
        }
      ];

      // Mock database responses
      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);

      // Set up mocks for the query patterns
      let whereCallCount = 0;
      let limitCallCount = 0;

      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount === 1) {
          // First where() call is for case query
          return mockDb;
        } else {
          // Second where() call is for rules query
          return Promise.resolve(mockRules);
        }
      });

      mockDb.limit.mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          // First limit() call is for case query
          return Promise.resolve([mockCase]);
        }
        return Promise.resolve([]);
      });

      mockStorage.upsertAction.mockResolvedValue({ id: 'action-2' });
      mockDb.values.mockResolvedValue([]);

      const result = await evaluateCase('case-4');

      expect(result.checks[0].status).toBe('non_compliant');
      expect(result.checks[0].finding).toContain('11 weeks');
      expect(mockStorage.upsertAction).toHaveBeenCalledWith(
        'case-4',
        'review_case',
        expect.any(Date),
        expect.stringContaining('RTW Plan Development Required')
      );
    });
  });

  describe('Payment Step Down Rule (PAYMENT_STEPDOWN)', () => {
    it('should be compliant when worker has returned to work', async () => {
      const oldInjury = new Date();
      oldInjury.setDate(oldInjury.getDate() - 100); // >13 weeks ago

      const mockCase = {
        id: 'case-5',
        workerName: 'Returned Worker',
        company: 'Test Company',
        currentStatus: 'At work',
        dateOfInjury: oldInjury,
        workStatus: 'At work',
        clinicalStatusJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRules = [
        {
          id: 'rule-3',
          ruleCode: 'PAYMENT_STEPDOWN',
          name: 'Payment step-down after 13 weeks',
          severity: 'medium',
          isActive: true,
          recommendedAction: 'Implement payment step-down',
          documentReferences: [{ source: 'Claims Manual', section: '6.2' }],
        }
      ];

      // Mock database responses
      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);

      // Set up mocks for the query patterns
      let whereCallCount = 0;
      let limitCallCount = 0;

      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount === 1) {
          // First where() call is for case query
          return mockDb;
        } else {
          // Second where() call is for rules query
          return Promise.resolve(mockRules);
        }
      });

      mockDb.limit.mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          // First limit() call is for case query
          return Promise.resolve([mockCase]);
        }
        return Promise.resolve([]);
      });

      mockDb.values.mockResolvedValue([]);

      const result = await evaluateCase('case-5');

      expect(result.checks[0].status).toBe('compliant');
      expect(result.checks[0].finding).toContain('returned to work');
    });
  });

  describe('Integration Tests', () => {
    it('should calculate overall compliance status correctly', async () => {
      const mockCase = {
        id: 'case-6',
        workerName: 'Multi Rule Test',
        company: 'Test Company',
        currentStatus: 'Off work',
        dateOfInjury: new Date('2024-01-01'),
        workStatus: 'Off work',
        clinicalStatusJson: { rtwPlanStatus: 'failing' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRules = [
        {
          id: 'rule-1',
          ruleCode: 'CERT_CURRENT',
          name: 'Certificate must be current',
          severity: 'high',
          isActive: true,
          recommendedAction: 'Request new certificate',
          documentReferences: [],
        },
        {
          id: 'rule-2',
          ruleCode: 'RTW_PLAN_10WK',
          name: 'RTW plan within 10 weeks',
          severity: 'critical',
          isActive: true,
          recommendedAction: 'Develop RTW plan',
          documentReferences: [],
        }
      ];

      // Mock database responses
      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);

      // Set up mocks for the query patterns
      let whereCallCount = 0;
      let limitCallCount = 0;

      mockDb.where.mockImplementation(() => {
        whereCallCount++;
        if (whereCallCount === 1) {
          // First where() call is for case query
          return mockDb;
        } else if (whereCallCount === 2) {
          // Second where() call is for rules query
          return Promise.resolve(mockRules);
        } else {
          // Additional where() calls during rule evaluation (certificates, etc.)
          return mockDb;
        }
      });

      mockDb.orderBy.mockReturnValue(mockDb);

      mockDb.limit.mockImplementation(() => {
        limitCallCount++;
        if (limitCallCount === 1) {
          // First limit() call is for case query
          return Promise.resolve([mockCase]);
        }
        // Additional limit() calls during rule evaluation
        return Promise.resolve([]);
      });

      mockStorage.upsertAction.mockResolvedValue({ id: 'action-1' });
      mockDb.values.mockResolvedValue([]);

      const result = await evaluateCase('case-6');

      expect(result.checks).toHaveLength(2);
      expect(result.criticalIssues + result.highIssues + result.mediumIssues + result.lowIssues).toBeGreaterThan(0);
      expect(['compliant', 'warning', 'non_compliant']).toContain(result.overallStatus);
    });
  });

  describe('getLatestComplianceReport', () => {
    it('should retrieve latest compliance checks for a case', async () => {
      const mockChecks = [
        {
          ruleCode: 'CERT_CURRENT',
          ruleName: 'Certificate must be current',
          status: 'compliant',
          severity: 'high',
          finding: 'Certificate is current',
          recommendation: null,
          documentReferences: [{ source: 'WorkSafe Manual', section: '4.1' }],
        }
      ];

      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);
      mockDb.innerJoin.mockReturnValue(mockDb);
      mockDb.where.mockReturnValue(mockDb);
      mockDb.orderBy.mockResolvedValue(mockChecks);

      const result = await getLatestComplianceReport('case-1');

      expect(result).toHaveLength(1);
      expect(result[0].ruleCode).toBe('CERT_CURRENT');
      expect(result[0].status).toBe('compliant');
    });
  });

  describe('Preventative cases (no claim)', () => {
    it('should short-circuit to compliant for cases with null claimNumber', async () => {
      const mockPreventativeCase = {
        id: 'case-naomi',
        workerName: 'Naomi Wright',
        company: 'Wallara',
        currentStatus: 'At work',
        dateOfInjury: new Date('2026-05-11'),
        workStatus: 'At work',
        clinicalStatusJson: null,
        claimNumber: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);
      mockDb.where.mockReturnValue(mockDb);
      mockDb.limit.mockResolvedValue([mockPreventativeCase]);
      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await evaluateCase('case-naomi');

      expect(result.caseId).toBe('case-naomi');
      expect(result.overallStatus).toBe('compliant');
      expect(result.complianceScore).toBe(100);
      expect(result.checks).toEqual([]);
      expect(result.criticalIssues).toBe(0);
      expect(result.highIssues).toBe(0);
    });

    it('should short-circuit to compliant for cases with empty-string claimNumber', async () => {
      const mockPreventativeCase = {
        id: 'case-empty-claim',
        workerName: 'Preventative Worker',
        company: 'Test',
        currentStatus: 'At work',
        dateOfInjury: new Date('2026-05-01'),
        workStatus: 'At work',
        clinicalStatusJson: null,
        claimNumber: '   ',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockReturnValue(mockDb);
      mockDb.from.mockReturnValue(mockDb);
      mockDb.where.mockReturnValue(mockDb);
      mockDb.limit.mockResolvedValue([mockPreventativeCase]);
      mockDb.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await evaluateCase('case-empty-claim');

      expect(result.overallStatus).toBe('compliant');
      expect(result.checks).toEqual([]);
    });
  });
});